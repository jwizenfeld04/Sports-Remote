// AuthService: everything about who is using the app, independent of the web framework.
// The Fastify routes in ./fastify.ts are a thin layer over this.
import { randomUUID } from "node:crypto";
import { clientInfo, lanOverlaps, TrustList, type ClientInfo } from "./net";
import {
  DEFAULT_SCRYPT, hashSecret, normalizeUsername, passwordProblem, pinProblem, verifyDummy, verifySecret, type ScryptParams,
} from "./password";
import { can, permissionsFor, type Permission, type Role } from "./permissions";
import { identityHeaders, normalizeProxySettings, proxyIdentity, type ProxyPreset } from "./proxy";
import { FailureBackoff, LoginLimiter } from "./rateLimit";
import { SessionManager, type SessionView } from "./sessions";
import { SetupToken } from "./setupToken";
import { emptyAuthData, type AuthData, type AuthMode, type AuthStore, type StoredSession, type User } from "./store";
import { COOKIE, parseCookies } from "./http";

/** Who is making a request. Attached to each request as `req.auth` (null = nobody). */
export interface AuthContext {
  role: Role;
  userId: string | null; // accounts: user id; proxy: the identity from the header; pin: null
  username: string | null; // accounts: username; proxy: identity; pin: null
  via: "session" | "proxy";
  sessionId: string | null; // hash of the current session, when signed in with one
}

/** Errors with an HTTP status and a message that's safe to show. */
export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSec?: number) {
    super(message);
  }
}

export type SetupInput =
  | { mode: "pin"; pin: string; adminPassword: string }
  | { mode: "accounts"; username: string; password: string }
  | {
      mode: "proxy"; header?: string; preset?: ProxyPreset; admins: string[]; members?: string[];
      allowAnyAuthenticated?: boolean; trustedProxies?: string[];
    };

export type LoginInput = { pin?: unknown; password?: unknown; username?: unknown };

export interface UserView {
  id: string;
  username: string;
  role: Role;
  createdAt: number;
  disabled: boolean;
}

type Headers = Record<string, string | string[] | undefined>;
type Log = (e: Record<string, unknown>) => void;

export interface AuthServiceOptions {
  store: AuthStore;
  /** From the environment (TRUSTED_PROXIES). Setup may add more. */
  trustedProxies?: string[];
  sessionLifetimeMs?: number;
  touchIntervalMs?: number;
  scrypt?: ScryptParams; // lower in tests
  now?: () => number;
  log?: Log;
  /** Turns the setup token into the link printed in the log, e.g. t => `http://host:8787/setup?token=${t}`. */
  setupUrl?: (token: string) => string;
  /** This machine's LAN addresses: a trusted range containing one would trust every device on the Wi-Fi. */
  lanAddresses?: string[];
}

export class AuthService {
  private data: AuthData = emptyAuthData();
  private sessions!: SessionManager;
  private trust!: TrustList;
  private envProxies: string[];
  private setupToken: SetupToken;
  private limiter: LoginLimiter;
  private backoff: FailureBackoff;
  private saving: Promise<void> = Promise.resolve();
  private saveError: Error | null = null;
  private now: () => number;
  private log: Log;
  private params: ScryptParams;

  private constructor(private opts: AuthServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.params = opts.scrypt ?? DEFAULT_SCRYPT;
    this.envProxies = opts.trustedProxies ?? [];
    this.setupToken = new SetupToken(this.now);
    this.limiter = new LoginLimiter(this.now);
    this.backoff = new FailureBackoff(this.now);
  }

