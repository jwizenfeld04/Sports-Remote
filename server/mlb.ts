import type { Game } from "../lib/types";

// Map an ESPN MLB game to MLB's gamePk via the public Stats API schedule (no key needed).
// Only used when the MLB.TV game-level deep link is in the registry.

type Fetch = typeof fetch;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export interface MlbScheduleGame {
  gamePk: number;
  gameDate: string;
  teams: { home: { team: { name: string } }; away: { team: { name: string } } };
}

export function matchGamePk(game: Game, schedule: MlbScheduleGame[]): string | null {
  const start = Date.parse(game.startTime);
  const hits = schedule.filter(
    (s) =>
      norm(s.teams.home.team.name) === norm(game.home.displayName) &&
      norm(s.teams.away.team.name) === norm(game.away.displayName),
  );
  if (hits.length === 0) return null;
  // Doubleheaders: pick the game whose start is closest.
  hits.sort((a, b) => Math.abs(Date.parse(a.gameDate) - start) - Math.abs(Date.parse(b.gameDate) - start));
  const best = hits[0];
  return Math.abs(Date.parse(best.gameDate) - start) <= 6 * 3600_000 ? String(best.gamePk) : null;
}

export class MlbSchedule {
  private cache = new Map<string, { at: number; games: MlbScheduleGame[] }>();
  constructor(private fetchImpl: Fetch = fetch, private now = () => Date.now()) {}

  async gamePkFor(game: Game): Promise<string | null> {
    if (game.league !== "mlb") return null;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(game.startTime));
    let entry = this.cache.get(day);
    if (!entry || this.now() - entry.at > 3600_000) {
      const res = await this.fetchImpl(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body: any = await res.json();
      const games: MlbScheduleGame[] = (body?.dates ?? []).flatMap((d: any) => d.games ?? []);
      entry = { at: this.now(), games };
      this.cache.set(day, entry);
    }
    return matchGamePk(game, entry.games);
  }
}
