import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, LogController } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import type { LaunchResult, LocalGuide } from "../lib/types";
import { GAME_ID_RE } from "../lib/types";
import { resolveGame, isResolvedRoute, type ResolveContext } from "../lib/resolve";
import { renderOutcome } from "../lib/messages";
import { APP_BY_ID } from "../lib/catalog/apps";
import { NETWORK_IDS } from "../lib/catalog/networks";
import { SUBSCRIPTION_BY_ID } from "../lib/catalog/subscriptions";
import { MarketZ, OwnedSubscriptionZ, PreferencesZ, type Config, type Tv } from "../lib/profile";
import type { EspnPoller } from "./espnPoller";
import type { ConfigStore } from "./store/config";
import type { TvManager } from "./tv/manager";
import { isAllowedKey, type AdbExec } from "./adb";
import { can, installAuth, requirePermission, type AuthService } from "./auth";
import { WindowLimiter } from "./auth/rateLimit";
import { connectTv, findConnectPort, identifyTv, pairTv, waitForApproval } from "./tv/pairing";
import { lanPrefixes, scanForAdb } from "./tv/discovery";
import { browseAdb } from "./tv/mdns";
import { APPS } from "../lib/catalog/apps";

export const VERSION = "0.2.0";

export interface Integrations {
  /** Re-read Plex/ESPN settings after they change. */
  reload(): Promise<void>;
  plexStatus(): "ok" | "down" | "unconfigured";
  /** Try a Plex URL + token before saving it. */
  testPlex(url: string, token: string): Promise<{ ok: boolean; error?: string; channels?: { callSign: string; network: string | null }[] }>;
}

export interface AppDeps {
  /** What this server can do: adb installed, OCR (tesseract) installed. Default: both. */
  capabilities?: { adb: boolean; ocr: boolean };
  poller: EspnPoller;
  store: ConfigStore;
  tvs: TvManager;
  adb: AdbExec;
  integrations: Integrations;
  guide: () => LocalGuide | null;
  auth: AuthService;
  /** Extra Host header values to accept (DNS-rebinding defense), e.g. "games.example.com". */
  allowedHosts: string[];
  staticDir?: string;
  events: SseHub;
  log?: boolean;
  /** Structured event sink (one JSON line per event); journald keeps them. */
  event?: (entry: Record<string, unknown>) => void;
}