  /** Load saved state; on first run, print the setup link. */
  static async open(opts: AuthServiceOptions): Promise<AuthService> {
    const svc = new AuthService(opts);
    svc.data = (await opts.store.load()) ?? emptyAuthData();
    svc.sessions = new SessionManager(svc.data.sessions, {
      lifetimeMs: opts.sessionLifetimeMs, touchIntervalMs: opts.touchIntervalMs, now: svc.now, onChange: () => svc.persist(),
    });
    svc.rebuildTrust();
    const wide = lanOverlaps([...svc.envProxies, ...(svc.data.trustedProxies ?? [])], opts.lanAddresses ?? []);
    if (wide.length) {
      svc.log({ evt: "config_warning", message: `Trusted proxies ${wide.join(", ")} include this machine's own network: any device there can set identity and forwarded headers. List only the proxy's address.` });
    }
    if (!svc.isSetupComplete()) svc.issueSetupToken();
    return svc;
  }

  // ---------- state ----------

  get mode(): AuthMode | null {
    return this.data.mode;
  }

  isSetupComplete(): boolean {
    return this.data.mode !== null;
  }

  get sessionLifetimeMs() {
    return this.sessions.lifetimeMs;
  }

  get trustedProxies(): string[] {
    return this.trust.entries;
  }

  private rebuildTrust() {
    this.trust = new TrustList([...this.envProxies, ...(this.data.trustedProxies ?? [])]);
  }

  /** Save in the background, one write at a time, always the latest state. */
  private persist(): Promise<void> {
    this.saving = this.saving.then(async () => {
      try {
        await this.opts.store.save({ ...this.data, sessions: this.sessions.snapshot() });
        this.saveError = null;
      } catch (e) {
        this.saveError = e as Error;
        this.log({ evt: "auth_save_error", error: (e as Error).message });
      }
    });
    return this.saving;
  }

  /** Save now and wait; throws if it couldn't be written. */
  private async commit(): Promise<void> {
    await this.persist();
    await this.flush();
  }

  /** Wait for pending writes. Throws if the last write failed. */
  async flush(): Promise<void> {
    await this.saving;
    if (this.saveError) throw this.saveError;
  }

  // ---------- setup ----------

  private issueSetupToken() {
    const token = this.setupToken.issue();
    const url = this.opts.setupUrl ? this.opts.setupUrl(token) : `/setup?token=${token}`;
    this.log({ evt: "setup_required", url, message: `Open ${url} to set up Sports Remote. The link works once and expires in 24 hours.` });
  }

  /** Does this setup token work right now? Doesn't use it up. */
  checkSetupToken(token: unknown, ip?: string): boolean {
    if (ip !== undefined) this.takeAttempt(ip);
    if (this.isSetupComplete()) return false;
    // The link expired (24 h) before anyone used it: print a fresh one rather than making people restart the server.
    if (!this.setupToken.active) {
      this.issueSetupToken();
      return false;
    }
    return this.setupToken.check(token);
  }

