import type { Broadcast, Game, League, TeamRef } from "./types";
import { LEAGUES } from "./types";
import { resolveGame, type Household, type ResolveContext } from "./resolve";
import { TEAMS } from "./catalog/teams";
import { LOCAL_TEAMS } from "./catalog/localTeams";
import { SUBSCRIPTION_BY_ID } from "./catalog/subscriptions";
import { NETWORK_LABEL, OUTLET_LABEL, type NetworkId, type OutletId } from "./catalog/networks";
import { teamKey } from "./teams";

// "Can I watch what I care about?" Runs the resolver over a set of games (this week's real schedule, or a
// typical week built from the 2026 rights) and summarizes it for the setup and coverage screens.

export type GameCoverage = "yes" | "maybe" | "no";

export interface Gap {
  need: string; // "Peacock", "NBA League Pass", "MSG"
  games: number;
  examples: string[]; // "BOS @ NY"
  fixes: { id: string; name: string; tier?: string; certain: boolean; adds: number }[];
}

export interface CoverageReport {
  total: number;
  yes: number;
  maybe: number;
  no: number;
  byLeague: Partial<Record<League, { total: number; yes: number; maybe: number }>>;
  favorites: { team: string; label: string; total: number; yes: number; maybe: number }[];
  gaps: Gap[];
  perGame: Map<string, { status: GameCoverage; app?: string; level?: string }>;
}

const status = (g: Game, ctx: ResolveContext): { status: GameCoverage; app?: string; level?: string } => {
  const r = resolveGame(g, ctx);
  const top = r.routes[0];
  if (!top) return { status: "no" };
  return { status: r.routes.some((x) => x.certain) ? "yes" : "maybe", app: top.service, level: top.level };
};

const matchup = (g: Game) => `${g.away.abbr} @ ${g.home.abbr}`;

export function coverage(games: Game[], ctx: ResolveContext, favorites: string[] = []): CoverageReport {
  const perGame = new Map<string, { status: GameCoverage; app?: string; level?: string }>();
  const byLeague: CoverageReport["byLeague"] = {};
  const gapMap = new Map<string, { games: Game[]; suggestions: Map<string, { tier?: string; certain: boolean }> }>();
  let yes = 0, maybe = 0, no = 0;

  for (const g of games) {
    const r = resolveGame(g, ctx);
    const s: GameCoverage = r.routes.length === 0 ? "no" : r.routes.some((x) => x.certain) ? "yes" : "maybe";
    perGame.set(g.id, { status: s, app: r.routes[0]?.service, level: r.routes[0]?.level });
    const L = (byLeague[g.league] ??= { total: 0, yes: 0, maybe: 0 });
    L.total++;
    if (s === "yes") (yes++, L.yes++);
    else if (s === "maybe") (maybe++, L.maybe++);
    else no++;
    if (s !== "no" || !r.notCovered || r.notCovered.network === "TBD") continue;
    const key = r.notCovered.network;
    const gap = gapMap.get(key) ?? { games: [] as Game[], suggestions: new Map<string, { tier?: string; certain: boolean }>() };
    gap.games.push(g);
    for (const sug of r.notCovered.suggestions) if (!gap.suggestions.has(sug.id)) gap.suggestions.set(sug.id, { tier: sug.tier, certain: sug.certain });
    gapMap.set(key, gap);
  }

  const owned = new Set(ctx.household.subscriptions.map((s) => s.id));
  const gaps: Gap[] = [...gapMap.entries()]
    .map(([need, v]) => ({
      need,
      games: v.games.length,
      examples: v.games.slice(0, 3).map(matchup),
      fixes: [...v.suggestions.entries()]
        .filter(([id]) => !owned.has(id))
        .map(([id, s]) => {
          const def = SUBSCRIPTION_BY_ID.get(id)!;
          return { id, name: def.name, tier: s.tier, certain: s.certain, adds: gainFrom(games, ctx, id, s.tier, perGame) };
        })
        .sort((a, b) => b.adds - a.adds || Number(b.certain) - Number(a.certain))
        .slice(0, 4),
    }))
    .sort((a, b) => b.games - a.games);

  const favs = favorites.map((key) => {
    const mine = games.filter((g) => teamKey(g.league, g.home) === key || teamKey(g.league, g.away) === key);
    const t = TEAMS.find((x) => x.key === key);
    return {
      team: key,
      label: t?.displayName ?? key,
      total: mine.length,
      yes: mine.filter((g) => perGame.get(g.id)?.status === "yes").length,
      maybe: mine.filter((g) => perGame.get(g.id)?.status === "maybe").length,
    };
  });

  return { total: games.length, yes, maybe, no, byLeague, favorites: favs, gaps, perGame };
}

/** How many games that aren't watchable now would become watchable with one more subscription. */
export function gainFrom(
  games: Game[], ctx: ResolveContext, id: string, tier?: string,
  current?: Map<string, { status: GameCoverage }>,
): number {
  const h: Household = { ...ctx.household, subscriptions: [...ctx.household.subscriptions.filter((s) => s.id !== id), { id, tier, addOns: [] }] };
  const next: ResolveContext = { ...ctx, household: h };
  let n = 0;
  for (const g of games) {
    const before = current?.get(g.id)?.status ?? status(g, ctx).status;
    if (before === "yes") continue;
    const after = status(g, next).status;
    if (after === "yes" || (after === "maybe" && before === "no")) n++;
  }
  return n;
}

