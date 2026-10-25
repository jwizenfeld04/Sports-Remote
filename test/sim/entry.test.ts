import { describe, expect, it } from "vitest";
import { alreadyPlaying, classifyScreen, LaunchHistory, planEntry, type EntryContext, type EntryObservation } from "../../server/navigation/entry";
import {
  allApps, LOCALS, plex, plexTarget, PLEX_PKG, prime, primeTile, PRIME_PKG, simGame, STILL_WATCHING, TEAMS, youtubeTv, ytLink, ytQueryFor,
  ytSearch, YTTV_PKG, LAUNCHER_PKG, type SimTv, type YtConfig,
} from ".";
import { launchViaEntry } from "./launch";
import { plexPlaying, primeState, ytPlaying } from "./harness";

const A = simGame("nfl:A", TEAMS.bears, TEAMS.falcons);
const B = simGame("nfl:B", TEAMS.cowboys, TEAMS.eagles);
const P1 = simGame("nfl:P1", TEAMS.seahawks, TEAMS.broncos);
const P2 = simGame("nfl:P2", TEAMS.chiefs, TEAMS.raiders);

const ytCfg = (extra: Partial<YtConfig> = {}): YtConfig => ({
  search: ytSearch({ [ytQueryFor(A)]: { cards: [{ kind: "game", game: A }] }, [ytQueryFor(B)]: { cards: [{ kind: "blocked" }, { kind: "game", game: B }] } }),
  profilePicker: true,
  ...extra,
});
const primeCfg = { search: (q: string) => (q.includes("Seahawks") ? [primeTile(P1, true)] : [primeTile(P2, true)]), profilePicker: true };

const strategies = (r: { entry: { telemetry: { attempts: { strategy: string }[] } } }) => r.entry.telemetry.attempts.map((a) => a.strategy);
const forceStops = (tv: SimTv) => tv.events.filter((e) => e.type === "force-stop").length;

// --- pure planning ---

const ctx = (o: Partial<EntryContext> = {}): EntryContext => ({
  navigator: "youtube_tv_search", pkg: YTTV_PKG, service: "youtube_st", gameId: "nfl:A", tvId: "tv1", now: 1_000_000, ...o,
});
const obs = (o: Partial<EntryObservation> = {}): EntryObservation => ({
  foreground: { pkg: YTTV_PKG, activity: "dev.cobalt.app.MainActivity" }, running: true, screenText: "", media: null, ...o,
});
const playing = [{ pkg: YTTV_PKG, active: true, state: "playing" as const }];

describe("planEntry", () => {
  it("cold when the app isn't running", () => {
    expect(planEntry(ctx(), obs({ foreground: { pkg: LAUNCHER_PKG, activity: ".Main" }, running: false, screenText: null }))).toMatchObject({ kind: "cold", reason: "app not running" });
  });

  it("cold when warm entry is turned off", () => {
    expect(planEntry(ctx({ allowWarm: false }), obs()).kind).toBe("cold");
  });

  it("YouTube TV: SEARCH before the link from any screen (the Live tab ignores links otherwise)", () => {
    const p = planEntry(ctx(), obs({ screenText: "Home Live Library Live guide NFL Sunday Ticket" }));
    expect(p).toMatchObject({ kind: "warm", screen: "other", steps: [{ key: "SEARCH" }] });
    expect(planEntry(ctx(), obs({ media: playing })).kind).toBe("warm");
  });

  it("a still-watching popup is dismissed first", () => {
    const p = planEntry(ctx(), obs({ screenText: STILL_WATCHING }));
    expect(p).toMatchObject({ kind: "warm", screen: "popup" });
    if (p.kind === "warm") expect(p.steps.map((s) => s.key)).toEqual(["SELECT", "SEARCH"]);
  });

  it("Plex: BACK out of live TV; nothing extra elsewhere", () => {
    const plexCtx = ctx({ navigator: "plex_guide", pkg: PLEX_PKG, service: "plex" });
    const live = planEntry(plexCtx, obs({ foreground: { pkg: PLEX_PKG, activity: "x" }, screenText: "" }));
    expect(live).toMatchObject({ kind: "warm", screen: "playback", steps: [{ key: "BACK" }] });
    const home = planEntry(plexCtx, obs({ foreground: { pkg: PLEX_PKG, activity: "x" }, screenText: "Home Movies TV Shows Live TV" }));
    expect(home).toMatchObject({ kind: "warm", steps: [] });
  });

  it("Prime: just the link, even during playback", () => {
    const p = planEntry(ctx({ navigator: "prime_search", pkg: PRIME_PKG, service: "prime" }), obs({ foreground: { pkg: PRIME_PKG, activity: "x" } }));
    expect(p).toMatchObject({ kind: "warm", screen: "playback", steps: [] });
  });

  it("a running app in the background: link first, and YouTube TV keeps SEARCH as a retry", () => {
    const p = planEntry(ctx(), obs({ foreground: { pkg: LAUNCHER_PKG, activity: ".Main" }, running: true, screenText: null }));
    expect(p).toMatchObject({ kind: "warm", steps: [], retrySteps: [{ key: "SEARCH" }] });
  });

  it("Prime/Plex with a profile picker in front go cold", () => {
    expect(planEntry(ctx({ navigator: "prime_search", pkg: PRIME_PKG }), obs({ foreground: { pkg: PRIME_PKG, activity: "x" }, screenText: "Who's watching? Avi" })).kind).toBe("cold");
  });

  it("classifies screens", () => {
    expect(classifyScreen("youtube_tv_search", null, null)).toBe("unreadable");
    expect(classifyScreen("youtube_tv_search", "", null)).toBe("playback");
    expect(classifyScreen("youtube_tv_search", "Chicago Bears at Atlanta Falcons LIVE", true)).toBe("playback");
    expect(classifyScreen("youtube_tv_search", "Atlanta Falcons Top picks Upcoming Games", null)).toBe("ready");
    expect(classifyScreen("plex_guide", "Guide What's On DVR Schedule 12:46 AM Jimmy Kimmel Live! talk show details", null)).toBe("ready");
    expect(classifyScreen("prime_search", "Who's watching? Avi", null)).toBe("profile");
  });
});