  /**
   * Finish first-run setup with the token from the log. For pin and accounts modes this also signs
   * the person in as admin (returns a session id for the cookie).
   */
  async completeSetup(token: unknown, input: SetupInput, meta: { ip?: string; userAgent?: string } = {}): Promise<{ sessionId: string | null; auth: AuthContext | null }> {
    if (this.isSetupComplete()) throw new AuthError(409, "setup_done", "Setup is already complete.");
    // Same per-IP limit as logins: the token is long, but there's no reason to allow guessing.
    if (meta.ip !== undefined) this.takeAttempt(meta.ip);
    if (!this.setupToken.check(token)) throw new AuthError(401, "bad_token", "This setup link is invalid or has expired. Restart the server for a new one.");

    // Validate everything before using the token up, so a typo doesn't burn the link.
    const next: AuthData = { ...emptyAuthData(), mode: input.mode };
    let pending: () => Promise<void>;
    let admin: { userId: string | null; username: string | null } | null = null;
    if (input.mode === "pin") {
      const bad = pinProblem(input.pin) ?? passwordProblem(input.adminPassword);
      if (bad) throw new AuthError(400, "invalid", bad);
      pending = async () => {
        next.pin = { pinHash: await hashSecret(input.pin, this.params), adminPasswordHash: await hashSecret(input.adminPassword, this.params) };
      };
      admin = { userId: null, username: null };
    } else if (input.mode === "accounts") {
      const username = normalizeUsername(input.username);
      if (!username) throw new AuthError(400, "invalid", "Usernames are 2-32 letters, digits, dots, dashes or underscores.");
      const bad = passwordProblem(input.password);
      if (bad) throw new AuthError(400, "invalid", bad);
      const user: User = { id: randomUUID(), username, passwordHash: "", role: "admin", createdAt: this.now() };
      pending = async () => {
        user.passwordHash = await hashSecret(input.password, this.params);
        next.users = [user];
      };
      admin = { userId: user.id, username };
    } else if (input.mode === "proxy") {
      let settings;
      try {
        settings = normalizeProxySettings(input);
      } catch (e) {
        throw new AuthError(400, "invalid", (e as Error).message);
      }
      if (settings.admins.length === 0) throw new AuthError(400, "invalid", "List at least one admin identity.");
      const extra = (input.trustedProxies ?? []).map((s) => s.trim()).filter(Boolean);
      try {
        new TrustList(extra);
      } catch (e) {
        throw new AuthError(400, "invalid", (e as Error).message);
      }
      const wide = lanOverlaps(extra, this.opts.lanAddresses ?? []);
      if (wide.length) {
        throw new AuthError(400, "invalid", `${wide.join(", ")} includes the devices on your home network, so any of them could claim to be an admin. List just your proxy's address (or its Docker network).`);
      }
      if (this.envProxies.length + extra.length === 0) {
        throw new AuthError(400, "invalid", "Proxy mode needs the proxy's address in trusted proxies (TRUSTED_PROXIES).");
      }
      next.proxy = settings;
      if (extra.length) next.trustedProxies = extra;
      pending = async () => {};
    } else {
      throw new AuthError(400, "invalid", "Unknown mode.");
    }

    if (!this.setupToken.consume(token)) throw new AuthError(401, "bad_token", "This setup link is invalid or has expired.");
    try {
      await pending();
    } catch (e) {
      this.issueSetupToken(); // don't leave the server unconfigurable
      throw e;
    }
    this.data = next;
    this.rebuildTrust();
    this.sessions.revokeAll();
    let sessionId: string | null = null;
    let auth: AuthContext | null = null;
    if (admin) {
      const { id, session } = this.sessions.create({ userId: admin.userId, role: "admin" }, meta);
      sessionId = id;
      auth = { role: "admin", userId: admin.userId, username: admin.username, via: "session", sessionId: session.idHash };
    }
    await this.commit();
    this.log({ evt: "setup_complete", mode: input.mode, ip: meta.ip });
    return { sessionId, auth };
  }

  // ---------- per request ----------

  /**
   * Work out the client and who they are. Mutates `headers`: identity headers are deleted unless
   * the request came through a trusted proxy, so nothing downstream can be fooled by them.
   * `refreshed` means the session's expiry moved and the cookie should be sent again.
   */
  identify(peer: string | undefined, headers: Headers, encrypted = false): { client: ClientInfo; auth: AuthContext | null; refreshed: boolean; cookie: string | null } {
    const client = clientInfo(peer, headers, this.trust, encrypted);
    if (!client.viaProxy) for (const h of identityHeaders(this.data.proxy)) delete headers[h];
    const none = { client, auth: null, refreshed: false, cookie: null };

    if (this.data.mode === "proxy") {
      if (!client.viaProxy || !this.data.proxy) return none;
      const who = proxyIdentity(this.data.proxy, headers);
      if (!who) return none;
      return { ...none, auth: { role: who.role, userId: who.identity, username: who.identity, via: "proxy", sessionId: null } };
    }
    if (this.data.mode !== "pin" && this.data.mode !== "accounts") return none;

    const cookie = parseCookies(headers.cookie as string | undefined)[COOKIE] ?? null;
    if (!cookie) return none;
    const used = this.sessions.use(cookie, { ip: client.ip });
    if (!used) return none;
    const s = used.session;
    let role = s.role;
    let username: string | null = null;
    if (this.data.mode === "accounts") {
      // Look the user up every time, so disabling or demoting someone takes effect at once.
      const user = this.data.users.find((u) => u.id === s.userId);
      if (!user || user.disabled) {
        this.sessions.revoke(s.idHash);
        return none;
      }
      role = user.role;
      username = user.username;
    }
    return { client, auth: { role, userId: s.userId, username, via: "session", sessionId: s.idHash }, refreshed: used.refreshed, cookie };
  }

