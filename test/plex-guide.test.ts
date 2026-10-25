import { describe, expect, it } from "vitest";
import { tuneViaGuide, type PlexNavDeps, type PlexScreen } from "../server/plexGuide";
import { FireTvAdbDriver } from "../server/driver";
import { APP_BY_ID } from "../lib/catalog/apps";
import type { AdbExec } from "../server/adb";
import type { AllowedKey, Game } from "../lib/types";

const TABS = "Guide What's On DVR Schedule Recording Priority Browse";

/** A scripted Plex guide: rows of programs, a cursor, keys dropped until the guide has loaded. */
function fakeGuide(rows: { show: string; episode?: string; timeline?: string[] }[], opts: { loadedAfterReads?: number; popup?: boolean; neverLoads?: boolean; col?: number } = {}) {
  let row = 0;
  let col = opts.col ?? 0;
  let reads = 0;
  let playing = false;
  const presses: AllowedKey[] = [];
  let t = 0;
  const loaded = () => !opts.neverLoads && reads >= (opts.loadedAfterReads ?? 0);
  const screen = async (): Promise<PlexScreen> => {
    reads++;
    if (playing) return { header: "", all: "" }; // video: nothing readable
    if (!loaded()) return { header: "", all: "" };
    const r = rows[row];
    const show = r.timeline ? r.timeline[Math.min(col, r.timeline.length - 1)] : r.show;
    const header = `${TABS} 12:46 AM ${show} ${r.episode ?? show} TV-PG 20m left Game show Hosts and details of the program`;
    // The rows below repeat every program's title, so "all" mentions all of them (and must never be used to match).
    return { header, all: `${header} Favorites ${rows.map((x) => x.show).join(" ")}` };
  };
  const deps: PlexNavDeps = {
    press: async (k) => {
      presses.push(k);
      if (!loaded()) return; // dropped: the guide hasn't finished loading
      if (k === "DOWN") row = Math.min(row + 1, rows.length - 1);
      else if (k === "RIGHT") col++;
      else if (k === "LEFT") col = Math.max(col - 1, 0);
      else if (k === "SELECT" && !opts.popup) playing = true;
    },
    screen,
    sleep: async (ms) => void (t += ms),
    now: () => t,
  };
  return { deps, presses, get playing() { return playing; }, get row() { return row; } };
}

const rows = [
  { show: "Funny You Should Ask" }, // CBS
  { show: "Late Night With Seth Meyers" }, // NBC
  { show: "Jimmy Kimmel Live!" }, // ABC
  { show: "TMZ Live" }, // FOX
];

