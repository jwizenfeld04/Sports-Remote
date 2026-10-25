// Where games air, as ESPN's scoreboard labels them (178 labels observed across all four leagues, Oct 2026).
// Three kinds:
//  - national networks and streamers (ESPN, NBC, Peacock, Prime Video ...)
//  - out-of-market packages that ESPN lists like networks (MLB.TV, NBA League Pass, NHL on ESPN+)
//  - local outlets for a team's regional games (DAZN, MSG, NESN, a team's app, a local TV station ...)

export const NETWORK_IDS = [
  // Broadcast networks. On a live TV service or antenna these mean the local affiliate.
  "abc", "cbs", "fox", "nbc",
  // Cable
  "espn", "espn2", "espnu", "espnews", "secn", "accn", "fs1", "fs2", "btn", "cbssn", "nbcsn",
  "tnt", "tbs", "trutv", "nbatv", "nflnet", "mlbnet", "nhlnet",
  // Streaming
  "espn_plus", "disney_plus", "hulu", "hbo_max", "peacock", "prime", "netflix", "apple", "youtube",
  // Out-of-market packages ESPN lists on games
  "mlbtv", "mlb_gotd", "nba_league_pass", "nhl_power_play", "nfl_sunday_ticket",
  // A team's regional broadcast (see `outlet` on the broadcast) and anything we can't place
  "local", "unknown",
] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export const NETWORK_LABEL: Record<NetworkId, string> = {
  abc: "ABC", cbs: "CBS", fox: "FOX", nbc: "NBC",
  espn: "ESPN", espn2: "ESPN2", espnu: "ESPNU", espnews: "ESPNews", secn: "SEC Network", accn: "ACC Network",
  fs1: "FS1", fs2: "FS2", btn: "Big Ten Network", cbssn: "CBS Sports Network", nbcsn: "NBCSN",
  tnt: "TNT", tbs: "TBS", trutv: "truTV", nbatv: "NBA TV", nflnet: "NFL Network", mlbnet: "MLB Network", nhlnet: "NHL Network",
  espn_plus: "ESPN+", disney_plus: "Disney+", hulu: "Hulu", hbo_max: "HBO Max", peacock: "Peacock", prime: "Prime Video",
  netflix: "Netflix", apple: "Apple TV", youtube: "YouTube",
  mlbtv: "MLB.TV", mlb_gotd: "MLB.TV game of the day", nba_league_pass: "NBA League Pass", nhl_power_play: "NHL Power Play", nfl_sunday_ticket: "NFL Sunday Ticket",
  local: "Local", unknown: "Unknown",
};

export type NetworkKind = "broadcast" | "cable" | "streaming" | "package" | "local" | "unknown";
export const NETWORK_KIND: Record<NetworkId, NetworkKind> = Object.fromEntries(NETWORK_IDS.map((id) => [id,
  ["abc", "cbs", "fox", "nbc"].includes(id) ? "broadcast"
    : ["espn_plus", "disney_plus", "hulu", "hbo_max", "peacock", "prime", "netflix", "apple", "youtube"].includes(id) ? "streaming"
      : ["mlbtv", "mlb_gotd", "nba_league_pass", "nhl_power_play", "nfl_sunday_ticket"].includes(id) ? "package"
        : id === "local" ? "local" : id === "unknown" ? "unknown" : "cable",
])) as Record<NetworkId, NetworkKind>;

/** Local outlets: who carries a team's regional games. */
export const OUTLET_IDS = [
  "dazn", "msg", "yes", "sny", "nesn", "marquee", "chsn", "schn", "sportsnet_la", "spectrum_sn", "masn", "monumental",
  "altitude", "nbcs_boston", "nbcs_bayarea", "nbcs_california", "nbcs_philadelphia", "prime_local", "mlb_local",
  "bravesvision", "rangers_sn", "sportsnet_pit", "detroit_sn", "team_app", "ota",
  // A regional label we can't tie to a current network (older listings still use some retired names).
  "rsn",
  // Canadian networks: not covered by US services.
  "canada",
] as const;
export type OutletId = (typeof OUTLET_IDS)[number];

export const OUTLET_LABEL: Record<OutletId, string> = {
  dazn: "DAZN", msg: "MSG", yes: "YES Network", sny: "SNY", nesn: "NESN", marquee: "Marquee Sports Network", chsn: "CHSN",
  schn: "Space City Home Network", sportsnet_la: "SportsNet LA", spectrum_sn: "Spectrum SportsNet", masn: "MASN",
  monumental: "Monumental Sports Network", altitude: "Altitude", nbcs_boston: "NBC Sports Boston", nbcs_bayarea: "NBC Sports Bay Area",
  nbcs_california: "NBC Sports California", nbcs_philadelphia: "NBC Sports Philadelphia", prime_local: "Prime Video (local)",
  mlb_local: "MLB local stream", bravesvision: "BravesVision", rangers_sn: "Rangers Sports Network", sportsnet_pit: "SportsNet Pittsburgh",
  detroit_sn: "Detroit SportsNet", team_app: "Team app", ota: "Local TV station", rsn: "Regional sports network",
  canada: "Canadian network",
};