describe("alreadyPlaying", () => {
  const last = { gameId: "nfl:A", service: "youtube_st", tvId: "tv1", at: 1_000_000 - 60_000 };
  it("skips the same game in the same app while video plays (media session)", () => {
    expect(alreadyPlaying(ctx({ last }), obs({ media: playing, screenText: "Chicago Bears at Atlanta Falcons LIVE" })).skip).toBe(true);
  });
  it("skips on a black frame when there's no media session to ask", () => {
    expect(alreadyPlaying(ctx({ last }), obs({ screenText: "" }))).toEqual({ skip: true, reason: "same game, video on screen (no readable text)" });
  });
  it("doesn't skip when paused, on a page, another game, another app, another TV, or hours later", () => {
    expect(alreadyPlaying(ctx({ last }), obs({ media: [{ pkg: YTTV_PKG, active: true, state: "paused" }] })).skip).toBe(false);
    expect(alreadyPlaying(ctx({ last }), obs({ screenText: "Atlanta Falcons Top picks" })).skip).toBe(false);
    expect(alreadyPlaying(ctx({ last, gameId: "nfl:B" }), obs()).skip).toBe(false);
    expect(alreadyPlaying(ctx({ last: { ...last, service: "prime" } }), obs()).skip).toBe(false);
    expect(alreadyPlaying(ctx({ last: { ...last, tvId: "tv2" } }), obs()).skip).toBe(false);
    expect(alreadyPlaying(ctx({ last, now: last.at + 5 * 3600_000 }), obs()).skip).toBe(false);
    expect(alreadyPlaying(ctx({ last }), obs({ foreground: { pkg: LAUNCHER_PKG, activity: ".Main" } })).skip).toBe(false);
    expect(alreadyPlaying(ctx(), obs()).skip).toBe(false);
  });
});

// --- on the simulated TV ---

