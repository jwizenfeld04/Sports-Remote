import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, inlineJson, SseHub, VERSION, type AppDeps } from "../server/app";
import { AuthService, hashSecret, MemoryAuthStore, type AuthData } from "../server/auth";
import { EspnPoller } from "../server/espnPoller";
import { ConfigStore } from "../server/store/config";
import type { AndroidTvDriver, LaunchRequest } from "../server/driver";
import type { TvManager } from "../server/tv/manager";
import type { LaunchResult } from "../lib/types";
import { MLB, NBA, NFL, NHL } from "./fixtures/espn";
import { espnDay } from "../lib/espn";

const FAST = { N: 1024, r: 8, p: 1 }; // cheap scrypt for tests
const HOST = "minipc.tail1234.ts.net";
const LAN_HOST = "192.168.1.25:8787";

function fixturePoller() {
  const fetchImpl = (async (url: string) => {
    const body = url.includes("/nfl/") ? NFL : url.includes("/nba/") ? NBA : url.includes("/mlb/") ? MLB : NHL;
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return new EspnPoller(fetchImpl, () => new Date("2026-10-18T21:00:00Z"));
}

// Two auth setups: a reverse proxy on loopback that passes the Tailscale identity header (what
// `tailscale serve` does), and the household-PIN mode for home Wi-Fi.
let pinData: AuthData;
beforeAll(async () => {
  pinData = {
    version: 1, mode: "pin", users: [], sessions: [],
    pin: { pinHash: await hashSecret("2468", FAST), adminPasswordHash: await hashSecret("admin-password", FAST) },
  };
});
const proxyData = (): AuthData => ({
  version: 1, mode: "proxy", users: [], sessions: [],
  proxy: { header: "Tailscale-User-Login", admins: ["owner@example.com"], members: [], allowAnyAuthenticated: false },
});
const authFor = (data: AuthData, events?: (e: Record<string, unknown>) => void) =>
  AuthService.open({ store: new MemoryAuthStore(structuredClone(data)), trustedProxies: ["loopback"], scrypt: FAST, log: events });

async function setup() {
  const launches: LaunchRequest[] = [];
  const keys: string[] = [];
  let busy = false;
  const driver = {
    launch: async (r: LaunchRequest): Promise<LaunchResult> => {
      launches.push(r);
      if (busy) return { requestId: r.requestId, ok: false, level: null, verified: false, outcome: "failed", title: "x", message: "x", persistent: true, attempts: [], error: "busy" };
      return { requestId: r.requestId, ok: true, level: "app", verified: true, outcome: "app", title: "Opened", message: "m", persistent: true, attempts: [], service: r.route.service };
    },
    key: async (k: string) => (keys.push(k), { ok: true }),
  } as unknown as AndroidTvDriver;
  const events = new SseHub();
  const sent: [string, unknown][] = [];
  const origSend = events.send.bind(events);
  events.send = (e, d) => (sent.push([e, d]), origSend(e, d));
  // The v1 household: New York, one Fire TV at 10.0.0.5.
  const store = new ConfigStore(mkdtempSync(join(tmpdir(), "sr-")));
  await store.load({ FIRETV_HOST: "10.0.0.5", PLEX_TOKEN: "t" });
  await store.update((c) => ({ ...c, setupComplete: true, preferences: { ...c.preferences, favorites: ["nfl:LAC", "mlb:LAD", "nhl:LA", "mlb:NYM", "nfl:NYG"] } }));
  const tvs = {
    sync: () => {},
    watchdog: () => {},
    pick: (id?: string | null) => {
      const tv = store.get().tvs.find((t) => !id || t.id === id);
      return tv ? { tv, driver } : null;
    },
    statuses: () => store.get().tvs.map((t) => ({ id: t.id, name: t.name, adb: "connected", screenOn: true, foreground: "com.plexapp.android", plex: "ok", latencyMs: 40 })),
    installedApps: () => null,
    refreshApps: async () => null,
  } as unknown as TvManager;
  const deps: AppDeps = {
    poller: fixturePoller(),
    store,
    tvs,
    adb: async () => ({ stdout: "", stderr: "", code: 0 }),
    integrations: { reload: async () => {}, plexStatus: () => "ok", testPlex: async () => ({ ok: true, channels: [] }) },
    guide: () => null,
    auth: await authFor(proxyData()),
    allowedHosts: [],
    events,
  };
  return { deps, launches, keys, sent, setBusy: (b: boolean) => (busy = b) };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
  await ctx.deps.poller.pollOnce();
});

const LAN_PEER = "192.168.1.9";
type InjectOpts = { method?: "GET" | "POST" | "PUT" | "DELETE"; url: string; headers?: Record<string, string>; payload?: object; remoteAddress?: string };
/** Proxy mode; inject()'s default peer is 127.0.0.1, i.e. the trusted local proxy. */
const tailnet = () => buildApp(ctx.deps);
/** PIN mode, reached directly from a phone on the LAN. */
const lan = async (events?: (e: Record<string, unknown>) => void) => {
  const app = buildApp({ ...ctx.deps, auth: await authFor(pinData, events) });
  return { inject: (o: InjectOpts) => app.inject({ remoteAddress: LAN_PEER, ...o }) };
};
const owner = { host: HOST, "tailscale-user-login": "owner@example.com" };
const post = (headers: Record<string, string>, host = headers.host) => ({ ...headers, "content-type": "application/json", origin: `https://${host}` });

async function loginCookie(app?: Awaited<ReturnType<typeof lan>>) {
  app ??= await lan();
  const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: post({ host: LAN_HOST }), payload: { pin: "2468" } });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return { app, cookie };
}

