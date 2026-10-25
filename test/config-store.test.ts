import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, ConfigStore } from "../server/store/config";
import { CONFIG_VERSION } from "../lib/profile";

const dir = () => mkdtemp(join(tmpdir(), "sr-store-"));

describe("ConfigStore", () => {
  it("starts a fresh install with defaults, not set up, and a generated session key", async () => {
    const d = await dir();
    const s = new ConfigStore(d);
    const c = await s.load();
    expect(c.version).toBe(CONFIG_VERSION);
    expect(c.setupComplete).toBe(false);
    expect(c.subscriptions).toEqual([]);
    expect(s.getSecrets()).toEqual({});
    expect((await stat(join(d, "secrets.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(d, "config.json"))).mode & 0o777).toBe(0o600);
    expect(s.migratedFrom).toBeNull();
  });

  it("keeps secrets across restarts, and still reads a file with the old unused sessionKey", async () => {
    const d = await dir();
    const a = new ConfigStore(d);
    await a.load();
    await a.updateSecrets({ plexToken: "tok-123" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "secrets.json"), JSON.stringify({ sessionKey: "x".repeat(64), plexToken: "tok-123" }));
    const b = new ConfigStore(d);
    await b.load();
    expect(b.getSecrets()).toEqual({ plexToken: "tok-123" });
  });

  it("migrates a v1 install (settings.json + env) without losing favorites, order or presets", async () => {
    const d = await dir();
    await writeFile(join(d, "settings.json"), JSON.stringify({
      favorites: ["nfl:LAC", "mlb:LAD", "bogus"],
      homeMarket: "nyc",
      servicePriority: { cbs: ["paramount", "plex"], fox: ["fox_one"] },
      oneTapSend: true,
      presets: [{ name: "Sunday NFL", query: "league=nfl&time=today" }],
    }));
    const s = new ConfigStore(d);
    const c = await s.load({ FIRETV_HOST: "192.168.1.50", PLEX_TOKEN: "tok", PLEX_URL: "http://127.0.0.1:32400", ESPN_WATCH_API_KEY: "k" });
    expect(s.migratedFrom).toMatch(/v1/);
    expect(c.preferences.favorites).toEqual(["nfl:LAC", "mlb:LAD"]);
    expect(c.preferences.servicePriority).toEqual({ cbs: ["paramount_plus", "plex"], fox: ["fox_one"] });
    expect(c.preferences.oneTapSend).toBe(true);
    expect(c.preferences.presets).toEqual([{ name: "Sunday NFL", query: "league=nfl&time=today" }]);
    expect(c.market.metro).toBe("new_york");
    expect(c.market.localTeams).toContain("mlb:NYM");
    expect(c.tvs).toEqual([expect.objectContaining({ host: "192.168.1.50", port: 5555, platform: "firetv" })]);
    expect(c.integrations.plex).toMatchObject({ url: "http://127.0.0.1:32400", channelMap: { cbs: "WCBS" } });
    expect(c.integrations.espnWatch).toBe(true);
    expect(c.setupComplete).toBe(true);
    expect(s.getSecrets()).toMatchObject({ plexToken: "tok", espnWatchApiKey: "k" });
    // The old file is left alone.
    expect(existsSync(join(d, "settings.json"))).toBe(true);
  });

  it("refuses a config from a newer version and leaves it untouched", async () => {
    const d = await dir();
    const body = JSON.stringify({ version: CONFIG_VERSION + 1, whatever: true });
    await writeFile(join(d, "config.json"), body);
    await expect(new ConfigStore(d).load()).rejects.toThrow(ConfigError);
    await expect(new ConfigStore(d).load()).rejects.toThrow(/newer Sports Remote/);
    expect(await readFile(join(d, "config.json"), "utf8")).toBe(body);
  });

  it("refuses a broken or invalid config instead of resetting it", async () => {
    const d = await dir();
    await writeFile(join(d, "config.json"), "{ not json");
    await expect(new ConfigStore(d).load()).rejects.toThrow(/isn't valid JSON/);
    await writeFile(join(d, "config.json"), JSON.stringify({ version: CONFIG_VERSION, setupComplete: "yes" }));
    await expect(new ConfigStore(d).load()).rejects.toThrow(/doesn't validate/);
    expect(await readFile(join(d, "config.json"), "utf8")).toContain('"yes"');
  });

  it("validates updates, writes atomically with a backup, and notifies listeners", async () => {
    const d = await dir();
    const s = new ConfigStore(d);
    await s.load();
    const seen: boolean[] = [];
    s.onChange((c) => seen.push(c.preferences.oneTapSend));
    await s.update((c) => void (c.preferences.oneTapSend = true));
    expect(seen).toEqual([true]);
    expect(JSON.parse(await readFile(join(d, "config.json"), "utf8")).preferences.oneTapSend).toBe(true);
    expect(JSON.parse(await readFile(join(d, "config.json.bak"), "utf8")).preferences.oneTapSend).toBe(false);
    await expect(s.update((c) => void ((c.market as { timezone: string }).timezone = "Mars/Olympus"))).rejects.toThrow();
    expect(s.get().market.timezone).not.toBe("Mars/Olympus");
    // Concurrent updates both land, in order.
    await Promise.all([
      s.update((c) => void c.preferences.favorites.push("nba:BOS")),
      s.update((c) => void (c.preferences.oneTapSend = false)),
    ]);
    const disk = JSON.parse(await readFile(join(d, "config.json"), "utf8"));
    expect(disk.preferences.oneTapSend).toBe(false);
  });

  it("updates and removes secrets", async () => {
    const d = await dir();
    const s = new ConfigStore(d);
    await s.load();
    await s.updateSecrets({ plexToken: "abc" });
    expect(new ConfigStore(d)).toBeTruthy();
    const again = new ConfigStore(d);
    await again.load();
    expect(again.getSecrets().plexToken).toBe("abc");
    await again.updateSecrets({ plexToken: undefined });
    expect(again.getSecrets().plexToken).toBeUndefined();
  });
});