// ---------- A typical week, for leagues without games on the schedule right now ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const teamRef = (key: string): TeamRef => {
  const t = TEAMS.find((x) => x.key === key)!;
  return { id: t.key, abbr: t.abbr, name: t.name, city: t.city, displayName: t.displayName, color: t.color, alternateColor: t.alternateColor };
};

const nat = (network: NetworkId, raw = NETWORK_LABEL[network], kind: Broadcast["kind"] = "tv"): Broadcast => ({ network, raw, scope: "national", regional: false, kind });
const loc = (outlet: OutletId, scope: "home" | "away"): Broadcast => ({ network: "local", outlet, raw: OUTLET_LABEL[outlet], scope, regional: true, kind: "tv" });

/** Each league's regular-season week, by window (2026–27 rights). Regional games get both teams' local outlets. */
const WEEK: Record<League, { count: number; broadcasts: Broadcast[]; sunday?: boolean; hour?: number }[]> = {
  nfl: [
    { count: 1, broadcasts: [nat("prime", "Prime Video", "streaming")] },
    { count: 6, broadcasts: [nat("cbs")], sunday: true, hour: 13 },
    { count: 5, broadcasts: [nat("fox")], sunday: true, hour: 13 },
    { count: 2, broadcasts: [nat("cbs")], sunday: true, hour: 16 },
    { count: 1, broadcasts: [nat("nbc"), nat("peacock", "Peacock", "streaming")] },
    { count: 1, broadcasts: [nat("espn"), nat("abc")] },
  ],
  nba: [
    { count: 2, broadcasts: [nat("espn")] },
    { count: 1, broadcasts: [nat("abc")] },
    { count: 2, broadcasts: [nat("nbc"), nat("peacock", "Peacock", "streaming")] },
    { count: 1, broadcasts: [nat("peacock", "Peacock", "streaming"), nat("nbcsn")] },
    { count: 2, broadcasts: [nat("prime", "Prime Video", "streaming")] },
    { count: 1, broadcasts: [nat("nbatv")] }, // non-exclusive: locals added below
    { count: 36, broadcasts: [] },
  ],
  mlb: [
    { count: 1, broadcasts: [nat("fox")] },
    { count: 1, broadcasts: [nat("fs1")] },
    { count: 1, broadcasts: [nat("tbs")] },
    { count: 1, broadcasts: [nat("nbc"), nat("peacock", "Peacock", "streaming")] },
    { count: 1, broadcasts: [nat("peacock", "Peacock", "streaming")] },
    { count: 1, broadcasts: [nat("espn")] },
    { count: 2, broadcasts: [nat("apple", "Apple TV", "streaming")] },
    { count: 2, broadcasts: [nat("mlbnet")] },
    { count: 80, broadcasts: [] },
  ],
  nhl: [
    { count: 2, broadcasts: [nat("tnt"), nat("hbo_max", "HBO Max", "streaming")] },
    { count: 2, broadcasts: [nat("espn")] },
    { count: 1, broadcasts: [nat("espn_plus", "ESPN+", "streaming"), nat("hulu", "Hulu", "streaming")] },
    { count: 45, broadcasts: [] },
  ],
};

const NON_EXCLUSIVE: NetworkId[] = ["nbatv", "fs1", "tbs", "mlbnet"];

/** A plausible week of games for each league, with the household's local teams playing their share. */
export function sampleWeek(localTeams: string[], start = new Date("2026-11-02T00:00:00Z"), seed = 7): Game[] {
  const games: Game[] = [];
  const rand = rng(seed);
  for (const league of LEAGUES) {
    const keys = TEAMS.filter((t) => t.league === league && (league === "nfl" || LOCAL_TEAMS[t.key]?.outlets[0] !== "canada")).map((t) => t.key);
    const locals = keys.filter((k) => localTeams.includes(k));
    let n = 0;
    for (const w of WEEK[league]) {
      for (let i = 0; i < w.count; i++, n++) {
        // Local teams play about 3–4 NBA/NHL games, 6 MLB games and 1 NFL game a week: put them in first.
        const perTeam = league === "mlb" ? 6 : league === "nfl" ? 1 : 3;
        const localPick = locals.length && n < locals.length * perTeam ? locals[n % locals.length] : null;
        const home = localPick ?? keys[Math.floor(rand() * keys.length)];
        let away = keys[Math.floor(rand() * keys.length)];
        while (away === home) away = keys[Math.floor(rand() * keys.length)];
        const regional = w.broadcasts.length === 0 || w.broadcasts.some((b) => NON_EXCLUSIVE.includes(b.network));
        const bs = [...w.broadcasts];
        if (regional && league !== "nfl") {
          const h = LOCAL_TEAMS[home]?.outlets[0];
          const a = LOCAL_TEAMS[away]?.outlets[0];
          if (h) bs.push(loc(h, "home"));
          if (a) bs.push(loc(a, "away"));
        }
        const day = w.sunday ? 6 : Math.floor(rand() * 7);
        const hour = w.hour ?? 19 + Math.floor(rand() * 3);
        const startTime = new Date(start.getTime() + day * 86400_000 + (hour + 5) * 3600_000).toISOString();
        games.push({
          id: `${league}:9${String(n).padStart(6, "0")}`,
          league, startTime, state: "pre", detail: "", home: teamRef(home), away: teamRef(away), broadcasts: bs,
        });
      }
    }
  }
  return games;
}
