import { describe, expect, it } from "vitest";
import { hasName, isGamePage, openGameViaSearch, type NavDeps } from "../server/youtubeTv";
import { FireTvAdbDriver } from "../server/driver";
import { APP_BY_ID } from "../lib/catalog/apps";
import { forceStopArgs, screencapArgs, type AdbExec } from "../server/adb";
import type { AllowedKey, Game } from "../lib/types";

const teams = { home: { name: "Falcons" }, away: { name: "Bears" } };

describe("matching what's on screen", () => {
  it("finds nicknames with a misread letter, and multi-word names", () => {
    expect(hasName("Chicago Bears at Atlanta Falcons", "Falcons")).toBe(true);
    expect(hasName("Chicago Bears at Atlanta Falcans", "Falcons")).toBe(true); // one letter off
    expect(hasName("Boston Red Sox at New York Yankees", "Red Sox")).toBe(true);
    expect(hasName("Kansas City Chiefs", "Falcons")).toBe(false);
    expect(hasName("The Bearsville Cafe", "Bears")).toBe(false); // whole words only
  });

  it("a game page names both teams and shows its menu; a team's results page doesn't qualify", () => {
    expect(isGamePage("Oct 18, 2026 Chicago Bears at Atlanta Falcons Watch now About Upcoming", teams)).toBe(true);
    expect(isGamePage("Chicago Bears Top picks America's Game Upcoming Games On demand", teams)).toBe(false);
    expect(isGamePage("Chicago Bears at Atlanta Falcons", teams)).toBe(false); // no menu yet: still loading
    expect(isGamePage("Arizona Cardinals at Los Angeles Rams Watch now About", teams)).toBe(false);
  });
});

type Screen = "profile" | "loading" | "results" | "game" | "otherpage" | "video" | "blank" | "playing";

/** A scripted TV: reads show the current screen's text, and keys move between screens like YouTube TV does. */
function fakeTv(start: Screen, opts: { cardOpens?: "game" | "video" | "other"; linkLost?: boolean; rowsAbove?: number; cards?: ("blocked" | "other" | "target")[] } = {}) {
  let card = 0; // focused card in the games row
  const need = opts.rowsAbove ?? 2; // DOWN presses until the games row is the top row
  let screen = start;
  let downs = 0;
  const presses: AllowedKey[] = [];
  let reopened = 0;
  let t = 0;
  const text: Record<Screen, string> = {
    profile: "Who's watching? Avi Add account Settings",
    loading: "",
    results: "",
    game: "Oct 18, 2026 Chicago Bears at Atlanta Falcons Watch now About Upcoming",
    video: "",
    blank: "",
    playing: "",
    otherpage: "",
  };
  const other = "Oct 18, 2026 Arizona Cardinals at Los Angeles Rams Watch now About Upcoming";
  const deps: NavDeps = {
    press: async (k) => {
      presses.push(k);
      if (screen === "profile" && k === "SELECT") screen = opts.linkLost ? "loading" : "results";
      else if (screen === "results" && k === "DOWN") downs++;
      else if (screen === "results" && k === "RIGHT" && downs >= need) card++;
      else if (screen === "results" && k === "SELECT" && downs >= need) {
        const kind = opts.cards ? (opts.cards[card] ?? "blocked") : opts.cardOpens === "video" ? "video" : opts.cardOpens === "other" ? "other" : "target";
        if (kind === "target") screen = "game";
        else if (kind === "other") screen = "otherpage";
        else if (kind === "video") screen = "video";
        // "blocked": nothing opens
      }
      else if (screen === "game" && k === "SELECT") screen = "playing";
      else if (k === "BACK") screen = screen === "otherpage" ? "results" : "blank";
    },
    reopen: async () => {
      reopened++;
      if (screen === "loading") screen = "results";
    },
    read: async () => {
      if (screen === "results") return downs >= need ? "America's Game Upcoming Games CHI ATL NFL ST - FOX On demand" : "Chicago Bears Top picks America's Game NFL Fantasy Live Upcoming Games";
      if (screen === "otherpage") return other;
      return text[screen];
    },
    sleep: async (ms) => void (t += ms),
    now: () => t,
  };
  return { deps, presses, get screen() { return screen; }, get reopened() { return reopened; } };
}

