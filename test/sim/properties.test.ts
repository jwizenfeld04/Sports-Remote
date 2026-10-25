// Properties over many seeded random runs: random card/tile/guide layouts (including look-alike teams), random
// perturbations, random start states. Whatever happens, the navigators must never start the wrong game, and when
// they say "ok" the right thing must have happened.

import { describe, expect, it } from "vitest";
import { LOCALS, plexTarget, primeTile, seeded, simGame, STILL_WATCHING, TEAMS, WHOS_WATCHING, type Perturbations, type SimGame, type YtCard } from ".";
import { plexPlaying, primeState, runPlex, runPrime, runYt, ytPlaying } from "./harness";
import { trace } from "./trace";

// On failure, the message carries the seed and the whole TV trace (keys, screens, OCR text) to replay it.
const explain = (seed: number, tv: Parameters<typeof trace>[0]) => `seed ${seed}\n${trace(tv, { reads: true })}`;

const RUNS = Number(process.env.SIM_RUNS ?? 150);

function randomPerturb(rnd: () => number): Perturbations {
  const p: Perturbations = {};
  if (rnd() < 0.5) p.dropKeys = { p: rnd() * 0.3 };
  if (rnd() < 0.5) p.misread = rnd() * 0.25;
  if (rnd() < 0.4) p.blackFrames = rnd() * 0.3;
  if (rnd() < 0.3) p.readErrors = rnd() * 0.2;
  if (rnd() < 0.4) p.slowLoads = 1 + rnd() * 2;
  if (rnd() < 0.3) p.popups = [{ text: rnd() < 0.5 ? STILL_WATCHING : WHOS_WATCHING, when: { afterKeys: Math.floor(rnd() * 8) }, covers: rnd() < 0.5 }];
  return p;
}

const pick = <T,>(rnd: () => number, xs: T[]) => xs[Math.floor(rnd() * xs.length)];

// Targets, each with look-alikes that share a nickname, a city, or one team.
const CASES: { target: SimGame; decoys: SimGame[] }[] = [
  { target: simGame("nfl:A", TEAMS.bears, TEAMS.falcons), decoys: [simGame("d1", TEAMS.bears, TEAMS.eagles), simGame("d2", TEAMS.cowboys, TEAMS.falcons)] },
  {
    target: simGame("nfl:NYG", TEAMS.giantsNfl, TEAMS.cardinalsNfl),
    decoys: [simGame("mlb:SF", TEAMS.giantsMlb, TEAMS.cardinalsMlb), simGame("mlb:SF2", TEAMS.cardinalsMlb, TEAMS.giantsMlb), simGame("d3", TEAMS.giantsNfl, TEAMS.eagles)],
  },
  { target: simGame("nfl:CAR", TEAMS.panthersNfl, TEAMS.jetsNfl), decoys: [simGame("nhl:FLA", TEAMS.panthersNhl, TEAMS.jetsNhl), simGame("d4", TEAMS.jetsNfl, TEAMS.panthersNfl)] },
  { target: simGame("nfl:LAR", TEAMS.seahawks, TEAMS.rams), decoys: [simGame("d5", TEAMS.seahawks, TEAMS.chargers), simGame("d6", TEAMS.niners, TEAMS.rams)] },
];

