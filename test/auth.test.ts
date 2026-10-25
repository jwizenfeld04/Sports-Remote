// Unit tests for server/auth: hashing, sessions, trusted proxies, setup token, permissions, limits, storage.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowedHost, AuthError, AuthService, can, clientInfo, contentSecurityPolicy, csrfOk, FailureBackoff, hashSecret, hashSessionId,
  identityHeaders, JsonFileAuthStore, LoginLimiter, MemoryAuthStore, normalizeIp, normalizeProxySettings, normalizeUsername,
  parseAuthData, parseCookies, passwordProblem, permissionsFor, pinProblem, proxyIdentity, securityHeaders, sessionCookie,
  SessionManager, SetupToken, TrustList, lanOverlaps, verifySecret, type AuthData,
} from "../server/auth";

const FAST = { N: 1024, r: 8, p: 1 };

function clock(start = Date.UTC(2026, 9, 18, 21)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("password hashing", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashSecret("correct horse", FAST);
    const b = await hashSecret("correct horse", FAST);
    expect(a).toMatch(/^scrypt\$1024\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b); // different salts
    expect(await verifySecret("correct horse", a)).toBe(true);
    expect(await verifySecret("correct horsf", a)).toBe(false);
    expect(await verifySecret("", a)).toBe(false);
  });

  it("uses the parameters stored in the hash", async () => {
    const h = await hashSecret("pw-12345", { N: 2048, r: 4, p: 1 });
    expect(h.startsWith("scrypt$2048$4$1$")).toBe(true);
    expect(await verifySecret("pw-12345", h)).toBe(true);
  });

  it("the default cost works within Node's memory limits", async () => {
    const h = await hashSecret("default-cost");
    expect(h.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifySecret("default-cost", h)).toBe(true);
  });

  it("never matches malformed or hostile hashes", async () => {
    const good = await hashSecret("x".repeat(8), FAST);
    const parts = good.split("$");
    for (const bad of [
      null, undefined, "", "plaintext", "bcrypt$1$2$3$4$5",
      [...parts.slice(0, 1), String(2 ** 24), ...parts.slice(2)].join("$"), // N too large (DoS)
      [...parts.slice(0, 1), "1000", ...parts.slice(2)].join("$"), // not a power of two
      [...parts.slice(0, 5), "short"].join("$"),
    ]) expect(await verifySecret("x".repeat(8), bad)).toBe(false);
    expect(await verifySecret(12345678 as unknown, good)).toBe(false);
  });

  it("normalizes Unicode so the same password typed differently matches", async () => {
    const h = await hashSecret("café-pass", FAST); // precomposed é
    expect(await verifySecret("café-pass", h)).toBe(true); // e + combining accent
  });
});

describe("what people may choose", () => {
  it("PINs are 4-12 digits", () => {
    for (const ok of ["1234", "000000", "123456789012"]) expect(pinProblem(ok)).toBeNull();
    for (const bad of ["123", "1234567890123", "12a4", " 1234", 1234, null]) expect(pinProblem(bad)).not.toBeNull();
  });
  it("passwords are 8-256 characters", () => {
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("1234567")).toMatch(/at least 8/);
    expect(passwordProblem("x".repeat(257))).toMatch(/at most/);
    expect(passwordProblem(undefined)).not.toBeNull();
  });
  it("usernames are lowercased and limited to a safe alphabet", () => {
    expect(normalizeUsername("  Sam.Smith ")).toBe("sam.smith");
    expect(normalizeUsername("a_b-c9")).toBe("a_b-c9");
    for (const bad of ["a", "-sam", "sam smith", "sam/../x", "x".repeat(33), "émile", "", 5]) expect(normalizeUsername(bad)).toBeNull();
  });
});