describe("openGameViaSearch", () => {
  it("opens the first game card, confirms the matchup, then presses Watch now", async () => {
    const tv = fakeTv("results");
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: true });
    expect(tv.presses).toEqual(["DOWN", "DOWN", "SELECT", "SELECT"]);
    expect(tv.screen).toBe("playing");
  });

  it("gets through the profile picker on a cold start (the app keeps the search)", async () => {
    const tv = fakeTv("profile");
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: true });
    expect(tv.presses).toEqual(["SELECT", "DOWN", "DOWN", "SELECT", "SELECT"]);
    expect(tv.reopened).toBe(0);
  });

  it("re-sends the search link when the profile picker swallowed it", async () => {
    const tv = fakeTv("profile", { linkLost: true });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: true });
    expect(tv.presses).toEqual(["SELECT", "DOWN", "DOWN", "SELECT", "SELECT"]);
    expect(tv.reopened).toBe(1);
  });

  it("never presses Watch when every card is a different matchup", async () => {
    const tv = fakeTv("results", { cards: ["other", "other", "other", "other", "other", "other"] });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: false, reason: "wrong_page" });
    // One SELECT per card tried (opens it), a BACK after each, and never the Watch press on a page that isn't the game.
    expect(tv.presses.filter((k) => k === "SELECT")).toHaveLength(6);
    expect(tv.screen).toBe("results");
  });

  it("skips blocked cards and finds the game further along the row (the Eagles case)", async () => {
    const tv = fakeTv("results", { cards: ["blocked", "blocked", "other", "target"] });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: true });
    expect(tv.presses).toEqual(["DOWN", "DOWN", "SELECT", "RIGHT", "SELECT", "RIGHT", "SELECT", "BACK", "RIGHT", "SELECT", "SELECT"]);
    expect(tv.screen).toBe("playing");
  });

  it("gives up after the first few cards when none is the game, without pressing Watch", async () => {
    const tv = fakeTv("results", { cards: ["blocked", "blocked", "blocked", "blocked", "blocked", "blocked", "blocked", "target"] });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: false, reason: "wrong_page" });
    expect(tv.screen).toBe("results"); // never reached the 8th card
  });

  it("backs out when the card started a video instead of a game page", async () => {
    const tv = fakeTv("results", { cardOpens: "video" });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: false, reason: "wrong_page" });
    expect(tv.presses.at(-1)).toBe("BACK");
  });

  it("keeps moving down when the team has more rows above the games row", async () => {
    const tv = fakeTv("results", { rowsAbove: 4 });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: true });
    expect(tv.presses).toEqual(["DOWN", "DOWN", "DOWN", "DOWN", "SELECT", "SELECT"]);
  });

  it("never opens a card when the games row can't be found", async () => {
    const tv = fakeTv("results", { rowsAbove: 99 });
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: false, reason: "no_results" });
    expect(tv.presses.filter((k) => k === "SELECT")).toHaveLength(0);
  });

  it("presses nothing when the results never show up", async () => {
    const tv = fakeTv("blank");
    expect(await openGameViaSearch(tv.deps, teams)).toEqual({ ok: false, reason: "no_results" });
    expect(tv.presses).toEqual([]);
  });

  it("rides out a few bad frames (a screenshot cut short mid-launch)", async () => {
    const tv = fakeTv("profile");
    let n = 0;
    const deps = { ...tv.deps, read: async () => { if (n++ % 3 === 1) throw new Error("libpng error"); return tv.deps.read(); } };
    expect(await openGameViaSearch(deps, teams)).toEqual({ ok: true });
  });

  it("reports an unreadable screen (OCR error) without pressing anything", async () => {
    const tv = fakeTv("results");
    const deps = { ...tv.deps, read: async () => { throw new Error("tesseract missing"); } };
    expect(await openGameViaSearch(deps, teams)).toEqual({ ok: false, reason: "ocr_failed" });
    expect(tv.presses).toEqual([]);
  });
});

