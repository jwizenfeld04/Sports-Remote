// FireTvAdbDriver.launch() end to end against the simulated TV: the real driver, the real navigators, the
// simulator's AdbExec and screenshots. This is today's cold behavior (force-stop before every navigator route);
// the last test shows what the entry layer saves when it's wired in.

import { describe, expect, it } from "vitest";
import { FireTvAdbDriver } from "../../server/driver";
import { APP_BY_ID } from "../../lib/catalog/apps";
import type { PlexClient } from "../../server/plex";
import type { LaunchRoute } from "../../lib/types";
import { LaunchHistory } from "../../server/navigation/entry";
import {
  allApps, LOCALS, plexTarget, PLEX_PKG, primeTile, PRIME_PKG, serverGame, simGame, TEAMS, ytQueryFor, ytSearch, YTTV_PKG, type SimTv,
} from ".";
import { plexPlaying, primeState, ytPlaying } from "./harness";
import { launchViaEntry } from "./launch";

const A = simGame("nfl:A", TEAMS.bears, TEAMS.falcons);
const B = simGame("nfl:B", TEAMS.cowboys, TEAMS.eagles);
const P = simGame("nfl:P", TEAMS.seahawks, TEAMS.broncos);

function tvWithApps(o: { resolution?: { width: number; height: number } } = {}) {
  return allApps(
    {
      yt: { search: ytSearch({ [ytQueryFor(A)]: { cards: [{ kind: "game", game: A }] }, [ytQueryFor(B)]: { cards: [{ kind: "game", game: B }] } }), profilePicker: true },
      prime: { search: () => [primeTile(P, true)], profilePicker: true },
    },
    { resolution: o.resolution },
  );
}

function driverFor(tv: SimTv, plexChannel = 3, warmEntry = true) {
  const plex = {
    dvrKey: async () => "2",
    around: async () => plexTarget(LOCALS[plexChannel]),
    channelFor: async () => null,
  } as unknown as PlexClient;
  return new FireTvAdbDriver({
    serial: tv.serial, exec: tv.adbExec(), apps: () => APP_BY_ID, plex, screen: tv.driverScreen(),
    sleep: (ms) => tv.sleep(ms), now: tv.clock.now, verifyTimeoutMs: 5000, warmEntry,
  });
}

const IDS: Record<string, string> = { youtube_st: "youtube_tv", prime: "prime_video" };
const route = (service: string, network: LaunchRoute["network"], level: LaunchRoute["level"]): LaunchRoute => ({ service: IDS[service] ?? service, network, level, reason: "sim", certain: true });
const req = (game: ReturnType<typeof serverGame>, r: LaunchRoute) => ({ requestId: "7a1d2c3e-0000-4000-8000-0000000000aa", game, route: r, wake: true });

