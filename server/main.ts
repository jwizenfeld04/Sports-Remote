import { join } from "node:path";
import type { LocalGuide } from "../lib/types";
import { loadConfig } from "./config";
import { makeAdbExec } from "./adb";
import { PlexClient, PlexError } from "./plex";
import { lanAddresses } from "./tv/discovery";
import { MlbSchedule } from "./mlb";
import { NbaSchedule } from "./nba";
import { EspnWatch } from "./espnWatch";
import { makeTesseract, makeTesseractBoxes, tesseractAvailable } from "./ocr";
import { EspnPoller } from "./espnPoller";
import { buildApp, SseHub, VERSION, type Integrations } from "./app";
import { installShutdown } from "./shutdown";
import { AuthService, JsonFileAuthStore } from "./auth";
import { ConfigError, ConfigStore } from "./store/config";
import { TvManager } from "./tv/manager";

const log = (e: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...e }));

process.on("unhandledRejection", (e) => log({ evt: "unhandled_rejection", error: (e as Error)?.stack?.split("\n").slice(0, 4).join(" | ") ?? String(e) }));
process.on("uncaughtException", (e) => {
  log({ evt: "uncaught_exception", error: e.stack?.split("\n").slice(0, 4).join(" | ") ?? String(e) });
  process.exit(1); // systemd / Docker restarts it
});

const cfg = loadConfig();
for (const k of cfg.ignored) log({ evt: "config_warning", message: `${k} is no longer used: access is configured on the setup page (see docs/ARCHITECTURE.md, Access control).` });

const store = new ConfigStore(cfg.dataDir);
try {
  await store.load(cfg.legacy);
} catch (e) {
  // Never start on defaults over a config we couldn't read: that would lose the household's setup.
  log({ evt: "config_error", error: (e as Error).message });
  console.error((e as Error).message);
  process.exit(e instanceof ConfigError ? 78 : 1); // 78 = EX_CONFIG: systemd's RestartPreventExitStatus can stop the loop
}
if (store.migratedFrom) log({ evt: "config_migrated", from: store.migratedFrom, file: store.configFile });

/** Best guess at a URL people can open, for the first-run setup link. */
function baseUrl(): string {
  if (cfg.publicUrl) return cfg.publicUrl;
  let host = cfg.bind;
  if (host === "0.0.0.0" || host === "::") {
    // The home network address people's phones use: real interfaces first (not Docker, Tailscale or VPNs).
    host = lanAddresses().sort((a, b) => Number(!/^(192\.168|10)\./.test(a)) - Number(!/^(192\.168|10)\./.test(b)))[0] ?? "127.0.0.1";
  }
  return `http://${host.includes(":") ? `[${host}]` : host}:${cfg.port}`;
}

const auth = await AuthService.open({
  store: new JsonFileAuthStore(join(cfg.dataDir, "auth.json")),
  trustedProxies: cfg.trustedProxies,
  sessionLifetimeMs: cfg.sessionDays * 86400_000,
  log,
  setupUrl: (token) => `${baseUrl()}/setup?token=${token}`,
  lanAddresses: lanAddresses(),
});

// Optional integrations, rebuilt when their settings change.
let plex: PlexClient | null = null;
let espn: EspnWatch | null = null;
let plexState: "ok" | "down" | "unconfigured" = "unconfigured";
function buildIntegrations() {
  const c = store.get(), s = store.getSecrets();
  try {
    plex = c.integrations.plex && s.plexToken ? new PlexClient({ url: c.integrations.plex.url, token: s.plexToken, playerId: c.integrations.plex.playerId, channelMap: c.integrations.plex.channelMap }) : null;
    plexState = plex ? "down" : "unconfigured";
  } catch (e) {
    // A bad saved Plex address mustn't stop the server: Plex is just off until it's fixed in setup.
    plex = null;
    plexState = "down";
    log({ evt: "config_warning", message: `Plex is off: ${(e as Error).message}. Fix it in Setup → Extras.` });
  }
  espn = c.integrations.espnWatch && s.espnWatchApiKey ? new EspnWatch(s.espnWatchApiKey) : null;
}
buildIntegrations();

