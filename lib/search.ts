import type { Game } from "./types";
import { NETWORK_LABEL } from "./networks";
import { TEAM_ALIASES, teamKey } from "./teams";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z0-9+]+/).filter(Boolean);

const LEAGUE_WORDS: Record<Game["league"], string[]> = {
  nfl: ["nfl", "football"],
  nba: ["nba", "basketball", "hoops"],
  mlb: ["mlb", "baseball"],
  nhl: ["nhl", "hockey"],
};

export interface SearchIndex {
  tokens: Map<string, string[]>; // game id -> searchable words
}

export function buildIndex(games: Game[]): SearchIndex {
  const tokens = new Map<string, string[]>();
  for (const g of games) {
    const w = new Set<string>();
    for (const t of [g.home, g.away]) {
      for (const s of [t.name, t.city, t.displayName, t.abbr]) words(s).forEach((x) => w.add(x));
      for (const a of TEAM_ALIASES[teamKey(g.league, t)] ?? []) words(a).forEach((x) => w.add(x));
    }
    LEAGUE_WORDS[g.league].forEach((x) => w.add(x));
    for (const b of g.broadcasts) {
      words(b.raw).forEach((x) => w.add(x));
      words(NETWORK_LABEL[b.network]).forEach((x) => w.add(x));
    }
    tokens.set(g.id, [...w]);
  }
  return { tokens };
}

/**
 * Every query word must prefix-match some word of the game (AND). "g-men" and "big blue" work
 * because aliases are split into words the same way the query is.
 */
export function matches(index: SearchIndex, gameId: string, query: string): boolean {
  const q = words(query);
  if (q.length === 0) return true;
  const w = index.tokens.get(gameId);
  if (!w) return false;
  return q.every((qw) => w.some((x) => x.startsWith(qw)));
}

export function search(index: SearchIndex, games: Game[], query: string): Game[] {
  if (words(query).length === 0) return games;
  return games.filter((g) => matches(index, g.id, query));
}
