import type { Game, LocalGuide, Settings } from "../lib/types";
import { normalizeScoreboard } from "../lib/espn";
import { APP_BY_ID, type AppDef } from "../lib/catalog/apps";
import { defaultConfig, type Config } from "../lib/profile";
import { migrateLegacy } from "../server/store/migrate";
import type { ResolveContext } from "../lib/resolve";
import { MLB, NBA, NFL, NHL } from "./fixtures/espn";

export const settings = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(defaultConfig().preferences), ...patch });

/** The household a v1 install migrates to: New York, antenna via Plex, Sunday Ticket, ESPN Unlimited, Prime, Paramount+, Fox One, HBO Max, MLB.TV. */
export const v1Household = (): Config => migrateLegacy({ favorites: ["nfl:LAC", "mlb:LAD", "nhl:LA", "mlb:NYM", "nfl:NYG"] }, { FIRETV_HOST: "10.0.0.5", PLEX_TOKEN: "t" })!.config;

export const allGames = (): Game[] => [
  ...normalizeScoreboard("nfl", NFL),
  ...normalizeScoreboard("nba", NBA),
  ...normalizeScoreboard("mlb", MLB),
  ...normalizeScoreboard("nhl", NHL),
];

export const game = (id: string): Game => {
  const g = allGames().find((x) => x.id === id);
  if (!g) throw new Error(`no fixture ${id}`);
  return g;
};

export const ctx = (guide: LocalGuide | null = null, s: Settings = settings(), c: Config = v1Household()): ResolveContext => ({
  household: { market: c.market, subscriptions: c.subscriptions, tveSignIns: c.tveSignIns, servicePriority: s.servicePriority },
  platform: "firetv",
  installedApps: null,
  guide,
  experimental: s.experimentalLaunches,
});

/** The app catalog with one app changed (for "what if this route were verified" tests). */
export function withApp(id: string, patch: (a: AppDef) => AppDef): ReadonlyMap<string, AppDef> {
  const m = new Map(APP_BY_ID);
  m.set(id, patch(structuredClone(APP_BY_ID.get(id)!)));
  return m;
}

export const guideWith = (entries: Partial<LocalGuide["entries"][number]>[]): LocalGuide => ({
  fetchedAt: "2026-10-18T16:00:00Z",
  entries: entries.map((e) => ({
    network: "cbs",
    channelKey: "/livetv/channels/1",
    channelName: "WCBS 2.1",
    title: "",
    start: "2026-10-18T17:00:00Z",
    end: "2026-10-18T20:15:00Z",
    ...e,
  })) as LocalGuide["entries"],
});

/** What the server sends a signed-in admin of the v1 household (one connected Fire TV), for UI tests. */
export function uiBoot(patch: Record<string, unknown> = {}) {
  const c = v1Household();
  c.setupComplete = true;
  const s = settings({ favorites: c.preferences.favorites });
  return {
    authed: true,
    me: { role: "admin" as const, via: "proxy" as const, userId: "owner@example.com", mode: "proxy" as const },
    games: allGames(),
    fetchedAt: "2026-10-18T21:00:00Z",
    stale: false,
    guide: null,
    settings: s,
    version: "test",
    household: {
      setupComplete: true, market: c.market, subscriptions: c.subscriptions, tveSignIns: c.tveSignIns, tvs: c.tvs,
      integrations: { plex: { url: "http://127.0.0.1:32400", channelMap: {}, status: "ok" }, espnWatch: false },
    },
    tvs: c.tvs.map((t) => ({ id: t.id, name: t.name, platform: t.platform, apps: null, adb: "connected" as const, screenOn: true, foreground: null, plex: "ok" as const, latencyMs: 30 })),
    ...patch,
  };
}
