// The simulator's own behavior: if these break, every scenario built on it means something else.

import { describe, expect, it } from "vitest";
import { foregroundArgs, keyArgs, mediaSessionArgs, parseForeground, parseMediaSessions, pidofArgs, shellArgs, viewIntentArgs, forceStopArgs, parseAmStart } from "../../server/adb";
import { parseForegroundActivity } from "../../server/driver";
import {
  fakePng, fakePngInfo, line, LAUNCHER_PKG, misread, plex, plexLink, PLEX_PKG, scaleWords, seeded, SimTv, STILL_WATCHING, unquote, youtubeTv, ytLink,
  ytSearch, YTTV_PKG, simGame, TEAMS, type AppModel,
} from ".";

const A = simGame("nfl:A", TEAMS.bears, TEAMS.falcons);
const yt = (o: ConstructorParameters<typeof SimTv>[0] extends infer T ? Partial<T> : never = {}) =>
  youtubeTv({ search: ytSearch({ "Atlanta Falcons": { cards: [{ kind: "game", game: A }] } }) }, o);

describe("clock and randomness", () => {
  it("time moves only on sleeps and on the cost of each action", async () => {
    const tv = yt();
    expect(tv.clock.now()).toBe(0);
    await tv.sleep(1000);
    expect(tv.clock.now()).toBe(1000);
    await tv.press("HOME");
    expect(tv.clock.now()).toBe(1000 + tv.costs.keyMs);
  });

  it("the same seed replays the same run", () => {
    const a = seeded(42);
    const b = seeded(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seeded(43)()).not.toBe(seeded(42)());
  });

  it("loading screens resolve at their due time even inside one long sleep", async () => {
    const tv = yt();
    tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
    await tv.sleep(60_000);
    const shots = tv.events.filter((e) => e.type === "screen" && e.pkg === YTTV_PKG).map((e) => (e as { to: string; t: number }));
    expect(shots.map((s) => s.to)).toEqual(["splash", "search_loading", "results"]);
    // splash 7 s after the cold start, then 2.5 s of loading
    expect(tv.app(YTTV_PKG)!.enteredAt).toBe(tv.costs.coldStartMs + 7000 + 2500);
  });

  it("slow loads stretch every timer", async () => {
    const tv = yt({ perturb: { slowLoads: 2 } });
    tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
    await tv.sleep(12_000); // a 7 s splash now takes 14 s
    expect(tv.current.screen).toBe("splash");
    await tv.sleep(10_000);
    expect(tv.current.screen).toBe("results");
  });
});

describe("keys", () => {
  it("drops presses at given indices, and only for chosen keys", async () => {
    const tv = yt({ perturb: { dropKeys: { at: [1], only: ["DOWN"] } } });
    tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
    await tv.sleep(20_000);
    await tv.press("DOWN");
    await tv.press("DOWN");
    await tv.press("DOWN");
    expect(tv.keys().map((k) => k.delivered)).toEqual([true, false, true]);
    expect(tv.app(YTTV_PKG)!.vars.focus).toBe(2);
  });

  it("keys sent to a loading screen are lost", async () => {
    const tv = yt();
    tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
    await tv.press("DOWN"); // splash
    await tv.sleep(20_000);
    expect(tv.app(YTTV_PKG)!.vars.focus).toBe(0);
  });

  it("BACK on an app's first screen goes to the launcher; HOME always does, and the app keeps running", async () => {
    const tv = yt();
    tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
    await tv.sleep(20_000);
    await tv.press("HOME");
    expect(tv.foreground).toBe(LAUNCHER_PKG);
    expect(tv.isRunning(YTTV_PKG)).toBe(true);
    expect(tv.launch(YTTV_PKG)).toBe(true);
    expect(tv.current).toEqual({ pkg: YTTV_PKG, screen: "results" });
  });
});

describe("intents and processes", () => {
  it("cold intent starts the app; force-stop kills it and shows the launcher", async () => {
    const tv = yt();
    expect(tv.view(ytLink("Atlanta Falcons"), YTTV_PKG)).toEqual({ ok: true, warm: false, handled: true });
    tv.forceStop(YTTV_PKG);
    expect(tv.isRunning(YTTV_PKG)).toBe(false);
    expect(tv.foreground).toBe(LAUNCHER_PKG);
  });

  it("warm intents: handled, ignored, or only from some screens", async () => {
    for (const [mode, expected] of [["handled", true], ["ignored", false], [{ from: ["home"] }, false], [{ except: ["home"] }, true]] as const) {
      const tv = yt({ warmIntent: { [YTTV_PKG]: mode } });
      tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
      await tv.sleep(20_000);
      expect(tv.view(ytLink("Atlanta Falcons"), YTTV_PKG).handled).toBe(expected);
    }
  });

  it("a modal popup swallows warm intents and keys until dismissed", async () => {
    const tv = yt({ perturb: { popups: [{ text: STILL_WATCHING, when: { atMs: 15_000 } }] } });
    tv.view(ytLink("Atlanta Falcons"), YTTV_PKG);
    await tv.sleep(20_000);
    expect(tv.activePopup).toBe(STILL_WATCHING);
    expect(tv.view(ytLink("Atlanta Falcons"), YTTV_PKG).handled).toBe(false);
    await tv.press("DOWN");
    expect(tv.app(YTTV_PKG)!.vars.focus).toBe(0);
    await tv.press("SELECT");
    expect(tv.activePopup).toBe(null);
  });

  it("YouTube TV ignores a warm link on the Live tab, but not after SEARCH", async () => {
    const tv = yt();
    tv.view("https://tv.youtube.com/live", YTTV_PKG);
    await tv.sleep(20_000);
    expect(tv.current.screen).toBe("live");
    expect(tv.view(ytLink("Atlanta Falcons"), YTTV_PKG).handled).toBe(false);
    await tv.press("SEARCH");
    expect(tv.current.screen).toBe("search_page");
    expect(tv.view(ytLink("Atlanta Falcons"), YTTV_PKG).handled).toBe(true);
  });
});