describe("sessions", () => {
  const make = (c = clock(), changes = { n: 0 }) =>
    new SessionManager([], { now: c.now, lifetimeMs: 30 * 86400_000, touchIntervalMs: 10 * 60_000, onChange: () => changes.n++ });

  it("issues random 32-byte ids and stores only their SHA-256", () => {
    const m = make();
    const { id, session } = m.create({ userId: "u1", role: "member" }, { userAgent: "x".repeat(500), ip: "192.168.1.9" });
    expect(Buffer.from(id, "base64url")).toHaveLength(32);
    expect(session.idHash).toBe(hashSessionId(id));
    expect(JSON.stringify(m.snapshot())).not.toContain(id);
    expect(session.userAgent).toHaveLength(160); // truncated
    expect(m.use(id)?.session.userId).toBe("u1");
    expect(m.use("nope")).toBeNull();
    expect(m.use(session.idHash)).toBeNull(); // the stored hash isn't a valid cookie
  });

  it("expires after the lifetime without use", () => {
    const c = clock();
    const m = make(c);
    const { id } = m.create({ userId: null, role: "member" });
    c.advance(30 * 86400_000 + 1);
    expect(m.use(id)).toBeNull();
    expect(m.snapshot()).toHaveLength(0);
  });

  it("slides: each use (at most every touch interval) pushes expiry out", () => {
    const c = clock();
    const changes = { n: 0 };
    const m = make(c, changes);
    const { id, session } = m.create({ userId: null, role: "member" });
    const first = session.expiresAt;
    changes.n = 0;
    c.advance(60_000);
    expect(m.use(id)).toMatchObject({ refreshed: false }); // within the touch interval: no write
    expect(changes.n).toBe(0);
    c.advance(10 * 60_000);
    expect(m.use(id, { ip: "10.0.0.7" })).toMatchObject({ refreshed: true });
    expect(changes.n).toBe(1);
    expect(m.use(id)!.session.expiresAt).toBe(first + 11 * 60_000);
    expect(m.use(id)!.session.ip).toBe("10.0.0.7");
    // Used every 20 days, it never expires.
    for (let i = 0; i < 5; i++) {
      c.advance(20 * 86400_000);
      expect(m.use(id)).not.toBeNull();
    }
  });

  it("revokes one, all for a user, or everything (optionally keeping the current one)", () => {
    const m = make();
    const a1 = m.create({ userId: "a", role: "admin" });
    const a2 = m.create({ userId: "a", role: "admin" });
    const b = m.create({ userId: "b", role: "member" });
    const p = m.create({ userId: null, role: "member" });
    expect(m.revoke(b.session.idHash)).toBe(true);
    expect(m.revoke(b.session.idHash)).toBe(false);
    expect(m.revokeForUser("a", a1.session.idHash)).toBe(1);
    expect(m.use(a1.id)).not.toBeNull();
    expect(m.use(a2.id)).toBeNull();
    expect(m.revokeAll(a1.session.idHash)).toBe(1);
    expect(m.use(p.id)).toBeNull();
    expect(m.list(() => true, a1.session.idHash)).toEqual([expect.objectContaining({ id: a1.session.idHash, current: true })]);
  });

  it("drops expired sessions loaded from disk", () => {
    const c = clock();
    const m = new SessionManager(
      [{ idHash: "h", userId: null, role: "member", createdAt: 0, lastSeenAt: 0, expiresAt: c.now() - 1, userAgent: "", ip: "" }],
      { now: c.now },
    );
    expect(m.snapshot()).toEqual([]);
  });
});

describe("trusted proxies", () => {
  it("normalizes addresses", () => {
    expect(normalizeIp("::ffff:192.168.1.9")).toBe("192.168.1.9");
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("203.0.113.5:51234")).toBe("203.0.113.5");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });

  it("matches IPv4 and IPv6 CIDRs, single addresses, mapped addresses and named groups", () => {
    const t = new TrustList(["10.0.0.0/8", "2001:db8::/32", "192.168.1.5", "loopback"]);
    expect(t.has("10.255.0.1")).toBe(true);
    expect(t.has("::ffff:10.1.2.3")).toBe(true); // how Node reports IPv4 on a dual-stack socket
    expect(t.has("11.0.0.1")).toBe(false);
    expect(t.has("2001:db8:1::5")).toBe(true);
    expect(t.has("2001:db9::5")).toBe(false);
    expect(t.has("192.168.1.5")).toBe(true);
    expect(t.has("192.168.1.6")).toBe(false);
    expect(t.has("127.0.0.1")).toBe(true);
    expect(t.has("::1")).toBe(true);
    expect(t.has(undefined)).toBe(false);
    expect(new TrustList(["172.16.0.0/12"]).has("172.20.0.3")).toBe(true);
    expect(() => new TrustList(["private"])).toThrow(); // removed: it trusted every device on the LAN
    expect(new TrustList([]).has("127.0.0.1")).toBe(false);
  });

  it("flags trusted ranges that contain this machine's LAN address", () => {
    expect(lanOverlaps(["192.168.1.0/24", "172.18.0.0/16", "192.168.1.7", "loopback"], ["192.168.1.11"])).toEqual(["192.168.1.0/24"]);
    expect(lanOverlaps(["10.0.0.0/8"], [])).toEqual([]);
  });

  it("rejects bad entries", () => {
    for (const bad of ["10.0.0.0/33", "::/129", "example.com", "10.0.0.0/x", "1.2.3.4/", "0.0.0.0/0", "::/0", "0.0.0.0/4"]) expect(() => new TrustList([bad])).toThrow();
  });

  const trusted = new TrustList(["10.0.0.2", "fd00::/8"]);

  it("ignores forwarded headers from an untrusted peer", () => {
    const c = clientInfo("192.168.1.9", { "x-forwarded-for": "1.1.1.1", "x-forwarded-proto": "https" }, trusted);
    expect(c).toEqual({ ip: "192.168.1.9", proto: "http", viaProxy: false });
  });

  it("uses the right-most untrusted address and the proxy's protocol from a trusted peer", () => {
    const c = clientInfo("::ffff:10.0.0.2", { "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https" }, trusted);
    expect(c).toEqual({ ip: "203.0.113.7", proto: "https", viaProxy: true });
  });

  it("can't be spoofed by a client putting addresses in X-Forwarded-For", () => {
    // The client sent "X-Forwarded-For: 10.0.0.2, 127.0.0.1"; the proxy appended the real address.
    const c = clientInfo("10.0.0.2", { "x-forwarded-for": "10.0.0.2, 127.0.0.1, 198.51.100.4" }, trusted);
    expect(c.ip).toBe("198.51.100.4");
    // Chains of trusted proxies are skipped from the right.
    expect(clientInfo("10.0.0.2", { "x-forwarded-for": "9.9.9.9, 198.51.100.4, fd00::3" }, trusted).ip).toBe("198.51.100.4");
    // Garbage on the right stops the walk at the last good address (the peer).
    expect(clientInfo("10.0.0.2", { "x-forwarded-for": "1.2.3.4, <script>" }, trusted).ip).toBe("10.0.0.2");
    // Repeated headers are joined.
    expect(clientInfo("10.0.0.2", { "x-forwarded-for": ["1.1.1.1", "2.2.2.2"] }, trusted).ip).toBe("2.2.2.2");
  });

  it("takes the right-most X-Forwarded-Proto, and falls back to the socket", () => {
    expect(clientInfo("10.0.0.2", { "x-forwarded-proto": "https, http" }, trusted).proto).toBe("http");
    expect(clientInfo("10.0.0.2", { "x-forwarded-proto": "gopher" }, trusted).proto).toBe("http");
    expect(clientInfo("10.0.0.2", {}, trusted, true).proto).toBe("https");
    expect(clientInfo("10.0.0.2", {}, trusted)).toEqual({ ip: "10.0.0.2", proto: "http", viaProxy: true });
  });
});

