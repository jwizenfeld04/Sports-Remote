import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { build } from "vite";

describe("UI bundle", () => {
  it("loads the game list in under 110 KB of gzipped JS, and contains no server code", { timeout: 60_000 }, async () => {
    const outDir = mkdtempSync(join(tmpdir(), "sr-build-"));
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production"; // vitest sets "test", which would bundle React's dev build
    await build({ configFile: join(import.meta.dirname, "../vite.config.ts"), logLevel: "silent", mode: "production", build: { outDir, emptyOutDir: true } }).finally(() => {
      process.env.NODE_ENV = prev;
    });
    const assets = join(outDir, "assets");
    const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
    const js = files.map((f) => readFileSync(join(assets, f)));
    const gz = (b: Buffer) => gzipSync(b).length;
    // The first load is the entry script; setup and coverage are separate chunks loaded when opened.
    const entry = readFileSync(join(outDir, "index.html"), "utf8").match(/src="\/assets\/([^"]+\.js)"/)![1];
    // ~60 KB of it is React DOM; the rest is the app plus the service and team catalogs it resolves games with.
    expect(gz(js[files.indexOf(entry)])).toBeLessThan(110 * 1024);
    expect(js.reduce((n, b) => n + gz(b), 0)).toBeLessThan(140 * 1024);
    const all = js.map((b) => b.toString()).join("\n");
    for (const marker of ["child_process", "execFile", "X-Plex-Token", "keyevent", "SESSION_SECRET"]) expect(all).not.toContain(marker);
  });
});