/** Fan-out for Server-Sent Events. */
export class SseHub {
  private clients = new Map<FastifyReply, string>(); // stream -> client IP
  onCountChange?: (n: number) => void;
  constructor(private limits = { total: 64, perIp: 8 }) {}
  /** False when there are already too many streams (in all, or from this address). */
  add(r: FastifyReply, ip = ""): boolean {
    if (this.clients.size >= this.limits.total) return false;
    let fromIp = 0;
    for (const v of this.clients.values()) if (v === ip) fromIp++;
    if (fromIp >= this.limits.perIp) return false;
    this.clients.set(r, ip);
    this.onCountChange?.(this.clients.size);
    return true;
  }
  remove(r: FastifyReply) {
    if (!this.clients.delete(r)) return;
    this.onCountChange?.(this.clients.size);
  }
  get size() {
    return this.clients.size;
  }
  private write(msg: string) {
    for (const c of [...this.clients.keys()]) {
      // A client that stopped reading would make us buffer every update for it: drop it (it reconnects when it can).
      if (c.raw.writableNeedDrain) {
        this.remove(c);
        c.raw.destroy?.();
        continue;
      }
      c.raw.write(msg);
    }
  }
  send(event: string, data: unknown) {
    this.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  ping() {
    this.write(": ping\n\n");
  }
}

const TvId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const Host = z.string().regex(/^[A-Za-z0-9.-]{1,253}$/);
const Port = z.number().int().min(1).max(65535);

const LaunchBody = z.object({
  requestId: z.string().uuid().optional(),
  gameId: z.string().regex(GAME_ID_RE),
  route: z.object({ service: z.string().regex(/^[a-z0-9_]{1,40}$/), network: z.enum(NETWORK_IDS) }).optional(),
  tv: TvId.optional(),
  wake: z.boolean().optional(),
}).strict();

/** Embed JSON in a <script> safely: no "</script>" or "<!--" can break out. */
export function inlineJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

// Preferences any member may change (personal). Everything else needs edit_settings.
const PERSONAL_SETTINGS = new Set(["favorites", "presets"]);

function changedKeys(current: object, next: unknown): string[] {
  if (!next || typeof next !== "object") return ["*"];
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  const a = current as Record<string, unknown>, b = next as Record<string, unknown>;
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** What the browser needs to know about the household (no secrets). */
export function householdView(c: Config, integrations: Integrations) {
  return {
    setupComplete: c.setupComplete,
    market: c.market,
    subscriptions: c.subscriptions,
    tveSignIns: c.tveSignIns,
    tvs: c.tvs,
    integrations: { plex: c.integrations.plex ? { url: c.integrations.plex.url, channelMap: c.integrations.plex.channelMap ?? {}, status: integrations.plexStatus() } : null, espnWatch: c.integrations.espnWatch },
  };
}

/** The resolver's view of the household for one TV (platform and installed apps decide the routes). */
export function resolveContext(c: Config, tvs: TvManager, guide: LocalGuide | null, tvId?: string | null, ocr = true): ResolveContext {
  const picked = tvs.pick(tvId, c.preferences.defaultTv);
  const installed = picked ? tvs.installedApps(picked.tv.id) : null;
  return {
    household: { market: c.market, subscriptions: c.subscriptions, tveSignIns: c.tveSignIns, servicePriority: c.preferences.servicePriority },
    platform: picked?.tv.platform ?? "firetv",
    installedApps: installed ? new Set(installed) : null,
    guide,
    // Screen-reading launches need OCR on the server; without it they'd only ever reach the app.
    experimental: c.preferences.experimentalLaunches && ocr,
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "tv";

/**
 * Build the app. To listen on several addresses, build one app per address from the same deps:
 * auth state (sessions, users) lives in deps.auth, so a sign-in works on all of them.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.log ? { level: "info", redact: ["req.headers.cookie", "req.headers['x-plex-token']"] } : false,
    logController: new LogController({ disableRequestLogging: true }), // launches and errors are logged explicitly; per-request lines are noise
    // We work out the client address ourselves (server/auth/net.ts), from TRUSTED_PROXIES only.
    trustProxy: false,
  });
  const indexPath = deps.staticDir ? join(deps.staticDir, "index.html") : null;
  const indexHtml = indexPath && existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
  const cfg = () => deps.store.get();

  installAuth(app, deps.auth, {
    allowedHosts: deps.allowedHosts,
    publicPaths: ["/api/bootstrap"], // answers "not signed in" with what the login screen needs
    skipChecks: ["/healthz"],
  });

  const tvStates = () => deps.tvs.statuses().map((s) => ({ ...s, apps: deps.tvs.installedApps(s.id) }));

  const caps = deps.capabilities ?? { adb: true, ocr: true };
  const bootstrap = (req: FastifyRequest) => {
    if (!req.auth) return { authed: false, auth: { mode: deps.auth.mode, setupRequired: !deps.auth.isSetupComplete() } };
    const snap = deps.poller.get();
    const c = cfg();
    return {
      authed: true,
      version: VERSION,
      me: deps.auth.me(req.auth),
      games: snap.games,
      fetchedAt: snap.fetchedAt,
      stale: snap.stale,
      feedError: snap.error,
      guide: deps.guide(),
      settings: c.preferences,
      household: householdView(c, deps.integrations),
      tvs: tvStates(),
      capabilities: caps,
    };
  };

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) deps.event?.({ evt: "server_error", method: req.method, url: req.url.split("?")[0], error: (err as Error).message, stack: (err as Error).stack?.split("\n").slice(0, 4).join(" | ") });
    return reply.code(status).send({ error: status >= 500 ? "server error" : (err as Error).message });
  });

  app.get("/healthz", async (req, reply) => {
    const ip = req.socket.remoteAddress ?? "";
    if (!/^(127\.|::1|::ffff:127\.)/.test(ip)) return reply.code(404).send();
    return { ok: true, version: VERSION };
  });

  const sendIndex = async (req: FastifyRequest, reply: FastifyReply) => {
    const state = `<script id="sr-state" type="application/json">${inlineJson(bootstrap(req))}</script>`;
    const html = indexHtml ? indexHtml.replace("</head>", `${state}</head>`) : `<!doctype html><html><head>${state}</head><body><div id="root"></div></body></html>`;
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  };
  app.get("/", sendIndex);
  app.get("/setup", sendIndex); // the setup wizard and coverage pages are part of the single-page app
  app.get("/coverage", sendIndex);

  if (deps.staticDir && existsSync(deps.staticDir)) {
    app.register(fastifyStatic, { root: deps.staticDir, index: false, wildcard: false, maxAge: "1h" });
  }

  app.get("/api/bootstrap", async (req) => bootstrap(req));

  app.get("/api/games", async (req, reply) => {
    const snap = deps.poller.get();
    const etag = `W/"g${snap.version}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.header("ETag", etag).send({ games: snap.games, fetchedAt: snap.fetchedAt, stale: snap.stale, feedError: snap.error, guide: deps.guide() });
  });

  // ---------- preferences and household ----------

  app.get("/api/settings", async () => cfg().preferences);
  app.put("/api/settings", async (req, reply) => {
    const changed = changedKeys(cfg().preferences, req.body);
    const need = changed.every((k) => PERSONAL_SETTINGS.has(k)) ? "edit_favorites" : "edit_settings";
    if (!can(req.auth!.role, need)) return reply.code(403).send({ error: "forbidden" });
    const parsed = PreferencesZ.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid settings" });
    const saved = await deps.store.update((c) => void (c.preferences = parsed.data));
    deps.events.send("settings", saved.preferences);
    return saved.preferences;
  });

  const HouseholdBody = z.object({
    market: MarketZ.optional(),
    subscriptions: z.array(OwnedSubscriptionZ).max(60).optional(),
    tveSignIns: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(40).optional(),
  }).strict();
  app.put("/api/household", { preHandler: requirePermission("edit_settings") }, async (req, reply) => {
    const p = HouseholdBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid household" });
    const unknown = (p.data.subscriptions ?? []).filter((s) => !SUBSCRIPTION_BY_ID.has(s.id)).map((s) => s.id);
    if (unknown.length) return reply.code(400).send({ error: `unknown subscriptions: ${unknown.join(", ")}` });
    const saved = await deps.store.update((c) => {
      if (p.data.market) c.market = p.data.market;
      if (p.data.subscriptions) c.subscriptions = p.data.subscriptions;
      if (p.data.tveSignIns) c.tveSignIns = p.data.tveSignIns.filter((a) => APP_BY_ID.has(a));
    });
    const view = householdView(saved, deps.integrations);
    deps.events.send("household", view);
    deps.event?.({ evt: "household_saved", by: req.auth?.username ?? req.auth?.role, subscriptions: saved.subscriptions.map((s) => s.id) });
    return view;
  });

  app.post("/api/setup/complete", { preHandler: requirePermission("edit_settings") }, async () => {
    const saved = await deps.store.update((c) => void (c.setupComplete = true));
    deps.events.send("household", householdView(saved, deps.integrations));
    return { ok: true };
  });

  // ---------- TVs ----------

  app.get("/api/status", async () => tvStates());
  app.get("/api/tvs", { preHandler: requirePermission("manage_tvs") }, async () => ({ configured: cfg().tvs, status: tvStates() }));

  /** mDNS (Google TV wireless debugging) plus a quick scan of this machine's LAN for ADB on 5555. */
  app.post("/api/tvs/discover", { preHandler: requirePermission("manage_tvs") }, async () => {
    const known = new Set(cfg().tvs.map((t) => t.host));
    const [mdns, scan] = await Promise.all([browseAdb(2500).catch(() => []), scanForAdb(lanPrefixes(), { skip: known }).catch(() => [])]);
    return { mdns: mdns.filter((m) => !known.has(m.host)), adb5555: scan };
  });

  app.post("/api/tvs/connect", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const p = z.object({ host: Host, port: Port.default(5555), wait: z.boolean().default(false) }).strict().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    const state = p.data.wait ? await waitForApproval(deps.adb, p.data.host, p.data.port, { timeoutMs: 45_000 }) : await connectTv(deps.adb, p.data.host, p.data.port);
    deps.event?.({ evt: "tv_connect", host: p.data.host, port: p.data.port, state });
    return { state };
  });

  app.post("/api/tvs/pair", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const p = z.object({ host: Host, pairPort: Port, code: z.string().regex(/^\d{6}$/), connectPort: Port.optional() }).strict().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    const paired = await pairTv(deps.adb, p.data.host, p.data.pairPort, p.data.code);
    deps.event?.({ evt: "tv_pair", host: p.data.host, ok: paired.ok, error: paired.error });
    if (!paired.ok) return reply.code(400).send(paired);
    const port = p.data.connectPort ?? (await findConnectPort(deps.adb, p.data.host));
    if (!port) return { ok: true, connectPort: null }; // the wizard asks for the port shown on the TV
    return { ok: true, connectPort: port, state: await connectTv(deps.adb, p.data.host, port) };
  });

  app.post("/api/tvs/identify", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const p = z.object({ host: Host, port: Port }).strict().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    const id = await identifyTv(deps.adb, p.data.host, p.data.port, APPS);
    return { platform: id.platform, name: id.name, model: id.props.model, sdk: id.props.sdk, apps: id.apps.map((a) => a.id) };
  });

