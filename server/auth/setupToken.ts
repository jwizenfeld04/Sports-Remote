// The first-run setup token. Until setup is complete, the only way to create the first admin is a
// link printed to the server log, so someone who merely reaches the page on the network can't
// claim the server. The token lives only in memory: a restart prints a fresh one.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SETUP_TOKEN_TTL_MS = 24 * 3600_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

export class SetupToken {
  private hash: Buffer | null = null; // only the hash is kept, even in memory, once issued
  private expiresAt = 0;

  constructor(private now: () => number = Date.now, private ttlMs = SETUP_TOKEN_TTL_MS) {}

  /** Make a new token (replacing any old one) and return it once, for the log. */
  issue(): string {
    const token = randomBytes(24).toString("base64url");
    this.hash = digest(token);
    this.expiresAt = this.now() + this.ttlMs;
    return token;
  }

  get active(): boolean {
    return !!this.hash && this.now() < this.expiresAt;
  }

  /** Constant-time check that doesn't use the token up. */
  check(token: unknown): boolean {
    if (typeof token !== "string" || !this.active) return false;
    return timingSafeEqual(digest(token), this.hash!); // equal-length digests, so no length leak
  }

  /** Check and, if it matches, use it up. */
  consume(token: unknown): boolean {
    if (!this.check(token)) return false;
    this.revoke();
    return true;
  }

  revoke() {
    this.hash = null;
    this.expiresAt = 0;
  }
}