describe("tuneViaGuide", () => {
  it("moves down to the channel's program and presses SELECT only there", async () => {
    const g = fakeGuide(rows);
    expect(await tuneViaGuide(g.deps, { now: { show: "Jimmy Kimmel Live!" } })).toEqual({ ok: true });
    expect(g.presses).toEqual(["DOWN", "DOWN", "SELECT"]);
    expect(g.playing).toBe(true);
  });

  it("selects straight away when the first row already matches", async () => {
    const g = fakeGuide(rows);
    expect(await tuneViaGuide(g.deps, { now: { show: "Funny You Should Ask" } })).toEqual({ ok: true });
    expect(g.presses).toEqual(["SELECT"]);
  });

  it("waits for the guide to load instead of pressing into a loading screen", async () => {
    const g = fakeGuide(rows, { loadedAfterReads: 4 });
    expect(await tuneViaGuide(g.deps, { now: { show: "TMZ Live" } })).toEqual({ ok: true });
    expect(g.presses.filter((k) => k === "DOWN")).toHaveLength(3);
    expect(g.row).toBe(3);
  });

  it("doesn't treat the tab bar and clock alone as a loaded guide", async () => {
    // Real traces showed "Guide What's On DVR Schedule ... 1:21 AM CBS" a few seconds before the grid existed.
    let t = 0;
    const presses: string[] = [];
    let reads = 0;
    const deps: PlexNavDeps = {
      press: async (k) => void presses.push(k),
      screen: async () => {
        reads++;
        if (presses.includes("SELECT")) return { header: "", all: "" }; // playing
        const tabsOnly = `${TABS} 1:21 AM CBS`;
        const full = `${tabsOnly} Funny You Should Ask Funny You Should Ask TV-PG details of the program`;
        const s = reads < 4 ? tabsOnly : full;
        return { header: s, all: s };
      },
      sleep: async (ms) => void (t += ms),
      now: () => t,
    };
    expect((await tuneViaGuide(deps, { now: { show: "Funny You Should Ask" } })).ok).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(4); // waited past the tabs-only frames before doing anything
    expect(presses).toEqual(["SELECT"]);
  });

  it("wakes the grid with RIGHT then LEFT when DOWN is being ignored", async () => {
    const g = fakeGuide(rows);
    let ignored = 2; // the first two DOWN presses are dropped
    const press = g.deps.press;
    const deps = { ...g.deps, press: async (k: AllowedKey) => { if (k === "DOWN" && ignored > 0) { ignored--; g.presses.push(k); return; } return press(k); } };
    expect(await tuneViaGuide(deps, { now: { show: "Late Night With Seth Meyers" } })).toEqual({ ok: true });
    expect(g.presses).toContain("RIGHT");
    expect(g.presses).toContain("LEFT");
  });

  it("gives up if the guide never loads, pressing nothing", async () => {
    const g = fakeGuide(rows, { neverLoads: true });
    expect(await tuneViaGuide(g.deps, { now: { show: "TMZ Live" } })).toEqual({ ok: false, reason: "no_guide" });
    expect(g.presses).toEqual([]);
  });

  it("never presses SELECT when the program isn't in the guide", async () => {
    const g = fakeGuide(rows);
    expect(await tuneViaGuide(g.deps, { now: { show: "Something Else Entirely" } })).toEqual({ ok: false, reason: "not_found" });
    expect(g.presses).not.toContain("SELECT");
    expect(g.playing).toBe(false);
  });

  it("matches the program from the header, not from the rows that repeat every title", async () => {
    // "TMZ Live" appears in the page text from the start, but the header says otherwise until the cursor is there.
    const g = fakeGuide(rows);
    expect(await tuneViaGuide(g.deps, { now: { show: "TMZ Live" } })).toEqual({ ok: true });
    expect(g.row).toBe(3);
  });

  it("needs both the show and the game title when two channels carry the same show (NFL on CBS and FOX)", async () => {
    const nfl = [
      { show: "NFL Football", episode: "Chicago Bears at Atlanta Falcons" }, // another channel, same show
      { show: "NFL Football", episode: "Baltimore Ravens at Cleveland Browns" },
    ];
    const g = fakeGuide(nfl);
    expect(await tuneViaGuide(g.deps, { now: { show: "NFL Football", episode: "Baltimore Ravens at Cleveland Browns" } })).toEqual({ ok: true });
    expect(g.row).toBe(1);
  });

  it("slides along the row when the TV's guide lags the clock (cursor on the previous program)", async () => {
    // The ABC row shows Kimmel (ended) at the cursor; the server says Nightline is on now.
    const abc = [{ show: "Funny You Should Ask" }, { show: "Late Night", timeline: undefined }, { show: "", timeline: ["Jimmy Kimmel Live!", "Nightline", "ABC World News Tonight"] }];
    const g = fakeGuide(abc);
    const target = { now: { show: "Nightline" }, prev: { show: "Jimmy Kimmel Live!" }, next: { show: "ABC World News Tonight" } };
    expect(await tuneViaGuide(g.deps, target)).toEqual({ ok: true });
    expect(g.presses).toEqual(["DOWN", "DOWN", "RIGHT", "SELECT"]);
  });

  it("slides back when the cursor is on the next program", async () => {
    const abc = [{ show: "Funny You Should Ask" }, { show: "", timeline: ["Jimmy Kimmel Live!", "Nightline", "ABC World News Tonight"] }];
    const g = fakeGuide(abc, { col: 2 });
    const target = { now: { show: "Nightline" }, prev: { show: "Jimmy Kimmel Live!" }, next: { show: "ABC World News Tonight" } };
    expect(await tuneViaGuide(g.deps, target)).toEqual({ ok: true });
    expect(g.presses).toEqual(["DOWN", "LEFT", "SELECT"]);
  });

  it("does not press SELECT on a neighbour if it can't reach the program on now", async () => {
    const abc = [{ show: "", timeline: ["Jimmy Kimmel Live!", "Jimmy Kimmel Live!", "Jimmy Kimmel Live!", "Jimmy Kimmel Live!", "Jimmy Kimmel Live!"] }];
    const g = fakeGuide(abc);
    const target = { now: { show: "Nightline" }, prev: { show: "Jimmy Kimmel Live!" } };
    const r = await tuneViaGuide(g.deps, target);
    expect(r.ok).toBe(false);
    expect(g.presses).not.toContain("SELECT");
  });

  it("reports when SELECT leaves the guide on screen (a popup, not playback)", async () => {
    const g = fakeGuide(rows, { popup: true });
    expect(await tuneViaGuide(g.deps, { now: { show: "Funny You Should Ask" } })).toEqual({ ok: false, reason: "no_playback" });
  });

  it("rides out unreadable frames", async () => {
    const g = fakeGuide(rows);
    let n = 0;
    const deps = { ...g.deps, screen: async () => { if (n++ % 4 === 1) throw new Error("libpng error"); return g.deps.screen(); } };
    expect(await tuneViaGuide(deps, { now: { show: "Jimmy Kimmel Live!" } })).toEqual({ ok: true });
  });
});

