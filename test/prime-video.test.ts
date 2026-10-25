import { describe, expect, it } from "vitest";
import { openPrimeGame, type PrimeNavDeps, type PrimeScreen } from "../server/primeVideo";
import { FireTvAdbDriver } from "../server/driver";
import { APP_BY_ID } from "../lib/catalog/apps";
import type { AdbExec } from "../server/adb";
import type { AllowedKey, Game } from "../lib/types";

const teams = { home: { name: "Broncos" }, away: { name: "Seahawks" } };
const EMPTY: PrimeScreen = { header: "", panel: "", all: "" };

/** A scripted Prime search page: keyboard first, then tiles; SELECT opens a panel. */
function fakePrime(tiles: string[], opts: { loadedAfter?: number; profile?: boolean; liveBehaviour?: "plays" | "details" } = {}) {
  let reads = 0;
  let rights = 0; // RIGHT presses so far
  let focus: "keyboard" | "chip" | "tile" = "keyboard";
  let tile = 0;
  let panelOpen = false;
  let playing = false;
  let t = 0;
  const presses: AllowedKey[] = [];
  const results = "Seahawks Broncos Top Sports Leagues and teams More to explore a b c d e f";
  const screen = async (): Promise<PrimeScreen> => {
    reads++;
    if (playing) return EMPTY; // video: nothing readable
    if (reads <= (opts.loadedAfter ?? 0)) return EMPTY;
    if (opts.profile && !presses.includes("SELECT")) return { header: "", panel: "", all: "Who's watching? Avi Add account" };
    if (panelOpen) {
      const name = tiles[tile];
      const panel = `UPCOMING Oct 15, 2026 7:00 ${name} Included with Prime Watch Live: Main Broadcast More details Add to Watchlist`;
      return { header: name, panel, all: `${results} ${panel}` };
    }
    const header = focus === "tile" ? `${tiles[tile]} UPCOMING Included with Prime` : "";
    return { header, panel: "", all: `${results} ${header}` };
  };
  const deps: PrimeNavDeps = {
    press: async (k) => {
      presses.push(k);
      if (k === "RIGHT") {
        if (focus === "keyboard" && ++rights >= 6) focus = "chip";
        else if (focus === "tile") tile = Math.min(tile + 1, tiles.length - 1);
      } else if (k === "DOWN" && focus === "chip") focus = "tile";
      else if (k === "SELECT" && focus === "tile") {
        if (!panelOpen) panelOpen = true;
        else if (opts.liveBehaviour !== "details") playing = true; // Watch Live
        else panelOpen = false;
      }
    },
    screen,
    sleep: async (ms) => void (t += ms),
    now: () => t,
  };
  return { deps, presses, get playing() { return playing; }, get panelOpen() { return panelOpen; } };
}

describe("openPrimeGame", () => {
  it("leaves the keyboard, finds the game tile, opens its panel and stops for a game that isn't on yet", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"]);
    expect(await openPrimeGame(p.deps, teams, { play: false })).toEqual({ ok: true, played: false });
    expect(p.presses).toEqual(["RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "DOWN", "SELECT"]);
    expect(p.playing).toBe(false);
  });

  it("presses Watch Live for a game that's on", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"]);
    expect(await openPrimeGame(p.deps, teams, { play: true })).toEqual({ ok: true, played: true });
    expect(p.presses.at(-2)).toBe("SELECT");
    expect(p.presses.at(-1)).toBe("SELECT");
    expect(p.playing).toBe(true);
  });

  it("slides along the Top Sports row to the right matchup", async () => {
    const p = fakePrime(["49ers vs. Seahawks", "Broncos vs. Steelers", "Seahawks vs. Broncos"]);
    expect(await openPrimeGame(p.deps, teams, { play: false })).toEqual({ ok: true, played: false });
    expect(p.presses.slice(6)).toEqual(["DOWN", "RIGHT", "RIGHT", "SELECT"]);
  });

  it("never opens a tile that isn't this matchup", async () => {
    const p = fakePrime(["49ers vs. Seahawks", "Broncos vs. Steelers", "Broncos vs. Cardinals", "Chiefs vs. Raiders"]);
    expect(await openPrimeGame(p.deps, teams, { play: true })).toEqual({ ok: false, reason: "not_found" });
    expect(p.presses).not.toContain("SELECT");
  });

  it("waits for the results instead of pressing into a loading screen", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"], { loadedAfter: 4 });
    expect(await openPrimeGame(p.deps, teams, { play: false })).toEqual({ ok: true, played: false });
    expect(p.presses[0]).toBe("RIGHT");
  });

  it("picks the first profile if Prime asks who's watching", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"], { profile: true });
    expect(await openPrimeGame(p.deps, teams, { play: false })).toEqual({ ok: true, played: false });
    expect(p.presses[0]).toBe("SELECT");
  });

  it("reports no playback when the second SELECT only opens a details page", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"], { liveBehaviour: "details" });
    const r = await openPrimeGame(p.deps, teams, { play: true });
    expect(r.ok).toBe(false);
  });

  it("gives up if the search never shows", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"], { loadedAfter: 999 });
    expect(await openPrimeGame(p.deps, teams, { play: false })).toEqual({ ok: false, reason: "no_results" });
    expect(p.presses).toEqual([]);
  });

  it("rides out unreadable frames", async () => {
    const p = fakePrime(["Seahawks vs. Broncos"]);
    let n = 0;
    const deps = { ...p.deps, screen: async () => { if (n++ % 4 === 1) throw new Error("libpng error"); return p.deps.screen(); } };
    expect(await openPrimeGame(deps, teams, { play: false })).toEqual({ ok: true, played: false });
  });
});

