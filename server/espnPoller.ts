import { EventEmitter } from "node:events";
import type { Game, League } from "../lib/types";
import { LEAGUES } from "../lib/types";
import { espnDays, normalizeScoreboard, scoreboardUrl } from "../lib/espn";

type Fetch = typeof fetch;

export interface GamesSnapshot {
  games: Game[];
  fetchedAt: string | null;
  stale: boolean; // at least one league failed on the last poll and is showing cached data
  error: string | null; // why, e.g. "mlb 20261012: HTTP 400"
  version: number;
}

// Yesterday, today and tomorrow are fetched on every poll; later days change rarely.
const HOT_DAYS = 3;
const COLD_TTL_MS = 30 * 60_000;

/**
 * Polls ESPN's scoreboards for NFL, MLB and NHL. Every 20 s while a game is live and someone is
 * watching, otherwise every 5 min. Keeps the last good payload per league; emits "games" on change.
 */
export class EspnPoller extends EventEmitter {
  private days = new Map<string, { at: number; games: Game[] }>(); // `${league}:${yyyymmdd}`
  private failed = new Set<League>();
  private snapshot: GamesSnapshot = { games: [], fetchedAt: null, stale: false, error: null, version: 0 };
  private timer: NodeJS.Timeout | null = null;
  private lastJson = "";
  clients = 0;

  constructor(private fetchImpl: Fetch = fetch, private now = () => new Date(), private leagues: League[] = LEAGUES) {
    super();
  }

  get(): GamesSnapshot {
    return this.snapshot;
  }

  find(id: string): Game | undefined {
    return this.snapshot.games.find((g) => g.id === id);
  }

  async pollOnce(): Promise<GamesSnapshot> {
    const now = this.now();
    const days = espnDays(new Date(now.getTime() - 24 * 3600_000), new Date(now.getTime() + 7 * 24 * 3600_000));
    const errors: string[] = [];
    await Promise.all(
      this.leagues.map(async (league) => {
        let ok = true;
        await Promise.all(
          days.map(async (day, i) => {
            const key = `${league}:${day}`;
            const hit = this.days.get(key);
            if (hit && i >= HOT_DAYS && now.getTime() - hit.at < COLD_TTL_MS) return;
            try {
              const res = await this.fetchImpl(scoreboardUrl(league, day), { signal: AbortSignal.timeout(8000) });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              this.days.set(key, { at: now.getTime(), games: normalizeScoreboard(league, await res.json()) });
            } catch (e) {
              ok = false;
              errors.push(`${league} ${day}: ${(e as Error).message || "failed"}`);
            }
          }),
        );
        if (ok) this.failed.delete(league);
        else this.failed.add(league);
      }),
    );
    for (const key of this.days.keys()) if (!days.includes(key.split(":")[1])) this.days.delete(key);
    const seen = new Set<string>();
    const games: Game[] = [];
    for (const league of this.leagues) {
      for (const day of days) {
        for (const g of this.days.get(`${league}:${day}`)?.games ?? []) {
          if (seen.has(g.id)) continue;
          seen.add(g.id);
          games.push(g);
        }
      }
    }
    const error = errors.length ? errors.sort()[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : "") : null;
    if (error && error !== this.snapshot.error) this.emit("poll_error", error);
    const json = JSON.stringify(games);
    const changed = json !== this.lastJson || error !== this.snapshot.error;
    this.lastJson = json;
    this.snapshot = {
      games,
      fetchedAt: now.toISOString(),
      stale: this.failed.size > 0,
      error,
      version: this.snapshot.version + (changed ? 1 : 0),
    };
    if (changed) this.emit("games", this.snapshot);
    return this.snapshot;
  }

  nextDelayMs(): number {
    const live = this.snapshot.games.some((g) => g.state === "in");
    return live && this.clients > 0 ? 20_000 : 300_000;
  }

  start() {
    const loop = async () => {
      try {
        await this.pollOnce();
      } catch {
        // pollOnce reports its own errors; never let one stop the schedule.
      } finally {
        this.timer = setTimeout(loop, this.nextDelayMs());
      }
    };
    void loop();
  }

  /** A client connected while we were on the slow cadence: refresh now. */
  poke() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.start();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
