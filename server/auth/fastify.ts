// Wires AuthService into a Fastify app: request checks, `req.auth`, permission guards, and the
// /api/auth/* and /api/setup/auth routes.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { allowedHost, clearSessionCookie, csrfOk, securityHeaders, sessionCookie } from "./http";
import type { ClientInfo } from "./net";
import { can, type Permission, type Role } from "./permissions";
import { PROXY_PRESETS } from "./proxy";
import { AuthError, type AuthContext, type AuthService, type SetupInput } from "./service";

declare module "fastify" {
  interface FastifyRequest {
    /** Who is asking; null when not signed in. */
    auth: AuthContext | null;
    /** The real client address and protocol (trusted-proxy aware). */
    client: ClientInfo;
  }
}

export interface InstallAuthOptions {
  allowedHosts: string[];
  /** Extra /api/ paths that don't need a signed-in user (exact match, without query string). */
  publicPaths?: string[];
  /** Paths that skip every check, even Host (e.g. a loopback-only health check). */
  skipChecks?: string[];
  /** Override the Content-Security-Policy header value. */
  csp?: string;
}

const ALWAYS_PUBLIC = ["/api/auth/login", "/api/auth/logout", "/api/setup/auth", "/api/setup/auth/check"];

const path = (url: string) => url.split("?")[0];

/** preHandler: only signed-in users with this permission may continue. */
export function requirePermission(perm: Permission): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: "unauthorized" });
    if (!can(req.auth.role, perm)) return reply.code(403).send({ error: "forbidden" });
  };
}

/** preHandler: only signed-in users with this role (admin also passes a member check). */
export function requireRole(role: Role): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: "unauthorized" });
    if (role === "admin" && req.auth.role !== "admin") return reply.code(403).send({ error: "forbidden" });
  };
}

const sendError = (reply: FastifyReply, e: unknown) => {
  if (e instanceof AuthError) {
    if (e.retryAfterSec) reply.header("Retry-After", String(e.retryAfterSec));
    return reply.code(e.status).send({ error: e.message, code: e.code });
  }
  throw e;
};

const LoginBody = z.object({
  pin: z.string().max(64).optional(),
  password: z.string().max(1024).optional(),
  username: z.string().max(64).optional(),
}).strict();

const SetupBody = z.discriminatedUnion("mode", [
  z.object({ token: z.string().max(200), mode: z.literal("pin"), pin: z.string().max(64), adminPassword: z.string().max(1024) }).strict(),
  z.object({ token: z.string().max(200), mode: z.literal("accounts"), username: z.string().max(64), password: z.string().max(1024) }).strict(),
  z.object({
    token: z.string().max(200),
    mode: z.literal("proxy"),
    header: z.string().max(64).optional(),
    preset: z.enum(Object.keys(PROXY_PRESETS) as [keyof typeof PROXY_PRESETS, ...(keyof typeof PROXY_PRESETS)[]]).optional(),
    admins: z.array(z.string().max(256)).max(100),
    members: z.array(z.string().max(256)).max(500).optional(),
    allowAnyAuthenticated: z.boolean().optional(),
    trustedProxies: z.array(z.string().max(64)).max(50).optional(),
  }).strict(),
]);

const UserCreate = z.object({ username: z.string().max(64), password: z.string().max(1024), role: z.enum(["admin", "member"]).optional() }).strict();
const UserPatch = z.object({ role: z.enum(["admin", "member"]).optional(), disabled: z.boolean().optional(), password: z.string().max(1024).optional() }).strict();
const PasswordBody = z.object({ currentPassword: z.string().max(1024), newPassword: z.string().max(1024) }).strict();
const PinBody = z.object({ pin: z.string().max(64) }).strict();
const RevokeAllBody = z.object({ userId: z.string().max(100).optional(), includeCurrent: z.boolean().optional() }).strict();

/**
 * Add auth to an app. Call before registering the app's own routes. Adds:
 * - an onRequest hook: Host check, same-origin JSON check, client address, `req.auth`, and a
 *   401 for /api/ routes unless the path is public;
 * - security headers on every response (CSP; HSTS over HTTPS);
 * - the auth and setup routes.
 * It's a plain function (not app.register) so the hooks apply to the whole app.
 */
