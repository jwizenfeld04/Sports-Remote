// enterApp() + a navigator against a simulated TV: what driver.launch() does for a navigator route once it is
// wired to the entry layer (see docs/testing-navigators.md, "Wiring entry into the driver").

import { shellArgs } from "../../server/adb";
import { enterApp, type EntryDeps, type EntryResult, type LaunchHistory, type NavigatorId } from "../../server/navigation/entry";
import { openGameViaSearch } from "../../server/youtubeTv";
import { tuneViaGuide, type PlexTarget } from "../../server/plexGuide";
import { openPrimeGame } from "../../server/primeVideo";
import type { SimTv } from "./tv";
import { navTeams, plexLink, PLEX_PKG, primeLink, primePhrase, PRIME_PKG, ytLink, ytQueryFor, YTTV_PKG, type SimGame } from ".";

export function entryDeps(tv: SimTv): EntryDeps {
  const exec = tv.adbExec();
  return {
    shell: (argv, t) => exec(shellArgs(tv.serial, argv), t),
    read: () => tv.readText(),
    sleep: (ms) => tv.sleep(ms),
    now: tv.clock.now,
  };
}

export type SimLaunch =
  | { nav: "youtube_tv_search"; game: SimGame }
  | { nav: "prime_search"; game: SimGame; play?: boolean }
  | { nav: "plex_guide"; channel: string; target: PlexTarget };

const PKG: Record<NavigatorId, string> = { youtube_tv_search: YTTV_PKG, plex_guide: PLEX_PKG, prime_search: PRIME_PKG };
const SERVICE: Record<NavigatorId, string> = { youtube_tv_search: "youtube_st", plex_guide: "plex", prime_search: "prime" };

export interface SimLaunchResult {
  ok: boolean;
  entry: EntryResult;
  nav?: { ok: boolean; reason?: string };
  ms: number;
}

/** Enter the app (skip / warm / cold), drive it, and record a success in `history`. */
export async function launchViaEntry(tv: SimTv, l: SimLaunch, o: { history?: LaunchHistory; allowWarm?: boolean; readyTimeoutMs?: number } = {}): Promise<SimLaunchResult> {
  const t0 = tv.clock.now();
  const pkg = PKG[l.nav];
  const gameId = l.nav === "plex_guide" ? `channel:${l.channel}` : l.game.id;
  const uri = l.nav === "youtube_tv_search" ? ytLink(ytQueryFor(l.game)) : l.nav === "prime_search" ? primeLink(primePhrase(l.game)) : plexLink();
  const entry = await enterApp(entryDeps(tv), {
    navigator: l.nav, pkg, uri, service: SERVICE[l.nav], gameId, tvId: tv.serial,
    last: o.history?.last(tv.serial) ?? null, allowWarm: o.allowWarm, readyTimeoutMs: o.readyTimeoutMs,
  });
  const done = (ok: boolean, nav?: SimLaunchResult["nav"]): SimLaunchResult => {
    if (ok) o.history?.record({ gameId, service: SERVICE[l.nav], tvId: tv.serial, at: tv.clock.now() });
    return { ok, entry, nav, ms: tv.clock.now() - t0 };
  };
  if (entry.strategy === "skip") return done(true);
  if (!entry.linkOk) return done(false);
  if (l.nav === "youtube_tv_search") {
    const r = await openGameViaSearch(tv.navDeps({ reopenUri: uri, pkg }), navTeams(l.game));
    return done(r.ok, r.ok ? { ok: true } : { ok: false, reason: r.reason });
  }
  if (l.nav === "prime_search") {
    const r = await openPrimeGame(tv.primeDeps(), navTeams(l.game), { play: l.play ?? true });
    return done(r.ok, r.ok ? { ok: true } : { ok: false, reason: r.reason });
  }
  const r = await tuneViaGuide(tv.plexDeps(), l.target);
  return done(r.ok, r.ok ? { ok: true } : { ok: false, reason: r.reason });
}
