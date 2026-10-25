import type { Game, League, NetworkId, Resolution, ServiceId, Settings } from "./types";
import { LEAGUES } from "./types";
import { teamKey } from "./teams";
import { buildIndex, search, type SearchIndex } from "./search";

export type StatusFilter = "live" | "upcoming" | "final";
export type TimeWindow = "now" | "tonight" | "today" | "tomorrow" | "week";
export type SortMode = "smart" | "time" | "league";

export interface FilterState {
  q: string;
  leagues: League[]; // empty = all
  status: StatusFilter[]; // empty = all
  time: TimeWindow;
  favorites: boolean;
  myServices: boolean;
  service: ServiceId | null;
  networks: NetworkId[]; // empty = all
  quality: boolean; // only games that open to the game or channel
  close: boolean;
  sort: SortMode;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "", leagues: [], status: ["live", "upcoming"], time: "week", favorites: false,
  myServices: false, service: null, networks: [], quality: false, close: false, sort: "smart",
};

export interface FilterContext {
  settings: Settings;
  resolutions: Map<string, Resolution>;
  now: Date;
  index?: SearchIndex;
  /** The household's timezone, for today/tonight/tomorrow. Default Eastern. */
  timezone?: string;
}

export const isFavorite = (g: Game, s: Settings) =>
  s.favorites.includes(teamKey(g.league, g.home)) || s.favorites.includes(teamKey(g.league, g.away));

const statusOf = (g: Game): StatusFilter => (g.state === "in" ? "live" : g.state === "post" ? "final" : "upcoming");

