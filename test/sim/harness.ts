// Run one navigator against one simulated TV and judge the outcome against the truth.

import { openGameViaSearch, type NavResult } from "../../server/youtubeTv";
import { tuneViaGuide, type PlexNavResult, type PlexTarget } from "../../server/plexGuide";
import { openPrimeGame, type PrimeNavResult } from "../../server/primeVideo";
import {
  LOCALS, navTeams, plex, plexLink, plexTarget, PLEX_PKG, prime, primeLink, primePhrase, PRIME_PKG, youtubeTv, ytLink, ytQueryFor, ytSearch, YTTV_PKG,
  type Perturbations, type PlexConfig, type PrimeTile, type SimChannel, type SimGame, type SimTv, type YtCard, type YtConfig,
} from ".";

export interface Verdict {
  /** Every "watch" (Watch now / Watch Live / tune) the TV saw, by content id. */
  watched: unknown[];
  /** Watches of anything but the target. Must always be empty. */
  wrong: unknown[];
  ms: number;
}

function verdict(tv: SimTv, target: string, t0: number): Verdict {
  const watched = tv.marks("watch").map((m) => m.data);
  return { watched, wrong: watched.filter((w) => w !== target), ms: tv.clock.now() - t0 };
}

export interface YtRun {
  cards: YtCard[];
  target: SimGame;
  /** The game the server asks for (default: the target). Differs in negative cases. */
  ask?: SimGame;
  perturb?: Perturbations;
  seed?: number;
  resolution?: { width: number; height: number };
  cfg?: Partial<YtConfig>;
  rowsBefore?: string[];
  /** The search finds nothing at all (the game isn't on the service). */
  noResults?: boolean;
  /** Start state: "cold" sends the link to a stopped app; a function can set the TV up first. */
  setup?: (tv: SimTv, link: string) => Promise<void> | void;
}

export async function runYt(o: YtRun): Promise<{ r: NavResult; tv: SimTv; v: Verdict }> {
  const ask = o.ask ?? o.target;
  const query = ytQueryFor(ask);
  const link = ytLink(query);
  const tv = youtubeTv(
    { search: ytSearch(o.noResults ? {} : { [query]: { cards: o.cards, rowsBefore: o.rowsBefore } }), ...o.cfg },
    { seed: o.seed, perturb: o.perturb, resolution: o.resolution },
  );
  if (o.setup) await o.setup(tv, link);
  else tv.view(link, YTTV_PKG);
  const t0 = tv.clock.now();
  const r = await openGameViaSearch(tv.navDeps({ reopenUri: link, pkg: YTTV_PKG }), navTeams(ask));
  await tv.sleep(20_000); // let playback start (slow loads included)
  return { r, tv, v: verdict(tv, ask.id, t0) };
}

export interface PlexRun {
  channels?: SimChannel[];
  /** Index of the channel to tune. */
  target: number;
  perturb?: Perturbations;
  seed?: number;
  resolution?: { width: number; height: number };
  cfg?: Partial<PlexConfig>;
  /** What the server's guide says (default: the channel's real programs). */
  serverTarget?: PlexTarget;
  setup?: (tv: SimTv, link: string) => Promise<void> | void;
}

export async function runPlex(o: PlexRun): Promise<{ r: PlexNavResult; tv: SimTv; v: Verdict }> {
  const channels = o.channels ?? LOCALS;
  const tv = plex({ channels, ...o.cfg }, { seed: o.seed, perturb: o.perturb, resolution: o.resolution });
  const link = plexLink();
  if (o.setup) await o.setup(tv, link);
  else tv.view(link, PLEX_PKG);
  const t0 = tv.clock.now();
  const r = await tuneViaGuide(tv.plexDeps(), o.serverTarget ?? plexTarget(channels[o.target]));
  await tv.sleep(20_000);
  return { r, tv, v: verdict(tv, channels[o.target].call, t0) };
}

export interface PrimeRun {
  tiles: PrimeTile[];
  target: SimGame;
  ask?: SimGame;
  play: boolean;
  perturb?: Perturbations;
  seed?: number;
  resolution?: { width: number; height: number };
  profilePicker?: boolean;
  setup?: (tv: SimTv, link: string) => Promise<void> | void;
}

export async function runPrime(o: PrimeRun): Promise<{ r: PrimeNavResult; tv: SimTv; v: Verdict }> {
  const ask = o.ask ?? o.target;
  const link = primeLink(primePhrase(ask));
  const tv = prime({ search: () => o.tiles, profilePicker: o.profilePicker }, { seed: o.seed, perturb: o.perturb, resolution: o.resolution });
  if (o.setup) await o.setup(tv, link);
  else tv.view(link, PRIME_PKG);
  const t0 = tv.clock.now();
  const r = await openPrimeGame(tv.primeDeps(), navTeams(ask), { play: o.play });
  await tv.sleep(20_000);
  return { r, tv, v: verdict(tv, ask.id, t0) };
}

/** Is the target on screen as the navigator claims? */
export function ytPlaying(tv: SimTv, id: string) {
  const a = tv.app(YTTV_PKG);
  return tv.foreground === YTTV_PKG && a?.screen === "playback" && a.vars.playing === id;
}
export function plexPlaying(tv: SimTv, call: string) {
  const a = tv.app(PLEX_PKG);
  return tv.foreground === PLEX_PKG && a?.screen === "live" && a.vars.playing === call;
}
export function primeState(tv: SimTv) {
  const a = tv.app(PRIME_PKG);
  return { screen: a?.screen, playing: a?.vars.playing ?? null, panel: a?.vars.panel };
}