describe("driver: YouTube TV route", () => {
  const SERIAL = "10.0.0.5:5555";
  const team = (name: string, city: string) => ({ id: "1", abbr: name.slice(0, 3).toUpperCase(), name, city, displayName: `${city} ${name}` });
  const game = {
    id: "nfl:401", league: "nfl", startTime: "2026-10-18T17:00:00Z", state: "pre", detail: "Sun 1:00 PM",
    home: team("Falcons", "Atlanta"), away: team("Bears", "Chicago"), broadcasts: [],
  } as Game;

  function run(screenOn: boolean, cardOpens: "game" | "video" = "game", progress: string[] = []) {
    const calls: string[][] = [];
    let screen: Screen = "results";
    let downs = 0;
    const exec: AdbExec = async (args) => {
      calls.push(args);
      const sh = args.slice(3);
      const out = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (args[0] === "connect") return out("connected");
      if (args[0] === "devices") return out(`List of devices attached\n${SERIAL}\tdevice\n`);
      if (sh[0] === "dumpsys" && sh[2] === "activities") return out("  topResumedActivity=ActivityRecord{1 u0 com.amazon.firetv.youtube.tv/dev.cobalt.app.MainActivity t1}");
      if (sh[0] === "dumpsys") return out("mWakefulness=Awake");
      if (sh[0] === "input") {
        const k = sh[2];
        if (k === "KEYCODE_DPAD_DOWN") downs++;
        else if (k === "KEYCODE_DPAD_CENTER" && screen === "results" && downs >= 2) screen = cardOpens === "video" ? "video" : "game";
        else if (k === "KEYCODE_DPAD_CENTER" && screen === "game") screen = "playing";
        return out("");
      }
      if (sh[0] === "am") return out("Status: ok");
      return out("");
    };
    const texts: Partial<Record<Screen, () => string>> = {
      results: () => (downs >= 2 ? "Upcoming Games ATL CHI On demand" : "Atlanta Falcons Top picks Upcoming Games On demand"),
      game: () => "Oct 18, 2026 Chicago Bears at Atlanta Falcons Watch now About Upcoming",
    };
    let t = 0;
    const d = new FireTvAdbDriver({ warmEntry: false,
      serial: SERIAL, exec, apps: () => APP_BY_ID, sleep: async (ms) => void (t += ms), now: () => t, verifyTimeoutMs: 2000,
      screen: screenOn ? { capture: async () => Buffer.from([1]), ocr: async () => texts[screen]?.() ?? "" } : null,
    });
    const launch = d.launch({
      requestId: "7a1d2c3e-0000-4000-8000-000000000003", game,
      route: { service: "youtube_tv", network: "fox", level: "game", reason: "test", certain: true },
      onProgress: (m) => progress.push(m),
    });
    return { launch, calls, get screen() { return screen; } };
  }

  it("cold-starts the app, searches the home team, opens the game and starts it", async () => {
    const x = run(true);
    const r = await x.launch;
    const flat = x.calls.map((c) => c.join(" "));
    const stop = flat.findIndex((c) => c.includes("am force-stop 'com.amazon.firetv.youtube.tv'"));
    const search = flat.findIndex((c) => c.includes("youtubetv://search"));
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(search);
    expect(r).toMatchObject({ ok: true, level: "game" });
    expect(x.calls.some((c) => c.join(" ").includes("'youtubetv://search?query=Atlanta%20Falcons' 'com.amazon.firetv.youtube.tv'"))).toBe(true);
    expect(x.screen).toBe("playing");
  });

  it("reports each step as it goes, so the screen can show what's happening", async () => {
    const progress: string[] = [];
    const x = run(true, "game", progress);
    await x.launch;
    expect(progress[0]).toBe("Restarting YouTube TV...");
    expect(progress).toContain("Looking for the game...");
    expect(progress.at(-1)).toBe("Found it. Starting the game...");
  });

  it("falls back to the Live guide link and the app when the card isn't the right game", async () => {
    const x = run(true, "video");
    const r = await x.launch;
    expect(r.level).not.toBe("game");
    expect(r.attempts[0]).toMatchObject({ level: "game", ok: false, error: "wrong_page" });
    expect(x.screen).not.toBe("playing");
  });

  it("skips the route when the screen can't be read (no OCR installed)", async () => {
    const x = run(false);
    const r = await x.launch;
    expect(r.level).not.toBe("game");
    expect(x.calls.some((c) => c.join(" ").includes("youtubetv://search"))).toBe(false);
  });
});