/** Late and close: final quarter/period/9th+ inning with a small margin. */
export function isCloseGame(g: Game): boolean {
  if (g.state !== "in" || g.home.score === undefined || g.away.score === undefined) return false;
  const margin = Math.abs(g.home.score - g.away.score);
  const p = g.period ?? 0;
  if (g.league === "nfl") return p >= 4 && margin <= 8;
  if (g.league === "nhl") return p >= 3 && margin <= 2;
  if (g.league === "nba") return p >= 4 && margin <= 6;
  return p >= 9 && margin <= 2; // mlb: period is the inning
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** Calendar day (yyyy-mm-dd) and hour in the household's timezone. */
function local(d: Date, tz: string): { day: string; hour: number } {
  const p = Object.fromEntries(fmt(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** "Today", "tonight" and "tomorrow" are in `tz`, the household's timezone (default Eastern). */
export function inWindow(g: Game, w: TimeWindow, now: Date, tz = "America/New_York"): boolean {
  const start = new Date(g.startTime);
  const live = g.state === "in";
  const ms = start.getTime() - now.getTime();
  switch (w) {
    case "now":
      return live || (g.state === "pre" && ms <= 60 * 60_000 && ms > -3 * 3600_000);
    case "today":
      return live || local(start, tz).day === local(now, tz).day;
    case "tonight": {
      if (live) return true;
      const s = local(start, tz);
      return s.day === local(now, tz).day && s.hour >= 17;
    }
    case "tomorrow":
      return local(start, tz).day === local(new Date(now.getTime() + 24 * 3600_000), tz).day;
    case "week":
      return live || (ms > -12 * 3600_000 && ms <= 7 * 24 * 3600_000);
  }
}

export function applyFilters(games: Game[], f: FilterState, ctx: FilterContext): Game[] {
  const index = ctx.index ?? buildIndex(games);
  let out = search(index, games, f.q);
  out = out.filter((g) => {
    if (f.leagues.length && !f.leagues.includes(g.league)) return false;
    if (f.status.length && !f.status.includes(statusOf(g))) return false;
    if (!inWindow(g, f.time, ctx.now, ctx.timezone)) return false;
    if (f.favorites && !isFavorite(g, ctx.settings)) return false;
    const res = ctx.resolutions.get(g.id);
    const routes = res?.routes ?? [];
    if (f.myServices && routes.length === 0) return false;
    // The service the Play button opens, not every service that could carry the network: Plex means
    // a game its local channels are showing, not any CBS/FOX game that is also on YouTube TV or Fox One.
    if (f.service && routes[0]?.service !== f.service) return false;
    if (f.networks.length && !g.broadcasts.some((b) => f.networks.includes(b.network))) return false;
    if (f.quality && !(routes[0] && routes[0].level !== "app" && routes[0].levelVerified !== false)) return false;
    if (f.close && !isCloseGame(g)) return false;
    return true;
  });
  return sortGames(out, f.sort, ctx.settings);
}

/** Smart: live games first (favorite teams first among them), then upcoming and finals by start time. */
export function sortGames(games: Game[], mode: SortMode, settings: Settings): Game[] {
  const t = (g: Game) => Date.parse(g.startTime);
  const live = (g: Game) => (g.state === "in" ? 0 : g.state === "pre" ? 1 : 2);
  const liveFav = (g: Game) => (g.state === "in" && isFavorite(g, settings) ? 0 : 1);
  const copy = [...games];
  if (mode === "time") return copy.sort((a, b) => t(a) - t(b));
  if (mode === "league") return copy.sort((a, b) => LEAGUES.indexOf(a.league) - LEAGUES.indexOf(b.league) || t(a) - t(b));
  return copy.sort((a, b) => live(a) - live(b) || liveFav(a) - liveFav(b) || t(a) - t(b));
}

/** Split sorted games into the Live / Upcoming / Final sections. Favorites lead only the Live section. */
export function sections(games: Game[], settings: Settings): { live: Game[]; upcoming: Game[]; final: Game[] } {
  const live = games.filter((g) => g.state === "in");
  return {
    live: [...live.filter((g) => isFavorite(g, settings)), ...live.filter((g) => !isFavorite(g, settings))],
    upcoming: games.filter((g) => g.state === "pre"),
    final: games.filter((g) => g.state === "post"),
  };
}

/** The status + time combinations the "Show" segmented control offers. Anything else lives in the popover. */
export type ViewPreset = "live" | "today" | "upcoming" | "all";
export const VIEW_PRESETS: Record<ViewPreset, Pick<FilterState, "status" | "time">> = {
  live: { status: ["live"], time: "week" },
  today: { status: ["live", "upcoming"], time: "today" },
  upcoming: { status: ["upcoming"], time: "week" },
  all: { status: ["live", "upcoming"], time: "week" },
};

export function viewOf(f: FilterState): ViewPreset | null {
  const key = (p: Pick<FilterState, "status" | "time">) => `${[...p.status].sort().join()}|${p.time}`;
  const k = key(f);
  return (Object.keys(VIEW_PRESETS) as ViewPreset[]).find((v) => key(VIEW_PRESETS[v]) === k) ?? null;
}

export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.leagues.length) n++;
  if (f.status.join() !== DEFAULT_FILTERS.status.join()) n++;
  if (f.time !== DEFAULT_FILTERS.time) n++;
  if (f.favorites) n++;
  if (f.myServices) n++;
  if (f.service) n++;
  if (f.networks.length) n++;
  if (f.quality) n++;
  if (f.close) n++;
  return n;
}

/** Explain an empty result: the first filter that, when cleared, would bring games back. */
export function blockingFilter(games: Game[], f: FilterState, ctx: FilterContext): keyof FilterState | null {
  // Suggest clearing a filter before the search text: the search is usually what the user meant.
  const keys: (keyof FilterState)[] = ["favorites", "myServices", "service", "quality", "close", "networks", "leagues", "status", "time", "q"];
  for (const k of keys) {
    const relaxed = { ...f, [k]: DEFAULT_FILTERS[k] } as FilterState;
    if (JSON.stringify(relaxed) === JSON.stringify(f)) continue;
    if (applyFilters(games, relaxed, ctx).length > 0) return k;
  }
  return null;
}