  // ---------- login ----------

  /** Count an attempt against this client's per-minute limit; throws 429 when over. */
  private takeAttempt(ip: string) {
    if (!this.limiter.take(ip)) throw new AuthError(429, "rate_limited", "Too many attempts. Wait a minute.", 60);
  }

  /** Check credentials and start a session. Returns the raw session id for the cookie. */
  async login(input: LoginInput, meta: { ip: string; userAgent?: string }): Promise<{ sessionId: string; auth: AuthContext }> {
    const mode = this.data.mode;
    if (mode === null) throw new AuthError(409, "setup_required", "Finish setup first.");
    if (mode === "proxy") throw new AuthError(400, "proxy_mode", "Sign in through your proxy.");
    this.takeAttempt(meta.ip);
    const wait = this.backoff.waitMs();
    if (wait > 0) throw new AuthError(429, "rate_limited", "Too many failed sign-ins. Try again shortly.", Math.ceil(wait / 1000));

    let who: { userId: string | null; role: Role; username: string | null } | null = null;
    let username: string | undefined;
    let as: string | undefined;
    if (mode === "pin") {
      if (typeof input.pin === "string") {
        as = "member";
        if (await verifySecret(input.pin, this.data.pin?.pinHash)) who = { userId: null, role: "member", username: null };
      } else if (typeof input.password === "string") {
        as = "admin";
        if (await verifySecret(input.password, this.data.pin?.adminPasswordHash)) who = { userId: null, role: "admin", username: null };
      } else {
        throw new AuthError(400, "invalid", "Enter the PIN.");
      }
    } else {
      username = normalizeUsername(input.username) ?? (typeof input.username === "string" ? input.username.slice(0, 64) : undefined);
      const user = this.data.users.find((u) => u.username === username);
      if (user && !user.disabled) {
        if (await verifySecret(input.password, user.passwordHash)) who = { userId: user.id, role: user.role, username: user.username };
      } else {
        await verifyDummy(input.password, this.params); // same timing whether or not the user exists
      }
    }

    if (!who) {
      this.backoff.fail();
      this.log({ evt: "login_failed", ip: meta.ip, mode, ...(username !== undefined ? { username } : {}), ...(as ? { as } : {}) });
      throw new AuthError(401, "bad_credentials", mode === "pin" ? (as === "admin" ? "Wrong admin password." : "Wrong PIN.") : "Wrong username or password.");
    }
    const { id, session } = this.sessions.create({ userId: who.userId, role: who.role }, meta);
    await this.flush().catch(() => {}); // logged in persist(); the session still works until restart
    this.log({ evt: "login", ip: meta.ip, mode, role: who.role, ...(who.username ? { username: who.username } : {}) });
    return { sessionId: id, auth: { ...who, via: "session", sessionId: session.idHash } };
  }

  logout(auth: AuthContext | null) {
    if (auth?.sessionId) this.sessions.revoke(auth.sessionId);
  }

  me(auth: AuthContext) {
    return { role: auth.role, userId: auth.userId, username: auth.username, via: auth.via, mode: this.data.mode, permissions: permissionsFor(auth.role) };
  }

  // ---------- sessions ----------

