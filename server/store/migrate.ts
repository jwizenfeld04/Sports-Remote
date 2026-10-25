import { CONFIG_VERSION, defaultConfig, type Config } from "../../lib/profile";

// Version 1 installs kept preferences in <data>/settings.json and everything else in the env file
// (FIRETV_HOST, PLEX_*, ESPN_WATCH_API_KEY). They were built for one household in New York with a fixed
// set of services, so that is what a v1 install migrates to. Auth settings (APP_PASSCODE,
// ALLOWED_TAILNET_USERS) are migrated by server/auth.

export interface LegacyEnv {
  FIRETV_HOST?: string;
  PLEX_URL?: string;
  PLEX_TOKEN?: string;
  PLEX_PLAYER_ID?: string;
  ESPN_WATCH_API_KEY?: string;
}

// v1 service ids -> catalog app ids.
const APP_IDS: Record<string, string> = {
  plex: "plex", youtube_st: "youtube_tv", espn: "espn", prime: "prime_video", paramount: "paramount_plus",
  fox_one: "fox_one", hbo_max: "hbo_max", mlbtv: "mlb",
};

// What a v1 household had: an antenna through Plex, Sunday Ticket, ESPN Unlimited, Prime, Paramount+, Fox One,
// HBO Max and MLB.TV.
const V1_SUBSCRIPTIONS: Config["subscriptions"] = [
  { id: "antenna", addOns: [] },
  { id: "nfl_sunday_ticket", addOns: [] },
  { id: "espn", tier: "unlimited", addOns: [] },
  { id: "prime_video", addOns: [] },
  { id: "paramount_plus", tier: "premium", addOns: [] },
  { id: "fox_one", addOns: [] },
  { id: "hbo_max", tier: "standard", addOns: [] },
  { id: "mlbtv", addOns: [] },
];

const NY_LOCAL = ["nfl:NYG", "nfl:NYJ", "nba:BKN", "nba:NY", "mlb:NYM", "mlb:NYY", "nhl:NJ", "nhl:NYI", "nhl:NYR"];

interface V1Settings {
  favorites?: unknown;
  servicePriority?: unknown;
  oneTapSend?: unknown;
  presets?: unknown;
}

export function migrateLegacy(
  settings: unknown,
  env: LegacyEnv,
): { config: Config; secrets: { plexToken?: string; espnWatchApiKey?: string }; from: string } | null {
  const s = (settings && typeof settings === "object" ? settings : null) as V1Settings | null;
  if (!s && !env.FIRETV_HOST) return null;

  const c = defaultConfig("America/New_York");
  c.market = {
    timezone: "America/New_York",
    metro: "new_york",
    localTeams: NY_LOCAL,
    // v1 counted the antenna for local Mets games on broadcast TV; cable-network games weren't covered.
    localSources: { "mlb:NYM": ["antenna"] },
  };
  c.subscriptions = structuredClone(V1_SUBSCRIPTIONS);
  c.tveSignIns = [];

  if (s) {
    if (Array.isArray(s.favorites)) c.preferences.favorites = s.favorites.filter((f): f is string => typeof f === "string" && /^(nfl|nba|mlb|nhl):[A-Z0-9]{1,5}$/.test(f)).slice(0, 50);
    if (typeof s.oneTapSend === "boolean") c.preferences.oneTapSend = s.oneTapSend;
    if (Array.isArray(s.presets)) {
      c.preferences.presets = s.presets
        .filter((p): p is { name: string; query: string } => !!p && typeof p.name === "string" && typeof p.query === "string" && p.name.length > 0)
        .slice(0, 20)
        .map((p) => ({ name: p.name.slice(0, 40), query: p.query.slice(0, 400) }));
    }
    if (s.servicePriority && typeof s.servicePriority === "object") {
      for (const [net, list] of Object.entries(s.servicePriority as Record<string, unknown>)) {
        if (!Array.isArray(list) || !/^[a-z0-9]{1,20}$/.test(net)) continue;
        const ids = list.map((x) => APP_IDS[String(x)]).filter(Boolean);
        if (ids.length) c.preferences.servicePriority[net] = ids;
      }
    }
  }

  const host = (env.FIRETV_HOST ?? "").trim();
  const m = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(host);
  if (m) {
    c.tvs = [{ id: "living-room", name: "Living room", host: m[1], port: Number(m[2] ?? 5555), platform: "firetv", apps: Object.values(APP_IDS), appsCheckedAt: null }];
    c.preferences.defaultTv = "living-room";
  }
  if (env.PLEX_TOKEN) {
    c.integrations.plex = {
      // Keep only scheme://host:port: 0.1 accepted addresses like http://host:32400/web, which Plex calls don't want.
      url: plexOrigin(env.PLEX_URL) ?? "http://127.0.0.1:32400",
      ...(env.PLEX_PLAYER_ID ? { playerId: env.PLEX_PLAYER_ID } : {}),
      channelMap: { abc: "WABC", cbs: "WCBS", fox: "WNYW", nbc: "WNBC" }, // v1 was built for New York's stations
    };
  }
  c.integrations.espnWatch = !!env.ESPN_WATCH_API_KEY;
  // A v1 install was a working setup, so don't send it back through the wizard.
  c.setupComplete = !!m;
  c.version = CONFIG_VERSION;

  return {
    config: c,
    secrets: { plexToken: env.PLEX_TOKEN || undefined, espnWatchApiKey: env.ESPN_WATCH_API_KEY || undefined },
    from: s ? "v1 settings.json + env" : "v1 env",
  };
}

function plexOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}
