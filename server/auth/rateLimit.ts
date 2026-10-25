// Brute-force protection for logins.

/** Sliding-window counter: at most `max` hits per `windowMs`. */
export class WindowLimiter {
  private hits: number[] = [];
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  take(): boolean {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
  idle(): boolean {
    const t = this.now();
    return this.hits.every((h) => t - h >= this.windowMs);
  }
}

/** Per-client-IP limiter for login attempts: 5 a minute by default. */
export class LoginLimiter {
  private byIp = new Map<string, WindowLimiter>();
  constructor(private now: () => number = Date.now, private max = 5, private windowMs = 60_000) {}
  take(ip: string): boolean {
    // Forget idle addresses now and then so the map can't grow without bound.
    if (this.byIp.size > 1000) for (const [k, l] of this.byIp) if (l.idle()) this.byIp.delete(k);
    let l = this.byIp.get(ip);
    if (!l) this.byIp.set(ip, (l = new WindowLimiter(this.max, this.windowMs, this.now)));
    return l.take();
  }
}

/**
 * Global backoff across all clients, against guessing from many addresses at once. After
 * `freeFailures` failures within `windowMs`, each further attempt must wait an exponentially
 * growing delay after the last failure (1 s, 2 s, 4 s ... capped at `maxDelayMs`). The cap is short
 * on purpose: an attacker can slow the household's logins down but not lock them out.
 */
export class FailureBackoff {
  private failures: number[] = [];
  constructor(
    private now: () => number = Date.now,
    private freeFailures = 10,
    private windowMs = 15 * 60_000,
    private maxDelayMs = 30_000,
  ) {}

  private recent(): number[] {
    const t = this.now();
    this.failures = this.failures.filter((f) => t - f < this.windowMs);
    return this.failures;
  }

  /** Milliseconds until the next attempt is allowed (0 = go ahead). */
  waitMs(): number {
    const f = this.recent();
    const over = f.length - this.freeFailures;
    if (over < 0) return 0;
    const delay = Math.min(1000 * 2 ** over, this.maxDelayMs);
    return Math.max(0, f[f.length - 1] + delay - this.now());
  }

  // A success doesn't clear the count: otherwise an attacker could reset it by logging in
  // with their own account between guesses.
  fail() {
    this.recent();
    this.failures.push(this.now());
  }
}
