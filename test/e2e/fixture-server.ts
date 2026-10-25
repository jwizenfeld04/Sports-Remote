// Runs the real Fastify app against fixture games and the fake adb binary, for Playwright.
// Same code paths as production except the ESPN fetch and the adb binary.
import { mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, SseHub } from "../../server/app";
import { EspnPoller } from "../../server/espnPoller";
import { ConfigStore } from "../../server/store/config";
import { TvManager } from "../../server/tv/manager";
import { makeAdbExec } from "../../server/adb";
import { AuthService, MemoryAuthStore } from "../../server/auth";
import { MLB, NBA, NFL, NHL } from "../fixtures/espn";

const fakeAdb = join(import.meta.dirname, "../fake-adb.mjs");
chmodSync(fakeAdb, 0o755);
process.env.FAKE_ADB_SERIAL = "10.0.0.5:5555";
process.env.FAKE_ADB_FG = process.env.FAKE_ADB_FG ?? "com.fox.one";

const fetchImpl = (async (url: string) =>
  new Response(JSON.stringify(url.includes("/nfl/") ? NFL : url.includes("/nba/") ? NBA : url.includes("/mlb/") ? MLB : NHL))) as typeof fetch;
const poller = new EspnPoller(fetchImpl, () => new Date("2026-10-18T21:00:00Z"));
await poller.pollOnce();

// The v1 household (New York, one Fire TV at 10.0.0.5), with setup finished. E2E_SETUP=1 starts it unfinished.
const store = new ConfigStore(mkdtempSync(join(tmpdir(), "sr-e2e-")));
await store.load({ FIRETV_HOST: "10.0.0.5" });
await store.update((c) => {
  c.setupComplete = process.env.E2E_SETUP !== "1";
  c.preferences.favorites = ["nfl:LAC", "mlb:LAD", "nhl:LA", "mlb:NYM", "nfl:NYG"];
});

const adb = makeAdbExec(fakeAdb);
const tvs = new TvManager({ exec: adb, adbBin: fakeAdb, shared: { verifyTimeoutMs: 1000 } });
tvs.sync(store.get().tvs);
await tvs.watchdog();

const app = buildApp({
  poller, store, tvs, adb, events: new SseHub(),
  integrations: { reload: async () => {}, plexStatus: () => "unconfigured", testPlex: async () => ({ ok: false, error: "not in e2e" }) },
  guide: () => null,
  // Proxy mode: signed in via the Tailscale identity header, which Playwright sends from loopback
  // (a trusted proxy here). PIN and account logins are covered by unit tests.
  auth: await AuthService.open({
    store: new MemoryAuthStore({
      version: 1, mode: "proxy", users: [], sessions: [],
      proxy: { header: "Tailscale-User-Login", admins: ["e2e@example.com"], members: [], allowAnyAuthenticated: false },
    }),
    trustedProxies: ["loopback"],
  }),
  allowedHosts: [],
  staticDir: join(import.meta.dirname, "../../dist/web"),
});
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 8799) });
console.log("e2e server ready");