describe("screens and OCR", () => {
  it("scales word boxes to the screenshot size", () => {
    const [w] = scaleWords(line("Hello", 960, 540, 40), 3840, 2160);
    expect(w).toMatchObject({ text: "Hello", left: 1920, top: 1080, height: 80 });
  });

  it("fake PNGs carry the resolution where a PNG header has it", async () => {
    const png = fakePng(7, 3840, 2160);
    expect(png.readUInt32BE(16)).toBe(3840);
    expect(png.readUInt32BE(20)).toBe(2160);
    expect(fakePngInfo(png)).toEqual({ frameId: 7, width: 3840, height: 2160 });
    expect(() => fakePngInfo(Buffer.from([0x89, 0x50]))).toThrow(/libpng/);
  });

  it("misreads change one character the way OCR does", () => {
    const r = seeded(3);
    const outs = new Set(Array.from({ length: 40 }, () => misread("Falcons", r)));
    for (const o of outs) expect(o.length === 7 || o.length === 8).toBe(true);
    expect(outs.size).toBeGreaterThan(1);
    expect(misread("XYZ", r)).toBe("XYZ");
  });

  it("DRM video reads as a black frame; black-frame and read-error perturbations apply per screenshot", async () => {
    const tv = yt({ perturb: { readErrors: 1 } });
    await expect(tv.readText()).rejects.toThrow(/libpng/);
    tv.perturb = { blackFrames: 1 };
    expect(await tv.readText()).toBe("");
  });
});

describe("the AdbExec fake speaks adb", () => {
  it("dumpsys activity parses with both the driver's and adb.ts's parsers; tasks list running apps", async () => {
    const tv = plex();
    const exec = tv.adbExec();
    await exec(shellArgs(tv.serial, viewIntentArgs(plexLink(), PLEX_PKG)));
    const out = (await exec(shellArgs(tv.serial, foregroundArgs()))).stdout;
    expect(parseForegroundActivity(out)?.pkg).toBe(PLEX_PKG);
    expect(parseForeground(out)?.pkg).toBe(PLEX_PKG);
    expect(out).toContain(`A=10102:${LAUNCHER_PKG}`);
  });

  it("am start reports cold vs warm delivery", async () => {
    const tv = plex();
    const exec = tv.adbExec();
    const cold = parseAmStart((await exec(shellArgs(tv.serial, viewIntentArgs(plexLink(), PLEX_PKG)))).stdout);
    expect(cold).toMatchObject({ ok: true, launchState: "COLD", deliveredToRunning: false });
    await tv.sleep(20_000);
    const warm = parseAmStart((await exec(shellArgs(tv.serial, viewIntentArgs(plexLink(), PLEX_PKG)))).stdout);
    expect(warm).toMatchObject({ ok: true, launchState: "HOT", deliveredToRunning: true });
  });

  it("pidof, media_session, keys and force-stop", async () => {
    const tv = plex();
    const exec = tv.adbExec();
    expect((await exec(shellArgs(tv.serial, pidofArgs(PLEX_PKG)))).code).toBe(1);
    await exec(shellArgs(tv.serial, viewIntentArgs(plexLink(), PLEX_PKG)));
    expect((await exec(shellArgs(tv.serial, pidofArgs(PLEX_PKG)))).stdout).toMatch(/^\d+/);
    await tv.sleep(20_000);
    await exec(shellArgs(tv.serial, keyArgs("SELECT"))); // tunes the first row's program
    await tv.sleep(5000);
    const sessions = parseMediaSessions((await exec(shellArgs(tv.serial, mediaSessionArgs()))).stdout);
    expect(sessions).toEqual([{ pkg: PLEX_PKG, active: true, state: "playing" }]);
    await exec(shellArgs(tv.serial, forceStopArgs(PLEX_PKG)));
    expect(tv.isRunning(PLEX_PKG)).toBe(false);
  });

  it("an unknown package can't be started and unknown commands fail", async () => {
    const tv = plex();
    const exec = tv.adbExec();
    expect((await exec(shellArgs(tv.serial, viewIntentArgs("https://example.com/x", "com.example.none")))).stdout).toMatch(/Error/);
    expect((await exec(shellArgs(tv.serial, ["reboot"]))).code).toBe(1);
    expect((await exec(["-s", "other:5555", "shell", "dumpsys", "power"])).code).toBe(1);
  });

  it("unquote undoes shellQuote", () => {
    expect(unquote("'it'\\''s'")).toBe("it's");
    expect(unquote("plain")).toBe("plain");
  });
});

describe("a custom app model in a few lines", () => {
  it("screens, keys and a timed transition", async () => {
    const app: AppModel<{ n: number }> = {
      pkg: "com.example.counter", label: "Counter", activity: ".Main",
      vars: () => ({ n: 0 }),
      start: (a) => a.reset("boot"),
      intent: () => undefined,
      screens: {
        boot: { draw: () => line("Loading", 100, 100), dropsKeys: true, after: { ms: 2000, to: "count" } },
        count: { draw: (a) => line(`Count ${a.vars.n}`, 100, 100), keys: { UP: (a) => void a.vars.n++ } },
      },
    };
    const tv = new SimTv({ apps: [app] });
    tv.launch(app.pkg);
    await tv.press("UP"); // lost: still loading
    await tv.sleep(3000);
    await tv.press("UP");
    expect(await tv.readText()).toBe("Count 1");
  });
});
