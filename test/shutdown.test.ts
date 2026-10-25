import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { installShutdown } from "../server/shutdown";

describe("installShutdown", () => {
  it("clears timers, closes servers, runs cleanup, exits 0", async () => {
    const app = Fastify();
    app.get("/", async () => "ok");
    await app.listen({ host: "127.0.0.1", port: 0 });
    const tick = vi.fn();
    const timer = setInterval(tick, 5);
    const cleanup = vi.fn();
    const exit = vi.fn();
    const events: string[] = [];
    const h = installShutdown({ servers: [app], timers: [timer], cleanup: [cleanup], exit, signals: [], log: (e) => events.push(String(e.evt)) });
    expect(await h.shutdown("SIGTERM")).toBe(0);
    expect(exit).toHaveBeenCalledWith(0);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(app.server.listening).toBe(false);
    const calls = tick.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(tick.mock.calls.length).toBe(calls);
    expect(events).toEqual(["shutdown", "stopped"]);
  });

  it("drops long-lived connections (SSE) after the grace period", async () => {
    const app = Fastify();
    app.get("/sse", (_req, reply) => {
      reply.raw.writeHead(200, { "content-type": "text/event-stream" });
      reply.raw.write(": hi\n\n");
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/sse`);
    const reader = res.body!.getReader();
    await reader.read();
    const exit = vi.fn();
    const h = installShutdown({ servers: [app], exit, signals: [], graceMs: 50, timeoutMs: 2000 });
    const t0 = Date.now();
    expect(await h.shutdown()).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1500);
    await reader.read().catch(() => null);
  });

  it("is idempotent and a failing cleanup doesn't block exit", async () => {
    const exit = vi.fn();
    const h = installShutdown({ servers: [{ close: async () => {} }], cleanup: [() => { throw new Error("boom"); }], exit, signals: [] });
    const [a, b] = await Promise.all([h.shutdown(), h.shutdown()]);
    expect(a).toBe(0);
    expect(b).toBe(0);
    expect(exit).toHaveBeenCalledOnce();
  });
});