describe("driver.launch() on the simulated TV", () => {
  it("YouTube TV: force-stop, search link, profile, game card, Watch now", async () => {
    const tv = tvWithApps();
    const r = await driverFor(tv).launch(req(serverGame(A), route("youtube_st", "fox", "game")));
    expect(r).toMatchObject({ ok: true, level: "game", outcome: "game" });
    const stop = tv.events.findIndex((e) => e.type === "force-stop" && e.pkg === YTTV_PKG);
    const link = tv.events.findIndex((e) => e.type === "intent" && e.uri.startsWith("youtubetv://search"));
    expect(link).toBeGreaterThan(-1);
    // Not running yet, so force-stop had nothing to stop: no event, and the link cold-started it.
    expect(stop).toBe(-1);
    await tv.sleep(10_000);
    expect(ytPlaying(tv, A.id)).toBe(true);
  });

  it("YouTube TV, switching A -> B: the driver switches inside the running app instead of restarting it", async () => {
    const switchOnce = async (warmEntry: boolean) => {
      const tv = tvWithApps();
      const d = driverFor(tv, 3, warmEntry);
      await d.launch(req(serverGame(A), route("youtube_st", "fox", "game")));
      await tv.sleep(60_000);
      const stopsBefore = tv.events.filter((e) => e.type === "force-stop").length;
      const t0 = tv.clock.now();
      const r = await d.launch(req(serverGame(B), route("youtube_st", "fox", "game")));
      const ms = tv.clock.now() - t0;
      await tv.sleep(10_000);
      return { r, ms, restarted: tv.events.filter((e) => e.type === "force-stop").length > stopsBefore, playing: ytPlaying(tv, B.id) };
    };
    const warm = await switchOnce(true);
    const cold = await switchOnce(false);
    expect(warm).toMatchObject({ restarted: false, playing: true, r: { ok: true, level: "game" } });
    expect(cold).toMatchObject({ restarted: true, playing: true });
    expect(warm.ms).toBeLessThan(cold.ms);
  });

  it("asking for the game that's already playing leaves it alone", async () => {
    const tv = tvWithApps();
    const d = driverFor(tv);
    await d.launch(req(serverGame(A), route("youtube_st", "fox", "game")));
    await tv.sleep(60_000);
    const keysBefore = tv.keys().length;
    const r = await d.launch(req(serverGame(A), route("youtube_st", "fox", "game")));
    expect(r.ok).toBe(true);
    expect(tv.keys().length - keysBefore).toBeLessThanOrEqual(1); // at most the wake key
    expect(ytPlaying(tv, A.id)).toBe(true);
  });

  it("Plex: guide link after a cold start, down to ABC, SELECT", async () => {
    const tv = tvWithApps();
    const r = await driverFor(tv, 3).launch(req(serverGame(A, { state: "in" }), route("plex", "abc", "channel")));
    expect(r).toMatchObject({ ok: true, level: "channel" });
    expect(tv.events.some((e) => e.type === "intent" && e.uri === "plex://live-tv/dvr.guide/ota/2" && e.pkg === PLEX_PKG)).toBe(true);
    await tv.sleep(10_000);
    expect(plexPlaying(tv, "ABC")).toBe(true);
  });

  it("Prime Video: search, tile, panel, Watch Live for a live game", async () => {
    const tv = tvWithApps();
    const r = await driverFor(tv).launch(req(serverGame(P, { state: "in" }), route("prime", "prime", "game")));
    expect(r).toMatchObject({ ok: true, level: "game" });
    expect(tv.events.some((e) => e.type === "intent" && e.pkg === PRIME_PKG && e.uri.includes("phrase=Seahawks%20Broncos"))).toBe(true);
    await tv.sleep(10_000);
    expect(primeState(tv).playing).toBe(P.id);
  });

  it("on a 4K TV (3840x2160 screenshots) every navigator still works through the driver", async () => {
    const tv = tvWithApps({ resolution: { width: 3840, height: 2160 } });
    const d = driverFor(tv, 5);
    expect((await d.launch(req(serverGame(A), route("youtube_st", "fox", "game")))).level).toBe("game");
    await tv.sleep(30_000);
    expect((await d.launch(req(serverGame(A, { state: "in" }), route("plex", "fox", "channel")))).level).toBe("channel");
    await tv.sleep(30_000);
    expect((await d.launch(req(serverGame(P, { state: "in" }), route("prime", "prime", "game")))).level).toBe("game");
    await tv.sleep(10_000);
    expect(primeState(tv).playing).toBe(P.id);
  });

  it("the game isn't on YouTube TV: the driver falls back to the Live link, then the app, never pressing Watch", async () => {
    const tv = tvWithApps();
    const r = await driverFor(tv).launch(req(serverGame(simGame("nfl:X", TEAMS.chiefs, TEAMS.raiders)), route("youtube_st", "fox", "game")));
    expect(r.level).not.toBe("game");
    expect(r.attempts[0]).toMatchObject({ level: "game", ok: false, error: "no_results" });
    expect(tv.marks("watch")).toEqual([]);
  });
});
