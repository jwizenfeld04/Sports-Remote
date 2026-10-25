import type { League } from "../types";
import type { NetworkId, OutletId } from "./networks";

// What people pay for, and what each one lets them watch. Researched Oct 2026 (sources in sources.json, keyed by
// id). Prices change often; they're shown as a guide only. `maybe` lists things reported but not confirmed: the
// coverage screen shows those as "probably" rather than "yes".
//
// A grant is one of:
//   "espn"              a network (on a live TV service, abc/cbs/fox/nbc mean your local station)
//   "cbs@nfl"           a network, but only that league's games on it
//   "outlet:dazn"       a team's regional games carried by that outlet
//   "nfl_sunday_ticket" an out-of-market package (also mlbtv, nba_league_pass, nhl_power_play, mlb_gotd)

export type Grant = NetworkId | `${NetworkId}@${League}` | `outlet:${OutletId}` | "nfl_redzone";

export type SubscriptionKind = "live_tv" | "streaming" | "league" | "regional" | "antenna";

export interface Tier {
  id: string;
  name: string;
  price?: string;
  grants: Grant[];
  maybe?: Grant[];
}

export interface SubscriptionDef {
  id: string;
  name: string;
  kind: SubscriptionKind;
  price?: string; // when there are no tiers
  /** Pick one. Tier grants add to `grants`. */
  tiers?: Tier[];
  defaultTier?: string;
  grants: Grant[];
  maybe?: Grant[];
  addOns?: Tier[];
  /** Apps where this subscription's content plays (catalog app ids), best first. */
  apps: string[];
  /** Signing in to these apps with this TV provider unlocks the listed subscription (TV Everywhere). */
  unlocks?: { subscription: string; tier?: string; app: string; maybeOnly?: boolean }[];
  league?: League;
  blurb: string;
  blackouts?: string;
  confidence: "high" | "medium" | "low";
}

const LOCALS: Grant[] = ["abc", "cbs", "fox", "nbc"];
const ESPN_LINEAR: Grant[] = ["espn", "espn2", "espnu", "espnews", "secn", "accn"];