describe("authentication", () => {
  it("a trusted proxy's identity header lets in allowed users", async () => {
    const r = await tailnet().inject({ url: "/api/games", headers: owner });
    expect(r.statusCode).toBe(200);
    expect(r.json().games).toHaveLength(18);
    expect(r.json().feedError).toBeNull();
  });

  it("other identities from the proxy are refused", async () => {
    const r = await tailnet().inject({ url: "/api/games", headers: { host: HOST, "tailscale-user-login": "guest@example.com" } });
    expect(r.statusCode).toBe(401);
  });

  it("the identity header is ignored from an untrusted peer", async () => {
    const r = await tailnet().inject({ url: "/api/games", remoteAddress: LAN_PEER, headers: { host: LAN_HOST, "tailscale-user-login": "owner@example.com" } });
    expect(r.statusCode).toBe(401);
    const pin = await (await lan()).inject({ url: "/api/games", headers: { host: LAN_HOST, "tailscale-user-login": "owner@example.com" } });
    expect(pin.statusCode).toBe(401);
  });

  it("PIN login sets an httpOnly SameSite=Strict cookie that works", async () => {
    const app = await lan();
    const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: post({ host: LAN_HOST }), payload: { pin: "2468" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ role: "member", via: "session", mode: "pin" });
    expect(String(r.headers["set-cookie"])).toMatch(/HttpOnly; SameSite=Strict; Max-Age=2592000$/); // 30 days; no Secure over http
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    expect((await app.inject({ url: "/api/games", headers: { host: LAN_HOST, cookie } })).statusCode).toBe(200);
  });

  it("wrong PIN, tampered cookie, and too many tries", async () => {
    const app = await lan();
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", headers: post({ host: LAN_HOST }), payload: { pin: "0000" } });
    expect(bad.statusCode).toBe(401);
    const { cookie } = await loginCookie(app);
    const tampered = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await app.inject({ url: "/api/games", headers: { host: LAN_HOST, cookie: tampered } })).statusCode).toBe(401);
    const forged = `sr_session=${"x".repeat(43)}`;
    expect((await app.inject({ url: "/api/games", headers: { host: LAN_HOST, cookie: forged } })).statusCode).toBe(401);
    for (let i = 0; i < 3; i++) await app.inject({ method: "POST", url: "/api/auth/login", headers: post({ host: LAN_HOST }), payload: { pin: "1111" } });
    const limited = await app.inject({ method: "POST", url: "/api/auth/login", headers: post({ host: LAN_HOST }), payload: { pin: "2468" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
  });
});

