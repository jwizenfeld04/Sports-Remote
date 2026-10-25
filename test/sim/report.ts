// Success-rate table: each navigator x each perturbation over N seeds, cold start.
//
//   npx tsx test/sim/report.ts [seeds=60]
//
// Not a test (it asserts nothing); use it to see where navigators struggle before and after a change, then pin the
// numbers you care about in navigators.test.ts. "wrong" counts Watch/tune presses on anything but the target and
// must always be 0.

import { primeTile, simGame, STILL_WATCHING, TEAMS, WHOS_WATCHING, type Perturbations } from "./index";
import { plexPlaying, primeState, runPlex, runPrime, runYt, ytPlaying } from "./harness";

const N = Number(process.argv[2] ?? 60);
const g = simGame("nfl:1", TEAMS.bears, TEAMS.falcons);
const other = simGame("nfl:9", TEAMS.cardinalsNfl, TEAMS.rams);
const pg = simGame("nfl:2", TEAMS.seahawks, TEAMS.broncos);

const P: Record<string, Perturbations> = {
  none: {},
  "drop 10%": { dropKeys: { p: 0.1 } },
  "drop 25%": { dropKeys: { p: 0.25 } },
  "slow x2": { slowLoads: 2 },
  "slow x3": { slowLoads: 3 },
  "misread 10%": { misread: 0.1 },
  "misread 30%": { misread: 0.3 },
  "black 20%": { blackFrames: 0.2 },
  "read errors 20%": { readErrors: 0.2 },
  "still watching": { popups: [{ text: STILL_WATCHING, when: { afterKeys: 2 } }] },
  "who's watching": { popups: [{ text: WHOS_WATCHING, when: { afterKeys: 1 }, covers: true }] },
};

const pct = (n: number) => `${String(Math.round((100 * n) / N)).padStart(3)}%`;
console.log(`${"perturbation".padEnd(16)} ${"YouTube TV".padEnd(11)} ${"Plex".padEnd(11)} ${"Prime".padEnd(11)} wrong`);
for (const [name, perturb] of Object.entries(P)) {
  let yt = 0, pl = 0, pr = 0, wrong = 0;
  for (let seed = 1; seed <= N; seed++) {
    const a = await runYt({ cards: [{ kind: "blocked" }, { kind: "game", game: other }, { kind: "game", game: g }], target: g, perturb, seed, cfg: { profilePicker: seed % 2 === 0 } });
    if (a.r.ok && ytPlaying(a.tv, g.id)) yt++;
    const b = await runPlex({ target: 3, perturb, seed, cfg: { downNeedsHorizontal: seed % 3 === 0 } });
    if (b.r.ok && plexPlaying(b.tv, "ABC")) pl++;
    const c = await runPrime({ tiles: [primeTile(other, true), primeTile(pg, true)], target: pg, play: true, perturb, seed, profilePicker: seed % 2 === 0 });
    if (c.r.ok && primeState(c.tv).playing === pg.id) pr++;
    wrong += a.v.wrong.length + b.v.wrong.length + c.v.wrong.length;
  }
  console.log(`${name.padEnd(16)} ${pct(yt).padEnd(11)} ${pct(pl).padEnd(11)} ${pct(pr).padEnd(11)} ${wrong}`);
}
