import { useDeferredValue, useMemo } from "react";
import type { Game, League } from "../../lib/types";
import { LEAGUES } from "../../lib/types";
import type { Market, OwnedSubscription } from "../../lib/profile";
import { coverage, gainFrom, sampleWeek, type CoverageReport } from "../../lib/coverage";
import type { ResolveContext } from "../../lib/resolve";
import type { Platform } from "../../lib/catalog/apps";

export type Sample = "week" | "typical";

export interface CoverageInput {
  market: Pick<Market, "localTeams" | "localSources">;
  subscriptions: OwnedSubscription[];
  tveSignIns: string[];
  favorites: string[];
  platform?: Platform;
}

/**
 * Games to measure against: this week's real schedule for leagues that are playing, and a typical week
 * (from the 2026 rights) for leagues that are off or barely listed yet. "typical" uses the sample for all.
 */
export function sampleGames(real: Game[], localTeams: string[], mode: Sample, now = Date.now()): { games: Game[]; realLeagues: League[] } {
  const typical = sampleWeek(localTeams);
  if (mode === "typical") return { games: typical, realLeagues: [] };
  const soon = real.filter((g) => g.state !== "post" && Date.parse(g.startTime) - now < 7 * 86400_000);
  const realLeagues = LEAGUES.filter((l) => soon.filter((g) => g.league === l).length >= 8);
  return {
    games: [...soon.filter((g) => realLeagues.includes(g.league)), ...typical.filter((g) => !realLeagues.includes(g.league))],
    realLeagues,
  };
}

export function contextFor(input: CoverageInput): ResolveContext {
  return {
    household: { market: input.market, subscriptions: input.subscriptions, tveSignIns: input.tveSignIns, servicePriority: {} },
    platform: input.platform ?? "firetv",
    installedApps: null,
    guide: null,
  };
}

/** Coverage for the draft household, recomputed as it changes (deferred so ticking boxes stays snappy). */
export function useCoverage(input: CoverageInput, games: Game[]): { report: CoverageReport; ctx: ResolveContext; gain: (id: string, tier?: string) => number } {
  const deferred = useDeferredValue(input);
  const ctx = useMemo(() => contextFor(deferred), [deferred]);
  const report = useMemo(() => coverage(games, ctx, deferred.favorites), [games, ctx, deferred.favorites]);
  const gain = useMemo(() => {
    const memo = new Map<string, number>();
    return (id: string, tier?: string) => {
      const k = `${id}|${tier ?? ""}`;
      if (!memo.has(k)) memo.set(k, gainFrom(games, ctx, id, tier, report.perGame));
      return memo.get(k)!;
    };
  }, [games, ctx, report]);
  return { report, ctx, gain };
}