  /** Admins see every session; others see their own (in pin mode, only the current one). */
  listSessions(auth: AuthContext): SessionView[] {
    const own = (s: StoredSession) => s.idHash === auth.sessionId || (auth.userId !== null && auth.via === "session" && s.userId === auth.userId);
    return this.sessions.list(can(auth.role, "manage_users") ? () => true : own, auth.sessionId);
  }

  revokeSession(auth: AuthContext, id: string): boolean {
    const s = this.sessions.getByHash(id);
    if (!s) return false;
    const mine = s.idHash === auth.sessionId || (auth.userId !== null && s.userId === auth.userId);
    if (!mine && !can(auth.role, "manage_users")) return false; // look the same as "not found"
    return this.sessions.revoke(id);
  }

  /** Sign out every session of one user. Admin only, or yourself. Keeps the caller's own session. */
  revokeUserSessions(auth: AuthContext, userId: string): number {
    if (userId !== auth.userId && !can(auth.role, "manage_users")) throw new AuthError(403, "forbidden", "Not allowed.");
    return this.sessions.revokeForUser(userId, auth.sessionId);
  }

  /** "Sign out all devices": admin only. Keeps the caller's session unless includeCurrent. */
  revokeAllSessions(auth: AuthContext, includeCurrent = false): number {
    if (!can(auth.role, "manage_users")) throw new AuthError(403, "forbidden", "Not allowed.");
    return this.sessions.revokeAll(includeCurrent ? null : auth.sessionId);
  }

  // ---------- accounts ----------

  private requireAccounts() {
    if (this.data.mode !== "accounts") throw new AuthError(409, "wrong_mode", "Accounts are only used in accounts mode.");
  }

