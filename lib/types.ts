// Shared types for the UI, server and spike CLI.

export type League = "nfl" | "nba" | "mlb" | "nhl";
export const LEAGUES: League[] = ["nfl", "nba", "mlb", "nhl"];
export const GAME_ID_RE = /^(nfl|nba|mlb|nhl):[0-9]{1,15}$/;
export const TEAM_KEY_RE = /^(nfl|nba|mlb|nhl):[A-Z0-9]{1,5}$/;
export type GameState = "pre" | "in" | "post";

export interface TeamRef {
  id: string;
  abbr: string; // ESPN abbreviation, e.g. "LAC", "NYG", "LAD"
  name: string; // "Chargers"
  city: string; // "Los Angeles"
  displayName: string; // "Los Angeles Chargers"
  logo?: string;
  color?: string; // "#rrggbb", normalized from ESPN's team.color
  alternateColor?: string; // "#rrggbb"
  score?: number;
}

import type { NetworkId, OutletId } from "./catalog/networks";
export type { NetworkId, OutletId } from "./catalog/networks";

export interface Broadcast {
  network: NetworkId;
  outlet?: OutletId; // for network "local": who carries it (DAZN, MSG, a local station ...)
  raw: string; // original ESPN label
  scope: "national" | "home" | "away";
  regional: boolean; // a team's local broadcast
  kind: "tv" | "streaming";
  radio?: boolean;
}

export interface Game {
  id: string; // `${league}:${espnEventId}`
  league: League;
  startTime: string; // ISO
  state: GameState;
  detail: string; // "Q3 4:12", "Top 7th", "Final", "Sun 1:00 PM"
  period?: number;
  home: TeamRef;
  away: TeamRef;
  broadcasts: Broadcast[];
}

/** A catalog app id (lib/catalog/apps.ts): "espn", "youtube_tv", "peacock" ... */
export type ServiceId = string;

export type LaunchLevel = "game" | "channel" | "app";
export const LEVEL_RANK: Record<LaunchLevel, number> = { game: 3, channel: 2, app: 1 };

/** The household's preferences (lib/profile.ts PreferencesZ). */
export type { Preferences as Settings } from "./profile";

// What the over-the-air guide (Plex) says is airing on the local channels, used to tell whether
// the local station is carrying a game (then Sunday Ticket would black it out).
export interface GuideEntry {
  network: NetworkId; // abc, cbs, fox, nbc
  channelKey: string;
  channelName: string; // "WCBS 2.1"
  title: string; // program title + description, as text
  show?: string; // series (or program) title, as the Plex guide header shows it
  episode?: string; // episode / game title when it differs from the show
  start: string; // ISO
  end: string; // ISO
}
export interface LocalGuide {
  entries: GuideEntry[];
  fetchedAt: string | null;
}

export interface LaunchRoute {
  service: ServiceId; // the app that opens
  network: NetworkId;
  outlet?: OutletId;
  level: LaunchLevel; // best level this route may reach
  levelVerified?: boolean; // false: that level hasn't been confirmed on this platform yet
  manual?: boolean; // the app has no known TV package here: you open it yourself (we wake the TV and show the steps)
  certain: boolean; // false: "probably" (unconfirmed channel lineup, or a game that may not air locally)
  installed?: boolean; // the app is on the TV (true when unknown)
  subscription?: string; // which subscription pays for it
  reason: string; // shown in the launch sheet
  priority?: number;
  /** Plex only: "guide" = the guide shows this game on a local channel; "market" = a local channel carries the network. */
  local?: "guide" | "market";
}

export interface Suggestion {
  id: string; // catalog subscription id
  tier?: string;
  certain: boolean;
  need: string; // what it would add, e.g. "Peacock"
}

export interface Resolution {
  routes: LaunchRoute[]; // ranked; empty when not covered
  notCovered?: { network: string; message: string; suggestions: Suggestion[] };
  needs?: import("./availability").Need[];
  notes?: string[];
}

export type LaunchOutcome = "game" | "channel" | "app" | "manual" | "profile_picker" | "unverified" | "failed";
export type LaunchError =
  | "device_offline" | "no_tv" | "not_installed" | "busy" | "bad_params" | "unknown_service" | "adb_error" | "plex_error" | "timeout" | "not_covered" | "unknown_game";

export interface LaunchAttempt {
  level: LaunchLevel;
  via: "adb" | "plex";
  ok: boolean;
  foreground?: string;
  ms: number;
  error?: string;
}

export interface LaunchResult {
  requestId: string;
  ok: boolean;
  level: LaunchLevel | null;
  verified: boolean;
  outcome: LaunchOutcome;
  title: string;
  message: string;
  persistent: boolean; // app-only/profile/unverified/failed results stay until dismissed
  service?: ServiceId;
  attempts: LaunchAttempt[];
  error?: LaunchError;
}

export interface TvStatus {
  adb: "connected" | "offline" | "unauthorized";
  screenOn: boolean | null;
  foreground: string | null;
  plex: "ok" | "down" | "unconfigured";
  latencyMs: number | null;
}

export const ALLOWED_KEYS = [
  "UP", "DOWN", "LEFT", "RIGHT", "SELECT", "BACK", "HOME", "PLAY_PAUSE", "WAKEUP",
  "REWIND", "FAST_FORWARD", "VOLUME_UP", "VOLUME_DOWN", "MUTE", "SLEEP", "SEARCH",
] as const;
export type AllowedKey = (typeof ALLOWED_KEYS)[number];