  const TvBody = z.object({ name: z.string().min(1).max(40), host: Host, port: Port, platform: z.enum(["firetv", "googletv"]), model: z.string().max(80).optional(), apps: z.array(z.string().max(40)).max(100).default([]) }).strict();
  app.post("/api/tvs", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const p = TvBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    let added: Tv | null = null;
    const saved = await deps.store.update((c) => {
      let id = slug(p.data.name);
      for (let i = 2; c.tvs.some((t) => t.id === id); i++) id = `${slug(p.data.name)}-${i}`;
      added = { id, ...p.data, apps: p.data.apps.filter((a) => APP_BY_ID.has(a)), appsCheckedAt: new Date().toISOString() };
      // The same TV added again replaces the old entry (a Google TV comes back on a new port after re-pairing).
      const same = (t: Tv) => t.host === p.data.host && (t.port === p.data.port || (t.platform === "googletv" && p.data.platform === "googletv"));
      const replaced = c.tvs.filter(same).map((t) => t.id);
      c.tvs = [...c.tvs.filter((t) => !same(t)), added];
      if (!c.preferences.defaultTv || replaced.includes(c.preferences.defaultTv)) c.preferences.defaultTv = id;
    });
    deps.tvs.sync(saved.tvs);
    void deps.tvs.watchdog();
    return added;
  });

  app.patch("/api/tvs/:id", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const id = TvId.safeParse((req.params as { id: string }).id);
    const p = z.object({ name: z.string().min(1).max(40).optional(), port: Port.optional(), default: z.boolean().optional() }).strict().safeParse(req.body);
    if (!id.success || !p.success) return reply.code(400).send({ error: "bad request" });
    if (!cfg().tvs.some((t) => t.id === id.data)) return reply.code(404).send({ error: "no such TV" });
    const saved = await deps.store.update((c) => {
      c.tvs = c.tvs.map((t) => (t.id === id.data ? { ...t, ...(p.data.name ? { name: p.data.name } : {}), ...(p.data.port ? { port: p.data.port } : {}) } : t));
      if (p.data.default) c.preferences.defaultTv = id.data;
    });
    deps.tvs.sync(saved.tvs);
    return saved.tvs.find((t) => t.id === id.data);
  });

  app.delete("/api/tvs/:id", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const id = TvId.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "bad request" });
    const saved = await deps.store.update((c) => {
      c.tvs = c.tvs.filter((t) => t.id !== id.data);
      if (c.preferences.defaultTv === id.data) c.preferences.defaultTv = c.tvs[0]?.id ?? null;
    });
    deps.tvs.sync(saved.tvs);
    return reply.code(204).send();
  });

  app.post("/api/tvs/:id/apps", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const id = TvId.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "bad request" });
    const ident = await deps.tvs.refreshApps(id.data);
    if (!ident) return reply.code(404).send({ error: "no such TV" });
    await deps.store.update((c) => void (c.tvs = c.tvs.map((t) => (t.id === id.data ? { ...t, apps: ident.apps.map((a) => a.id), appsCheckedAt: new Date().toISOString() } : t))));
    return { apps: ident.apps.map((a) => a.id), platform: ident.platform };
  });

  /** Setup's "test it": open an app on a TV (app level, no game). */
  app.post("/api/tvs/:id/test", { preHandler: requirePermission("manage_tvs") }, async (req, reply) => {
    const id = TvId.safeParse((req.params as { id: string }).id);
    const p = z.object({ app: z.string().regex(/^[a-z0-9_]{1,40}$/) }).strict().safeParse(req.body);
    if (!id.success || !p.success || !APP_BY_ID.has(p.data.app)) return reply.code(400).send({ error: "bad request" });
    const t = deps.tvs.pick(id.data);
    if (!t || t.tv.id !== id.data) return reply.code(404).send({ error: "no such TV" });
    return t.driver.openApp(p.data.app);
  });

  // ---------- integrations (secrets never leave the server) ----------

  app.put("/api/integrations/plex", { preHandler: requirePermission("edit_settings") }, async (req, reply) => {
    const p = z.object({
      url: z.string().regex(/^https?:\/\/[A-Za-z0-9.\-:[\]]+\/?$/),
      token: z.string().min(8).max(200).optional(),
      channelMap: z.object({ abc: z.string().max(12), cbs: z.string().max(12), fox: z.string().max(12), nbc: z.string().max(12) }).partial().strict().optional(),
    }).strict().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    // The saved token is only reused for the same server: pointing Plex somewhere new needs the token typed again,
    // so changing the URL can't send the household's token to another host.
    const current = deps.store.get().integrations.plex?.url;
    const sameServer = !!current && new URL(current).origin === new URL(p.data.url).origin;
    const token = p.data.token ?? (sameServer ? deps.store.getSecrets().plexToken : undefined);
    if (!token) return reply.code(400).send({ error: sameServer || !current ? "Plex token needed" : "Enter the Plex token again to use a different server" });
    const test = await deps.integrations.testPlex(p.data.url, token);
    if (!test.ok) return reply.code(400).send(test);
    if (p.data.token) await deps.store.updateSecrets({ plexToken: p.data.token });
    await deps.store.update((c) => void (c.integrations.plex = { url: p.data.url.replace(/\/$/, ""), ...(p.data.channelMap ? { channelMap: p.data.channelMap } : {}) }));
    await deps.integrations.reload();
    return test;
  });

  app.delete("/api/integrations/plex", { preHandler: requirePermission("edit_settings") }, async () => {
    await deps.store.updateSecrets({ plexToken: undefined });
    await deps.store.update((c) => void (c.integrations.plex = null));
    await deps.integrations.reload();
    return { ok: true };
  });

  app.put("/api/integrations/espn", { preHandler: requirePermission("edit_settings") }, async (req, reply) => {
    const p = z.object({ key: z.string().min(8).max(200).nullable() }).strict().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    await deps.store.updateSecrets({ espnWatchApiKey: p.data.key ?? undefined });
    await deps.store.update((c) => void (c.integrations.espnWatch = !!p.data.key));
    await deps.integrations.reload();
    return { ok: true };
  });

  // ---------- the remote and launching ----------

  app.post("/api/key", { preHandler: requirePermission("remote") }, async (req, reply) => {
    const body = (req.body ?? {}) as { key?: unknown; tv?: unknown };
    if (!isAllowedKey(body.key)) return reply.code(400).send({ error: "key not allowed" });
    const t = deps.tvs.pick(typeof body.tv === "string" ? body.tv : null, cfg().preferences.defaultTv);
    if (!t) return reply.code(409).send({ ok: false, error: "device_offline" });
    const r = await t.driver.key(body.key);
    deps.event?.({ evt: "key", tv: t.tv.id, key: body.key, ok: r.ok, error: r.error });
    return reply.code(r.ok ? 200 : r.error === "busy" ? 429 : 502).send(r);
  });

  app.post("/api/launch", { preHandler: requirePermission("launch") }, async (req, reply) => {
    const parsed = LaunchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const body = parsed.data;
    const requestId = body.requestId ?? randomUUID();
    const game = deps.poller.find(body.gameId);
    const failed = (error: LaunchResult["error"], code: number) => {
      deps.event?.({ evt: "launch_rejected", requestId, game: body.gameId, error, route: body.route });
      const m = renderOutcome("failed", null, null, { error });
      return reply.code(code).send({ requestId, ok: false, level: null, verified: false, outcome: "failed", ...m, attempts: [], error } satisfies LaunchResult);
    };
    if (!game) return failed("unknown_game", 404);
    const c = cfg();
    const t = deps.tvs.pick(body.tv, c.preferences.defaultTv);
    if (!t) return failed(c.tvs.length === 0 ? "no_tv" : "device_offline", 409);
    // Re-resolve on the server for this TV; the client may only pick one of our own routes.
    const res = resolveGame(game, resolveContext(c, deps.tvs, deps.guide(), t.tv.id, caps.ocr));
    if (res.routes.length === 0) return failed("not_covered", 422);
    let route = res.routes[0];
    if (body.route) {
      if (!isResolvedRoute(res, body.route)) return failed("bad_params", 400);
      route = res.routes.find((r) => r.service === body.route!.service && r.network === body.route!.network)!;
    }
    const result = await t.driver.launch({
      requestId, game, route, wake: body.wake,
      onProgress: (message) => deps.events.send("launch_progress", { requestId, message }),
    });
    deps.events.send("launch", { requestId, tv: t.tv.id, outcome: result.outcome, service: result.service });
    return reply.code(result.error === "busy" ? 409 : 200).send(result);
  });

  // Errors from the browser (a crash on a phone, a failed request) land in the same log.
  const ClientLog = z.object({
    kind: z.enum(["error", "rejection", "api"]),
    message: z.string().max(500),
    stack: z.string().max(2000).optional(),
    where: z.string().max(200).optional(),
  }).strict();
  // Browser errors go to the log; a per-address limit keeps one page (or script) from flooding it.
  const clientLogLimits = new Map<string, WindowLimiter>();
  app.post("/api/client-log", async (req, reply) => {
    const p = ClientLog.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad request" });
    const ip = req.client?.ip ?? req.ip;
    if (clientLogLimits.size > 500) for (const [k, l] of clientLogLimits) if (l.idle()) clientLogLimits.delete(k);
    let lim = clientLogLimits.get(ip);
    if (!lim) clientLogLimits.set(ip, (lim = new WindowLimiter(20, 60_000)));
    if (!lim.take()) return reply.code(204).send();
    deps.event?.({ evt: "client_error", ua: String(req.headers["user-agent"] ?? "").slice(0, 160), ...p.data });
    return reply.code(204).send();
  });

  app.get("/api/events", async (req, reply) => {
    if (!deps.events.add(reply, req.client?.ip ?? req.ip)) return reply.code(503).header("Retry-After", "30").send({ error: "too many live connections" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`retry: 3000\n\n`);
    req.raw.on("close", () => deps.events.remove(reply));
  });

  return app;
}
