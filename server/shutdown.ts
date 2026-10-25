// Graceful shutdown on SIGTERM/SIGINT (systemd stop, `docker stop`, Ctrl-C).
//
// Order: stop timers -> stop accepting connections and let in-flight requests finish (up to
// `graceMs`) -> drop whatever is still open (SSE streams never end on their own) -> run cleanup
// callbacks -> exit. A hard deadline (`timeoutMs`) exits with status 1 if anything hangs, so a
// stuck ADB call can never stall a container stop past Docker's 10 s SIGKILL.

/** The parts of a Fastify instance this needs (kept structural so tests can pass fakes). */
export interface Closable {
  close(): PromiseLike<unknown>;
  server?: { closeAllConnections?: () => void };
}

export interface ShutdownOptions {
  servers: Closable[];
  timers?: Array<Parameters<typeof clearInterval>[0]>;
  /** Run after the servers close, in order. Errors are logged and don't stop the rest. */
  cleanup?: Array<() => unknown>;
  /** How long in-flight requests get before open connections are dropped. Default 5000. */
  graceMs?: number;
  /** Hard deadline for the whole shutdown. Default 8000 (under Docker's default 10 s stop timeout). */
  timeoutMs?: number;
  log?: (e: Record<string, unknown>) => void;
  signals?: NodeJS.Signals[];
  /** Injected for tests. */
  exit?: (code: number) => void;
}

export interface ShutdownHandle {
  /** Run the shutdown sequence now (also what the signal handlers call). Resolves with the exit code. */
  shutdown(signal?: string): Promise<number>;
  /** Remove the signal handlers. */
  dispose(): void;
}

export function installShutdown(opts: ShutdownOptions): ShutdownHandle {
  const { servers, timers = [], cleanup = [], graceMs = 5000, timeoutMs = 8000, log = () => {}, exit = (c) => process.exit(c) } = opts;
  const signals = opts.signals ?? ["SIGTERM", "SIGINT"];
  let running: Promise<number> | null = null;

  const shutdown = (signal = "manual"): Promise<number> => {
    if (running) return running;
    running = (async () => {
      const started = Date.now();
      log({ evt: "shutdown", signal });
      const deadline = setTimeout(() => {
        log({ evt: "shutdown_timeout", afterMs: timeoutMs });
        exit(1);
      }, timeoutMs);
      deadline.unref();

      for (const t of timers) clearInterval(t); // clearInterval also clears timeouts

      const closing = servers.map((s) => Promise.resolve(s.close()).catch((e) => log({ evt: "shutdown_error", step: "close", error: (e as Error).message })));
      const grace = setTimeout(() => {
        for (const s of servers) s.server?.closeAllConnections?.();
      }, graceMs);
      grace.unref();
      await Promise.all(closing);
      clearTimeout(grace);

      for (const fn of cleanup) {
        try {
          await fn();
        } catch (e) {
          log({ evt: "shutdown_error", step: "cleanup", error: (e as Error).message });
        }
      }
      clearTimeout(deadline);
      log({ evt: "stopped", ms: Date.now() - started });
      exit(0);
      return 0;
    })();
    return running;
  };

  const handler = (sig: NodeJS.Signals) => void shutdown(sig);
  for (const s of signals) process.on(s, handler);
  return {
    shutdown,
    dispose: () => {
      for (const s of signals) process.off(s, handler);
    },
  };
}
