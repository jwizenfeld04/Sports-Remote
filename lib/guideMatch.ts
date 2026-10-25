import type { Game, LocalGuide, TeamRef } from "./types";
import type { NetworkId } from "./catalog/networks";
import { TEAM_ALIASES, teamKey } from "./teams";

// Matching a game to an over-the-air guide (Plex / HDHomeRun): which local station is showing it.

const SHORT_ALIASES = new Set(["la", "ny", "sf", "new york", "los angeles"]);

function teamTerms(league: Game["league"], t: TeamRef): string[] {
  const base = [t.name, t.displayName].filter(Boolean).map((s) => s.toLowerCase());
  const aliases = (TEAM_ALIASES[teamKey(league, t)] ?? []).filter((a) => !SHORT_ALIASES.has(a) && a.length > 3 && a !== t.city.toLowerCase());
  return [...new Set([...base, ...aliases])];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when a guide entry's text names both teams. */
export function titleMatches(game: Game, text: string): boolean {
  const hay = text.toLowerCase();
  const has = (t: TeamRef) => teamTerms(game.league, t).some((term) => new RegExp(`\\b${escapeRe(term)}\\b`).test(hay));
  return has(game.home) && has(game.away);
}

/** Which local channel (if any) the guide says is carrying this game. */
export function localGuideMatch(game: Game, guide: LocalGuide | null, networks: NetworkId[]): NetworkId | null {
  if (!guide) return null;
  const start = Date.parse(game.startTime);
  for (const e of guide.entries) {
    if (!networks.includes(e.network)) continue;
    const s = Date.parse(e.start), end = Date.parse(e.end);
    // The program must cover kickoff: it starts no later than 15 min after kickoff and ends after it.
    if (!(s <= start + 15 * 60_000 && end > start)) continue;
    if (titleMatches(game, e.title)) return e.network;
  }
  return null;
}