export const SUBSCRIPTIONS: SubscriptionDef[] = [
  // ---------- Live TV services ----------
  {
    id: "youtube_tv", name: "YouTube TV", kind: "live_tv", defaultTier: "base",
    tiers: [
      {
        id: "base", name: "Base plan", price: "$82.99/mo",
        grants: [...LOCALS, ...ESPN_LINEAR, "espn_plus", "fs1", "fs2", "btn", "cbssn", "nbcsn", "tnt", "tbs", "trutv", "nflnet",
          "outlet:nbcs_bayarea", "outlet:nbcs_california", "outlet:nbcs_boston", "outlet:nbcs_philadelphia", "outlet:sny"],
        maybe: ["nbatv", "mlbnet", "outlet:marquee"],
      },
      {
        id: "sports", name: "Sports plan", price: "$64.99/mo",
        grants: [...LOCALS, ...ESPN_LINEAR, "espn_plus", "fs1", "btn", "cbssn", "nbcsn", "nflnet"],
        maybe: ["fs2", "tnt", "tbs", "trutv", "nbatv", "mlbnet"],
      },
    ],
    grants: [],
    addOns: [{ id: "sports_plus", name: "Sports Plus", price: "$10.99/mo", grants: ["nfl_redzone"], maybe: ["nhlnet"] }],
    apps: ["youtube_tv"],
    unlocks: [{ subscription: "espn", tier: "unlimited", app: "espn" }, { subscription: "fox_one", app: "fox_one", maybeOnly: true }],
    blurb: "Locals in most markets, every ESPN channel (ESPN Unlimited is built in since Sept 2026), FS1, TNT/TBS, NBCSN and NFL Network. Sunday Ticket is an add-on.",
    blackouts: "Regional sports networks are limited (NBC Sports regionals and SNY; no MSG, NESN or DAZN teams).",
    confidence: "high",
  },
  {
    id: "hulu_live", name: "Hulu + Live TV", kind: "live_tv", price: "$99.99/mo",
    grants: [...LOCALS, ...ESPN_LINEAR, "espn_plus", "disney_plus", "hulu", "fs1", "fs2", "btn", "cbssn", "nbcsn", "tnt", "tbs", "trutv", "nflnet"],
    maybe: ["nbatv", "mlbnet", "nhlnet", "outlet:nbcs_bayarea", "outlet:nbcs_california", "outlet:nbcs_boston", "outlet:nbcs_philadelphia"],
    apps: ["hulu"],
    unlocks: [{ subscription: "espn", tier: "unlimited", app: "espn", maybeOnly: true }, { subscription: "fox_one", app: "fox_one", maybeOnly: true }],
    blurb: "Locals, ESPN channels, FS1, TNT/TBS and NFL Network, with Disney+ and ESPN content included.",
    confidence: "medium",
  },
  {
    id: "fubo", name: "Fubo", kind: "live_tv", defaultTier: "pro",
    tiers: [
      { id: "sports", name: "Sports", price: "$64.99/mo", grants: [...LOCALS, "espn", "fs1", "nflnet", "nfl_redzone", "mlbnet", "nhlnet"], maybe: ["espn2", "espnu", "fs2", "btn", "nbcsn", "nbatv"] },
      {
        id: "pro", name: "Pro", price: "$88.99/mo + regional fee",
        grants: [...LOCALS, ...ESPN_LINEAR, "espn_plus", "fs1", "fs2", "btn", "cbssn", "nbcsn", "nbatv", "nflnet", "mlbnet", "nhlnet",
          "outlet:nbcs_bayarea", "outlet:nbcs_california", "outlet:nbcs_boston", "outlet:nbcs_philadelphia", "outlet:sny", "outlet:nesn",
          "outlet:marquee", "outlet:monumental", "outlet:sportsnet_pit", "outlet:schn"],
        maybe: ["outlet:msg", "outlet:yes", "outlet:altitude", "outlet:chsn"],
      },
    ],
    grants: [],
    addOns: [{ id: "redzone", name: "Sports Plus with NFL RedZone", grants: ["nfl_redzone"] }],
    apps: ["fubo"],
    unlocks: [{ subscription: "espn", tier: "unlimited", app: "espn", maybeOnly: true }, { subscription: "fox_one", app: "fox_one", maybeOnly: true }],
    blurb: "The most regional sports networks of the live TV apps. Never carries TNT, TBS or truTV.",
    blackouts: "No TNT/TBS/truTV: NHL on TNT and MLB on TBS aren't on Fubo.",
    confidence: "medium",
  },
  {
    id: "sling", name: "Sling TV", kind: "live_tv", defaultTier: "orange_blue",
    tiers: [
      { id: "orange", name: "Orange", price: "$45.99/mo", grants: ["espn", "espn2", "tnt", "tbs", "trutv"] },
      { id: "blue", name: "Blue", price: "$45.99/mo", grants: ["fs1", "nflnet", "tnt", "tbs", "trutv"], maybe: ["abc", "fox", "nbc", "nbcsn"] },
      { id: "orange_blue", name: "Orange & Blue", price: "$60.99/mo", grants: ["espn", "espn2", "fs1", "nflnet", "tnt", "tbs", "trutv"], maybe: ["abc", "fox", "nbc", "nbcsn"] },
    ],
    grants: [],
    addOns: [{ id: "sports_extra", name: "Sports Extra", price: "~$11/mo", grants: ["espnu", "secn", "accn", "fs2", "btn", "nbatv", "mlbnet", "nhlnet"], maybe: ["nfl_redzone"] }],
    apps: ["sling"],
    unlocks: [{ subscription: "espn", tier: "unlimited", app: "espn", maybeOnly: true }],
    blurb: "Cheapest way to ESPN and TNT. No CBS anywhere, and ABC/FOX/NBC only in some markets.",
    confidence: "medium",
  },
  {
    id: "directv", name: "DIRECTV Stream", kind: "live_tv", defaultTier: "mysports",
    tiers: [
      {
        id: "mysports", name: "MySports", price: "$64.99/mo",
        grants: [...LOCALS, ...ESPN_LINEAR, "espn_plus", "fs1", "fs2", "btn", "cbssn", "tnt", "tbs", "trutv", "nbatv", "nflnet", "mlbnet", "nhlnet"],
      },
      {
        id: "choice", name: "Choice or above", price: "~$100+/mo + regional fee",
        grants: [...LOCALS, ...ESPN_LINEAR, "espn_plus", "fs1", "fs2", "btn", "cbssn", "tnt", "tbs", "trutv", "nbatv", "nflnet", "mlbnet", "nhlnet",
          "outlet:msg", "outlet:yes", "outlet:nesn", "outlet:marquee", "outlet:chsn", "outlet:schn", "outlet:sportsnet_la", "outlet:spectrum_sn",
          "outlet:masn", "outlet:monumental", "outlet:altitude", "outlet:sportsnet_pit", "outlet:sny",
          "outlet:nbcs_bayarea", "outlet:nbcs_california", "outlet:nbcs_boston", "outlet:nbcs_philadelphia"],
      },
    ],
    grants: [],
    apps: ["directv"],
    unlocks: [{ subscription: "espn", tier: "unlimited", app: "espn" }, { subscription: "fox_one", app: "fox_one", maybeOnly: true }],
    blurb: "Best regional sports network coverage on Choice and up. No NBCSN.",
    confidence: "medium",
  },
  {
    id: "xfinity", name: "Xfinity streaming TV", kind: "live_tv", price: "varies",
    grants: [...LOCALS, "espn", "fs1", "nbcsn", "peacock"],
    maybe: ["espn2", "tnt", "tbs", "outlet:nbcs_boston", "outlet:nbcs_philadelphia", "outlet:nbcs_bayarea", "outlet:nbcs_california"],
    apps: ["xfinity"],
    unlocks: [{ subscription: "peacock", tier: "premium", app: "peacock", maybeOnly: true }, { subscription: "espn", tier: "unlimited", app: "espn", maybeOnly: true }],
    blurb: "Comcast's streaming packages (need Xfinity internet). Lineups vary.",
    confidence: "low",
  },
  {
    id: "philo", name: "Philo", kind: "live_tv", price: "$33/mo", grants: [], apps: ["philo"],
    blurb: "No live sports channels.", confidence: "high",
  },

  // ---------- Streaming apps ----------
  {
    id: "espn", name: "ESPN", kind: "streaming", defaultTier: "unlimited",
    tiers: [
      { id: "select", name: "ESPN Select (was ESPN+)", price: "$13.99/mo", grants: ["espn_plus", "nhl_power_play"] },
      { id: "unlimited", name: "ESPN Unlimited", price: "$31.99/mo", grants: [...ESPN_LINEAR, "espn_plus", "abc", "nflnet", "nhl_power_play", "mlb_gotd"] },
    ],
    grants: [],
    apps: ["espn"],
    blurb: "Unlimited has every ESPN channel, ABC's games, NFL Network and out-of-market NHL. Select has ESPN+ shows and out-of-market NHL only.",
    blackouts: "NHL Power Play blacks out your local NHL teams and national games. The MLB game of the day is blacked out in-market.",
    confidence: "high",
  },
  {
    id: "fox_one", name: "Fox One", kind: "streaming", price: "$19.99/mo",
    grants: ["fox", "fs1", "fs2", "btn"], apps: ["fox_one"],
    blurb: "Your local FOX station plus FS1, FS2 and Big Ten Network.", confidence: "high",
  },
  {
    id: "peacock", name: "Peacock", kind: "streaming", defaultTier: "premium",
    tiers: [
      { id: "premium", name: "Premium", price: "$12.99/mo", grants: ["peacock", "nbc"], maybe: ["nbcsn"] },
      { id: "premium_plus", name: "Premium Plus", price: "$19.99/mo", grants: ["peacock", "nbc"], maybe: ["nbcsn"] },
    ],
    grants: [],
    addOns: [
      { id: "nbcs_boston", name: "NBC Sports Boston", price: "add-on, in-market", grants: ["outlet:nbcs_boston"] },
      { id: "nbcs_philadelphia", name: "NBC Sports Philadelphia", price: "add-on, in-market", grants: ["outlet:nbcs_philadelphia"] },
      { id: "nbcs_bayarea", name: "NBC Sports Bay Area", price: "add-on, in-market", grants: ["outlet:nbcs_bayarea"] },
      { id: "nbcs_california", name: "NBC Sports California", price: "add-on, in-market", grants: ["outlet:nbcs_california"] },
    ],
    apps: ["peacock"],
    blurb: "Sunday Night Football, all 100 NBA games on NBC/Peacock, MLB Sunday Night Baseball, and Peacock exclusives.",
    confidence: "high",
  },
  {
    id: "paramount_plus", name: "Paramount+", kind: "streaming", defaultTier: "premium",
    tiers: [
      { id: "essential", name: "Essential", price: "$8.99/mo", grants: ["cbs@nfl"] },
      { id: "premium", name: "Premium", price: "$13.99/mo", grants: ["cbs"] },
    ],
    grants: [], apps: ["paramount_plus"],
    blurb: "Your local CBS station (Premium), or just CBS's NFL games in your market (Essential).", confidence: "high",
  },
  {
    id: "prime_video", name: "Prime Video", kind: "streaming", price: "$14.99/mo with Prime",
    grants: ["prime"], maybe: ["outlet:prime_local"],
    addOns: [{ id: "nba_league_pass", name: "NBA League Pass (Prime Video Channel)", price: "$16.99/mo", grants: ["nba_league_pass", "nbatv"] }],
    apps: ["prime_video"],
    blurb: "Thursday Night Football, NBA on Prime, and some teams' local games (Hawks, Stars and Ducks included; Hurricanes, Blue Jackets, Wild and Blues as add-ons).",
    confidence: "high",
  },
  { id: "netflix", name: "Netflix", kind: "streaming", price: "from ~$7.99/mo", grants: ["netflix"], apps: ["netflix"], blurb: "NFL Christmas and other one-off games, MLB Opening Night and the Home Run Derby.", confidence: "high" },
  { id: "apple_tv", name: "Apple TV", kind: "streaming", price: "$12.99/mo", grants: ["apple"], apps: ["apple_tv"], blurb: "MLB Friday Night Baseball (2026; Apple's plans after that are unclear).", confidence: "medium" },
  {
    id: "hbo_max", name: "HBO Max", kind: "streaming", defaultTier: "standard",
    tiers: [
      { id: "basic", name: "Basic with Ads", price: "$10.99/mo", grants: [] },
      { id: "standard", name: "Standard or Premium", price: "$18.49/mo+", grants: ["hbo_max", "tnt", "tbs", "trutv"] },
    ],
    grants: [], apps: ["hbo_max"],
    blurb: "TNT, TBS and truTV sports: NHL and MLB. No NBA since 2025. Basic with Ads has no live sports.", confidence: "medium",
  },
  { id: "disney_plus", name: "Disney+", kind: "streaming", price: "from $11.99/mo", grants: ["disney_plus"], apps: ["disney_plus"], blurb: "Some ESPN games are simulcast here (Monday Night Football, NHL on ESPN+).", confidence: "medium" },

  // ---------- League packages ----------
  {
    id: "nfl_sunday_ticket", name: "NFL Sunday Ticket", kind: "league", league: "nfl", defaultTier: "youtube_tv",
    tiers: [
      { id: "youtube_tv", name: "With YouTube TV", price: "$378/season", grants: [] },
      { id: "primetime_channel", name: "On YouTube (Primetime Channels)", price: "$480/season", grants: [] },
    ],
    grants: ["nfl_sunday_ticket"], apps: ["youtube_tv", "youtube"],
    blurb: "Every out-of-market Sunday afternoon game on CBS and FOX.",
    blackouts: "Your local CBS/FOX games, and every primetime or exclusive game.", confidence: "high",
  },
  {
    id: "nfl_plus", name: "NFL+", kind: "league", league: "nfl", defaultTier: "premium",
    tiers: [
      { id: "base", name: "NFL+", price: "$6.99/mo", grants: [] },
      { id: "premium", name: "NFL+ Premium", price: "$14.99/mo", grants: ["nfl_redzone"] },
    ],
    grants: [], apps: ["nfl"],
    blurb: "Live local and primetime games on phones and tablets only, so not on a TV. Premium adds NFL RedZone.", confidence: "medium",
  },
  {
    id: "nba_league_pass", name: "NBA League Pass", kind: "league", league: "nba", defaultTier: "standard",
    tiers: [
      { id: "standard", name: "League Pass", price: "$16.99/mo or $109.99/season", grants: ["nba_league_pass", "nbatv"] },
      { id: "premium", name: "League Pass Premium", price: "$24.99/mo", grants: ["nba_league_pass", "nbatv"] },
      { id: "nbatv", name: "NBA TV only", price: "$8.99/mo", grants: ["nbatv"] },
    ],
    grants: [], apps: ["nba"],
    blurb: "Every out-of-market NBA game, plus NBA TV.",
    blackouts: "Your local teams, and every national game (ESPN, ABC, NBC, Peacock, Prime).", confidence: "medium",
  },
  {
    id: "mlbtv", name: "MLB.TV", kind: "league", league: "mlb", price: "$149.99/season (via ESPN)",
    grants: ["mlbtv"],
    addOns: [{ id: "in_market", name: "Your team's in-market stream", price: "~$19.99/mo", grants: ["outlet:mlb_local"] }],
    apps: ["mlb", "espn"],
    blurb: "Every out-of-market MLB game. Sold through ESPN since 2026; also plays in the MLB app.",
    blackouts: "Your local teams (unless you add their in-market stream), national exclusives and the postseason.", confidence: "medium",
  },

  // ---------- Regional (your local teams) ----------
  { id: "dazn", name: "DAZN", kind: "regional", price: "$19.99/mo", grants: ["outlet:dazn"], apps: ["dazn"], blurb: "Local games for about nine NBA teams (Cavaliers, Pacers, Spurs, Grizzlies, Timberwolves, Pistons, Hornets, Magic, Nets) and the Kings.", confidence: "medium" },
  { id: "gotham", name: "Gotham Sports (MSG + YES)", kind: "regional", price: "$34.99/mo", grants: ["outlet:msg", "outlet:yes"], apps: ["gotham"], blurb: "Knicks, Rangers, Islanders, Devils, Sabres, Yankees and Nets.", confidence: "medium" },
  { id: "sny", name: "SNY", kind: "regional", price: "~$149.99/yr", grants: ["outlet:sny"], apps: ["mlb"], blurb: "Mets games, sold in the MLB app.", confidence: "medium" },
  { id: "nesn_360", name: "NESN 360", kind: "regional", price: "$29.99/mo", grants: ["outlet:nesn"], apps: ["nesn"], blurb: "Red Sox and Bruins.", confidence: "high" },
  { id: "marquee", name: "Marquee Sports Network", kind: "regional", price: "~$20/mo", grants: ["outlet:marquee"], apps: ["marquee"], blurb: "Cubs.", confidence: "medium" },
  { id: "chsn", name: "CHSN+", kind: "regional", price: "$20/mo", grants: ["outlet:chsn"], apps: ["chsn"], blurb: "Bulls, Blackhawks and White Sox.", confidence: "medium" },
  { id: "monumental", name: "Monumental+", kind: "regional", price: "$19.99/mo", grants: ["outlet:monumental"], apps: ["dazn"], blurb: "Wizards and Capitals (in the DAZN app).", confidence: "medium" },
  { id: "space_city", name: "Space City Home Network", kind: "regional", price: "$20/mo", grants: ["outlet:schn"], apps: ["space_city"], blurb: "Rockets and Astros.", confidence: "medium" },
  { id: "altitude", name: "Altitude+", kind: "regional", price: "$20/mo", grants: ["outlet:altitude"], apps: ["altitude"], blurb: "Nuggets and Avalanche.", confidence: "medium" },
  { id: "spectrum_sn", name: "Spectrum SportsNet+", kind: "regional", price: "~$20/mo", grants: ["outlet:spectrum_sn", "outlet:sportsnet_la"], apps: ["spectrum_sn"], blurb: "Lakers and Dodgers.", confidence: "medium" },
  { id: "sportsnet_pit", name: "SportsNet Pittsburgh", kind: "regional", price: "~$100/season", grants: ["outlet:sportsnet_pit"], apps: ["sportsnet_pit"], blurb: "Penguins and Pirates.", confidence: "low" },
  { id: "detroit_sn", name: "Detroit SportsNet", kind: "regional", price: "~$140", grants: ["outlet:detroit_sn"], apps: ["mlb"], blurb: "Red Wings and Tigers.", confidence: "low" },
  { id: "masn", name: "MASN", kind: "regional", price: "varies", grants: ["outlet:masn"], apps: ["masn"], blurb: "Orioles.", confidence: "low" },
  { id: "rangers_sn", name: "Rangers Sports Network", kind: "regional", price: "varies", grants: ["outlet:rangers_sn"], apps: ["team_app"], blurb: "Rangers.", confidence: "low" },
  { id: "bravesvision", name: "BravesVision", kind: "regional", price: "varies", grants: ["outlet:bravesvision"], apps: ["mlb"], blurb: "Braves.", confidence: "low" },
  { id: "team_app", name: "A team's own app", kind: "regional", price: "~$15–20/mo", grants: ["outlet:team_app"], apps: ["team_app"], blurb: "Jazz+, MavsTV+, Suns Live, Bucks App, Thunder App, ClipperVision, BlazerVision, team hockey networks and more.", confidence: "low" },

  // ---------- Antenna ----------
  {
    id: "antenna", name: "Antenna (over the air)", kind: "antenna", price: "free",
    grants: [...LOCALS, "outlet:ota"],
    apps: ["plex", "channels", "tablo", "hdhomerun"],
    blurb: "Free local ABC, CBS, FOX and NBC, plus the local stations that now carry many NBA and NHL teams. Through Plex, Channels, Tablo or HDHomeRun.",
    confidence: "high",
  },
];

export const SUBSCRIPTION_BY_ID: ReadonlyMap<string, SubscriptionDef> = new Map(SUBSCRIPTIONS.map((s) => [s.id, s]));