describe("proxy identity", () => {
  const settings = normalizeProxySettings({ preset: "cloudflare", admins: ["Owner@Example.com "], members: ["kid@example.com"] });

  it("presets pick the header; lists are lowercased", () => {
    expect(settings.header).toBe("Cf-Access-Authenticated-User-Email");
    expect(settings.admins).toEqual(["owner@example.com"]);
    expect(normalizeProxySettings({ admins: [] }).header).toBe("Remote-User");
    expect(normalizeProxySettings({ preset: "tailscale", admins: [] }).header).toBe("Tailscale-User-Login");
    expect(() => normalizeProxySettings({ header: "Bad Header:\r\n", admins: [] })).toThrow();
  });

  it("admins, members, anyone, or nobody", () => {
    const h = (v: string | string[]) => ({ "cf-access-authenticated-user-email": v });
    expect(proxyIdentity(settings, h("OWNER@example.com"))).toEqual({ identity: "owner@example.com", role: "admin" });
    expect(proxyIdentity(settings, h("kid@example.com"))).toEqual({ identity: "kid@example.com", role: "member" });
    expect(proxyIdentity(settings, h("guest@example.com"))).toBeNull();
    expect(proxyIdentity({ ...settings, allowAnyAuthenticated: true }, h("guest@example.com"))?.role).toBe("member");
    expect(proxyIdentity(settings, {})).toBeNull();
    expect(proxyIdentity(settings, h(["owner@example.com", "kid@example.com"]))).toBeNull(); // ambiguous
    expect(proxyIdentity(settings, h("   "))).toBeNull();
  });

  it("knows every identity header to strip", () => {
    expect(identityHeaders(normalizeProxySettings({ header: "X-Auth-User", admins: [] }))).toEqual(
      expect.arrayContaining(["tailscale-user-login", "remote-user", "cf-access-authenticated-user-email", "x-auth-user"]),
    );
  });
});

describe("setup token", () => {
  it("works once, only with the right value", () => {
    const t = new SetupToken();
    const token = t.issue();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(t.check(token + "x")).toBe(false);
    expect(t.check(token.slice(0, -1))).toBe(false);
    expect(t.check(undefined)).toBe(false);
    expect(t.check(token)).toBe(true); // checking doesn't use it up
    expect(t.consume(token)).toBe(true);
    expect(t.consume(token)).toBe(false);
    expect(t.active).toBe(false);
  });

  it("expires after 24 hours", () => {
    const c = clock();
    const t = new SetupToken(c.now);
    const token = t.issue();
    c.advance(24 * 3600_000 - 1);
    expect(t.check(token)).toBe(true);
    c.advance(1);
    expect(t.check(token)).toBe(false);
  });

  it("a new token replaces the old one", () => {
    const t = new SetupToken();
    const old = t.issue();
    const fresh = t.issue();
    expect(t.check(old)).toBe(false);
    expect(t.check(fresh)).toBe(true);
  });
});

