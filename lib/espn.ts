import { z } from "zod";
import type { Broadcast, Game, League, TeamRef } from "./types";
import { classifyLabel } from "./catalog/networks";

// Only the fields we use; everything else in ESPN's payload is ignored (passthrough).
const Team = z.object({
  id: z.string(),
  abbreviation: z.string().default(""),
  displayName: z.string().default(""),
  shortDisplayName: z.string().optional(),
  name: z.string().optional(),
  location: z.string().optional(),
  logo: z.string().optional(),
  color: z.string().optional(),
  alternateColor: z.string().optional(),
}).passthrough();

const Competitor = z.object({
  homeAway: z.enum(["home", "away"]),
  score: z.union([z.string(), z.number()]).optional(),
  team: Team,
}).passthrough();

const GeoBroadcast = z.object({
  type: z.object({ shortName: z.string().optional() }).passthrough().optional(),
  market: z.object({ type: z.string().optional() }).passthrough().optional(),
  media: z.object({ shortName: z.string().optional() }).passthrough().optional(),
}).passthrough();

const LegacyBroadcast = z.object({
  market: z.string().optional(),
  names: z.array(z.string()).default([]),
}).passthrough();

const Status = z.object({
  period: z.number().optional(),
  displayClock: z.string().optional(),
  type: z.object({
    state: z.enum(["pre", "in", "post"]),
    shortDetail: z.string().optional(),
    detail: z.string().optional(),
  }).passthrough(),
}).passthrough();

const Competition = z.object({
  date: z.string().optional(),
  competitors: z.array(Competitor).min(2),
  broadcasts: z.array(LegacyBroadcast).optional(),
  geoBroadcasts: z.array(GeoBroadcast).optional(),
  status: Status.optional(),
}).passthrough();

const Event = z.object({
  id: z.string(),
  date: z.string(),
  status: Status.optional(),
  competitions: z.array(Competition).min(1),
}).passthrough();

export const Scoreboard = z.object({ events: z.array(z.unknown()).default([]) }).passthrough();

function scopeOf(raw: string | undefined): Broadcast["scope"] {
  const s = (raw ?? "").toLowerCase();
  if (s === "home") return "home";
  if (s === "away") return "away";
  return "national";
}

export const NEUTRAL_TEAM_COLOR = "#2b3442";

/** ESPN sends colors as 6-hex without "#". Anything else falls back. */
export function hexColor(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : fallback;
}

function team(c: z.infer<typeof Competitor>, started: boolean): TeamRef {
  const t = c.team;
  // ESPN sends "0" before kickoff; only show scores once the game has started.
  const score = !started || c.score === undefined || c.score === "" ? undefined : Number(c.score);
  return {
    id: t.id,
    abbr: t.abbreviation.toUpperCase(),
    name: t.name ?? t.shortDisplayName ?? t.displayName,
    city: t.location ?? "",
    displayName: t.displayName,
    logo: t.logo && /^https:\/\//.test(t.logo) ? t.logo : undefined,
    color: hexColor(t.color, NEUTRAL_TEAM_COLOR),
    alternateColor: hexColor(t.alternateColor, hexColor(t.color, NEUTRAL_TEAM_COLOR)),
    score: Number.isFinite(score) ? score : undefined,
  };
}

export function broadcastsOf(comp: z.infer<typeof Competition>): Broadcast[] {
  const out: Broadcast[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, scope: Broadcast["scope"], kind: Broadcast["kind"]) => {
    if (!raw) return;
    const { network, outlet, radio } = classifyLabel(raw);
    const regional = network === "local";
    const key = `${network}|${regional || network === "unknown" ? raw : ""}|${regional ? scope : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const b: Broadcast = { network, raw, scope: regional ? (scope === "national" ? "home" : scope) : scope, regional, kind };
    if (outlet) b.outlet = outlet;
    if (radio) b.radio = true;
    out.push(b);
  };
  for (const g of comp.geoBroadcasts ?? []) {
    const kind = (g.type?.shortName ?? "").toLowerCase() === "streaming" ? "streaming" : "tv";
    add(g.media?.shortName, scopeOf(g.market?.type), kind);
  }
  if (out.length === 0) {
    for (const b of comp.broadcasts ?? []) for (const n of b.names) add(n, scopeOf(b.market), "tv");
  }
  return out;
}

/** Normalize one league's ESPN scoreboard payload. Malformed events are skipped, not fatal. */
export function normalizeScoreboard(league: League, payload: unknown): Game[] {
  const sb = Scoreboard.parse(payload);
  const games: Game[] = [];
  for (const raw of sb.events) {
    const parsed = Event.safeParse(raw);
    if (!parsed.success) continue;
    const ev = parsed.data;
    const comp = ev.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const status = comp.status ?? ev.status;
    const started = (status?.type.state ?? "pre") !== "pre";
    games.push({
      id: `${league}:${ev.id}`,
      league,
      startTime: comp.date ?? ev.date,
      state: status?.type.state ?? "pre",
      detail: status?.type.shortDetail ?? status?.type.detail ?? "",
      period: status?.period,
      home: team(home, started),
      away: team(away, started),
      broadcasts: broadcastsOf(comp),
    });
  }
  return games;
}

export const ESPN_PATHS: Record<League, string> = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

/** Eastern-time calendar day as yyyymmdd. */
export function espnDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d).replace(/-/g, "");
}

/** Every Eastern-time day touched by [from, to], in order. 12 h steps so DST days are never skipped. */
export function espnDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let t = from.getTime(); t <= to.getTime() + 12 * 3600_000; t += 12 * 3600_000) {
    const d = espnDay(new Date(Math.min(t, to.getTime())));
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * One Eastern-time day. ESPN's scoreboard rejects `dates=yyyymmdd-yyyymmdd` ranges with
 * 400 "Failed to get events endpoint." (seen Oct 2026), so ranges must be fetched day by day.
 */
export function scoreboardUrl(league: League, day: string): string {
  if (!/^\d{8}$/.test(day)) throw new Error("day must be yyyymmdd");
  return `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATHS[league]}/scoreboard?dates=${day}&limit=300`;
}
