import type { OutletId } from "./networks";

// Where each NBA, MLB and NHL team's local (regional) games air in 2026–27, for setup: "your local teams and how
// you'd watch them". From the research in Oct 2026 (Sports Media Watch local guides, team announcements). The
// game feed (ESPN labels) is the source of truth per game; this table is the default the wizard suggests.
// NFL teams have no regional networks: their games are on the local CBS/FOX/NBC/ABC stations.

export interface LocalTeam {
  outlets: OutletId[];
  /** Subscriptions that carry the team's local games, best first (catalog ids). */
  subs: string[];
  note: string;
}

export const LOCAL_TEAMS: Record<string, LocalTeam> = {
  // ---------- NBA ----------
  "nba:ATL": { outlets: ["ota", "prime_local"], subs: ["prime_video", "antenna"], note: "Atlanta News First / Peachtree Sports Network over the air; streams on Prime Video (included with Prime)." },
  "nba:BOS": { outlets: ["nbcs_boston"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports Boston; Peacock add-on." },
  "nba:BKN": { outlets: ["yes", "dazn"], subs: ["gotham", "dazn", "directv", "fubo"], note: "YES Network; DAZN (YES) stream." },
  "nba:CHA": { outlets: ["ota", "dazn"], subs: ["antenna", "dazn"], note: "WSOC/WAXN over the air; DAZN." },
  "nba:CHI": { outlets: ["chsn"], subs: ["chsn", "directv", "fubo"], note: "Chicago Sports Network; CHSN+." },
  "nba:CLE": { outlets: ["ota", "dazn"], subs: ["antenna", "dazn"], note: "Local stations; DAZN." },
  "nba:DAL": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "KFAA/WFAA over the air; MavsTV+." },
  "nba:DEN": { outlets: ["altitude", "ota"], subs: ["altitude", "directv", "antenna"], note: "Altitude Sports (some games on 9NEWS); Altitude+." },
  "nba:DET": { outlets: ["ota", "dazn"], subs: ["antenna", "dazn"], note: "The Spot – Detroit 20 over the air; DAZN." },
  "nba:GS": { outlets: ["nbcs_bayarea"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports Bay Area; Peacock add-on." },
  "nba:HOU": { outlets: ["schn"], subs: ["space_city", "directv", "fubo"], note: "Space City Home Network; SCHN+." },
  "nba:IND": { outlets: ["dazn", "ota"], subs: ["dazn", "antenna"], note: "DAZN (some games on CBS4/FOX59)." },
  "nba:LAC": { outlets: ["team_app", "ota"], subs: ["team_app", "antenna"], note: "ClipperVision (some games on KTLA)." },
  "nba:LAL": { outlets: ["spectrum_sn"], subs: ["spectrum_sn", "directv"], note: "Spectrum SportsNet; Spectrum SportsNet+." },
  "nba:MEM": { outlets: ["dazn", "ota"], subs: ["dazn", "antenna"], note: "DAZN (some games on ABC24)." },
  "nba:MIA": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "WPLG Local 10 over the air; Local 10+ (free)." },
  "nba:MIL": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "MY24 over the air statewide; Bucks+ in the NBA app." },
  "nba:MIN": { outlets: ["dazn", "ota"], subs: ["dazn", "antenna"], note: "DAZN (some games on KARE 11)." },
  "nba:NO": { outlets: ["team_app", "ota"], subs: ["team_app", "antenna"], note: "Gulf Coast Sports & Entertainment Network (some on FOX 8); Pelicans+." },
  "nba:NY": { outlets: ["msg", "dazn"], subs: ["gotham", "dazn", "directv", "fubo"], note: "MSG Networks; MSG+ (via Gotham Sports or DAZN)." },
  "nba:OKC": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "Thunder Gameday Network on KSBI/KQCW; Thunder+ in the NBA app." },
  "nba:ORL": { outlets: ["ota", "dazn"], subs: ["antenna", "dazn"], note: "MagicTV 27/WFTV 9 over the air; DAZN." },
  "nba:PHI": { outlets: ["nbcs_philadelphia"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports Philadelphia; Peacock add-on." },
  "nba:PHX": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "Arizona's Family 3TV/CBS5 over the air; Suns+." },
  "nba:POR": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "Rip City TV Network on KUNP/KATU; BlazerVision." },
  "nba:SAC": { outlets: ["nbcs_california"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports California; Peacock add-on." },
  "nba:SA": { outlets: ["dazn", "ota"], subs: ["dazn", "antenna"], note: "DAZN (22 games on CW San Antonio)." },
  "nba:TOR": { outlets: ["canada"], subs: [], note: "TSN/Sportsnet (Canada)." },
  "nba:UTAH": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "KJZZ 14 over the air; Jazz+." },
  "nba:WSH": { outlets: ["monumental"], subs: ["monumental", "directv", "fubo"], note: "Monumental Sports Network; Monumental+ (in DAZN)." },

  // ---------- MLB ----------
  "mlb:ARI": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; DBACKS.TV in the MLB app." },
  "mlb:ATH": { outlets: ["nbcs_california", "mlb_local"], subs: ["peacock", "mlbtv", "youtube_tv"], note: "NBC Sports California; Athletics.TV." },
  "mlb:ATL": { outlets: ["bravesvision", "ota"], subs: ["bravesvision", "antenna"], note: "BravesVision (some games over the air)." },
  "mlb:BAL": { outlets: ["masn"], subs: ["masn", "directv"], note: "MASN; MASN+." },
  "mlb:BOS": { outlets: ["nesn"], subs: ["nesn_360", "fubo", "directv"], note: "NESN; NESN 360." },
  "mlb:CHC": { outlets: ["marquee"], subs: ["marquee", "directv", "fubo"], note: "Marquee Sports Network." },
  "mlb:CHW": { outlets: ["chsn"], subs: ["chsn", "directv"], note: "CHSN." },
  "mlb:CIN": { outlets: ["mlb_local", "ota"], subs: ["mlbtv", "antenna"], note: "MLB Local Media; Reds.TV (some on FOX19)." },
  "mlb:CLE": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; CLEGuardians.TV." },
  "mlb:COL": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Rockies.TV." },
  "mlb:DET": { outlets: ["detroit_sn", "mlb_local"], subs: ["detroit_sn", "mlbtv"], note: "Detroit SportsNet; Tigers.TV." },
  "mlb:HOU": { outlets: ["schn"], subs: ["space_city", "directv", "fubo"], note: "Space City Home Network; SCHN+." },
  "mlb:KC": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Royals.TV." },
  "mlb:LAA": { outlets: ["mlb_local", "ota"], subs: ["mlbtv", "antenna"], note: "Angels.TV in the MLB app; some games on KCOP." },
  "mlb:LAD": { outlets: ["sportsnet_la"], subs: ["spectrum_sn", "directv"], note: "SportsNet LA; SNLA+." },
  "mlb:MIA": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Marlins.TV." },
  "mlb:MIL": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Brewers.TV." },
  "mlb:MIN": { outlets: ["mlb_local", "ota"], subs: ["mlbtv", "antenna"], note: "MLB Local Media; Twins.TV (some on KMSP)." },
  "mlb:NYM": { outlets: ["sny", "ota"], subs: ["sny", "youtube_tv", "fubo", "directv", "antenna"], note: "SNY (some games on PIX11); SNY in the MLB app." },
  "mlb:NYY": { outlets: ["yes", "prime_local"], subs: ["gotham", "prime_video", "directv", "fubo"], note: "YES Network (21 games on Prime Video); Gotham Sports." },
  "mlb:PHI": { outlets: ["nbcs_philadelphia", "ota"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports Philadelphia (some on NBC10); Peacock add-on." },
  "mlb:PIT": { outlets: ["sportsnet_pit"], subs: ["sportsnet_pit", "directv", "fubo"], note: "SportsNet Pittsburgh; SNP 360." },
  "mlb:SD": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Padres.TV." },
  "mlb:SF": { outlets: ["nbcs_bayarea"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports Bay Area; Peacock add-on." },
  "mlb:SEA": { outlets: ["mlb_local", "ota"], subs: ["mlbtv", "antenna"], note: "MLB Local Media; Mariners.TV." },
  "mlb:STL": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Cardinals.TV." },
  "mlb:TB": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Rays.TV." },
  "mlb:TEX": { outlets: ["rangers_sn"], subs: ["rangers_sn"], note: "Rangers Sports Network." },
  "mlb:TOR": { outlets: ["canada"], subs: [], note: "Sportsnet (Canada)." },
  "mlb:WSH": { outlets: ["mlb_local"], subs: ["mlbtv"], note: "MLB Local Media; Nationals.TV." },

  // ---------- NHL ----------
  "nhl:ANA": { outlets: ["ota", "prime_local"], subs: ["prime_video", "antenna"], note: "KCOP / FOX 11 over the air; Prime Video (local)." },
  "nhl:BOS": { outlets: ["nesn"], subs: ["nesn_360", "fubo", "directv"], note: "NESN; NESN 360." },
  "nhl:BUF": { outlets: ["msg", "dazn"], subs: ["gotham", "dazn", "directv"], note: "MSG (MSGB); MSG+." },
  "nhl:CAR": { outlets: ["team_app", "ota", "prime_local"], subs: ["prime_video", "antenna"], note: "Hurricanes Hockey Network (some on WRAL/FOX50); Prime Video add-on." },
  "nhl:CHI": { outlets: ["chsn"], subs: ["chsn", "directv"], note: "CHSN." },
  "nhl:COL": { outlets: ["altitude", "ota"], subs: ["altitude", "directv", "antenna"], note: "Altitude (some on 9NEWS/KTVD); Altitude+." },
  "nhl:CBJ": { outlets: ["team_app", "prime_local"], subs: ["prime_video"], note: "Blue Jackets Hockey Network; Prime Video add-on." },
  "nhl:DAL": { outlets: ["ota", "prime_local"], subs: ["prime_video", "antenna"], note: "FOX 4 over the air (17 games); Prime Video." },
  "nhl:DET": { outlets: ["detroit_sn"], subs: ["detroit_sn"], note: "Detroit SportsNet (DSN)." },
  "nhl:FLA": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "The Spot – South Florida 39 over the air; Panthers+." },
  "nhl:LA": { outlets: ["team_app", "dazn"], subs: ["dazn", "team_app"], note: "Angels Broadcast Television (ABTV); DAZN." },
  "nhl:MIN": { outlets: ["team_app", "prime_local"], subs: ["prime_video"], note: "Wild+; Prime Video add-on." },
  "nhl:NSH": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "The Spot – Nashville 28, over the air." },
  "nhl:NJ": { outlets: ["msg", "dazn"], subs: ["gotham", "dazn", "directv"], note: "MSG (MSGSN); MSG+." },
  "nhl:NYI": { outlets: ["msg", "dazn"], subs: ["gotham", "dazn", "directv"], note: "MSG (MSGSN); MSG+." },
  "nhl:NYR": { outlets: ["msg", "dazn"], subs: ["gotham", "dazn", "directv"], note: "MSG; MSG+." },
  "nhl:PHI": { outlets: ["nbcs_philadelphia"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports Philadelphia; Peacock add-on." },
  "nhl:PIT": { outlets: ["sportsnet_pit"], subs: ["sportsnet_pit", "directv", "fubo"], note: "SportsNet Pittsburgh; SNP 360." },
  "nhl:SJ": { outlets: ["nbcs_california", "nbcs_bayarea"], subs: ["peacock", "youtube_tv", "fubo", "directv"], note: "NBC Sports California; Peacock add-on." },
  "nhl:SEA": { outlets: ["ota", "team_app", "prime_local"], subs: ["prime_video", "antenna"], note: "KONG/KING (Kraken Hockey Network); Prime Video." },
  "nhl:STL": { outlets: ["team_app", "prime_local"], subs: ["prime_video", "team_app"], note: "Blue Note+; Prime Video add-on." },
  "nhl:TB": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "The Spot – Tampa Bay 66, over the air." },
  "nhl:UTAH": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "Utah 16 over the air; Mammoth+." },
  "nhl:VGK": { outlets: ["ota", "team_app"], subs: ["antenna", "team_app"], note: "The Spot – Vegas 34 over the air; KnightTime+." },
  "nhl:WSH": { outlets: ["monumental"], subs: ["monumental", "directv", "fubo"], note: "Monumental Sports Network; Monumental+." },
};