  private view(u: User): UserView {
    return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, disabled: !!u.disabled };
  }

  private enabledAdmins(except?: string) {
    return this.data.users.filter((u) => u.role === "admin" && !u.disabled && u.id !== except).length;
  }

  listUsers(): UserView[] {
    this.requireAccounts();
    return this.data.users.map((u) => this.view(u));
  }

  async createUser(input: { username: unknown; password: unknown; role?: unknown }): Promise<UserView> {
    this.requireAccounts();
    const username = normalizeUsername(input.username);
    if (!username) throw new AuthError(400, "invalid", "Usernames are 2-32 letters, digits, dots, dashes or underscores.");
    const bad = passwordProblem(input.password);
    if (bad) throw new AuthError(400, "invalid", bad);
    const role: Role = input.role === "admin" ? "admin" : "member";
    if (input.role !== undefined && input.role !== "admin" && input.role !== "member") throw new AuthError(400, "invalid", "Role must be admin or member.");
    if (this.data.users.some((u) => u.username === username)) throw new AuthError(409, "exists", "That username is taken.");
    const user: User = { id: randomUUID(), username, passwordHash: await hashSecret(input.password as string, this.params), role, createdAt: this.now() };
    // Re-check after the await: two requests could race for the same name.
    if (this.data.users.some((u) => u.username === username)) throw new AuthError(409, "exists", "That username is taken.");
    this.data.users.push(user);
    await this.commit();
    this.log({ evt: "user_created", username, role });
    return this.view(user);
  }

  /** Change role, disabled flag or (admin reset) password. Guards the last admin. */
  async updateUser(id: string, patch: { role?: unknown; disabled?: unknown; password?: unknown }): Promise<UserView> {
    this.requireAccounts();
    const user = this.data.users.find((u) => u.id === id);
    if (!user) throw new AuthError(404, "not_found", "No such user.");
    if (patch.role !== undefined && patch.role !== "admin" && patch.role !== "member") throw new AuthError(400, "invalid", "Role must be admin or member.");
    if (patch.disabled !== undefined && typeof patch.disabled !== "boolean") throw new AuthError(400, "invalid", "disabled must be true or false.");
    const losesAdmin = user.role === "admin" && !user.disabled && (patch.role === "member" || patch.disabled === true);
    if (losesAdmin && this.enabledAdmins(user.id) === 0) throw new AuthError(409, "last_admin", "There must be at least one admin.");
    let newHash: string | null = null;
    if (patch.password !== undefined) {
      const bad = passwordProblem(patch.password);
      if (bad) throw new AuthError(400, "invalid", bad);
      newHash = await hashSecret(patch.password as string, this.params);
    }
    if (patch.role !== undefined) user.role = patch.role as Role;
    if (patch.disabled !== undefined) user.disabled = patch.disabled as boolean || undefined;
    if (newHash) user.passwordHash = newHash;
    // A reset password or a disabled account signs that person out everywhere.
    if (newHash || user.disabled) this.sessions.revokeForUser(user.id);
    await this.commit();
    this.log({ evt: "user_updated", username: user.username, role: user.role, disabled: !!user.disabled, passwordReset: !!newHash });
    return this.view(user);
  }

  async deleteUser(id: string): Promise<void> {
    this.requireAccounts();
    const user = this.data.users.find((u) => u.id === id);
    if (!user) throw new AuthError(404, "not_found", "No such user.");
    if (user.role === "admin" && !user.disabled && this.enabledAdmins(user.id) === 0) {
      throw new AuthError(409, "last_admin", "There must be at least one admin.");
    }
    this.data.users = this.data.users.filter((u) => u.id !== id);
    this.sessions.revokeForUser(id);
    await this.commit();
    this.log({ evt: "user_deleted", username: user.username });
  }

  // ---------- passwords ----------

  /**
   * Change your own password (accounts mode, or the admin password in pin mode). Needs the current
   * one. Your other sessions are signed out; this one stays.
   */
  async changePassword(auth: AuthContext, current: unknown, next: unknown): Promise<void> {
    if (auth.via !== "session") throw new AuthError(400, "proxy_mode", "Your proxy manages your password.");
    const bad = passwordProblem(next);
    if (bad) throw new AuthError(400, "invalid", bad);
    if (this.data.mode === "accounts") {
      const user = this.data.users.find((u) => u.id === auth.userId);
      if (!user) throw new AuthError(401, "unauthorized", "Sign in again.");
      if (!(await verifySecret(current, user.passwordHash))) throw new AuthError(403, "bad_credentials", "Current password is wrong.");
      user.passwordHash = await hashSecret(next as string, this.params);
      this.sessions.revokeForUser(user.id, auth.sessionId);
    } else if (this.data.mode === "pin" && auth.role === "admin" && this.data.pin) {
      if (!(await verifySecret(current, this.data.pin.adminPasswordHash))) throw new AuthError(403, "bad_credentials", "Current password is wrong.");
      this.data.pin.adminPasswordHash = await hashSecret(next as string, this.params);
      this.sessions.revokeWhere((s) => s.role === "admin", auth.sessionId);
    } else {
      throw new AuthError(403, "forbidden", "Only the admin can change the password.");
    }
    await this.commit();
    this.log({ evt: "password_changed", mode: this.data.mode, ...(auth.username ? { username: auth.username } : {}) });
  }

  /** Pin mode: an admin sets a new household PIN. Every member session is signed out. */
  async changePin(auth: AuthContext, pin: unknown): Promise<void> {
    if (this.data.mode !== "pin" || !this.data.pin) throw new AuthError(409, "wrong_mode", "There's no PIN in this mode.");
    if (!can(auth.role, "manage_users")) throw new AuthError(403, "forbidden", "Not allowed.");
    const bad = pinProblem(pin);
    if (bad) throw new AuthError(400, "invalid", bad);
    this.data.pin.pinHash = await hashSecret(pin as string, this.params);
    this.sessions.revokeWhere((s) => s.role === "member");
    await this.commit();
    this.log({ evt: "pin_changed" });
  }
}

export type { Permission, Role };