describe("permissions", () => {
  it("members watch and use the remote; admins can do everything", () => {
    for (const p of ["view", "launch", "remote", "edit_favorites"] as const) expect(can("member", p)).toBe(true);
    for (const p of ["edit_settings", "manage_tvs", "manage_users", "setup"] as const) {
      expect(can("member", p)).toBe(false);
      expect(can("admin", p)).toBe(true);
    }
    expect(can(null, "view")).toBe(false);
    expect(can("guest" as never, "view")).toBe(false);
    expect(permissionsFor("admin")).toHaveLength(8);
  });
});

describe("login rate limits", () => {
  it("allows 5 attempts per minute per address", () => {
    const c = clock();
    const l = new LoginLimiter(c.now);
    for (let i = 0; i < 5; i++) expect(l.take("192.168.1.9")).toBe(true);
    expect(l.take("192.168.1.9")).toBe(false);
    expect(l.take("192.168.1.11")).toBe(true); // other clients unaffected
    c.advance(60_000);
    expect(l.take("192.168.1.9")).toBe(true);
  });

  it("global backoff grows after many failures, is capped, and wears off", () => {
    const c = clock();
    const b = new FailureBackoff(c.now, 3, 15 * 60_000, 8000);
    for (let i = 0; i < 2; i++) b.fail();
    expect(b.waitMs()).toBe(0);
    b.fail();
    expect(b.waitMs()).toBe(1000);
    b.fail();
    expect(b.waitMs()).toBe(2000);
    for (let i = 0; i < 10; i++) b.fail();
    expect(b.waitMs()).toBe(8000); // capped
    c.advance(8000);
    expect(b.waitMs()).toBe(0);
    c.advance(15 * 60_000);
    b.fail();
    expect(b.waitMs()).toBe(0); // old failures aged out
  });
});

describe("http helpers", () => {
  it("parses cookies and survives bad escapes", () => {
    expect(parseCookies("a=1; sr_session=abc%3D; b")).toEqual({ a: "1", sr_session: "abc=" });
    expect(parseCookies("x=%E0%A4%A; sr_session=ok")).toEqual({ sr_session: "ok" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("session cookie is HttpOnly, SameSite=Strict, Path=/, Secure only over HTTPS", () => {
    expect(sessionCookie("v", 2592000, false)).toBe("sr_session=v; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000");
    expect(sessionCookie("v", 60, true)).toMatch(/; Secure$/);
  });

  it("allowed hosts", () => {
    expect(allowedHost([], "minipc.tail1234.ts.net")).toBe(true);
    expect(allowedHost([], "192.168.1.25:8787")).toBe(true);
    expect(allowedHost([], "[::1]:8787")).toBe(true);
    expect(allowedHost([], "[2001:db8::1]")).toBe(true);
    expect(allowedHost([], "sports-remote.local")).toBe(true);
    expect(allowedHost([], "evil.example.com")).toBe(false);
    expect(allowedHost(["Games.Example.com"], "games.example.com:443")).toBe(true);
    expect(allowedHost([], undefined)).toBe(false);
  });

  it("csrf: JSON from our own origin; DELETE needs the origin but no body", () => {
    const h = { host: "a.lan", origin: "https://a.lan", "content-type": "application/json" };
    expect(csrfOk("GET", {})).toBe(true);
    expect(csrfOk("POST", h)).toBe(true);
    expect(csrfOk("POST", { ...h, "content-type": "text/plain" })).toBe(false);
    expect(csrfOk("POST", { ...h, origin: "https://evil.lan" })).toBe(false);
    expect(csrfOk("POST", { ...h, origin: "null" })).toBe(false);
    expect(csrfOk("DELETE", { host: "a.lan", origin: "https://a.lan" })).toBe(true);
    expect(csrfOk("DELETE", { host: "a.lan" })).toBe(false);
  });

  it("CSP allows only our scripts and styles, ESPN logos; HSTS only over HTTPS", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("img-src 'self' data: https://a.espncdn.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(securityHeaders(false)["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders(true)["Strict-Transport-Security"]).toBe("max-age=15552000");
  });
});

describe("storage", () => {
  const data = (): AuthData => ({ version: 1, mode: "pin", users: [], sessions: [], pin: { pinHash: "x", adminPasswordHash: "y" } });

  it("JSON file: atomic write with mode 0600, then reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-auth-"));
    const store = new JsonFileAuthStore(join(dir, "sub", "auth.json"));
    expect(await store.load()).toBeNull();
    await store.save(data());
    await store.save({ ...data(), mode: "accounts" });
    expect(readdirSync(join(dir, "sub"))).toEqual(["auth.json"]); // no temp files left
    expect(statSync(join(dir, "sub", "auth.json")).mode & 0o777).toBe(0o600);
    expect((await store.load())?.mode).toBe("accounts");
  });

  it("refuses damaged or newer files instead of starting over", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-auth-"));
    const file = join(dir, "auth.json");
    writeFileSync(file, "{oops");
    await expect(new JsonFileAuthStore(file).load()).rejects.toThrow(/not valid JSON/);
    writeFileSync(file, JSON.stringify({ ...data(), version: 7 }));
    await expect(new JsonFileAuthStore(file).load()).rejects.toThrow(/newer version/);
    writeFileSync(file, JSON.stringify({ ...data(), users: "nope" }));
    await expect(new JsonFileAuthStore(file).load()).rejects.toThrow(/damaged/);
    expect(readFileSync(file, "utf8")).toContain("nope"); // the bad file is kept
    expect(() => parseAuthData(data())).not.toThrow();
  });
});

