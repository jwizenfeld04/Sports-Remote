// Scenario matrix: each navigator, cold, against the simulated apps, with each perturbation, plus negative cases.
// Rates are over fixed seeds, so a regression shows up as a changed count, not a flake.

import { describe, expect, it } from "vitest";
import { LOCALS, plexTarget, primeTile, simGame, STILL_WATCHING, TEAMS, WHOS_WATCHING, type Perturbations, type SimChannel, type YtCard } from ".";
import { plexPlaying, primeState, runPlex, runPrime, runYt, ytPlaying } from "./harness";

const A = simGame("nfl:A", TEAMS.bears, TEAMS.falcons);
const OTHER = simGame("nfl:O", TEAMS.cardinalsNfl, TEAMS.rams);
const P = simGame("nfl:P", TEAMS.seahawks, TEAMS.broncos);

const PERTURBATIONS: [string, Perturbations, number][] = [
  // name, perturbation, minimum successes out of SEEDS (per navigator)
  ["clean", {}, 20],
  ["10% dropped keys", { dropKeys: { p: 0.1 } }, 17],
  ["slow loads x2", { slowLoads: 2 }, 20],
  ["slow loads x3", { slowLoads: 3 }, 20],
  ["10% misread words", { misread: 0.1 }, 17],
  ["20% black frames", { blackFrames: 0.2 }, 19],
  ["20% unreadable screenshots", { readErrors: 0.2 }, 19],
  ["still-watching popup mid-flow", { popups: [{ text: STILL_WATCHING, when: { afterKeys: 2 } }] }, 20],
  ["who's-watching popup covering the screen", { popups: [{ text: WHOS_WATCHING, when: { afterKeys: 1 }, covers: true }] }, 20],
];
const SEEDS = 20;
const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);