/** Lowercase, no spaces or punctuation, "+" spelled out: "Prime Video (Local)" -> "primevideolocal", "ESPN+" -> "espnplus". */
export function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/\+/g, "plus").replace(/[\s.\-_'’()]/g, "");
}

// Exact labels (normalized) -> national network or package.
const NATIONAL: Record<string, NetworkId> = {
  abc: "abc", cbs: "cbs", cbssports: "cbs", fox: "fox", foxsports: "fox", nbc: "nbc", nbcsports: "nbc",
  espn: "espn", espn2: "espn2", espnu: "espnu", espnews: "espnews", secn: "secn", secnetwork: "secn", accn: "accn", accnetwork: "accn",
  fs1: "fs1", fs2: "fs2", btn: "btn", bigtennetwork: "btn", cbssn: "cbssn", cbssportsnetwork: "cbssn", nbcsn: "nbcsn",
  tnt: "tnt", tntsports: "tnt", tbs: "tbs", trutv: "trutv", nbatv: "nbatv", nflnet: "nflnet", nflnetwork: "nflnet",
  mlbnet: "mlbnet", mlbnetwork: "mlbnet", nhlnet: "nhlnet", nhlnetwork: "nhlnet",
  espnplus: "espn_plus", disney: "disney_plus", disneyplus: "disney_plus", hulu: "hulu", hbomax: "hbo_max", max: "hbo_max",
  peacock: "peacock", prime: "prime", primevideo: "prime", amazonprimevideo: "prime", amazon: "prime",
  netflix: "netflix", appletv: "apple", appletvplus: "apple", youtube: "youtube", youtubetv: "youtube",
  mlbtv: "mlbtv", espnunlmtd: "mlb_gotd", espnunlimited: "mlb_gotd", nbaleaguepass: "nba_league_pass", nhlpowerplay: "nhl_power_play",
};

// Local outlets, matched in order against the normalized label.
const OUTLETS: [RegExp, OutletId][] = [
  [/^primevideolocal$/, "prime_local"],
  [/^dazn/, "dazn"],
  [/^msg|^msgsn|^msgb|^msg2/, "msg"],
  [/^yes(network)?$/, "yes"],
  [/^sny$/, "sny"],
  [/^nesn/, "nesn"],
  [/^marquee/, "marquee"],
  [/^chsn/, "chsn"],
  [/^spacecity|^schn/, "schn"],
  [/^sportsnetla$/, "sportsnet_la"],
  [/^spectrumsports(net)?/, "spectrum_sn"],
  [/^masn/, "masn"],
  [/^mnmt|^monumental/, "monumental"],
  [/^altitude/, "altitude"],
  [/^nbcsportsbo|^nbcsboston/, "nbcs_boston"],
  [/^nbcsportsba|^nbcsbayarea/, "nbcs_bayarea"],
  [/^nbcsportsca|^nbcsca|^nbcscalifornia/, "nbcs_california"],
  [/^nbcsportsphil|^nbcsphil/, "nbcs_philadelphia"],
  [/^bravesvision/, "bravesvision"],
  [/^rangerssportsnetwork/, "rangers_sn"],
  [/^sportsnetpittsburgh|^sportsnetpit|^snp$/, "sportsnet_pit"],
  [/^dsn$|^detroitsportsnet/, "detroit_sn"],
  [/^fanduel|^fdsn|^bally|^victory/, "rsn"], // retired regional networks that older ESPN listings still name
  [/^sportsnet(one)?$|^tva$|^tsn/, "canada"],
  // Team apps and team-run networks
  [/vision$|app$|^jazz|^mavstv|^sunslive|^pelicanscom|^mammoth|^gcsen|^abtv|^bn(plus)?$|^carnhl|^cbjnhl|^minnhl|^khn$|^snc(plus)?$|^local10plus/, "team_app"],
  // Over-the-air stations: call signs (KTLA, WPIX, KCOP ...), "Fox 5 WTTG", "NBC 10", "CW33", Scripps' The Spot ...
  [/^[kw][a-z]{2,3}(tv|dt)?\d*|^(fox|nbc|abc|cbs|cw|my)\d+|^arizonasfamily|^graymedia|^mymi|^scripps|^thespot|^utah16|^tvazteca|^fox11plus|^delmarva|^pix11/, "ota"],
];

export interface LabelInfo {
  network: NetworkId;
  outlet?: OutletId;
  radio?: boolean;
}

/** What a single ESPN broadcast label means, before looking at the rest of the game. */
export function classifyLabel(raw: string): LabelInfo {
  const n = normalizeLabel(raw);
  if (n === "eradm" || /radio/.test(n)) return { network: "unknown", radio: true };
  if (NATIONAL[n]) return { network: NATIONAL[n] };
  // MLB Local Media team streams: "Brewers.TV", "CLEGuardians.TV", "DBACKS.TV" (a dot, unlike "KMSP-TV" or "MavsTV").
  if (/^[A-Za-z]+\.TV$/i.test(raw.trim())) return { network: "local", outlet: "mlb_local" };
  for (const [re, outlet] of OUTLETS) if (re.test(n)) return { network: "local", outlet };
  return { network: "unknown" };
}