describe("AuthService", () => {
  const open = async (data: AuthData | null = null, extra: Partial<Parameters<typeof AuthService.open>[0]> = {}) => {
    const store = new MemoryAuthStore(data);
    const logs: Record<string, unknown>[] = [];
    const svc = await AuthService.open({ store, scrypt: FAST, log: (e) => logs.push(e), ...extra });
    return { svc, store, logs };
  };
  const tokenFrom = (logs: Record<string, unknown>[]) => new URL(String(logs.find((l) => l.evt === "setup_required")!.url), "http://x").searchParams.get("token")!;
  const meta = { ip: "192.168.1.9", userAgent: "test" };

  it("an expired setup link prints a new one when someone tries it", async () => {
    let t = 0;
    const { svc, logs } = await open(null, { now: () => t });
    const first = tokenFrom(logs);
    t += 25 * 3600_000;
    expect(svc.checkSetupToken(first)).toBe(false);
    const issued = logs.filter((l) => l.evt === "setup_required");
    expect(issued).toHaveLength(2);
    expect(svc.checkSetupToken(tokenFrom(issued.slice(1)))).toBe(true);
  });

  it("first run: prints a setup link; the token works once", async () => {
    const { svc, logs, store } = await open(null, { setupUrl: (t) => `http://192.168.1.25:8787/setup?token=${t}` });
    expect(svc.isSetupComplete()).toBe(false);
    expect(String(logs[0].url)).toMatch(/^http:\/\/192\.168\.1\.25:8787\/setup\?token=[\w-]{32}$/);
    const token = tokenFrom(logs);
    expect(svc.checkSetupToken("wrong")).toBe(false);
    expect(svc.checkSetupToken(token)).toBe(true);
    // A bad request doesn't burn the token.
    await expect(svc.completeSetup(token, { mode: "pin", pin: "12", adminPassword: "long-enough" })).rejects.toThrow(/PIN/);
    const r = await svc.completeSetup(token, { mode: "pin", pin: "2468", adminPassword: "long-enough" }, meta);
    expect(r.auth).toMatchObject({ role: "admin", via: "session" });
    expect(r.sessionId).toBeTruthy();
    expect(svc.mode).toBe("pin");
    expect(store.current?.pin?.pinHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(store.current)).not.toContain("2468");
    await expect(svc.completeSetup(token, { mode: "pin", pin: "1357", adminPassword: "long-enough" })).rejects.toMatchObject({ status: 409 });
  });

  it("setup rejects a wrong token and refuses once complete", async () => {
    const { svc, logs } = await open();
    await expect(svc.completeSetup("nope", { mode: "accounts", username: "sam", password: "password1" })).rejects.toMatchObject({ status: 401 });
    const r = await svc.completeSetup(tokenFrom(logs), { mode: "accounts", username: "Sam", password: "password1" });
    expect(r.auth).toMatchObject({ role: "admin", username: "sam" });
    expect(svc.listUsers()).toEqual([expect.objectContaining({ username: "sam", role: "admin" })]);
  });

  it("proxy setup needs a trusted proxy and an admin", async () => {
    const { svc, logs } = await open();
    const token = tokenFrom(logs);
    await expect(svc.completeSetup(token, { mode: "proxy", preset: "authelia", admins: ["me"] })).rejects.toThrow(/trusted proxies/);
    await expect(svc.completeSetup(token, { mode: "proxy", preset: "authelia", admins: [], trustedProxies: ["10.0.0.2"] })).rejects.toThrow(/admin/);
    await expect(svc.completeSetup(token, { mode: "proxy", admins: ["me"], trustedProxies: ["bogus"] })).rejects.toThrow(/IP/);
    const r = await svc.completeSetup(token, { mode: "proxy", preset: "authelia", admins: ["me"], trustedProxies: ["10.0.0.2"] });
    expect(r.sessionId).toBeNull();
    expect(svc.trustedProxies).toEqual(["10.0.0.2"]);
    const h = { "remote-user": "me" };
    expect(svc.identify("10.0.0.2", { ...h }).auth).toMatchObject({ role: "admin", via: "proxy", userId: "me" });
    const fromLan = { ...h } as Record<string, string>;
    expect(svc.identify("192.168.1.9", fromLan).auth).toBeNull();
    expect(fromLan["remote-user"]).toBeUndefined(); // stripped
  });

  it("strips identity headers from untrusted peers in every mode", async () => {
    const { svc } = await open({ version: 1, mode: "pin", users: [], sessions: [], pin: { pinHash: "x", adminPasswordHash: "y" } }, { trustedProxies: ["127.0.0.1"] });
    const h: Record<string, string> = { "tailscale-user-login": "a", "remote-user": "b", "cf-access-authenticated-user-email": "c", "x-other": "keep" };
    svc.identify("192.168.1.9", h);
    expect(h).toEqual({ "x-other": "keep" });
    const trusted: Record<string, string> = { "remote-user": "b" };
    svc.identify("127.0.0.1", trusted);
    expect(trusted["remote-user"]).toBe("b"); // a trusted proxy's headers are left alone
  });

  const accounts = async () => {
    const { svc, logs, store } = await open();
    const setup = await svc.completeSetup(tokenFrom(logs), { mode: "accounts", username: "admin", password: "admin-password" }, meta);
    return { svc, logs, store, adminAuth: setup.auth!, adminCookie: setup.sessionId! };
  };
  const cookieHeader = (id: string) => ({ cookie: `sr_session=${id}` });

  it("accounts: login, wrong password, unknown user, disabled user; events are logged", async () => {
    const { svc, logs } = await accounts();
    const member = await svc.createUser({ username: "kid", password: "kid-password" });
    expect(member.role).toBe("member");
    await expect(svc.login({ username: "kid", password: "wrong-pass" }, meta)).rejects.toMatchObject({ status: 401 });
    await expect(svc.login({ username: "ghost", password: "kid-password" }, meta)).rejects.toMatchObject({ status: 401 });
    const ok = await svc.login({ username: "KID", password: "kid-password" }, meta);
    expect(ok.auth).toMatchObject({ role: "member", username: "kid" });
    expect(svc.identify("192.168.1.9", cookieHeader(ok.sessionId)).auth?.username).toBe("kid");
    await svc.updateUser(member.id, { disabled: true });
    expect(svc.identify("192.168.1.9", cookieHeader(ok.sessionId)).auth).toBeNull(); // signed out at once
    await expect(svc.login({ username: "kid", password: "kid-password" }, { ip: "10.1.1.1" })).rejects.toMatchObject({ status: 401 });
    const failed = logs.filter((l) => l.evt === "login_failed");
    expect(failed[0]).toEqual({ evt: "login_failed", ip: "192.168.1.9", mode: "accounts", username: "kid" });
    expect(failed[1]).toMatchObject({ username: "ghost" });
    expect(logs.find((l) => l.evt === "login")).toMatchObject({ ip: "192.168.1.9", mode: "accounts", username: "kid", role: "member" });
    expect(JSON.stringify(logs)).not.toContain("kid-password");
  });

  it("accounts: demoting takes effect on existing sessions", async () => {
    const { svc } = await accounts();
    const u = await svc.createUser({ username: "co-admin", password: "password2", role: "admin" });
    const s = await svc.login({ username: "co-admin", password: "password2" }, meta);
    expect(svc.identify("192.168.1.9", cookieHeader(s.sessionId)).auth?.role).toBe("admin");
    await svc.updateUser(u.id, { role: "member" });
    expect(svc.identify("192.168.1.9", cookieHeader(s.sessionId)).auth?.role).toBe("member");
  });

  it("accounts: rules for usernames, passwords, duplicates and the last admin", async () => {
    const { svc, adminAuth } = await accounts();
    await expect(svc.createUser({ username: "x", password: "password1" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createUser({ username: "bob", password: "short" })).rejects.toThrow(/at least 8/);
    await expect(svc.createUser({ username: "ADMIN", password: "password1" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.createUser({ username: "bob", password: "password1", role: "root" })).rejects.toMatchObject({ status: 400 });
    const id = adminAuth.userId!;
    await expect(svc.updateUser(id, { role: "member" })).rejects.toMatchObject({ code: "last_admin" });
    await expect(svc.updateUser(id, { disabled: true })).rejects.toMatchObject({ code: "last_admin" });
    await expect(svc.deleteUser(id)).rejects.toMatchObject({ code: "last_admin" });
    const other = await svc.createUser({ username: "bob", password: "password1", role: "admin" });
    await svc.updateUser(id, { role: "member" }); // fine now: bob is still an admin
    await expect(svc.deleteUser(other.id)).rejects.toMatchObject({ code: "last_admin" });
    await expect(svc.deleteUser("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("changing your password signs out your other sessions, not this one", async () => {
    const { svc, adminAuth, adminCookie } = await accounts();
    const other = await svc.login({ username: "admin", password: "admin-password" }, meta);
    await expect(svc.changePassword(adminAuth, "wrong-one", "new-password")).rejects.toMatchObject({ status: 403 });
    await expect(svc.changePassword(adminAuth, "admin-password", "short")).rejects.toMatchObject({ status: 400 });
    await svc.changePassword(adminAuth, "admin-password", "new-password");
    expect(svc.identify("1.1.1.1", cookieHeader(adminCookie)).auth).not.toBeNull();
    expect(svc.identify("1.1.1.1", cookieHeader(other.sessionId)).auth).toBeNull();
    await expect(svc.login({ username: "admin", password: "admin-password" }, { ip: "10.0.0.9" })).rejects.toMatchObject({ status: 401 });
    expect((await svc.login({ username: "admin", password: "new-password" }, { ip: "10.0.0.9" })).auth.role).toBe("admin");
  });

  it("an admin password reset signs that user out everywhere", async () => {
    const { svc } = await accounts();
    const u = await svc.createUser({ username: "kid", password: "kid-password" });
    const s = await svc.login({ username: "kid", password: "kid-password" }, meta);
    await svc.updateUser(u.id, { password: "fresh-password" });
    expect(svc.identify("1.1.1.1", cookieHeader(s.sessionId)).auth).toBeNull();
  });

  const pin = async () => {
    const { svc, logs, store } = await open();
    const setup = await svc.completeSetup(tokenFrom(logs), { mode: "pin", pin: "2468", adminPassword: "admin-password" }, meta);
    return { svc, logs, store, adminAuth: setup.auth!, adminCookie: setup.sessionId! };
  };

  it("pin: the PIN gives member, the admin password gives admin", async () => {
    const { svc, logs } = await pin();
    expect((await svc.login({ pin: "2468" }, meta)).auth).toMatchObject({ role: "member", userId: null });
    expect((await svc.login({ password: "admin-password" }, meta)).auth.role).toBe("admin");
    await expect(svc.login({ pin: "admin-password" }, meta)).rejects.toMatchObject({ status: 401 });
    await expect(svc.login({ password: "2468" }, { ip: "10.0.0.5" })).rejects.toThrow(/admin password/);
    await expect(svc.login({}, { ip: "10.0.0.5" })).rejects.toMatchObject({ status: 400 });
    expect(logs.filter((l) => l.evt === "login_failed").map((l) => l.as)).toEqual(["member", "admin"]);
  });

  it("pin: changing the PIN signs out members; changing the admin password signs out other admins", async () => {
    const { svc, adminAuth, adminCookie } = await pin();
    const member = await svc.login({ pin: "2468" }, meta);
    const admin2 = await svc.login({ password: "admin-password" }, meta);
    const memberAuth = svc.identify("1.1.1.1", cookieHeader(member.sessionId)).auth!;
    await expect(svc.changePin(memberAuth, "1357")).rejects.toMatchObject({ status: 403 });
    await expect(svc.changePassword(memberAuth, "2468", "new-password")).rejects.toMatchObject({ status: 403 });
    await expect(svc.changePin(adminAuth, "12")).rejects.toMatchObject({ status: 400 });
    await svc.changePin(adminAuth, "1357");
    expect(svc.identify("1.1.1.1", cookieHeader(member.sessionId)).auth).toBeNull();
    expect(svc.identify("1.1.1.1", cookieHeader(admin2.sessionId)).auth).not.toBeNull();
    await svc.changePassword(adminAuth, "admin-password", "new-password");
    expect(svc.identify("1.1.1.1", cookieHeader(admin2.sessionId)).auth).toBeNull();
    expect(svc.identify("1.1.1.1", cookieHeader(adminCookie)).auth).not.toBeNull();
    await expect(svc.login({ pin: "2468" }, { ip: "10.0.0.6" })).rejects.toMatchObject({ status: 401 });
    expect((await svc.login({ pin: "1357" }, { ip: "10.0.0.6" })).auth.role).toBe("member");
  });

  it("session listing and revoking: admins see all; members only their own", async () => {
    const { svc, adminAuth } = await accounts();
    await svc.createUser({ username: "kid", password: "kid-password" });
    const k1 = await svc.login({ username: "kid", password: "kid-password" }, meta);
    const k2 = await svc.login({ username: "kid", password: "kid-password" }, meta);
    const kidAuth = svc.identify("1.1.1.1", cookieHeader(k1.sessionId)).auth!;
    expect(svc.listSessions(adminAuth)).toHaveLength(3);
    const mine = svc.listSessions(kidAuth);
    expect(mine).toHaveLength(2);
    expect(mine.find((s) => s.current)?.id).toBe(kidAuth.sessionId);
    expect(svc.revokeSession(kidAuth, adminAuth.sessionId!)).toBe(false); // not theirs
    expect(() => svc.revokeAllSessions(kidAuth)).toThrow(AuthError);
    expect(() => svc.revokeUserSessions(kidAuth, adminAuth.userId!)).toThrow(AuthError);
    expect(svc.revokeUserSessions(kidAuth, kidAuth.userId!)).toBe(1); // their other device
    expect(svc.identify("1.1.1.1", cookieHeader(k2.sessionId)).auth).toBeNull();
    expect(svc.revokeAllSessions(adminAuth)).toBe(1); // everyone but the admin's own
    expect(svc.listSessions(adminAuth)).toEqual([expect.objectContaining({ current: true })]);
    expect(svc.revokeAllSessions(adminAuth, true)).toBe(1);
  });

  it("pin-mode members see only the current session", async () => {
    const { svc } = await pin();
    const m1 = await svc.login({ pin: "2468" }, meta);
    await svc.login({ pin: "2468" }, meta);
    const a = svc.identify("1.1.1.1", cookieHeader(m1.sessionId)).auth!;
    expect(svc.listSessions(a)).toEqual([expect.objectContaining({ current: true })]);
  });

  it("sessions survive a restart (persisted through the store)", async () => {
    const { svc, store, adminCookie } = await accounts();
    await svc.flush();
    const again = await AuthService.open({ store, scrypt: FAST });
    expect(again.isSetupComplete()).toBe(true);
    expect(again.identify("1.1.1.1", cookieHeader(adminCookie)).auth?.role).toBe("admin");
    expect(JSON.stringify(store.current)).not.toContain(adminCookie);
  });

  it("lastSeen writes are throttled", async () => {
    const c = clock();
    const { svc, store, adminCookie } = await (async () => {
      const r = await open(null, { now: c.now });
      const s = await r.svc.completeSetup(tokenFrom(r.logs), { mode: "pin", pin: "2468", adminPassword: "admin-password" });
      return { ...r, adminCookie: s.sessionId! };
    })();
    await svc.flush();
    const before = store.saves;
    for (let i = 0; i < 50; i++) svc.identify("1.1.1.1", cookieHeader(adminCookie));
    await svc.flush();
    expect(store.saves).toBe(before);
    c.advance(11 * 60_000);
    expect(svc.identify("1.1.1.1", cookieHeader(adminCookie)).refreshed).toBe(true);
    await svc.flush();
    expect(store.saves).toBe(before + 1);
  });

  it("per-IP limit and global backoff on login", async () => {
    const c = clock();
    const r = await open(null, { now: c.now });
    await r.svc.completeSetup(tokenFrom(r.logs), { mode: "pin", pin: "2468", adminPassword: "admin-password" });
    const svc = r.svc;
    for (let i = 0; i < 5; i++) await expect(svc.login({ pin: "0000" }, { ip: "10.0.0.1" })).rejects.toMatchObject({ status: 401 });
    await expect(svc.login({ pin: "2468" }, { ip: "10.0.0.1" })).rejects.toMatchObject({ status: 429, retryAfterSec: 60 });
    // Many addresses guessing at once trip the global backoff (10 free failures).
    for (let i = 0; i < 5; i++) await expect(svc.login({ pin: "0000" }, { ip: `10.0.1.${i}` })).rejects.toMatchObject({ status: 401 });
    await expect(svc.login({ pin: "0000" }, { ip: "10.0.2.1" })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    c.advance(1000);
    expect((await svc.login({ pin: "2468" }, { ip: "10.0.2.1" })).auth.role).toBe("member");
  });

  it("proxy mode refuses password logins; setup-required refuses everything", async () => {
    const { svc } = await open();
    await expect(svc.login({ pin: "2468" }, meta)).rejects.toMatchObject({ status: 409 });
    expect(svc.identify("127.0.0.1", { "remote-user": "x" }).auth).toBeNull();
    const p = await open({ version: 1, mode: "proxy", users: [], sessions: [], proxy: normalizeProxySettings({ admins: ["me"] }) }, { trustedProxies: ["loopback"] });
    await expect(p.svc.login({ pin: "2468" }, meta)).rejects.toMatchObject({ status: 400, code: "proxy_mode" });
    expect(p.logs.some((l) => l.evt === "setup_required")).toBe(false);
  });
});