describe.each(PERTURBATIONS)("%s", (_name, perturb, min) => {
  it("YouTube TV: finds the game past a blocked card and another game, never watches the wrong one", async () => {
    let ok = 0;
    for (const seed of seeds) {
      const { r, tv, v } = await runYt({ cards: [{ kind: "blocked" }, { kind: "game", game: OTHER }, { kind: "game", game: A }], target: A, perturb, seed, cfg: { profilePicker: seed % 2 === 0 } });
      expect(v.wrong).toEqual([]);
      if (r.ok && ytPlaying(tv, A.id)) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(min);
  });

  it("Plex: tunes ABC from a cold guide, never tunes another channel", async () => {
    let ok = 0;
    for (const seed of seeds) {
      const { r, tv, v } = await runPlex({ target: 3, perturb, seed, cfg: { downNeedsHorizontal: seed % 3 === 0 } });
      expect(v.wrong).toEqual([]);
      if (r.ok && plexPlaying(tv, "ABC")) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(min);
  });

  it("Prime Video: slides to the second tile and plays it, never another game", async () => {
    let ok = 0;
    for (const seed of seeds) {
      const { r, tv, v } = await runPrime({ tiles: [primeTile(OTHER, true), primeTile(P, true)], target: P, play: true, perturb, seed, profilePicker: seed % 2 === 0 });
      expect(v.wrong).toEqual([]);
      if (r.ok && primeState(tv).playing === P.id) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(min);
  });
});

describe("resolution independence", () => {
  for (const resolution of [{ width: 3840, height: 2160 }, { width: 1280, height: 720 }, { width: 2560, height: 1080 }]) {
    const label = `${resolution.width}x${resolution.height}`;
    it(`YouTube TV at ${label}`, async () => {
      const { r, tv } = await runYt({ cards: [{ kind: "game", game: A }], target: A, resolution });
      expect(r.ok && ytPlaying(tv, A.id)).toBe(true);
    });
    it(`Plex at ${label} (the header is the top 44% of any frame)`, async () => {
      const { r, tv } = await runPlex({ target: 5, resolution });
      expect(r.ok && plexPlaying(tv, "MY9")).toBe(true);
    });
    it(`Prime Video at ${label} (header and panel cuts are fractions of the width)`, async () => {
      const { r, tv } = await runPrime({ tiles: [primeTile(OTHER, true), primeTile(P, true)], target: P, play: true, resolution });
      expect(r).toEqual({ ok: true, played: true });
      expect(primeState(tv).playing).toBe(P.id);
    });
  }
});

describe("YouTube TV: negative cases and look-alikes", () => {
  it("the game isn't on the service: no results, nothing pressed after the search", async () => {
    const { r, tv } = await runYt({ cards: [], noResults: true, target: A, ask: simGame("nfl:X", TEAMS.chiefs, TEAMS.raiders) });
    expect(r).toEqual({ ok: false, reason: "no_results" });
    expect(tv.keys()).toEqual([]);
  });

  it("the team's row has only other games: tries them, presses Watch on none", async () => {
    const cards: YtCard[] = [OTHER, simGame("nfl:O2", TEAMS.falcons, TEAMS.cowboys), simGame("nfl:O3", TEAMS.bears, TEAMS.eagles)].map((game) => ({ kind: "game", game }));
    const { r, v } = await runYt({ cards, target: A });
    expect(r).toEqual({ ok: false, reason: "wrong_page" });
    expect(v.watched).toEqual([]);
  });

  it("New York Giants at Arizona Cardinals (NFL) is not San Francisco Giants at St. Louis Cardinals (MLB)", async () => {
    const nfl = simGame("nfl:NYG", TEAMS.giantsNfl, TEAMS.cardinalsNfl);
    const mlb = simGame("mlb:SF", TEAMS.giantsMlb, TEAMS.cardinalsMlb);
    const { r, tv, v } = await runYt({ cards: [{ kind: "game", game: mlb }, { kind: "game", game: nfl }], target: nfl });
    expect(v.watched).toEqual([nfl.id]);
    expect(r.ok && ytPlaying(tv, nfl.id)).toBe(true);
    // ...and with only the MLB game on the service, nothing is watched.
    const only = await runYt({ cards: [{ kind: "game", game: mlb }], target: nfl });
    expect(only.r.ok).toBe(false);
    expect(only.v.watched).toEqual([]);
  });

  it("Carolina Panthers at New York Jets (NFL) is not Florida Panthers at Winnipeg Jets (NHL)", async () => {
    const nfl = simGame("nfl:CAR", TEAMS.panthersNfl, TEAMS.jetsNfl);
    const nhl = simGame("nhl:FLA", TEAMS.panthersNhl, TEAMS.jetsNhl);
    const { v } = await runYt({ cards: [{ kind: "game", game: nhl }], target: nfl });
    expect(v.watched).toEqual([]);
  });

  it("Los Angeles Rams vs the Los Angeles Chargers: the same city doesn't make it the same team", async () => {
    const rams = simGame("nfl:LAR", TEAMS.cardinalsNfl, TEAMS.rams);
    const chargers = simGame("nfl:LAC", TEAMS.cardinalsNfl, TEAMS.chargers);
    const { tv, v } = await runYt({ cards: [{ kind: "game", game: chargers }, { kind: "game", game: rams }], target: rams });
    expect(v.watched).toEqual([rams.id]);
    expect(ytPlaying(tv, rams.id)).toBe(true);
  });

  it("a card that starts a video is backed out of", async () => {
    const { r, tv, v } = await runYt({ cards: [{ kind: "video", title: "Bears highlights" }, { kind: "game", game: A }], target: A });
    expect(v.watched).toEqual([A.id]);
    expect(r.ok && ytPlaying(tv, A.id)).toBe(true);
  });

  it("KNOWN LIMITATION: a row between Top picks and the games row, with rows below the focus visible", async () => {
    // "Games row on screen and Top picks gone" is true one or two rows early when the screen shows rows below the
    // focused one. The navigator then opens a card in the wrong row and fails safely. How many rows YouTube TV
    // shows, and where the focused row sits, needs a real TV (docs/testing-navigators.md, open questions).
    const { r, v } = await runYt({ cards: [{ kind: "game", game: A }], target: A, rowsBefore: ["Top picks", "Live"] });
    expect(r.ok).toBe(false);
    expect(v.watched).toEqual([]);
  });

  it("the profile picker drops the link: the search is sent again", async () => {
    const { r, tv } = await runYt({ cards: [{ kind: "game", game: A }], target: A, cfg: { profilePicker: true, linkLostAfterProfile: true } });
    expect(r.ok && ytPlaying(tv, A.id)).toBe(true);
    expect(tv.events.filter((e) => e.type === "intent")).toHaveLength(2);
  });
});

describe("Plex: guide cases", () => {
  it("the TV's guide lags (cursor on the program that just ended): slides to the one on now", async () => {
    const { r, tv } = await runPlex({ target: 3, cfg: { startOffset: -1, tunable: [-1, 0] } });
    expect(r.ok && plexPlaying(tv, "ABC")).toBe(true);
    expect(tv.keys().map((k) => k.key)).toContain("RIGHT");
  });

  it("the server's guide is ahead of the TV's: slides back", async () => {
    const { r, tv } = await runPlex({ target: 3, cfg: { startOffset: 1, tunable: [0] } });
    expect(r.ok && plexPlaying(tv, "ABC")).toBe(true);
  });

  it("the same show on two channels (NFL on CBS and FOX): needs the matchup too", async () => {
    const { r, tv, v } = await runPlex({ target: 2 }); // FOX: NFL Football, Ravens at Browns; CBS above it also has NFL Football
    expect(v.watched).toEqual(["FOX"]);
    expect(r.ok && plexPlaying(tv, "FOX")).toBe(true);
  });

  it("a program that isn't in the guide: never tunes anything", async () => {
    const { r, v } = await runPlex({ target: 0, serverTarget: { now: { show: "Something Else Entirely" } } });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(v.watched).toEqual([]);
  });

  it("a guide whose cursor starts below the channel (opened warm, parked on the last channel): searches back up", async () => {
    const { r, tv } = await runPlex({
      target: 0,
      cfg: { retainCursor: true },
      setup: async (t, link) => {
        t.view(link, "com.plexapp.android");
        await t.sleep(20_000);
        for (let i = 0; i < 5; i++) await t.press("DOWN"); // the last row
        t.view(link, "com.plexapp.android"); // warm: the cursor stays there
      },
    });
    expect(r.ok && plexPlaying(tv, "CBS")).toBe(true);
    expect(tv.keys().map((k) => k.key)).toContain("UP");
  });

  it("a long guide (40 channels) with the channel near the end", async () => {
    const many: SimChannel[] = Array.from({ length: 40 }, (_, i) => ({ call: `CH${i}`, number: `${i + 2}.1`, programs: [{ show: `Program number ${i} tonight` }], now: 0 }));
    const { r, tv } = await runPlex({ channels: many, target: 28 });
    expect(r.ok && plexPlaying(tv, "CH28")).toBe(true);
  });

  it("SELECT on a program that isn't airing opens a menu: reported, and no second press", async () => {
    const { r, tv, v } = await runPlex({ target: 3, cfg: { tunable: [] } });
    expect(r).toEqual({ ok: false, reason: "no_playback" });
    expect(v.watched).toEqual([]);
    expect(tv.keys().filter((k) => k.key === "SELECT")).toHaveLength(1);
  });
});

describe("Prime Video: cases", () => {
  it("an upcoming game: opens its panel and stops", async () => {
    const { r, tv, v } = await runPrime({ tiles: [primeTile(P, false)], target: P, play: false });
    expect(r).toEqual({ ok: true, played: false });
    expect(v.watched).toEqual([]);
    expect(primeState(tv).panel).toBe("open");
  });

  it("the game isn't in the results: opens no tile", async () => {
    const tiles = [primeTile(OTHER, true), primeTile(simGame("x", TEAMS.chiefs, TEAMS.raiders), true)];
    const { r, tv } = await runPrime({ tiles, target: P, play: true });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(tv.marks("open_tile")).toEqual([]);
  });

  it("a panel that names another league's Giants and Cardinals is never played", async () => {
    const nfl = simGame("nfl:NYG", TEAMS.giantsNfl, TEAMS.cardinalsNfl);
    const tile = { ...primeTile(simGame("mlb:SF", TEAMS.giantsMlb, TEAMS.cardinalsMlb), true), panelTitle: "San Francisco Giants vs. St. Louis Cardinals" };
    const { r, v } = await runPrime({ tiles: [tile], target: nfl, play: true });
    expect(r.ok).toBe(false);
    expect(v.watched).toEqual([]);
  });
});

describe("timing", () => {
  it("a clean cold YouTube TV route takes tens of seconds of TV time (the reason warm entry exists)", async () => {
    const { tv } = await runYt({ cards: [{ kind: "game", game: A }], target: A, cfg: { profilePicker: true } });
    const watch = tv.marks("watch")[0];
    expect(watch.t).toBeGreaterThan(15_000);
  });

  it("LOCALS fixture is what the Plex cases assume", () => {
    expect(LOCALS.map((c) => c.call)).toEqual(["CBS", "NBC", "FOX", "ABC", "PIX11", "MY9"]);
    expect(plexTarget(LOCALS[3]).now.show).toBe("Nightline");
  });
});
