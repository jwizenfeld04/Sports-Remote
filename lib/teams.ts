import type { League, TeamRef } from "./types";
import { TEAMS, type TeamInfo } from "./catalog/teams";

// Team keys are `${league}:${ESPN abbreviation}`.
export const teamKey = (league: League, t: Pick<TeamRef, "abbr">) => `${league}:${t.abbr.toUpperCase()}`;

export const TEAM_BY_KEY: ReadonlyMap<string, TeamInfo> = new Map(TEAMS.map((t) => [t.key, t]));

// Nicknames and city names for search, keyed by team key. Lowercase.
export const TEAM_ALIASES: Record<string, string[]> = Object.fromEntries(TEAMS.map((t) => [t.key, t.aliases]));

// Kept until the resolver reads the household market (see docs/ARCHITECTURE.md).
export const DEFAULT_FAVORITES = ["nfl:LAC", "mlb:LAD", "nhl:LA", "mlb:NYM", "nfl:NYG"];
export const NY_MARKET_TEAMS = new Set(["nfl:NYG", "nfl:NYJ", "mlb:NYM", "mlb:NYY", "nhl:NYR", "nhl:NYI", "nhl:NJ"]);
export const isNyMarket = (league: League, t: Pick<TeamRef, "abbr">) => NY_MARKET_TEAMS.has(teamKey(league, t));