describe("driver: Prime Video route", () => {
  const SERIAL = "10.0.0.5:5555";
  const team = (name: string, city: string) => ({ id: "1", abbr: name.slice(0, 3).toUpperCase(), name, city, displayName: `${city} ${name}` });
  const game = (state: "pre" | "in") => ({
    id: "nfl:1", league: "nfl", startTime: "2026-10-16T00:15:00Z", state, detail: "", broadcasts: [],
    home: team("Broncos", "Denver"), away: team("Seahawks", "Seattle"),
  }) as Game;

  async function launch(state: "pre" | "in", withBoxes = true) {
    const calls: string[][] = [];
    let panel = false;
    let played = false;
    const exec: AdbExec = async (args) => {
      calls.push(args);
      const sh = args.slice(3);
      const out = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (args[0] === "connect") return out("connected");
      if (args[0] === "devices") return out(`List of devices attached\n${SERIAL}\tdevice\n`);
      if (sh[0] === "dumpsys" && sh[2] === "activities") return out("  topResumedActivity=ActivityRecord{1 u0 com.amazon.firebat/com.amazon.pyrocore.IgnitionActivity t1}");
      if (sh[0] === "dumpsys") return out("mWakefulness=Awake");
      if (sh[0] === "input" && sh[2] === "KEYCODE_DPAD_CENTER") { if (!panel) panel = true; else played = true; return out(""); }
      return out("Status: ok");
    };
    const w = (text: string, left: number, top: number) => ({ text, left, top, width: 60, height: 20 });
    const screenWords = () => {
      if (played) return [];
      const words = [w("Top", 700, 180), w("Sports", 760, 180), w("Seahawks", 150, 90), w("Broncos", 300, 90)]; // keyboard side + results
      if (!panel) return [...words, ...["Seahawks", "vs.", "Broncos", "UPCOMING"].map((t, i) => w(t, 650 + i * 70, 100))];
      return [...words, ...["Seahawks", "vs.", "Broncos", "More", "details", "Watch", "Live"].map((t, i) => w(t, 1250 + i * 60, 280))];
    };
    let t = 0;
    const progress: string[] = [];
    const d = new FireTvAdbDriver({ warmEntry: false,
      serial: SERIAL, exec, apps: () => APP_BY_ID, sleep: async (ms) => void (t += ms), now: () => t, verifyTimeoutMs: 2000,
      screen: withBoxes ? { capture: async () => Buffer.from([1]), ocr: async () => "", boxes: async () => ({ words: screenWords(), height: 1080, width: 1920 }) } : null,
    });
    const r = await d.launch({ requestId: "7a1d2c3e-0000-4000-8000-000000000006", game: game(state), route: { service: "prime_video", network: "prime", level: "game", reason: "test", certain: true }, onProgress: (m) => progress.push(m) });
    return { r, calls: calls.map((c) => c.join(" ")), played, progress };
  }

  it("searches both team names after a cold start, and doesn't press play on an upcoming game", async () => {
    const x = await launch("pre");
    expect(x.r).toMatchObject({ ok: true, level: "game" });
    const stop = x.calls.findIndex((c) => c.includes("am force-stop 'com.amazon.firebat'"));
    const link = x.calls.findIndex((c) => c.includes("'https://app.primevideo.com/search?phrase=Seahawks%20Broncos' 'com.amazon.firebat'"));
    expect(stop).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(stop);
    expect(x.played).toBe(false);
    expect(x.progress[0]).toBe("Restarting Prime Video...");
  });

  it("presses Watch Live when the game is on", async () => {
    const x = await launch("in");
    expect(x.r).toMatchObject({ ok: true, level: "game" });
    expect(x.played).toBe(true);
  });

  it("is skipped without word positions (falls back to opening the app)", async () => {
    const x = await launch("pre", false);
    expect(x.r.level).toBe("app");
    expect(x.calls.some((c) => c.includes("app.primevideo.com/search"))).toBe(false);
  });
});
