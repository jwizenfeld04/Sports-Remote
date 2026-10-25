import type { LaunchLevel } from "../types";
import type { NetworkId } from "./networks";

// Apps on the TV: their package names per platform and how deep we can open them. Researched Oct 2026
// (Google Play listings for Google TV packages, APKMirror Fire TV listings, community projects).
//
// A route's template only takes named params that the server fills from its own data (never from the client),
// each checked against its regex before use. `verified` lists the platforms where the route was confirmed on a
// real TV. Unverified routes are still tried, but the result says "if it didn't land on the game: <steps>".

export type Platform = "firetv" | "googletv";
export const PLATFORMS: Platform[] = ["firetv", "googletv"];
export const PLATFORM_LABEL: Record<Platform, string> = { firetv: "Fire TV", googletv: "Google TV" };

export type Navigator = "youtube_tv_search" | "plex_guide" | "prime_search";

export interface RouteDef {
  level: Exclude<LaunchLevel, "app">;
  via: "adb" | "plex";
  template?: string; // a VIEW intent URI, e.g. "mlbatbat://mlbtv?date={gameDate}&gamepk={gamePk}"
  params: Record<string, string>; // param name -> regex source
  networks?: NetworkId[]; // only for these networks (default: any the app plays)
  platforms?: Platform[]; // default: both
  navigate?: Navigator; // after the link opens, drive the app while reading the screen (experimental)
  verified: Platform[];
  verifiedNetworks?: NetworkId[]; // confirmed only for these networks' games (default: all)
}

export interface AppDef {
  id: string;
  label: string;
  packages: Partial<Record<Platform, string[]>>; // first one installed wins
  routes: RouteDef[];
  appOnlyMessage: string; // steps to the game once the app is open; see lib/messages.ts placeholders
  hasProfilePicker: boolean;
}

