// Server-side sessions. The browser holds a random 32-byte id in a cookie; we keep only its
// SHA-256, so a leaked auth file can't be replayed as cookies. Sessions slide: each use pushes the
// expiry out by the full lifetime.
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "./permissions";
import type { StoredSession } from "./store";

export const DEFAULT_SESSION_LIFETIME_MS = 30 * 86400_000; // 30 days
/**
 * A session's lastSeen (and sliding expiry) moves at most this often, so busy clients don't cause a
 * disk write per request. Requests in between change nothing.
 */
export const DEFAULT_TOUCH_INTERVAL_MS = 10 * 60_000;
const MAX_SESSIONS = 500; // across everyone; oldest-idle are dropped beyond this
const UA_MAX = 160;

export function hashSessionId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

/** What clients see about a session. `id` is the hash, which is useless as a cookie. */
export interface SessionView {
  id: string;
  userId: string | null;
  role: Role;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  ip: string;
  current: boolean;
}

export interface SessionOptions {
  lifetimeMs?: number;
  touchIntervalMs?: number;
  now?: () => number;
  /** Called whenever sessions changed and should be saved. */
  onChange?: () => void;
}

export class SessionManager {
  private byHash = new Map<string, StoredSession>();
  readonly lifetimeMs: number;
  private touchIntervalMs: number;
  private now: () => number;
  private onChange: () => void;

  constructor(initial: StoredSession[], opts: SessionOptions = {}) {
    this.lifetimeMs = opts.lifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS;
    this.touchIntervalMs = opts.touchIntervalMs ?? DEFAULT_TOUCH_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange ?? (() => {});
    for (const s of initial) this.byHash.set(s.idHash, { ...s });
    this.prune();
  }

  /** Start a session. Returns the raw id for the cookie; only its hash is kept. */
  create(who: { userId: string | null; role: Role }, meta: { userAgent?: string; ip?: string } = {}): { id: string; session: StoredSession } {
    const id = randomBytes(32).toString("base64url");
    const t = this.now();
    const session: StoredSession = {
      idHash: hashSessionId(id),
      userId: who.userId,
      role: who.role,
      createdAt: t,
      lastSeenAt: t,
      expiresAt: t + this.lifetimeMs,
      userAgent: (meta.userAgent ?? "").slice(0, UA_MAX),
      ip: (meta.ip ?? "").slice(0, 64),
    };
    this.byHash.set(session.idHash, session);
    this.prune();
    this.onChange();
    return { id, session };
  }

  /**
   * Look up a cookie value. Returns the session if it's valid. `refreshed` is true when the expiry
   * was pushed out on this call (then the caller should re-send the cookie). Writes are throttled:
   * a session is touched at most once per touch interval.
   */
  use(id: string | undefined, meta: { ip?: string } = {}): { session: StoredSession; refreshed: boolean } | null {
    if (!id || id.length > 100) return null;
    const s = this.byHash.get(hashSessionId(id));
    if (!s) return null;
    const t = this.now();
    if (s.expiresAt <= t) {
      this.byHash.delete(s.idHash);
      this.onChange();
      return null;
    }
    if (t - s.lastSeenAt < this.touchIntervalMs) return { session: s, refreshed: false };
    s.lastSeenAt = t;
    s.expiresAt = t + this.lifetimeMs;
    if (meta.ip) s.ip = meta.ip.slice(0, 64);
    this.onChange();
    return { session: s, refreshed: true };
  }

  getByHash(idHash: string): StoredSession | undefined {
    return this.byHash.get(idHash);
  }

  list(filter: (s: StoredSession) => boolean = () => true, currentHash?: string | null): SessionView[] {
    this.prune();
    return [...this.byHash.values()]
      .filter(filter)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((s) => ({
        id: s.idHash, userId: s.userId, role: s.role, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt, userAgent: s.userAgent, ip: s.ip, current: s.idHash === currentHash,
      }));
  }

  /** Remove sessions matching a predicate (never the one whose hash is `keep`). Returns how many. */
  revokeWhere(pred: (s: StoredSession) => boolean, keep?: string | null): number {
    let n = 0;
    for (const [h, s] of this.byHash) {
      if (h !== keep && pred(s)) {
        this.byHash.delete(h);
        n++;
      }
    }
    if (n) this.onChange();
    return n;
  }

  revoke(idHash: string): boolean {
    return this.revokeWhere((s) => s.idHash === idHash) > 0;
  }

  revokeForUser(userId: string, keep?: string | null): number {
    return this.revokeWhere((s) => s.userId === userId, keep);
  }

  revokeAll(keep?: string | null): number {
    return this.revokeWhere(() => true, keep);
  }

  /** For saving. */
  snapshot(): StoredSession[] {
    return [...this.byHash.values()].map((s) => ({ ...s }));
  }

  /** Drop expired sessions, and the least recently used ones beyond the cap. */
  private prune() {
    const t = this.now();
    let changed = false;
    for (const [h, s] of this.byHash) {
      if (s.expiresAt <= t) {
        this.byHash.delete(h);
        changed = true;
      }
    }
    if (this.byHash.size > MAX_SESSIONS) {
      const oldest = [...this.byHash.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      for (const s of oldest.slice(0, this.byHash.size - MAX_SESSIONS)) this.byHash.delete(s.idHash);
      changed = true;
    }
    if (changed) this.onChange();
  }
}
