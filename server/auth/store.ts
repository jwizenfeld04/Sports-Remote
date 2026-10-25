// What the auth module persists, and where. The app's main config store is separate; auth talks
// only to the small AuthStore interface so it can be backed by a file, the main store, or memory.
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Role } from "./permissions";
import type { ProxySettings } from "./proxy";

export type AuthMode = "pin" | "accounts" | "proxy";

export interface User {
  id: string;
  username: string; // lowercase, see normalizeUsername
  passwordHash: string;
  role: Role;
  createdAt: number; // ms since epoch
  disabled?: boolean;
}

export interface StoredSession {
  idHash: string; // SHA-256 (hex) of the cookie value; the raw id is never stored
  userId: string | null; // accounts mode: the user; pin mode: null
  role: Role;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  ip: string;
}

export interface AuthData {
  version: 1;
  mode: AuthMode | null; // null until first-run setup is complete
  pin?: { pinHash: string; adminPasswordHash: string };
  users: User[];
  proxy?: ProxySettings;
  /** Extra trusted proxies chosen during setup, added to the ones from the environment. */
  trustedProxies?: string[];
  sessions: StoredSession[];
}

export const AUTH_DATA_VERSION = 1;

export function emptyAuthData(): AuthData {
  return { version: AUTH_DATA_VERSION, mode: null, users: [], sessions: [] };
}

export interface AuthStore {
  load(): Promise<AuthData | null>; // null: nothing saved yet
  save(d: AuthData): Promise<void>;
}

const RoleZ = z.enum(["admin", "member"]);
const AuthDataZ = z.object({
  version: z.literal(1),
  mode: z.enum(["pin", "accounts", "proxy"]).nullable(),
  pin: z.object({ pinHash: z.string(), adminPasswordHash: z.string() }).optional(),
  users: z.array(z.object({
    id: z.string(), username: z.string(), passwordHash: z.string(), role: RoleZ, createdAt: z.number(), disabled: z.boolean().optional(),
  })),
  proxy: z.object({
    header: z.string(), admins: z.array(z.string()), members: z.array(z.string()), allowAnyAuthenticated: z.boolean(),
  }).optional(),
  trustedProxies: z.array(z.string()).optional(),
  sessions: z.array(z.object({
    idHash: z.string(), userId: z.string().nullable(), role: RoleZ, createdAt: z.number(), lastSeenAt: z.number(),
    expiresAt: z.number(), userAgent: z.string(), ip: z.string(),
  })),
});

/**
 * Check data read from disk. A newer version or a damaged file stops the server with a clear
 * message rather than silently starting over (which would wipe everyone's access).
 */
export function parseAuthData(raw: unknown, source = "auth data"): AuthData {
  const v = (raw as { version?: unknown } | null)?.version;
  if (typeof v === "number" && v > AUTH_DATA_VERSION) {
    throw new Error(`${source} was written by a newer version of Sports Remote (version ${v}). Upgrade, or restore a backup.`);
  }
  const parsed = AuthDataZ.safeParse(raw);
  if (!parsed.success) throw new Error(`${source} is damaged: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data as AuthData;
}

/** Keeps everything in memory. For tests, and for running without a data directory. */
export class MemoryAuthStore implements AuthStore {
  saves = 0;
  constructor(private data: AuthData | null = null) {}
  async load() {
    return this.data ? structuredClone(this.data) : null;
  }
  async save(d: AuthData) {
    this.saves++;
    this.data = structuredClone(d);
  }
  get current() {
    return this.data;
  }
}

/**
 * A JSON file, written atomically: the new content goes to a temp file (mode 0600, fsynced), which
 * is then renamed over the old one, so a crash leaves either the old file or the new one.
 */
export class JsonFileAuthStore implements AuthStore {
  constructor(readonly file: string) {}

  async load(): Promise<AuthData | null> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`${this.file} is not valid JSON. Fix or remove it (it holds logins and sessions).`);
    }
    return parseAuthData(raw, this.file);
  }

  async save(d: AuthData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const fh = await open(tmp, "wx", 0o600);
    try {
      await fh.writeFile(JSON.stringify(d, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, this.file);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
}
