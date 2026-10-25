import type { Game } from "../lib/types";

// Map an ESPN NBA game to NBA's own game id (e.g. "0022600123") for the NBA app's gametime://game/<id> link,
// using NBA's public season schedule. nba.com's CDN blocks some networks (it answered 403 from our test
// machine in Oct 2026); when it does, NBA games open the app with on-screen steps instead.

type Fetch = typeof fetch;

export interface NbaScheduleGame {
  gameId: string;
  gameDateTimeUTC: string;
  homeTeam: { teamTricode: string; teamCity?: string; teamName?: string };
  awayTeam: { teamTricode: string; teamCity?: string; teamName?: string };
}

// ESPN abbreviations that differ from NBA tricodes.
const ESPN_TO_NBA: Record<string, string> = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const tricode = (espnAbbr: string) => ESPN_TO_NBA[espnAbbr.toUpperCase()] ?? espnAbbr.toUpperCase();

export function matchNbaGameId(game: Game, schedule: NbaScheduleGame[]): string | null {
  const start = Date.parse(game.startTime);
  const home = tricode(game.home.abbr), away = tricode(game.away.abbr);
  const hit = schedule
    .filter((s) => s.homeTeam.teamTricode === home && s.awayTeam.teamTricode === away)
    .sort((a, b) => Math.abs(Date.parse(a.gameDateTimeUTC) - start) - Math.abs(Date.parse(b.gameDateTimeUTC) - start))[0];
  if (!hit || Math.abs(Date.parse(hit.gameDateTimeUTC) - start) > 6 * 3600_000) return null;
  return /^00[0-9]{8}$/.test(hit.gameId) ? hit.gameId : null;
}

export class NbaSchedule {
  private cache: { at: number; games: NbaScheduleGame[] } | null = null;
  private failedAt = 0;
  constructor(private fetchImpl: Fetch = fetch, private now = () => Date.now()) {}

  async gameIdFor(game: Game): Promise<string | null> {
    if (game.league !== "nba") return null;
    if (!this.cache || this.now() - this.cache.at > 12 * 3600_000) {
      if (this.now() - this.failedAt < 3600_000) return null; // don't hammer a CDN that's refusing us
      try {
        const res = await this.fetchImpl("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json", {
          headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.nba.com/", Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: any = await res.json();
        const games: NbaScheduleGame[] = (body?.leagueSchedule?.gameDates ?? []).flatMap((d: any) => d.games ?? []);
        this.cache = { at: this.now(), games };
      } catch {
        this.failedAt = this.now();
        return null;
      }
    }
    return matchNbaGameId(game, this.cache.games);
  }
}