describe("properties: YouTube TV", () => {
  it(`never presses Watch on a page that doesn't name both teams, over ${RUNS} random runs`, async () => {
    let oks = 0;
    let present = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const rnd = seeded(seed * 7919);
      const c = pick(rnd, CASES);
      const n = 1 + Math.floor(rnd() * 5);
      const cards: YtCard[] = Array.from({ length: n }, () => {
        const x = rnd();
        return x < 0.25 ? { kind: "blocked" } : x < 0.35 ? { kind: "video", title: "Highlights" } : { kind: "game", game: pick(rnd, c.decoys) };
      });
      const hasTarget = rnd() < 0.75;
      if (hasTarget) cards.splice(Math.floor(rnd() * (cards.length + 1)), 0, { kind: "game", game: c.target });
      const { r, tv, v } = await runYt({ cards, target: c.target, perturb: randomPerturb(rnd), seed, cfg: { profilePicker: rnd() < 0.5, linkLostAfterProfile: rnd() < 0.2 } });
      const why = explain(seed, tv);
      expect(v.wrong, why).toEqual([]);
      if (!hasTarget) expect(r.ok, why).toBe(false);
      if (r.ok) {
        // ok means the target's own page was confirmed and Watch pressed; it plays unless every Watch press was lost.
        const lostWatch = tv.keys().some((k) => k.key === "SELECT" && !k.delivered && k.screen === "gamepage");
        expect(ytPlaying(tv, c.target.id) || lostWatch, why).toBe(true);
        oks++;
      }
      if (hasTarget) present++;
    }
    // Under these (heavy) random perturbations most runs with the game present still get there.
    expect(oks / present).toBeGreaterThan(0.6);
  }, 60_000);
});

describe("properties: Plex", () => {
  it(`only ever tunes the target channel, over ${RUNS} random runs`, async () => {
    let oks = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const rnd = seeded(seed * 104729);
      const target = Math.floor(rnd() * LOCALS.length);
      const lag = rnd() < 0.3;
      const { r, tv, v } = await runPlex({
        target, perturb: randomPerturb(rnd), seed,
        cfg: { downNeedsHorizontal: rnd() < 0.3, startOffset: lag ? -1 : 0, tunable: lag ? [-1, 0] : [0] },
      });
      const why = explain(seed, tv);
      expect(v.wrong, why).toEqual([]);
      if (r.ok) {
        expect(plexPlaying(tv, LOCALS[target].call) || tv.keys().some((k) => k.key === "SELECT" && !k.delivered), why).toBe(true);
        oks++;
      }
    }
    expect(oks / RUNS).toBeGreaterThan(0.7);
  }, 60_000);

  it("never tunes anything for a program that isn't on", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = seeded(seed);
      const { r, v } = await runPlex({ target: 0, serverTarget: { now: { show: "Monday Night Countdown" } }, perturb: randomPerturb(rnd), seed });
      expect(r.ok, `seed ${seed}`).toBe(false);
      expect(v.watched, `seed ${seed}`).toEqual([]);
    }
  }, 60_000);

  it("the LOCALS fixture has distinct programs (so 'the right program' means 'the right channel')", () => {
    const now = LOCALS.map((c) => plexTarget(c).now.show + (plexTarget(c).now.episode ?? ""));
    expect(new Set(now).size).toBe(now.length);
  });
});

describe("properties: Prime Video", () => {
  it(`never opens a tile or presses Watch Live for another game, over ${RUNS} random runs`, async () => {
    let oks = 0;
    let present = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const rnd = seeded(seed * 15485863);
      const c = pick(rnd, CASES.filter((x) => x.target.id !== "nfl:NYG" && x.target.id !== "nfl:CAR")); // nickname-only tiles can't tell leagues apart (see docs)
      const tiles = Array.from({ length: Math.floor(rnd() * 4) }, () => primeTile(pick(rnd, c.decoys), rnd() < 0.5));
      const hasTarget = rnd() < 0.75;
      const live = rnd() < 0.6;
      if (hasTarget) tiles.splice(Math.floor(rnd() * Math.min(3, tiles.length + 1)), 0, primeTile(c.target, live));
      const { r, tv, v } = await runPrime({ tiles, target: c.target, play: live, perturb: randomPerturb(rnd), seed, profilePicker: rnd() < 0.5 });
      const why = explain(seed, tv);
      expect(v.wrong, why).toEqual([]);
      expect(tv.marks("open_tile").map((m) => m.data).filter((id) => id !== c.target.id), why).toEqual([]);
      if (!hasTarget) expect(r.ok, why).toBe(false);
      if (r.ok && hasTarget) {
        oks++;
        if (r.played) expect(primeState(tv).playing === c.target.id || tv.keys().some((k) => k.key === "SELECT" && !k.delivered), why).toBe(true);
      }
      if (hasTarget) present++;
    }
    expect(oks / present).toBeGreaterThan(0.6);
  }, 60_000);
});