describe("roles", () => {
  it("members launch and edit favorites; household settings need the admin", async () => {
    const { app, cookie } = await loginCookie();
    const as = (c: string) => ({ ...post({ host: LAN_HOST }), cookie: c });
    expect((await app.inject({ method: "POST", url: "/api/launch", headers: as(cookie), payload: { gameId: "nfl:402" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/key", headers: as(cookie), payload: { key: "HOME" } })).statusCode).toBe(200);
    const s = (await app.inject({ url: "/api/settings", headers: { host: LAN_HOST, cookie } })).json();
    const fav = await app.inject({ method: "PUT", url: "/api/settings", headers: as(cookie), payload: { ...s, favorites: ["nfl:NYG"] } });
    expect(fav.statusCode).toBe(200);
    const household = await app.inject({ method: "PUT", url: "/api/settings", headers: as(cookie), payload: { ...s, oneTapSend: true } });
    expect(household.statusCode).toBe(403);
    const admin = await app.inject({ method: "POST", url: "/api/auth/login", headers: post({ host: LAN_HOST }), payload: { password: "admin-password" } });
    const adminCookie = String(admin.headers["set-cookie"]).split(";")[0];
    const ok = await app.inject({ method: "PUT", url: "/api/settings", headers: as(adminCookie), payload: { ...s, favorites: ["nfl:NYG"], oneTapSend: true } });
    expect(ok.statusCode).toBe(200);
  });

  it("the signed-in page includes who you are", async () => {
    const r = await tailnet().inject({ url: "/api/bootstrap", headers: owner });
    expect(r.json().me).toMatchObject({ role: "admin", via: "proxy", userId: "owner@example.com", mode: "proxy" });
  });

  it("before setup, the page asks for the setup link", async () => {
    const app = buildApp({ ...ctx.deps, auth: await AuthService.open({ store: new MemoryAuthStore(), log: () => {} }) });
    const r = await app.inject({ url: "/api/bootstrap", headers: { host: LAN_HOST } });
    expect(r.json()).toEqual({ authed: false, auth: { mode: null, setupRequired: true } });
    expect((await app.inject({ url: "/setup?token=abc", headers: { host: LAN_HOST } })).headers["content-type"]).toContain("text/html");
  });
});

describe("request hygiene", () => {
  it("refuses unknown host names (DNS rebinding)", async () => {
    const r = await tailnet().inject({ url: "/api/games", headers: { ...owner, host: "evil.example.com" } });
    expect(r.statusCode).toBe(421);
  });

  it("accepts tailnet, .local and IP hosts", async () => {
    for (const host of [HOST, "sports-remote.local:8787", "192.168.1.25:8787", "localhost:8787"]) {
      expect((await tailnet().inject({ url: "/api/status", headers: { ...owner, host } })).statusCode).toBe(200);
    }
  });

  it("POST needs JSON and a same-origin Origin header", async () => {
    const app = tailnet();
    const send = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/api/key", headers: { ...owner, ...headers }, payload: JSON.stringify({ key: "HOME" }) });
    expect((await send({ "content-type": "application/json" })).statusCode).toBe(403); // no Origin
    expect((await send({ "content-type": "application/json", origin: "https://evil.example.com" })).statusCode).toBe(403);
    expect((await send({ "content-type": "text/plain", origin: `https://${HOST}` })).statusCode).toBe(403);
    expect((await send({ "content-type": "application/json", origin: `https://${HOST}` })).statusCode).toBe(200);
    expect(ctx.keys).toEqual(["HOME"]);
  });

  it("sets protective headers", async () => {
    const r = await tailnet().inject({ url: "/api/status", headers: owner });
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("healthz is open but loopback-only", async () => {
    expect((await tailnet().inject({ url: "/healthz" })).json()).toEqual({ ok: true, version: VERSION });
    expect((await tailnet().inject({ url: "/healthz", remoteAddress: "192.168.1.9" })).statusCode).toBe(404);
  });
});

describe("index page", () => {
  it("inlines games for signed-in users", async () => {
    const r = await tailnet().inject({ url: "/", headers: owner });
    expect(r.headers["content-type"]).toContain("text/html");
    const state = JSON.parse(r.body.match(/<script id="sr-state" type="application\/json">(.*?)<\/script>/)![1]);
    expect(state.authed).toBe(true);
    expect(state.games).toHaveLength(18);
    expect(state.settings.favorites).toContain("nfl:LAC");
  });

  it("shows only the login state to others", async () => {
    const r = await (await lan()).inject({ url: "/", headers: { host: LAN_HOST } });
    const state = JSON.parse(r.body.match(/<script id="sr-state" type="application\/json">(.*?)<\/script>/)![1]);
    expect(state).toEqual({ authed: false, auth: { mode: "pin", setupRequired: false } });
  });

  it("inline JSON can't break out of its script tag", () => {
    const s = inlineJson({ x: "</script><script>alert(1)</script>" });
    expect(s).not.toContain("</script>");
    expect(JSON.parse(s)).toEqual({ x: "</script><script>alert(1)</script>" });
  });
});

describe("launch", () => {
  const launch = (payload: unknown) => tailnet().inject({ method: "POST", url: "/api/launch", headers: post(owner), payload: payload as object });

  it("resolves on the server and launches the primary route", async () => {
    const r = await launch({ gameId: "nfl:402" });
    expect(r.statusCode).toBe(200);
    expect(ctx.launches[0].route).toMatchObject({ service: "plex", network: "fox" });
    expect(ctx.launches[0].game.id).toBe("nfl:402");
    expect(ctx.sent.some(([e]) => e === "launch")).toBe(true);
  });

  it("accepts an alternate the server would offer", async () => {
    await launch({ gameId: "nfl:402", route: { service: "fox_one", network: "fox" } });
    expect(ctx.launches[0].route.service).toBe("fox_one");
  });

  it("rejects a route the server didn't resolve", async () => {
    const r = await launch({ gameId: "nfl:402", route: { service: "mlbtv", network: "fox" } });
    expect(r.statusCode).toBe(400);
    expect(ctx.launches).toHaveLength(0);
  });

  it("not covered and unknown games", async () => {
    expect((await launch({ gameId: "mlb:502" })).statusCode).toBe(422);
    expect((await launch({ gameId: "nfl:999" })).statusCode).toBe(404);
    expect((await launch({ gameId: "nfl:1; reboot" })).statusCode).toBe(400);
    expect((await launch({ gameId: "nfl:402", extra: "x" })).statusCode).toBe(400);
    expect(ctx.launches).toHaveLength(0);
  });

  it("busy -> 409", async () => {
    ctx.setBusy(true);
    expect((await launch({ gameId: "nfl:402" })).statusCode).toBe(409);
  });

  it("only allowlisted keys", async () => {
    const r = await tailnet().inject({ method: "POST", url: "/api/key", headers: post(owner), payload: { key: "POWER" } });
    expect(r.statusCode).toBe(400);
  });
});

describe("games and settings", () => {
  it("ETag on games", async () => {
    const app = tailnet();
    const first = await app.inject({ url: "/api/games", headers: owner });
    const again = await app.inject({ url: "/api/games", headers: { ...owner, "if-none-match": String(first.headers.etag) } });
    expect(again.statusCode).toBe(304);
  });

  it("validates and saves settings, then broadcasts them", async () => {
    const app = tailnet();
    const s = (await app.inject({ url: "/api/settings", headers: owner })).json();
    const bad = await app.inject({ method: "PUT", url: "/api/settings", headers: post(owner), payload: { ...s, favorites: ["nba:lal"] } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/api/settings", headers: post(owner), payload: { ...s, oneTapSend: true } });
    expect(ok.json().oneTapSend).toBe(true);
    expect(ctx.sent.find(([e]) => e === "settings")).toBeTruthy();
  });
});

describe("household and TVs", () => {
  it("saves the household, rejecting unknown subscriptions, and broadcasts it", async () => {
    const app = tailnet();
    const bad = await app.inject({ method: "PUT", url: "/api/household", headers: post(owner), payload: { subscriptions: [{ id: "not_a_service", addOns: [] }] } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/api/household", headers: post(owner), payload: { subscriptions: [{ id: "youtube_tv", addOns: [] }], tveSignIns: ["espn", "zzz"] } });
    expect(ok.statusCode).toBe(200);
    expect(ctx.deps.store.get().subscriptions.map((s) => s.id)).toEqual(["youtube_tv"]);
    expect(ctx.deps.store.get().tveSignIns).toEqual(["espn"]);
    expect(ctx.sent.some(([e]) => e === "household")).toBe(true);
  });

  it("members can't change the household or TVs", async () => {
    const { app, cookie } = await loginCookie();
    const as = { ...post({ host: LAN_HOST }), cookie };
    expect((await app.inject({ method: "PUT", url: "/api/household", headers: as, payload: { subscriptions: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/tvs", headers: as, payload: { name: "Den", host: "10.0.0.9", port: 5555, platform: "firetv", apps: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/tvs/living-room", headers: { host: LAN_HOST, origin: `https://${LAN_HOST}`, cookie } })).statusCode).toBe(403);
  });

  it("adds, renames and removes TVs; bad hosts are refused", async () => {
    const app = tailnet();
    const add = (payload: object) => app.inject({ method: "POST", url: "/api/tvs", headers: post(owner), payload });
    expect((await add({ name: "Den", host: "10.0.0.9; reboot", port: 5555, platform: "firetv", apps: [] })).statusCode).toBe(400);
    const r = await add({ name: "Den TV", host: "10.0.0.9", port: 5555, platform: "googletv", apps: ["espn", "bogus"] });
    expect(r.statusCode).toBe(200);
    const den = ctx.deps.store.get().tvs.find((t) => t.host === "10.0.0.9")!;
    expect(den).toMatchObject({ id: "den-tv", platform: "googletv", apps: ["espn"] });
    await app.inject({ method: "PATCH", url: `/api/tvs/${den.id}`, headers: post(owner), payload: { name: "Den", default: true } });
    expect(ctx.deps.store.get().preferences.defaultTv).toBe(den.id);
    expect((await app.inject({ method: "DELETE", url: `/api/tvs/${den.id}`, headers: { ...owner, origin: `https://${HOST}` } })).statusCode).toBe(204);
    expect(ctx.deps.store.get().tvs.some((t) => t.id === den.id)).toBe(false);
  });

  it("the bootstrap includes the household without secrets", async () => {
    await ctx.deps.store.updateSecrets({ plexToken: "very-secret-token" });
    const r = await tailnet().inject({ url: "/api/bootstrap", headers: owner });
    expect(r.json().household.market.localTeams).toContain("mlb:NYM");
    expect(r.body).not.toContain("very-secret-token");
  });

  it("launching on a TV that isn't there fails cleanly", async () => {
    const r = await tailnet().inject({ method: "POST", url: "/api/launch", headers: post(owner), payload: { gameId: "nfl:402", tv: "nope" } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ ok: false, error: "device_offline" });
    expect(ctx.launches).toHaveLength(0);
  });
});

describe("EspnPoller", () => {
  it("keeps the last good data and flags stale when a league fails", async () => {
    let fail = false;
    const fetchImpl = (async (url: string) => {
      if (fail && url.includes("/mlb/")) return new Response("down", { status: 503 });
      return new Response(JSON.stringify(url.includes("/nfl/") ? NFL : url.includes("/nba/") ? NBA : url.includes("/mlb/") ? MLB : NHL));
    }) as typeof fetch;
    const p = new EspnPoller(fetchImpl, () => new Date("2026-10-18T21:00:00Z"));
    let emitted = 0;
    p.on("games", () => emitted++);
    await p.pollOnce();
    fail = true;
    const snap = await p.pollOnce();
    expect(snap.stale).toBe(true);
    expect(snap.games).toHaveLength(18);
    expect(emitted).toBe(2); // the failure itself is pushed so clients can show it
    await p.pollOnce();
    expect(emitted).toBe(2); // unchanged data and the same failure don't re-emit
  });

  // Regression: ESPN started answering `dates=yyyymmdd-yyyymmdd` with 400 "Failed to get events endpoint.",
  // every league failed silently and the app showed an empty list. This fake behaves like ESPN does now.
  const realisticEspn = (urls: string[]) =>
    (async (url: string) => {
      urls.push(url);
      const dates = new URL(url).searchParams.get("dates") ?? "";
      if (!/^\d{8}$/.test(dates)) return new Response(JSON.stringify({ code: 400, message: "Failed to get events endpoint." }), { status: 400 });
      const sb = (url.includes("/nfl/") ? NFL : url.includes("/nba/") ? NBA : url.includes("/mlb/") ? MLB : NHL) as { events: { date: string }[] };
      return new Response(JSON.stringify({ ...sb, events: sb.events.filter((e) => espnDay(new Date(e.date)) === dates) }));
    }) as unknown as typeof fetch;

  it("fetches one day at a time, which ESPN accepts, and merges the days", async () => {
    const urls: string[] = [];
    const p = new EspnPoller(realisticEspn(urls), () => new Date("2026-10-18T21:00:00Z"));
    const snap = await p.pollOnce();
    expect(snap.stale).toBe(false);
    expect(snap.error).toBeNull();
    expect(snap.games).toHaveLength(18);
    expect(new Set(snap.games.map((g) => g.id)).size).toBe(18);
    expect(urls.every((u) => /[?&]dates=\d{8}&/.test(u))).toBe(true);
    expect(urls).toHaveLength(4 * 9); // 4 leagues x yesterday..+7 days
  });

  it("refreshes only yesterday, today and tomorrow on every poll; later days every 30 minutes", async () => {
    const urls: string[] = [];
    let now = new Date("2026-10-18T21:00:00Z");
    const p = new EspnPoller(realisticEspn(urls), () => now);
    await p.pollOnce();
    urls.length = 0;
    now = new Date(now.getTime() + 20_000);
    await p.pollOnce();
    expect(urls.map((u) => new URL(u).searchParams.get("dates")).sort()).toEqual(
      ["20261017", "20261018", "20261019"].flatMap((d) => [d, d, d, d]),
    );
    urls.length = 0;
    now = new Date(now.getTime() + 31 * 60_000);
    await p.pollOnce();
    expect(urls).toHaveLength(36);
  });

  it("reports why when ESPN rejects every request, instead of silently returning nothing", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ code: 400, message: "Failed to get events endpoint." }), { status: 400 })) as unknown as typeof fetch;
    const p = new EspnPoller(fetchImpl, () => new Date("2026-10-18T21:00:00Z"));
    const errors: string[] = [];
    p.on("poll_error", (e: string) => errors.push(e));
    const snap = await p.pollOnce();
    await p.pollOnce();
    expect(snap.games).toEqual([]);
    expect(snap.stale).toBe(true);
    expect(snap.error).toMatch(/^mlb 20261017: HTTP 400 \(\+35 more\)$/);
    expect(errors).toHaveLength(1); // logged once, not on every poll
  });

  it("polls fast only when a game is live and someone is watching", async () => {
    const p = fixturePoller();
    await p.pollOnce();
    expect(p.nextDelayMs()).toBe(300_000);
    p.clients = 1;
    expect(p.nextDelayMs()).toBe(20_000);
  });
});

describe("Plex settings", () => {
  it("won't send the saved token to a different server", async () => {
    await ctx.deps.store.update((c) => void (c.integrations.plex = { url: "http://127.0.0.1:32400" }));
    await ctx.deps.store.updateSecrets({ plexToken: "saved-token-123" });
    const tried: string[] = [];
    ctx.deps.integrations.testPlex = async (url) => (tried.push(url), { ok: true, channels: [] });
    const put = (payload: object) => tailnet().inject({ method: "PUT", url: "/api/integrations/plex", headers: post(owner), payload });
    const other = await put({ url: "http://attacker.example:8080" });
    expect(other.statusCode).toBe(400);
    expect(other.json().error).toMatch(/token again/);
    expect(tried).toEqual([]);
    expect((await put({ url: "http://127.0.0.1:32400/" })).statusCode).toBe(200); // same server: saved token is fine
    expect((await put({ url: "http://10.0.0.9:32400", token: "typed-again-456" })).statusCode).toBe(200);
    expect(tried).toEqual(["http://127.0.0.1:32400/", "http://10.0.0.9:32400"]);
  });
});

describe("SseHub", () => {
  it("caps streams per address and in all, and drops clients that stopped reading", () => {
    const hub = new SseHub({ total: 3, perIp: 2 });
    const mk = (needDrain = false) => ({ raw: { write: () => true, writableNeedDrain: needDrain, destroy: () => {} } }) as never;
    expect(hub.add(mk(), "a")).toBe(true);
    expect(hub.add(mk(), "a")).toBe(true);
    expect(hub.add(mk(), "a")).toBe(false);
    expect(hub.add(mk(true), "b")).toBe(true);
    expect(hub.add(mk(), "c")).toBe(false);
    hub.send("tv", {});
    expect(hub.size).toBe(2);
  });
  it("fans out events", () => {
    const hub = new SseHub();
    const writes: string[] = [];
    const reply = { raw: { write: (s: string) => writes.push(s) } } as never;
    hub.add(reply);
    hub.send("tv", { adb: "connected" });
    hub.remove(reply);
    hub.send("tv", {});
    expect(writes).toEqual(['event: tv\ndata: {"adb":"connected"}\n\n']);
  });
});

describe("event log", () => {
  it("records client errors, rejected launches and key presses, but never the PIN", async () => {
    const events: Record<string, unknown>[] = [];
    ctx.deps.event = (e) => events.push(e);
    const app = tailnet();
    const send = (url: string, payload: object) => app.inject({ method: "POST", url, headers: post(owner), payload });
    expect((await send("/api/client-log", { kind: "error", message: "boom", where: "/" })).statusCode).toBe(204);
    expect((await send("/api/client-log", { kind: "nope", message: "x" })).statusCode).toBe(400);
    await send("/api/launch", { gameId: "nfl:99999" });
    await send("/api/key", { key: "VOLUME_UP" });
    await (await lan((e) => events.push(e))).inject({ method: "POST", url: "/api/auth/login", headers: post({ host: HOST }), payload: { pin: "97531" } });
    expect(events.map((e) => e.evt)).toEqual(["client_error", "launch_rejected", "key", "login_failed"]);
    expect(events[3]).toMatchObject({ ip: LAN_PEER, mode: "pin" });
    expect(JSON.stringify(events)).not.toContain("97531");
  });
});

describe("no TV yet", () => {
  it("says to add one, instead of 'not connected'", async () => {
    await ctx.deps.store.update((c) => void (c.tvs = []));
    const r = await tailnet().inject({ method: "POST", url: "/api/launch", headers: post(owner), payload: { gameId: "nfl:402" } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_tv" });
    expect(r.json().message).toMatch(/no TV is set up yet/);
  });
});