describe("YouTube TV entry", () => {
  it("cold start from the home screen: force-stop, link, profile, game", async () => {
    const tv = youtubeTv(ytCfg());
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A });
    expect(r.ok).toBe(true);
    expect(r.entry.strategy).toBe("cold");
    expect(r.entry.telemetry.planReason).toBe("app not running");
    await tv.sleep(10_000);
    expect(ytPlaying(tv, A.id)).toBe(true);
  });

  it("switching from game A to game B: warm (SEARCH, link), no restart, much faster than cold", async () => {
    const tv = youtubeTv(ytCfg());
    const history = new LaunchHistory();
    const first = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    await tv.sleep(60_000);
    const stopsBefore = forceStops(tv);
    const second = await launchViaEntry(tv, { nav: "youtube_tv_search", game: B }, { history });
    expect(second.ok).toBe(true);
    expect(second.entry.strategy).toBe("warm");
    expect(second.entry.telemetry.observed).toMatchObject({ screen: "playback", media: true, foreground: YTTV_PKG });
    expect(second.entry.telemetry.attempts[0]).toMatchObject({ strategy: "warm", ok: true, steps: ["SEARCH", "link"] });
    expect(second.entry.telemetry.attempts[0].am).toMatchObject({ ok: true, deliveredToRunning: true, launchState: "HOT" });
    expect(forceStops(tv)).toBe(stopsBefore);
    await tv.sleep(10_000);
    expect(ytPlaying(tv, B.id)).toBe(true);
    expect(second.ms).toBeLessThan(first.ms); // no splash, no profile picker (on a real TV cold is 30-70 s)
  });

  it("from the Live tab: the link alone is ignored there, SEARCH first makes it land", async () => {
    const tv = youtubeTv(ytCfg({ profilePicker: false }));
    tv.view("https://tv.youtube.com/live", YTTV_PKG);
    await tv.sleep(15_000);
    expect(tv.current.screen).toBe("live");
    expect(tv.view(ytLink(ytQueryFor(A)), YTTV_PKG).handled).toBe(false); // the community finding, modelled
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A });
    expect(r.entry.strategy).toBe("warm");
    expect(r.ok).toBe(true);
  });

  it("running in the background (HOME during Live playback): the link is swallowed, the SEARCH retry lands it", async () => {
    const tv = youtubeTv(ytCfg({ profilePicker: false }));
    tv.view("https://tv.youtube.com/live", YTTV_PKG);
    await tv.sleep(15_000);
    await tv.press("SELECT"); // play a live channel
    await tv.press("HOME");
    expect(tv.foreground).toBe(LAUNCHER_PKG);
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A });
    expect(r.entry.telemetry.planReason).toBe("app running in the background");
    expect(r.entry.telemetry.attempts[0]).toMatchObject({ strategy: "warm", ok: true, steps: ["link", "SEARCH", "link"] });
    expect(r.ok).toBe(true);
  });

  it("an app that ignores warm links falls back to cold inside the readiness window", async () => {
    const tv = youtubeTv(ytCfg(), { warmIntent: { [YTTV_PKG]: "ignored" } });
    const history = new LaunchHistory();
    await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    await tv.sleep(30_000);
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: B }, { history });
    expect(strategies(r)).toEqual(["warm", "cold"]);
    expect(r.entry.telemetry.fallback).toMatch(/not seen within 10000 ms/);
    expect(r.entry.telemetry.attempts[0].ms).toBeLessThan(16_000);
    expect(r.ok).toBe(true);
  });

  it("a still-watching popup over the game is dismissed before the link", async () => {
    const tv = youtubeTv(ytCfg(), { perturb: { popups: [{ text: STILL_WATCHING, pkg: YTTV_PKG, when: { atMs: 120_000 } }] } });
    const history = new LaunchHistory();
    await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    await tv.sleep(150_000);
    expect(tv.activePopup).toBe(STILL_WATCHING);
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: B }, { history });
    expect(r.entry.telemetry.observed.screen).toBe("popup");
    expect(r.entry.telemetry.attempts[0].steps).toEqual(["SELECT", "SEARCH", "link"]);
    expect(r.ok).toBe(true);
  });

  it("tapping the game that's already playing does nothing", async () => {
    const tv = youtubeTv(ytCfg());
    const history = new LaunchHistory();
    await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    await tv.sleep(60_000);
    const keysBefore = tv.keys().length;
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    expect(r.entry.strategy).toBe("skip");
    expect(tv.keys().length).toBe(keysBefore);
    expect(r.ms).toBeLessThan(3000);
    expect(ytPlaying(tv, A.id)).toBe(true);
  });

  it("the same game after backing out to its page is launched again, warm", async () => {
    const tv = youtubeTv(ytCfg());
    const history = new LaunchHistory();
    await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    await tv.sleep(30_000);
    await tv.press("BACK"); // to the game page: not playing
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    expect(r.entry.strategy).toBe("warm");
    expect(r.ok).toBe(true);
  });
});