export function installAuth(app: FastifyInstance, auth: AuthService, opts: InstallAuthOptions) {
  const publicPaths = new Set([...ALWAYS_PUBLIC, ...(opts.publicPaths ?? [])]);
  const skip = new Set(opts.skipChecks ?? []);
  const maxAge = () => auth.sessionLifetimeMs / 1000;

  app.decorateRequest("auth", null);
  app.decorateRequest("client", null as unknown as ClientInfo);

  app.addHook("onRequest", async (req, reply) => {
    const encrypted = !!(req.raw.socket as { encrypted?: boolean }).encrypted;
    const who = auth.identify(req.socket.remoteAddress, req.headers, encrypted);
    req.client = who.client;
    req.auth = who.auth;
    if (skip.has(path(req.url))) return;
    if (!allowedHost(opts.allowedHosts, req.headers.host)) return reply.code(421).send({ error: "host not allowed" });
    if (!csrfOk(req.method, req.headers)) return reply.code(403).send({ error: "bad origin or content type" });
    // Sliding sessions: re-send the cookie when its expiry moved, so the browser's copy slides too.
    if (who.refreshed && who.cookie) reply.header("Set-Cookie", sessionCookie(who.cookie, maxAge(), who.client.proto === "https"));
    if (req.url.startsWith("/api/") && !publicPaths.has(path(req.url)) && !req.auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.addHook("onSend", async (req, reply, payload) => {
    for (const [k, v] of Object.entries(securityHeaders(req.client?.proto === "https", opts.csp))) reply.header(k, v);
    return payload;
  });

  const secure = (req: FastifyRequest) => req.client.proto === "https";
  const meta = (req: FastifyRequest) => ({ ip: req.client.ip, userAgent: String(req.headers["user-agent"] ?? "") });

  // ---- login / logout / me ----

  app.post("/api/auth/login", async (req, reply) => {
    const body = LoginBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      const r = await auth.login(body.data, meta(req));
      return reply.header("Set-Cookie", sessionCookie(r.sessionId, maxAge(), secure(req))).send(auth.me(r.auth));
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    auth.logout(req.auth);
    await auth.flush().catch(() => {});
    return reply.header("Set-Cookie", clearSessionCookie(secure(req))).code(204).send();
  });

  app.get("/api/auth/me", async (req) => auth.me(req.auth!));

  // ---- sessions ----

  app.get("/api/auth/sessions", async (req) => ({ sessions: auth.listSessions(req.auth!) }));

  app.delete<{ Params: { id: string } }>("/api/auth/sessions/:id", async (req, reply) => {
    const current = req.params.id === req.auth!.sessionId;
    if (!auth.revokeSession(req.auth!, req.params.id)) return reply.code(404).send({ error: "no such session" });
    await auth.flush();
    if (current) reply.header("Set-Cookie", clearSessionCookie(secure(req)));
    return reply.code(204).send();
  });

  app.post("/api/auth/sessions/revoke-all", async (req, reply) => {
    const body = RevokeAllBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      const n = body.data.userId
        ? auth.revokeUserSessions(req.auth!, body.data.userId)
        : auth.revokeAllSessions(req.auth!, body.data.includeCurrent);
      await auth.flush();
      if (body.data.includeCurrent && !body.data.userId) reply.header("Set-Cookie", clearSessionCookie(secure(req)));
      return { revoked: n };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // ---- own password, household PIN ----

  app.post("/api/auth/password", async (req, reply) => {
    const body = PasswordBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      await auth.changePassword(req.auth!, body.data.currentPassword, body.data.newPassword);
      return reply.code(204).send();
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post("/api/auth/pin", { preHandler: requirePermission("manage_users") }, async (req, reply) => {
    const body = PinBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      await auth.changePin(req.auth!, body.data.pin);
      return reply.code(204).send();
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // ---- accounts (admin only) ----

  const admin = { preHandler: requirePermission("manage_users") };
  app.get("/api/auth/users", admin, async (_req, reply) => {
    try {
      return { users: auth.listUsers() };
    } catch (e) {
      return sendError(reply, e);
    }
  });
  app.post("/api/auth/users", admin, async (req, reply) => {
    const body = UserCreate.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      return reply.code(201).send(await auth.createUser(body.data));
    } catch (e) {
      return sendError(reply, e);
    }
  });
  app.patch<{ Params: { id: string } }>("/api/auth/users/:id", admin, async (req, reply) => {
    const body = UserPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      return await auth.updateUser(req.params.id, body.data);
    } catch (e) {
      return sendError(reply, e);
    }
  });
  app.delete<{ Params: { id: string } }>("/api/auth/users/:id", admin, async (req, reply) => {
    try {
      await auth.deleteUser(req.params.id);
      return reply.code(204).send();
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // ---- first-run setup ----

  // What a setup page needs to know. Says nothing secret.
  app.get("/api/setup/auth", async () => ({
    setupRequired: !auth.isSetupComplete(),
    modes: ["pin", "accounts", "proxy"],
    proxyPresets: PROXY_PRESETS,
    trustedProxies: auth.trustedProxies.length > 0,
  }));

  // Lets a setup page check the link before showing the form. Doesn't use the token up.
  app.post("/api/setup/auth/check", async (req, reply) => {
    const token = (req.body as { token?: unknown } | null)?.token;
    try {
      return { valid: auth.checkSetupToken(token, req.client.ip) };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post("/api/setup/auth", async (req, reply) => {
    const body = SetupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    try {
      const { token, ...input } = body.data;
      const r = await auth.completeSetup(token, input as SetupInput, meta(req));
      if (r.sessionId) reply.header("Set-Cookie", sessionCookie(r.sessionId, maxAge(), secure(req)));
      return reply.send(r.auth ? auth.me(r.auth) : { mode: auth.mode });
    } catch (e) {
      return sendError(reply, e);
    }
  });
}
