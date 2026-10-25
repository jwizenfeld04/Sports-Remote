import { z } from "zod";
import { TEAM_KEY_RE } from "./types";

// The household profile: everything a person sets up once (services, market, TVs) plus their preferences.
// Stored by server/store/config.ts as config.json (versioned). Secrets live elsewhere (secrets.json).

export const CONFIG_VERSION = 2;

const Id = z.string().regex(/^[a-z0-9][a-z0-9_:+-]{0,63}$/);
export const TeamKeyZ = z.string().regex(TEAM_KEY_RE);

export const TimezoneZ = z.string().min(1).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "unknown timezone");

/** One subscription the household pays for. Ids refer to lib/catalog/subscriptions.ts. */
export const OwnedSubscriptionZ = z.object({
  id: Id,
  tier: Id.optional(),
  addOns: z.array(Id).max(20).default([]),
}).strict();

export const MarketZ = z.object({
  timezone: TimezoneZ,
  metro: Id.nullable(), // lib/catalog/teams.ts METROS id
  localTeams: z.array(TeamKeyZ).max(40), // blacked out on out-of-market packages; their regional games are "local"
  // How each local team's regional games are watched: subscription ids, or [] for "I don't get them".
  localSources: z.record(TeamKeyZ, z.array(Id).max(5)).default({}),
}).strict();

export const TvZ = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(40),
  host: z.string().regex(/^[A-Za-z0-9.-]{1,253}$/),
  port: z.number().int().min(1).max(65535),
  platform: z.enum(["firetv", "googletv"]),
  model: z.string().max(80).optional(),
  apps: z.array(Id).max(100).default([]), // catalog app ids found installed (pm list packages)
  appsCheckedAt: z.string().datetime().nullable().default(null),
}).strict();

export const PreferencesZ = z.object({
  favorites: z.array(TeamKeyZ).max(50),
  // Per network: catalog app ids in the order to try them.
  servicePriority: z.record(Id, z.array(Id).max(10)).default({}),
  oneTapSend: z.boolean(),
  presets: z.array(z.object({ name: z.string().min(1).max(40), query: z.string().max(400) }).strict()).max(20),
  experimentalLaunches: z.boolean().default(true), // screen-reading navigators
  defaultTv: z.string().max(40).nullable().default(null),
}).strict();

export const IntegrationsZ = z.object({
  plex: z.object({
    url: z.string().regex(/^https?:\/\/[A-Za-z0-9.\-:[\]]+\/?$/, "a Plex address is scheme://host:port"),
    playerId: z.string().max(100).optional(),
    // Which channel is which network, when the server can't tell: call sign per network.
    channelMap: z.object({ abc: z.string().max(12), cbs: z.string().max(12), fox: z.string().max(12), nbc: z.string().max(12) }).partial().strict().optional(),
  }).strict().nullable().default(null),
  espnWatch: z.boolean().default(false), // ESPN Watch API key is in secrets.json
}).strict();

export const ConfigZ = z.object({
  version: z.literal(CONFIG_VERSION),
  setupComplete: z.boolean(),
  market: MarketZ,
  subscriptions: z.array(OwnedSubscriptionZ).max(60),
  tveSignIns: z.array(Id).max(40).default([]), // apps signed in with a TV provider (e.g. ESPN with YouTube TV)
  tvs: z.array(TvZ).max(10),
  integrations: IntegrationsZ,
  preferences: PreferencesZ,
}).strict();

export type OwnedSubscription = z.infer<typeof OwnedSubscriptionZ>;
export type Market = z.infer<typeof MarketZ>;
export type Tv = z.infer<typeof TvZ>;
export type Preferences = z.infer<typeof PreferencesZ>;
export type Config = z.infer<typeof ConfigZ>;

export function defaultConfig(timezone = "America/New_York"): Config {
  return {
    version: CONFIG_VERSION,
    setupComplete: false,
    market: { timezone, metro: null, localTeams: [], localSources: {} },
    subscriptions: [],
    tveSignIns: [],
    tvs: [],
    integrations: { plex: null, espnWatch: false },
    preferences: {
      favorites: [],
      servicePriority: {},
      oneTapSend: false,
      presets: [
        { name: "Tonight", query: "time=tonight" },
        { name: "On my services", query: "mine=1" },
      ],
      experimentalLaunches: true,
      defaultTv: null,
    },
  };
}