// Routes that drive an app by reading its screen need tesseract (apt install tesseract-ocr); without it they're skipped.
const ocr = (await tesseractAvailable()) ? { ocr: makeTesseract(), boxes: makeTesseractBoxes() } : null;
const adb = makeAdbExec(cfg.adbBin);
const adbOk = (await adb(["version"], 5000).catch(() => ({ code: 1 }))).code === 0;
if (!adbOk) log({ evt: "adb_missing", message: `Can't run "${cfg.adbBin}". Install adb (apt install adb) or set ADB_BIN; TVs can't be reached until then.` });
if (!ocr) log({ evt: "ocr_missing", message: "tesseract isn't installed: YouTube TV, Prime Video and Plex open to the app instead of the game (apt install tesseract-ocr)." });
const tvs = new TvManager({
  exec: adb,
  adbBin: cfg.adbBin,
  keyBackends: cfg.keyBackends,
  ocr,
  log,
  plexState: () => plexState,
  // Saving the new port re-syncs the TVs (store.onChange below), which reconnects on it.
  onPortChange: (id, port) => void store.update((c) => void (c.tvs = c.tvs.map((t) => (t.id === id ? { ...t, port } : t)))).catch((e) => log({ evt: "server_error", error: (e as Error).message })),
  shared: {
    // Getters, so a changed Plex or ESPN setting applies without a restart.
    get plex() { return plex; },
    get espn() { return espn; },
    mlb: new MlbSchedule(),
    nba: new NbaSchedule(),
    log,
  },
});
tvs.sync(store.get().tvs);

const poller = new EspnPoller();
const events = new SseHub();
let guide: LocalGuide | null = null;

events.onCountChange = (n) => {
  poller.clients = n;
  if (n === 1) poller.poke();
};
poller.on("games", (snap) => events.send("games", { games: snap.games, fetchedAt: snap.fetchedAt, stale: snap.stale, feedError: snap.error }));
poller.on("poll_error", (error: string) => log({ evt: "espn_error", error }));
tvs.onStatus = (s) => events.send("tv", { ...s, apps: tvs.installedApps(s.id) });
store.onChange((c) => tvs.sync(c.tvs));

async function refreshGuide() {
  if (!plex) return;
  try {
    guide = await plex.localGuide();
    plexState = "ok";
    events.send("guide", guide);
  } catch (e) {
    plexState = "down";
    log({ evt: "plex_guide_error", error: (e as Error).message });
  }
}

const integrations: Integrations = {
  async reload() {
    buildIntegrations();
    guide = null;
    await refreshGuide();
  },
  plexStatus: () => plexState,
  async testPlex(url, token) {
    try {
      const client = new PlexClient({ url, token, channelMap: store.get().integrations.plex?.channelMap });
      const channels = await client.channels();
      return { ok: true, channels: channels.map((c) => ({ callSign: c.callSign, network: c.network })) };
    } catch (e) {
      // Only our own fixed messages go back to the browser, never raw error text (it could echo another server's reply).
      return { ok: false, error: e instanceof PlexError ? e.message : "Couldn't reach Plex at that address" };
    }
  },
};

const app = buildApp({
  poller, store, tvs, adb, integrations, events, auth,
  capabilities: { adb: adbOk, ocr: !!ocr },
  guide: () => guide,
  allowedHosts: cfg.allowedHosts,
  staticDir: cfg.staticDir,
  log: true,
  event: log,
});
await app.listen({ host: cfg.bind, port: cfg.port });

poller.start();
void refreshGuide();
void tvs.watchdog();
const timers = [setInterval(refreshGuide, 5 * 60_000), setInterval(() => void tvs.watchdog(), 15_000), setInterval(() => events.ping(), 25_000)];

// --- graceful shutdown (SIGTERM/SIGINT): see server/shutdown.ts ---
installShutdown({ servers: [app], timers, cleanup: [() => poller.stop(), () => tvs.close()], log });
log({
  evt: "started", version: VERSION, port: cfg.port, bind: cfg.bind, authMode: auth.mode, trustedProxies: auth.trustedProxies,
  setupComplete: store.get().setupComplete, tvs: store.get().tvs.map((t) => `${t.id}=${t.platform}@${t.host}:${t.port}`),
  subscriptions: store.get().subscriptions.map((s) => s.id), plex: !!plex, espn: !!espn, ocr: !!ocr,
});