export const APPS: AppDef[] = [
  {
    id: "youtube_tv", label: "YouTube TV",
    packages: { firetv: ["com.amazon.firetv.youtube.tv"], googletv: ["com.google.android.youtube.tvunplugged"] },
    routes: [
      {
        // Search the home team, open its game card, press Watch only on a page that names both teams.
        level: "game", via: "adb", template: "youtubetv://search?query={query}", params: { query: "^[A-Za-z0-9 .'&-]{2,60}$" },
        // Confirmed on 10 of 10 Sunday Ticket games; other leagues' games use the same pages but are untested.
        navigate: "youtube_tv_search", platforms: ["firetv"], verified: ["firetv"], verifiedNetworks: ["nfl_sunday_ticket", "cbs", "fox"],
      },
      { level: "channel", via: "adb", template: "https://tv.youtube.com/live", params: {}, verified: [] },
    ],
    appOnlyMessage: "Go to **Live** and pick **{away} at {home}** ({network}).",
    hasProfilePicker: true,
  },
  {
    id: "youtube", label: "YouTube",
    packages: { firetv: ["com.amazon.firetv.youtube"], googletv: ["com.google.android.youtube.tv"] },
    routes: [],
    appOnlyMessage: "Open **NFL Sunday Ticket** from your library and pick **{away} at {home}**.",
    hasProfilePicker: true,
  },
  {
    id: "espn", label: "ESPN",
    packages: { firetv: ["com.espn.gtv"], googletv: ["com.espn.score_center"] },
    routes: [{
      // The airing id comes from ESPN's Watch API (needs ESPN_WATCH_API_KEY).
      level: "game", via: "adb", template: "sportscenter://x-callback-url/showWatchStream?playID={airingId}",
      params: { airingId: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }, verified: ["firetv"],
    }],
    appOnlyMessage: "Go to **Live** and pick **{away} at {home}** ({network}).",
    hasProfilePicker: false,
  },
  {
    id: "fox_one", label: "Fox One",
    packages: { firetv: ["com.fox.foxone"], googletv: ["com.fox.foxone"] },
    routes: [{
      level: "channel", via: "adb", template: "foxone://channel/{callSign}", params: { callSign: "^[A-Z0-9]{2,8}$" },
      networks: ["fs1", "fs2", "btn"], verified: ["firetv"],
    }],
    appOnlyMessage: "Go to **Live**, then choose **{network}**.",
    hasProfilePicker: false,
  },
  {
    id: "prime_video", label: "Prime Video",
    packages: { firetv: ["com.amazon.firebat"], googletv: ["com.amazon.amazonvideo.livingroom"] },
    routes: [{
      level: "game", via: "adb", template: "https://app.primevideo.com/search?phrase={query}", params: { query: "^[A-Za-z0-9 .'&-]{2,60}$" },
      navigate: "prime_search", verified: [],
    }],
    appOnlyMessage: "Go to **Sports** (or **Live TV**) and pick **{away} at {home}**.",
    hasProfilePicker: true,
  },
  {
    id: "peacock", label: "Peacock",
    packages: { firetv: ["com.peacock.peacockfiretv"], googletv: ["com.peacocktv.peacockandroid"] },
    routes: [],
    appOnlyMessage: "Go to **Sports** and pick **{away} at {home}** (it's at the top while it's live).",
    hasProfilePicker: true,
  },
  {
    id: "paramount_plus", label: "Paramount+",
    packages: { firetv: ["com.cbs.ott"], googletv: ["com.cbs.ott"] },
    routes: [{ level: "channel", via: "adb", template: "https://www.paramountplus.com/live-tv/", params: {}, verified: [] }],
    appOnlyMessage: "Go to **Live TV** and choose your local **CBS** station.",
    hasProfilePicker: true,
  },
  {
    id: "hbo_max", label: "HBO Max",
    packages: { firetv: ["com.hbo.hbonow"], googletv: ["com.wbd.stream"] },
    routes: [],
    appOnlyMessage: "Go to **Sports**, then **Live & Upcoming**, and pick **{away} at {home}** ({network}).",
    hasProfilePicker: true,
  },
  {
    id: "netflix", label: "Netflix",
    packages: { firetv: ["com.netflix.ninja"], googletv: ["com.netflix.ninja"] },
    routes: [],
    appOnlyMessage: "The live game is the first row on the home screen while it's on: pick **{away} at {home}**.",
    hasProfilePicker: true,
  },
  {
    id: "apple_tv", label: "Apple TV",
    packages: { firetv: ["com.apple.atve.amazon.appletv"], googletv: ["com.apple.atve.androidtv.appletv"] },
    routes: [],
    appOnlyMessage: "Go to **Sports** (or search **Friday Night Baseball**) and pick **{away} at {home}**.",
    hasProfilePicker: false,
  },
  {
    id: "disney_plus", label: "Disney+",
    packages: { firetv: ["com.disney.disneyplus"], googletv: ["com.disney.disneyplus"] },
    routes: [],
    appOnlyMessage: "Go to **ESPN** in the menu and pick **{away} at {home}**.",
    hasProfilePicker: true,
  },
  {
    id: "hulu", label: "Hulu",
    packages: { firetv: ["com.hulu.plus"], googletv: ["com.hulu.livingroomplus"] },
    routes: [],
    appOnlyMessage: "Go to **Live**, open the **Guide**, and choose **{network}**.",
    hasProfilePicker: true,
  },
  {
    id: "sling", label: "Sling TV",
    packages: { firetv: ["com.sling"], googletv: ["com.sling"] },
    routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{network}**.",
    hasProfilePicker: false,
  },
  {
    id: "fubo", label: "Fubo",
    packages: { firetv: ["com.fubo.firetv.screen"], googletv: ["com.fubo.firetv.screen"] },
    routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{network}**.",
    hasProfilePicker: true,
  },
  {
    id: "directv", label: "DIRECTV",
    packages: { firetv: ["com.att.tv"], googletv: ["com.att.tv"] },
    routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{network}**.",
    hasProfilePicker: false,
  },
  {
    id: "xfinity", label: "Xfinity Stream", packages: { firetv: ["com.xfinity.cloudtvr.tenfoot"], googletv: ["com.xfinity.cloudtvr.tenfoot"] }, routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{network}**.", hasProfilePicker: false,
  },
  {
    id: "philo", label: "Philo", packages: { firetv: ["com.philo.philo.amazon"], googletv: ["com.philo.philo.google"] }, routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{network}**.", hasProfilePicker: false,
  },
  {
    id: "nba", label: "NBA",
    packages: { firetv: ["com.nbaimd.gametime.nba2011.amazon"], googletv: ["com.nbaimd.gametime.nba2011"] },
    routes: [{
      // NBA's own game id (e.g. 0022600123), looked up from NBA's public schedule.
      level: "game", via: "adb", template: "gametime://game/{nbaGameId}", params: { nbaGameId: "^00[0-9]{8}$" },
      networks: ["nba_league_pass", "nbatv"], verified: [],
    }],
    appOnlyMessage: "Go to **Games** and pick **{away} at {home}**.",
    hasProfilePicker: false,
  },
  {
    id: "mlb", label: "MLB",
    packages: { firetv: ["com.bamnetworks.mobile.android.gameday.atbat"], googletv: ["com.bamnetworks.mobile.android.gameday.atbat"] },
    routes: [{
      level: "game", via: "adb", template: "mlbatbat://mlbtv?date={gameDate}&gamepk={gamePk}",
      params: { gameDate: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", gamePk: "^[0-9]{4,9}$" }, verified: [],
    }],
    appOnlyMessage: "Go to **Today's Games** and pick **{away} at {home}**.",
    hasProfilePicker: false,
  },
  {
    id: "nhl", label: "NHL", packages: { firetv: ["com.nhl.gc1112.free"], googletv: ["com.nhl.gc1112.free"] }, routes: [],
    appOnlyMessage: "Pick **{away} at {home}** from today's games.", hasProfilePicker: false,
  },
  {
    id: "nfl", label: "NFL", packages: { firetv: ["com.gotv.nflgamecenter.us.lite"], googletv: ["com.gotv.nflgamecenter.us.lite"] }, routes: [],
    appOnlyMessage: "Open **NFL RedZone** or pick **{away} at {home}**.", hasProfilePicker: false,
  },
  {
    id: "dazn", label: "DAZN", packages: { firetv: ["com.dazn"], googletv: ["com.dazn"] }, routes: [],
    appOnlyMessage: "Go to **Schedule**, find your team, and pick **{away} at {home}**.", hasProfilePicker: false,
  },
  {
    id: "gotham", label: "Gotham Sports", packages: { firetv: ["com.gothamsports.gotham.tv"], googletv: ["com.gothamsports.gotham.tv"] }, routes: [],
    appOnlyMessage: "Pick **{away} at {home}** under **Live**.", hasProfilePicker: false,
  },
  {
    id: "nesn", label: "NESN 360", packages: { firetv: ["com.nesn.nesnplayer"], googletv: ["com.nesn.nesnplayer"] }, routes: [],
    appOnlyMessage: "Pick **{away} at {home}** under **Live**.", hasProfilePicker: false,
  },
  { id: "marquee", label: "Marquee Sports Network", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  { id: "chsn", label: "CHSN+", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  { id: "space_city", label: "Space City Home Network", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  { id: "altitude", label: "Altitude+", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  { id: "spectrum_sn", label: "Spectrum SportsNet", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  { id: "sportsnet_pit", label: "SportsNet Pittsburgh", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  { id: "masn", label: "MASN", packages: {}, routes: [], appOnlyMessage: "Pick the live game.", hasProfilePicker: false },
  // Each team's own streaming app (Jazz+, MavsTV+, Suns Live ...): too many to list, so you open it yourself.
  { id: "team_app", label: "your team's app", packages: {}, routes: [], appOnlyMessage: "Open your team's app and pick the live game.", hasProfilePicker: false },
  {
    id: "plex", label: "Plex",
    packages: { firetv: ["com.plexapp.android"], googletv: ["com.plexapp.android"] },
    routes: [{
      // Opens the Live TV guide; the server moves to the channel and presses SELECT only when the header matches.
      level: "channel", via: "adb", template: "plex://live-tv/dvr.guide/ota/{dvrKey}", params: { dvrKey: "^[0-9]{1,4}$" },
      navigate: "plex_guide", verified: ["firetv"],
    }],
    appOnlyMessage: "Go to **Live TV & DVR**, open the **Guide**, and choose **{channel}**.",
    hasProfilePicker: false,
  },
  {
    id: "channels", label: "Channels", packages: { firetv: ["com.getchannels.dvr.app"], googletv: ["com.getchannels.dvr.app"] }, routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{channel}**.", hasProfilePicker: false,
  },
  {
    id: "tablo", label: "Tablo", packages: { firetv: ["com.nuvyyo.TabloFAST"], googletv: ["com.nuvyyo.TabloFAST"] }, routes: [],
    appOnlyMessage: "Open the **Guide** and choose **{channel}**.", hasProfilePicker: false,
  },
  {
    id: "hdhomerun", label: "HDHomeRun", packages: { firetv: ["com.silicondust.view"], googletv: ["com.silicondust.view"] }, routes: [],
    appOnlyMessage: "Choose **{channel}** from the channel list.", hasProfilePicker: false,
  },
];

export const APP_BY_ID: ReadonlyMap<string, AppDef> = new Map(APPS.map((a) => [a.id, a]));

export function packageFor(app: AppDef, platform: Platform, installed?: string): string | null {
  if (installed && (app.packages[platform] ?? []).includes(installed)) return installed;
  return app.packages[platform]?.[0] ?? null;
}

export const isVerified = (r: RouteDef, network: NetworkId, platform: Platform) =>
  r.verified.includes(platform) && (!r.verifiedNetworks || r.verifiedNetworks.includes(network));

/** Routes the driver should try on this platform, best level first, verified before unverified. */
export function routesToTry(app: AppDef, network: NetworkId, platform: Platform): RouteDef[] {
  const rank = { game: 2, channel: 1 } as const;
  return app.routes
    .filter((r) => (!r.networks || r.networks.includes(network)) && (!r.platforms || r.platforms.includes(platform)))
    .slice()
    .sort((a, b) => rank[b.level] - rank[a.level] || Number(isVerified(b, network, platform)) - Number(isVerified(a, network, platform)));
}

/** Best level an app reaches for a network on a platform, counting only verified routes. */
export function verifiedLevel(app: AppDef, network: NetworkId, platform: Platform): LaunchLevel {
  let best: LaunchLevel = "app";
  for (const r of routesToTry(app, network, platform)) {
    if (!isVerified(r, network, platform)) continue;
    if (r.level === "game") return "game";
    best = "channel";
  }
  return best;
}

/** Best level an app may reach (verified or not): what the card can promise as "might open the game". */
export function bestLevel(app: AppDef, network: NetworkId, platform: Platform): LaunchLevel {
  const r = routesToTry(app, network, platform)[0];
  return r ? r.level : "app";
}

const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
export function isValidPackage(p: string): boolean {
  return PACKAGE_RE.test(p) && p.length <= 150;
}

// Deliberately narrower than RFC 3986: no quotes, $, backticks, parens, ; or ! even though they're legal in URLs.
// URIs are shell-quoted anyway; this is a second layer, checked on every catalog route by the tests.
const URI_CHARS = "[A-Za-z0-9._~%&=+,:@/?#{}-]";
const TEMPLATE_RE = new RegExp(`^(https://[a-z0-9.-]+\\.[a-z]{2,}(/${URI_CHARS}*)?|[a-z][a-z0-9+.-]{1,30}://${URI_CHARS}*)$`);
// Schemes that read local files or start arbitrary components rather than opening an app.
const BLOCKED_SCHEMES = /^(file|content|intent|javascript|data|android-app|jar|about):/i;

export function isValidTemplate(t: string): boolean {
  return TEMPLATE_RE.test(t) && t.length <= 300 && !BLOCKED_SCHEMES.test(t);
}