describe("driver: Plex guide route", () => {
  it("uses the app's DVR guide link with the server's DVR key, after a cold start", async () => {
    const SERIAL = "10.0.0.5:5555";
    const calls: string[][] = [];
    let row = 0;
    let playing = false;
    const exec: AdbExec = async (args) => {
      calls.push(args);
      const sh = args.slice(3);
      const out = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (args[0] === "connect") return out("connected");
      if (args[0] === "devices") return out(`List of devices attached\n${SERIAL}\tdevice\n`);
      if (sh[0] === "dumpsys" && sh[2] === "activities") return out("  topResumedActivity=ActivityRecord{1 u0 com.plexapp.android/tv.plex.app.MainActivity t1}");
      if (sh[0] === "dumpsys") return out("mWakefulness=Awake");
      if (sh[0] === "input") {
        if (sh[2] === "KEYCODE_DPAD_DOWN") row++;
        if (sh[2] === "KEYCODE_DPAD_CENTER") playing = true;
        return out("");
      }
      return out("Status: ok");
    };
    const shows = ["Funny You Should Ask", "Late Night With Seth Meyers", "Jimmy Kimmel Live!"];
    const word = (text: string, top: number, left: number) => ({ text, left, top, width: 50, height: 20 });
    const plex = {
      dvrKey: async () => "2",
      around: async () => ({ now: { show: "Jimmy Kimmel Live!" } }),
      channelFor: async () => null,
    } as never;
    let t = 0;
    const d = new FireTvAdbDriver({ warmEntry: false,
      serial: SERIAL, exec, apps: () => APP_BY_ID, plex, sleep: async (ms) => void (t += ms), now: () => t, verifyTimeoutMs: 2000,
      screen: {
        capture: async () => Buffer.from([1]),
        ocr: async () => "",
        boxes: async () => {
          if (playing) return { words: [], height: 1080 };
          const header = `Guide What's On DVR Schedule Recording Priority Browse 12:46 AM ${shows[row]} ${shows[row]} TV-PG details of the program`;
          // header words sit near the top; a lower row repeats every title
          return { height: 1080, words: [...header.split(" ").map((w, i) => word(w, 60 + (i % 3) * 30, i * 40)), ...shows.map((s, i) => word(s, 700 + i * 90, 300))] };
        },
      },
    });
    const g = { id: "nfl:1", league: "nfl", startTime: "2026-10-18T17:00:00Z", state: "in", detail: "Q1", broadcasts: [],
      home: { id: "1", abbr: "ATL", name: "Falcons", city: "Atlanta", displayName: "Atlanta Falcons" },
      away: { id: "2", abbr: "CHI", name: "Bears", city: "Chicago", displayName: "Chicago Bears" } } as Game;
    const progress: string[] = [];
    const r = await d.launch({ requestId: "7a1d2c3e-0000-4000-8000-000000000004", game: g, route: { service: "plex", network: "abc", level: "channel", reason: "test", certain: true }, onProgress: (m) => progress.push(m) });
    expect(r).toMatchObject({ ok: true, level: "channel" });
    const flat = calls.map((c) => c.join(" "));
    const stop = flat.findIndex((c) => c.includes("am force-stop 'com.plexapp.android'"));
    const link = flat.findIndex((c) => c.includes("'plex://live-tv/dvr.guide/ota/2' 'com.plexapp.android'"));
    expect(stop).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(stop);
    expect(playing).toBe(true);
    expect(progress).toEqual(["Restarting Plex...", "Opening the Live TV guide...", "Finding the channel...", "Starting playback..."]);
  });

  it("is skipped without word positions (no OCR boxes)", () => {
    expect(APP_BY_ID.get("plex")!.routes[0].navigate).toBe("plex_guide");
  });

});
