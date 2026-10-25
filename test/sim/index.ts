// Ready-made TVs and fixtures for navigator tests. See docs/testing-navigators.md.

import type { Game, League } from "../../lib/types";
import { SimTv, type Perturbations, type SimOptions, type WarmIntentMode } from "./tv";
import { youtubeTvApp, type SimGame, type SimTeam, type YtCard, type YtConfig, type YtSearchResult, YTTV_PKG } from "./apps/youtubeTv";
import { plexApp, type PlexConfig, type SimChannel, PLEX_PKG } from "./apps/plex";
import { primeApp, type PrimeConfig, type PrimeTile, PRIME_PKG } from "./apps/prime";

export * from "./tv";
export * from "./frame";
export * from "./apps/youtubeTv";
export * from "./apps/plex";
export * from "./apps/prime";

// --- teams (including the ones that share a nickname across leagues) ---

const t = (city: string, name: string, abbr: string): SimTeam => ({ city, name, abbr });
export const TEAMS = {
  bears: t("Chicago", "Bears", "CHI"),
  falcons: t("Atlanta", "Falcons", "ATL"),
  cardinalsNfl: t("Arizona", "Cardinals", "ARI"),
  cardinalsMlb: t("St. Louis", "Cardinals", "STL"),
  giantsNfl: t("New York", "Giants", "NYG"),
  giantsMlb: t("San Francisco", "Giants", "SF"),
  rams: t("Los Angeles", "Rams", "LAR"),
  chargers: t("Los Angeles", "Chargers", "LAC"),
  eagles: t("Philadelphia", "Eagles", "PHI"),
  cowboys: t("Dallas", "Cowboys", "DAL"),
  seahawks: t("Seattle", "Seahawks", "SEA"),
  broncos: t("Denver", "Broncos", "DEN"),
  steelers: t("Pittsburgh", "Steelers", "PIT"),
  niners: t("San Francisco", "49ers", "SF"),
  chiefs: t("Kansas City", "Chiefs", "KC"),
  raiders: t("Las Vegas", "Raiders", "LV"),
  panthersNfl: t("Carolina", "Panthers", "CAR"),
  jetsNfl: t("New York", "Jets", "NYJ"),
  panthersNhl: t("Florida", "Panthers", "FLA"),
  jetsNhl: t("Winnipeg", "Jets", "WPG"),
  dodgers: t("Los Angeles", "Dodgers", "LAD"),
};

export const simGame = (id: string, away: SimTeam, home: SimTeam, extra: Partial<SimGame> = {}): SimGame => ({ id, away, home, ...extra });

/** A Game (as the server has it) for a simulated matchup. */
export function serverGame(g: SimGame, o: { league?: League; state?: Game["state"]; startTime?: string } = {}): Game {
  const ref = (x: SimTeam, id: string) => ({ id, abbr: x.abbr, name: x.name, city: x.city, displayName: `${x.city} ${x.name}` });
  return {
    id: g.id, league: o.league ?? "nfl", startTime: o.startTime ?? "2026-10-18T17:00:00Z", state: o.state ?? "pre", detail: "",
    home: ref(g.home, "1"), away: ref(g.away, "2"), broadcasts: [],
  };
}

export const navTeams = (g: SimGame) => ({
  home: { name: g.home.name, city: g.home.city, displayName: `${g.home.city} ${g.home.name}` },
  away: { name: g.away.name, city: g.away.city, displayName: `${g.away.city} ${g.away.name}` },
});

// --- YouTube TV ---

export const ytQueryFor = (g: SimGame) => `${g.home.city} ${g.home.name}`;
export const ytLink = (query: string) => `youtubetv://search?query=${encodeURIComponent(query)}`;

/** Search results keyed by the query; anything else has no results. */
export function ytSearch(byQuery: Record<string, { cards: YtCard[]; rowsBefore?: string[]; header?: string }>): YtConfig["search"] {
  return (q) => {
    const r = byQuery[q];
    return r ? ({ header: r.header ?? q, rowsBefore: r.rowsBefore, cards: r.cards } satisfies YtSearchResult) : null;
  };
}

export function youtubeTv(cfg: YtConfig, o: Omit<SimOptions, "apps"> & { extraApps?: SimOptions["apps"] } = {}) {
  return new SimTv({ ...o, apps: [youtubeTvApp(cfg), ...(o.extraApps ?? [])] });
}

// --- Plex ---

export const plexLink = (dvrKey = "2") => `plex://live-tv/dvr.guide/ota/${dvrKey}`;

export const LOCALS: SimChannel[] = [
  { call: "CBS", number: "2.1", programs: [{ show: "CBS Mornings" }, { show: "NFL Today" }, { show: "NFL Football", episode: "Chicago Bears at Atlanta Falcons" }, { show: "60 Minutes" }], now: 2 },
  { call: "NBC", number: "4.1", programs: [{ show: "Meet the Press" }, { show: "Football Night in America" }, { show: "Sunday Night Football", episode: "Dallas Cowboys at Philadelphia Eagles" }], now: 1 },
  { call: "FOX", number: "5.1", programs: [{ show: "Fox NFL Sunday" }, { show: "NFL Football", episode: "Baltimore Ravens at Cleveland Browns" }, { show: "The OT" }], now: 1 },
  { call: "ABC", number: "7.1", programs: [{ show: "Jimmy Kimmel Live!" }, { show: "Nightline" }, { show: "ABC World News Tonight" }], now: 1 },
  { call: "PIX11", number: "11.1", programs: [{ show: "PIX11 News" }, { show: "Yankees Postgame" }], now: 0 },
  { call: "MY9", number: "9.1", programs: [{ show: "Judge Judy" }, { show: "TMZ Live" }], now: 1 },
];

/** What the server's guide (PlexClient.around) says is on a channel. */
export function plexTarget(c: SimChannel) {
  return { prev: c.programs[c.now - 1], now: c.programs[c.now], next: c.programs[c.now + 1] };
}

export function plex(cfg: Partial<PlexConfig> = {}, o: Omit<SimOptions, "apps"> & { extraApps?: SimOptions["apps"] } = {}) {
  return new SimTv({ ...o, apps: [plexApp({ channels: LOCALS, ...cfg }), ...(o.extraApps ?? [])] });
}

// --- Prime Video ---

export const primeLink = (phrase: string) => `https://app.primevideo.com/search?phrase=${encodeURIComponent(phrase)}`;
export const primePhrase = (g: SimGame) => `${g.away.name} ${g.home.name}`;
export const primeTile = (g: SimGame, live: boolean): PrimeTile => ({ id: g.id, away: g.away.name, home: g.home.name, live });

export function prime(cfg: PrimeConfig, o: Omit<SimOptions, "apps"> & { extraApps?: SimOptions["apps"] } = {}) {
  return new SimTv({ ...o, apps: [primeApp(cfg), ...(o.extraApps ?? [])] });
}

/** All three apps on one TV (switching between apps). */
export function allApps(c: { yt: YtConfig; plex?: Partial<PlexConfig>; prime: PrimeConfig }, o: Omit<SimOptions, "apps"> = {}) {
  return new SimTv({ ...o, apps: [youtubeTvApp(c.yt), plexApp({ channels: LOCALS, ...c.plex }), primeApp(c.prime)] });
}

export { YTTV_PKG, PLEX_PKG, PRIME_PKG };
export type { Perturbations, WarmIntentMode };