describe("registry and command shapes", () => {
  it("force-stop is a fixed argv and rejects a hostile package", () => {
    expect(forceStopArgs("com.amazon.firetv.youtube.tv")).toEqual(["am", "force-stop", "'com.amazon.firetv.youtube.tv'"]);
    expect(() => forceStopArgs("com.x; reboot")).toThrow();
  });

  it("screencap is a fixed argv and rejects a hostile serial", () => {
    expect(screencapArgs("10.0.0.5:5555")).toEqual(["-s", "10.0.0.5:5555", "exec-out", "screencap", "-p"]);
    expect(() => screencapArgs("1.2.3.4;reboot")).toThrow();
  });

});

describe("driver: Fox One channel link", () => {
  const SERIAL = "10.0.0.5:5555";
  const team = (name: string, city: string) => ({ id: "1", abbr: name.slice(0, 3).toUpperCase(), name, city, displayName: `${city} ${name}` });
  const game = {
    id: "mlb:1", league: "mlb", startTime: "2026-10-14T00:00:00Z", state: "in", detail: "Top 3rd",
    home: team("Brewers", "Milwaukee"), away: team("Dodgers", "Los Angeles"), broadcasts: [],
  } as Game;

  async function launch(network: "fs1" | "fs2" | "btn" | "fox") {
    const calls: string[][] = [];
    const exec: AdbExec = async (args) => {
      calls.push(args);
      const sh = args.slice(3);
      const out = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (args[0] === "connect") return out("connected");
      if (args[0] === "devices") return out(`List of devices attached\n${SERIAL}\tdevice\n`);
      if (sh[0] === "dumpsys" && sh[2] === "activities") return out("  topResumedActivity=ActivityRecord{1 u0 com.fox.foxone/.ui.activity.MainActivity t1}");
      if (sh[0] === "dumpsys") return out("mWakefulness=Awake");
      return out("Status: ok");
    };
    let t = 0;
    const d = new FireTvAdbDriver({ serial: SERIAL, exec, apps: () => APP_BY_ID, sleep: async (ms) => void (t += ms), now: () => t, verifyTimeoutMs: 2000 });
    const r = await d.launch({ requestId: "7a1d2c3e-0000-4000-8000-000000000005", game, route: { service: "fox_one", network, level: "channel", reason: "test", certain: true } });
    return { r, calls: calls.map((c) => c.join(" ")) };
  }

  it("tunes FS1, FS2 and BTN by call sign", async () => {
    for (const [net, sign] of [["fs1", "FS1"], ["fs2", "FS2"], ["btn", "BTN"]] as const) {
      const { r, calls } = await launch(net);
      expect(r).toMatchObject({ ok: true, level: "channel" });
      expect(calls.some((c) => c.includes(`'foxone://channel/${sign}' 'com.fox.foxone'`))).toBe(true);
    }
  });

  it("opens the app only for the FOX network (channel/FOX isn't available in Fox One)", async () => {
    const { r, calls } = await launch("fox");
    expect(r.level).toBe("app");
    expect(calls.some((c) => c.includes("foxone://channel/"))).toBe(false);
  });
});
