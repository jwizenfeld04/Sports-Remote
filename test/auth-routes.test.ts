// The auth HTTP API through Fastify inject: login per mode, cookies, sessions, users, setup, headers.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AuthService, installAuth, MemoryAuthStore, normalizeProxySettings, requirePermission, requireRole, type AuthData } from "../server/auth";

const FAST = { N: 1024, r: 8, p: 1 };
const HOST = "games.example.com";
const LAN = "192.168.1.9";
const PROXY = "10.0.0.2";

async function makeApp(data: AuthData | null = null, opts: { trustedProxies?: string[] } = {}) {
  const logs: Record<string, unknown>[] = [];
  const auth = await AuthService.open({
    store: new MemoryAuthStore(data), scrypt: FAST, trustedProxies: opts.trustedProxies ?? [PROXY], log: (e) => logs.push(e),
    setupUrl: (t) => `http://${HOST}/setup?token=${t}`,
  });
  const app = Fastify();
  installAuth(app, auth, { allowedHosts: [HOST], publicPaths: ["/api/open"], skipChecks: ["/healthz"] });
  app.get("/api/thing", async (req) => ({ auth: req.auth, client: req.client }));
  app.get("/api/open", async (req) => ({ authed: !!req.auth }));
  app.get("/api/tvs", { preHandler: requirePermission("manage_tvs") }, async () => ({ ok: true }));
  app.get("/api/admin", { preHandler: requireRole("admin") }, async () => ({ ok: true }));
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/", async () => "<html></html>");
  const token = () => new URL(String(logs.find((l) => l.evt === "setup_required")?.url)).searchParams.get("token")!;

  // Helpers that fill in what a same-origin browser would send.
  type Opts = { headers?: Record<string, string>; remoteAddress?: string; cookie?: string };
  const headers = (o: Opts, json: boolean) => ({
    host: HOST, ...(json ? { "content-type": "application/json", origin: `https://${HOST}` } : {}),
    ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers,
  });
  const get = (url: string, o: Opts = {}) => app.inject({ method: "GET", url, headers: headers(o, false), remoteAddress: o.remoteAddress ?? LAN });
  const post = (url: string, payload: object, o: Opts = {}) => app.inject({ method: "POST", url, payload, headers: headers(o, true), remoteAddress: o.remoteAddress ?? LAN });
  const patch = (url: string, payload: object, o: Opts = {}) => app.inject({ method: "PATCH", url, payload, headers: headers(o, true), remoteAddress: o.remoteAddress ?? LAN });
  const del = (url: string, o: Opts = {}) =>
    app.inject({ method: "DELETE", url, headers: { host: HOST, origin: `https://${HOST}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers }, remoteAddress: o.remoteAddress ?? LAN });
  return { app, auth, logs, token, get, post, patch, del };
}

const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers["set-cookie"]).split(";")[0];

async function accountsApp() {
  const t = await makeApp();
  const r = await t.post("/api/setup/auth", { token: t.token(), mode: "accounts", username: "admin", password: "admin-password" });
  expect(r.statusCode).toBe(200);
  return { ...t, admin: cookieOf(r) };
}

async function pinApp() {
  const t = await makeApp();
  const r = await t.post("/api/setup/auth", { token: t.token(), mode: "pin", pin: "2468", adminPassword: "admin-password" });
  expect(r.statusCode).toBe(200);
  return { ...t, admin: cookieOf(r) };
}

describe("first-run setup over HTTP", () => {
  it("everything is locked until setup; the setup link signs you in as admin", async () => {
    const t = await makeApp();
    expect((await t.get("/api/thing")).statusCode).toBe(401);
    expect((await t.get("/api/setup/auth")).json()).toMatchObject({ setupRequired: true, trustedProxies: true });
    expect((await t.post("/api/auth/login", { pin: "1234" })).statusCode).toBe(409);
    expect((await t.post("/api/setup/auth/check", { token: "nope" })).json()).toEqual({ valid: false });
    expect((await t.post("/api/setup/auth/check", { token: t.token() })).json()).toEqual({ valid: true });
    expect((await t.post("/api/setup/auth", { token: "nope", mode: "pin", pin: "2468", adminPassword: "admin-password" })).statusCode).toBe(401);
    expect((await t.post("/api/setup/auth", { token: t.token(), mode: "pin", pin: "24", adminPassword: "admin-password" })).statusCode).toBe(400);
    expect((await t.post("/api/setup/auth", { token: t.token(), mode: "root" })).statusCode).toBe(400);
    const r = await t.post("/api/setup/auth", { token: t.token(), mode: "pin", pin: "2468", adminPassword: "admin-password" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ role: "admin", mode: "pin" });
    const me = await t.get("/api/auth/me", { cookie: cookieOf(r) });
    expect(me.json()).toMatchObject({ role: "admin", via: "session", permissions: expect.arrayContaining(["manage_users"]) });
    expect((await t.post("/api/setup/auth", { token: t.token(), mode: "pin", pin: "1357", adminPassword: "admin-password" })).statusCode).toBe(409);
    expect(t.logs.find((l) => l.evt === "setup_complete")).toMatchObject({ mode: "pin", ip: LAN });
  });

  it("proxy setup returns no cookie, then the proxy header signs people in", async () => {
    const t = await makeApp();
    const r = await t.post("/api/setup/auth", { token: t.token(), mode: "proxy", preset: "tailscale", admins: ["owner@example.com"] });
    expect(r.statusCode).toBe(200);
    expect(r.headers["set-cookie"]).toBeUndefined();
    const via = await t.get("/api/thing", { remoteAddress: PROXY, headers: { "tailscale-user-login": "owner@example.com" } });
    expect(via.json().auth).toMatchObject({ role: "admin", via: "proxy", userId: "owner@example.com" });
  });
});

describe("proxy mode", () => {
  const data = (): AuthData => ({
    version: 1, mode: "proxy", users: [], sessions: [],
    proxy: normalizeProxySettings({ preset: "authelia", admins: ["boss"], members: ["kid"] }),
  });

  it("trusts the header only from trusted proxies, and strips it otherwise", async () => {
    const t = await makeApp(data(), { trustedProxies: ["10.0.0.0/24", "fd00::/8"] });
    const ok = await t.get("/api/thing", { remoteAddress: PROXY, headers: { "remote-user": "kid", "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" } });
    expect(ok.json()).toMatchObject({ auth: { role: "member", userId: "kid" }, client: { ip: "203.0.113.9", proto: "https", viaProxy: true } });
    expect(ok.headers["strict-transport-security"]).toBe("max-age=15552000");
    const v6 = await t.get("/api/thing", { remoteAddress: "fd00::5", headers: { "remote-user": "boss" } });
    expect(v6.json().auth.role).toBe("admin");
    const mapped = await t.get("/api/thing", { remoteAddress: "::ffff:10.0.0.7", headers: { "remote-user": "boss" } });
    expect(mapped.json().auth.role).toBe("admin");
    // A LAN client sending the header itself gets nothing, and the header never reaches the route.
    const forged = await t.get("/api/open", { headers: { "remote-user": "boss" } });
    expect(forged.json()).toEqual({ authed: false });
    expect((await t.get("/api/thing", { headers: { "remote-user": "boss" } })).statusCode).toBe(401);
    // Spoofed X-Forwarded-For from a LAN client is ignored.
    const spoof = await t.get("/api/open", { headers: { "x-forwarded-for": PROXY } });
    expect(spoof.statusCode).toBe(200);
    expect((await t.get("/api/thing", { remoteAddress: PROXY, headers: { "remote-user": "stranger" } })).statusCode).toBe(401);
    expect((await t.post("/api/auth/login", { pin: "1234" })).json().code).toBe("proxy_mode");
  });

  it("permissions apply to proxy identities", async () => {
    const t = await makeApp(data());
    const as = (u: string) => ({ remoteAddress: PROXY, headers: { "remote-user": u } });
    expect((await t.get("/api/tvs", as("kid"))).statusCode).toBe(403);
    expect((await t.get("/api/tvs", as("boss"))).statusCode).toBe(200);
    expect((await t.get("/api/admin", as("kid"))).statusCode).toBe(403);
    expect((await t.get("/api/auth/sessions", as("boss"))).json()).toEqual({ sessions: [] });
  });
});

describe("pin mode over HTTP", () => {
  it("PIN for members, password for admin; logout revokes the session", async () => {
    const t = await pinApp();
    const bad = await t.post("/api/auth/login", { pin: "0000" });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe("Wrong PIN.");
    const m = await t.post("/api/auth/login", { pin: "2468" });
    expect(m.json()).toMatchObject({ role: "member", permissions: ["view", "launch", "remote", "edit_favorites"] });
    const member = cookieOf(m);
    expect((await t.get("/api/tvs", { cookie: member })).statusCode).toBe(403);
    expect((await t.get("/api/tvs", { cookie: t.admin })).statusCode).toBe(200);
    expect((await t.post("/api/auth/pin", { pin: "1357" }, { cookie: member })).statusCode).toBe(403);
    const out = await t.post("/api/auth/logout", {}, { cookie: member });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/^sr_session=; .*Max-Age=0/);
    expect((await t.get("/api/thing", { cookie: member })).statusCode).toBe(401); // revoked server-side, not just cleared
    expect((await t.post("/api/auth/login", { foo: 1 })).statusCode).toBe(400);
  });

  it("an admin changes the PIN and members are signed out", async () => {
    const t = await pinApp();
    const member = cookieOf(await t.post("/api/auth/login", { pin: "2468" }));
    expect((await t.post("/api/auth/pin", { pin: "1357" }, { cookie: t.admin })).statusCode).toBe(204);
    expect((await t.get("/api/thing", { cookie: member })).statusCode).toBe(401);
    expect((await t.post("/api/auth/login", { pin: "1357" }, { remoteAddress: "192.168.1.40" })).statusCode).toBe(200);
  });

  it("Secure cookies when the browser uses HTTPS through a trusted proxy", async () => {
    const t = await pinApp();
    const r = await t.post("/api/auth/login", { pin: "2468" }, { remoteAddress: PROXY, headers: { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.4" } });
    expect(String(r.headers["set-cookie"])).toMatch(/; Secure$/);
    expect(t.logs.find((l) => l.evt === "login" && l.ip === "203.0.113.4")).toBeTruthy();
    // The same header from an untrusted client doesn't count.
    const plain = await t.post("/api/auth/login", { pin: "2468" }, { headers: { "x-forwarded-proto": "https" } });
    expect(String(plain.headers["set-cookie"])).not.toContain("Secure");
  });

  it("rate limit is per real client, not per proxy", async () => {
    const t = await pinApp();
    const from = (ip: string) => ({ remoteAddress: PROXY, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 5; i++) await t.post("/api/auth/login", { pin: "0000" }, from("203.0.113.1"));
    const limited = await t.post("/api/auth/login", { pin: "2468" }, from("203.0.113.1"));
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect((await t.post("/api/auth/login", { pin: "2468" }, from("203.0.113.2"))).statusCode).toBe(200);
  });
});

describe("accounts over HTTP", () => {
  it("admin manages users; members can't", async () => {
    const t = await accountsApp();
    const created = await t.post("/api/auth/users", { username: "Kid", password: "kid-password" }, { cookie: t.admin });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ username: "kid", role: "member", disabled: false });
    expect(JSON.stringify(created.json())).not.toContain("scrypt");
    expect((await t.post("/api/auth/users", { username: "kid", password: "kid-password" }, { cookie: t.admin })).statusCode).toBe(409);
    expect((await t.post("/api/auth/users", { username: "x y", password: "kid-password" }, { cookie: t.admin })).statusCode).toBe(400);
    const kid = cookieOf(await t.post("/api/auth/login", { username: "kid", password: "kid-password" }));
    expect((await t.get("/api/auth/users", { cookie: kid })).statusCode).toBe(403);
    expect((await t.post("/api/auth/users", { username: "evil", password: "password1", role: "admin" }, { cookie: kid })).statusCode).toBe(403);
    const list = (await t.get("/api/auth/users", { cookie: t.admin })).json().users as { id: string; username: string }[];
    expect(list.map((u) => u.username)).toEqual(["admin", "kid"]);
    const kidId = list[1].id;
    const adminId = list[0].id;
    expect((await t.patch(`/api/auth/users/${adminId}`, { role: "member" }, { cookie: t.admin })).json().code).toBe("last_admin");
    expect((await t.patch(`/api/auth/users/${kidId}`, { role: "admin" }, { cookie: t.admin })).json().role).toBe("admin");
    expect((await t.get("/api/tvs", { cookie: kid })).statusCode).toBe(200); // promotion applies at once
    expect((await t.patch(`/api/auth/users/${kidId}`, { role: "owner" }, { cookie: t.admin })).statusCode).toBe(400);
    expect((await t.del(`/api/auth/users/${kidId}`, { cookie: t.admin })).statusCode).toBe(204);
    expect((await t.get("/api/thing", { cookie: kid })).statusCode).toBe(401); // deleted users are signed out
    expect((await t.del(`/api/auth/users/${adminId}`, { cookie: t.admin })).statusCode).toBe(409);
    expect((await t.del("/api/auth/users/nope", { cookie: t.admin })).statusCode).toBe(404);
  });

  it("wrong username or password, with the username in the log", async () => {
    const t = await accountsApp();
    const r = await t.post("/api/auth/login", { username: "admin", password: "nope-nope" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("Wrong username or password.");
    expect(t.logs.find((l) => l.evt === "login_failed")).toEqual({ evt: "login_failed", ip: LAN, mode: "accounts", username: "admin" });
  });

  it("sessions: list, revoke one, sign out all devices", async () => {
    const t = await accountsApp();
    const phone = cookieOf(await t.post("/api/auth/login", { username: "admin", password: "admin-password" }, { headers: { "user-agent": "iPhone" } }));
    const sessions = (await t.get("/api/auth/sessions", { cookie: t.admin })).json().sessions as { id: string; current: boolean; userAgent: string }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const other = sessions.find((s) => !s.current)!;
    expect(other.userAgent).toBe("iPhone");
    expect((await t.del(`/api/auth/sessions/${other.id}`, { cookie: t.admin })).statusCode).toBe(204);
    expect((await t.get("/api/thing", { cookie: phone })).statusCode).toBe(401);
    expect((await t.del(`/api/auth/sessions/${other.id}`, { cookie: t.admin })).statusCode).toBe(404);

    const tablet = cookieOf(await t.post("/api/auth/login", { username: "admin", password: "admin-password" }));
    const all = await t.post("/api/auth/sessions/revoke-all", {}, { cookie: t.admin });
    expect(all.json()).toEqual({ revoked: 1 });
    expect((await t.get("/api/thing", { cookie: tablet })).statusCode).toBe(401);
    expect((await t.get("/api/thing", { cookie: t.admin })).statusCode).toBe(200);
    const everywhere = await t.post("/api/auth/sessions/revoke-all", { includeCurrent: true }, { cookie: t.admin });
    expect(everywhere.json()).toEqual({ revoked: 1 });
    expect(String(everywhere.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect((await t.get("/api/thing", { cookie: t.admin })).statusCode).toBe(401);
  });

  it("revoking your current session clears the cookie", async () => {
    const t = await accountsApp();
    const me = (await t.get("/api/auth/sessions", { cookie: t.admin })).json().sessions[0];
    const r = await t.del(`/api/auth/sessions/${me.id}`, { cookie: t.admin });
    expect(r.statusCode).toBe(204);
    expect(String(r.headers["set-cookie"])).toMatch(/Max-Age=0/);
  });

  it("change own password keeps this session and ends the others", async () => {
    const t = await accountsApp();
    const other = cookieOf(await t.post("/api/auth/login", { username: "admin", password: "admin-password" }));
    expect((await t.post("/api/auth/password", { currentPassword: "wrong-pass", newPassword: "new-password" }, { cookie: t.admin })).statusCode).toBe(403);
    expect((await t.post("/api/auth/password", { currentPassword: "admin-password", newPassword: "new-password" }, { cookie: t.admin })).statusCode).toBe(204);
    expect((await t.get("/api/thing", { cookie: t.admin })).statusCode).toBe(200);
    expect((await t.get("/api/thing", { cookie: other })).statusCode).toBe(401);
  });
});

describe("request checks and headers", () => {
  it("Host, Origin and content type are checked before anything else; /healthz skips them", async () => {
    const t = await pinApp();
    expect((await t.get("/api/open", { headers: { host: "evil.example.com" } })).statusCode).toBe(421);
    const noOrigin = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { pin: "2468" }, headers: { host: HOST, "content-type": "application/json" }, remoteAddress: LAN });
    expect(noOrigin.statusCode).toBe(403);
    const deleteNoOrigin = await t.app.inject({ method: "DELETE", url: "/api/auth/sessions/x", headers: { host: HOST, cookie: t.admin }, remoteAddress: LAN });
    expect(deleteNoOrigin.statusCode).toBe(403);
    expect((await t.app.inject({ url: "/healthz", headers: { host: "anything" } })).statusCode).toBe(200);
  });

  it("security headers on every response; HSTS only over HTTPS", async () => {
    const t = await pinApp();
    const r = await t.get("/");
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["strict-transport-security"]).toBeUndefined();
    const denied = await t.get("/api/thing");
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["content-security-policy"]).toBeTruthy();
  });

  it("sliding sessions re-send the cookie when the expiry moves", async () => {
    let now = Date.UTC(2026, 9, 18);
    const logs: Record<string, unknown>[] = [];
    const auth = await AuthService.open({ store: new MemoryAuthStore(), scrypt: FAST, now: () => now, log: (e) => logs.push(e), sessionLifetimeMs: 86400_000 });
    const token = new URL(String(logs[0].url), "http://x").searchParams.get("token")!;
    const app = Fastify();
    installAuth(app, auth, { allowedHosts: [HOST] });
    app.get("/api/thing", async () => ({ ok: true }));
    const setup = await app.inject({ method: "POST", url: "/api/setup/auth", payload: { token, mode: "pin", pin: "2468", adminPassword: "admin-password" }, headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json" } });
    const cookie = cookieOf(setup);
    expect(String(setup.headers["set-cookie"])).toContain("Max-Age=86400");
    now += 60_000;
    expect((await app.inject({ url: "/api/thing", headers: { host: HOST, cookie } })).headers["set-cookie"]).toBeUndefined();
    now += 20 * 60_000;
    const slid = await app.inject({ url: "/api/thing", headers: { host: HOST, cookie } });
    expect(String(slid.headers["set-cookie"])).toBe(`${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    now += 86400_000 + 1;
    expect((await app.inject({ url: "/api/thing", headers: { host: HOST, cookie } })).statusCode).toBe(401);
  });
});