describe("Plex entry", () => {
  const abc = LOCALS.findIndex((c) => c.call === "ABC");
  const cbs = LOCALS.findIndex((c) => c.call === "CBS");
  const tune = (i: number) => ({ nav: "plex_guide" as const, channel: LOCALS[i].call, target: plexTarget(LOCALS[i]) });

  for (const retainCursor of [false, true]) {
    it(`switching channels from live TV: BACK, guide link, tune (guide ${retainCursor ? "keeps" : "resets"} its cursor)`, async () => {
      const tv = plex({ retainCursor });
      const history = new LaunchHistory();
      expect((await launchViaEntry(tv, tune(abc), { history })).entry.strategy).toBe("cold");
      await tv.sleep(60_000);
      expect(plexPlaying(tv, "ABC")).toBe(true);
      const r = await launchViaEntry(tv, tune(cbs), { history });
      expect(r.entry.strategy).toBe("warm");
      expect(r.entry.telemetry.attempts[0].steps).toEqual(["BACK", "link"]);
      expect(r.ok).toBe(true);
      await tv.sleep(10_000);
      expect(plexPlaying(tv, "CBS")).toBe(true);
    });
  }

  it("a Plex that ignores the warm guide link falls back to cold", async () => {
    const tv = plex({}, { warmIntent: { [PLEX_PKG]: "ignored" } });
    const history = new LaunchHistory();
    await launchViaEntry(tv, tune(abc), { history });
    await tv.sleep(60_000);
    const r = await launchViaEntry(tv, tune(cbs), { history });
    // BACK lands on the guide, but the ignored link never redraws it: warm can't confirm the link and goes cold.
    expect(strategies(r)).toEqual(["warm", "cold"]);
    expect(r.ok).toBe(true);
  });
});

describe("Prime Video entry", () => {
  it("switching games during (black, DRM) playback: just the link, warm", async () => {
    const tv = prime(primeCfg);
    const history = new LaunchHistory();
    expect((await launchViaEntry(tv, { nav: "prime_search", game: P1 }, { history })).ok).toBe(true);
    await tv.sleep(60_000);
    const r = await launchViaEntry(tv, { nav: "prime_search", game: P2 }, { history });
    expect(r.entry.strategy).toBe("warm");
    expect(r.entry.telemetry.attempts[0].steps).toEqual(["link"]);
    expect(r.ok).toBe(true);
    await tv.sleep(10_000);
    expect(primeState(tv).playing).toBe(P2.id);
  });

  it("from an open panel on the results (already 'ready' before the link): waits for the new search", async () => {
    const tv = prime(primeCfg);
    const history = new LaunchHistory();
    await launchViaEntry(tv, { nav: "prime_search", game: P1, play: false }, { history });
    expect(primeState(tv).panel).toBe("open");
    const r = await launchViaEntry(tv, { nav: "prime_search", game: P2 }, { history });
    expect(r.entry.strategy).toBe("warm");
    expect(r.ok).toBe(true);
    await tv.sleep(10_000);
    expect(primeState(tv).playing).toBe(P2.id);
  });
});

describe("switching between apps", () => {
  it("from a YouTube TV game to Prime (not running): cold; back to YouTube TV (running, in the background): warm", async () => {
    const tv = allApps({ yt: ytCfg(), prime: primeCfg });
    const history = new LaunchHistory();
    expect((await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history })).entry.strategy).toBe("cold");
    await tv.sleep(30_000);
    const p = await launchViaEntry(tv, { nav: "prime_search", game: P1 }, { history });
    expect(p.entry.strategy).toBe("cold");
    expect(p.ok).toBe(true);
    await tv.sleep(30_000);
    const y = await launchViaEntry(tv, { nav: "youtube_tv_search", game: B }, { history });
    expect(y.entry.telemetry.planReason).toBe("app running in the background");
    expect(y.ok).toBe(true);
    await tv.sleep(10_000);
    expect(ytPlaying(tv, B.id)).toBe(true);
  });

  it("from Plex live TV to YouTube TV never sends keys to Plex", async () => {
    const tv = allApps({ yt: ytCfg(), prime: primeCfg });
    const history = new LaunchHistory();
    await launchViaEntry(tv, { nav: "plex_guide", channel: "ABC", target: plexTarget(LOCALS[3]) }, { history });
    await tv.sleep(30_000);
    const keysBefore = tv.keys().length;
    const r = await launchViaEntry(tv, { nav: "youtube_tv_search", game: A }, { history });
    expect(r.entry.strategy).toBe("cold");
    expect(tv.keys().slice(keysBefore).every((k) => k.pkg !== PLEX_PKG)).toBe(true);
  });
});
