// ESPN-scoreboard-shaped fixtures (site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard).
// Hand-built in ESPN's payload shape: events[].competitions[0] with competitors, status, broadcasts
// and geoBroadcasts. Only fields the app reads are filled in, plus a few it should ignore.

export interface T { lg: "nfl" | "nba" | "mlb" | "nhl"; id: string; abbr: string; name: string; location: string; color?: string; alt?: string }

export const TEAMS = {
  LAC: { lg: "nfl", id: "24", abbr: "LAC", name: "Chargers", location: "Los Angeles", color: "0080c6", alt: "ffc20e" },
  KC: { lg: "nfl", id: "12", abbr: "KC", name: "Chiefs", location: "Kansas City", color: "e31837", alt: "ffb612" },
  NYG: { lg: "nfl", id: "19", abbr: "NYG", name: "Giants", location: "New York", color: "003c7f", alt: "c9243f" },
  DAL: { lg: "nfl", id: "6", abbr: "DAL", name: "Cowboys", location: "Dallas", color: "002a5c", alt: "b0b7bc" },
  NYJ: { lg: "nfl", id: "20", abbr: "NYJ", name: "Jets", location: "New York", color: "115740", alt: "ffffff" },
  BUF: { lg: "nfl", id: "2", abbr: "BUF", name: "Bills", location: "Buffalo", color: "00338d", alt: "d50a0a" },
  LV: { lg: "nfl", id: "13", abbr: "LV", name: "Raiders", location: "Las Vegas", color: "000000", alt: "a5acaf" },
  LAD: { lg: "mlb", id: "19", abbr: "LAD", name: "Dodgers", location: "Los Angeles", color: "005a9c", alt: "ffffff" },
  SD: { lg: "mlb", id: "25", abbr: "SD", name: "Padres", location: "San Diego", color: "2f241d", alt: "ffc425" },
  NYM: { lg: "mlb", id: "21", abbr: "NYM", name: "Mets", location: "New York", color: "002d72", alt: "ff5910" },
  ATL: { lg: "mlb", id: "15", abbr: "ATL", name: "Braves", location: "Atlanta", color: "0c2340", alt: "ba0c2f" },
  SF: { lg: "mlb", id: "26", abbr: "SF", name: "Giants", location: "San Francisco", color: "000000", alt: "fd5a1e" },
  PHI: { lg: "mlb", id: "22", abbr: "PHI", name: "Phillies", location: "Philadelphia", color: "e81828", alt: "002d72" },
  LA: { lg: "nhl", id: "8", abbr: "LA", name: "Kings", location: "Los Angeles", color: "111111", alt: "a2aaad" },
  SJ: { lg: "nhl", id: "18", abbr: "SJ", name: "Sharks", location: "San Jose", color: "00788a", alt: "070707" },
  NYR: { lg: "nhl", id: "13", abbr: "NYR", name: "Rangers", location: "New York", color: "0038a8", alt: "ce1126" },
  BOS: { lg: "nhl", id: "1", abbr: "BOS", name: "Bruins", location: "Boston", color: "231f20", alt: "fdb927" },
  CELTICS: { lg: "nba", id: "2", abbr: "BOS", name: "Celtics", location: "Boston", color: "008348", alt: "ffffff" },
  KNICKS: { lg: "nba", id: "18", abbr: "NY", name: "Knicks", location: "New York", color: "1d428a", alt: "f58426" },
  LAKERS: { lg: "nba", id: "13", abbr: "LAL", name: "Lakers", location: "Los Angeles", color: "552583", alt: "fdb927" },
  WARRIORS: { lg: "nba", id: "9", abbr: "GS", name: "Warriors", location: "Golden State", color: "fdb927", alt: "1d428a" },
  PISTONS: { lg: "nba", id: "8", abbr: "DET", name: "Pistons", location: "Detroit", color: "1d428a", alt: "c8102e" },
} satisfies Record<string, T>;

export interface EvOpts {
  id: string;
  date: string; // ISO with Z
  state?: "pre" | "in" | "post";
  detail?: string;
  period?: number;
  home: T;
  away: T;
  homeScore?: number;
  awayScore?: number;
  broadcasts: { name: string; market?: "National" | "Home" | "Away"; type?: "TV" | "Streaming" }[];
  legacyOnly?: boolean; // only the older `broadcasts` field, no geoBroadcasts
}

const competitor = (t: T, homeAway: "home" | "away", score?: number) => ({
  id: t.id,
  homeAway,
  score: score === undefined ? "0" : String(score),
  records: [{ summary: "5-3" }],
  team: {
    id: t.id,
    abbreviation: t.abbr,
    displayName: `${t.location} ${t.name}`,
    shortDisplayName: t.name,
    name: t.name,
    location: t.location,
    logo: `https://a.espncdn.com/i/teamlogos/${t.lg}/500/scoreboard/${t.abbr.toLowerCase()}.png`,
    color: t.color,
    alternateColor: t.alt,
  },
});

export function espnEvent(o: EvOpts) {
  const state = o.state ?? "pre";
  const status = {
    clock: 0,
    displayClock: "0:00",
    period: o.period ?? 0,
    type: { id: "1", name: "STATUS", state, completed: state === "post", shortDetail: o.detail ?? (state === "post" ? "Final" : "") },
  };
  return {
    id: o.id,
    uid: `s:x~e:${o.id}`,
    date: o.date,
    name: `${o.away.location} ${o.away.name} at ${o.home.location} ${o.home.name}`,
    competitions: [
      {
        id: o.id,
        date: o.date,
        venue: { fullName: "Stadium" },
        competitors: [competitor(o.home, "home", state === "pre" ? undefined : o.homeScore), competitor(o.away, "away", state === "pre" ? undefined : o.awayScore)],
        status,
        broadcasts: [{ market: (o.broadcasts[0]?.market ?? "National").toLowerCase(), names: o.broadcasts.map((b) => b.name) }],
        ...(o.legacyOnly
          ? {}
          : {
              geoBroadcasts: o.broadcasts.map((b) => ({
                type: { id: "1", shortName: b.type ?? "TV" },
                market: { id: "1", type: b.market ?? "National" },
                media: { shortName: b.name },
                lang: "en",
                region: "us",
              })),
            }),
      },
    ],
    status,
  };
}

export const scoreboard = (events: unknown[]) => ({ leagues: [{ id: "x" }], season: { year: 2026 }, events });

// A Sunday in October 2026 (Oct 18 2026 is a Sunday). 17:00Z = 1:00 PM ET.
export const SUNDAY_1PM = "2026-10-18T17:00:00Z";
export const SUNDAY_425PM = "2026-10-18T20:25:00Z";
export const SUNDAY_820PM = "2026-10-19T00:20:00Z";
export const MONDAY_815PM = "2026-10-20T00:15:00Z";
export const THURSDAY_815PM = "2026-10-23T00:15:00Z";

export const NFL = scoreboard([
  espnEvent({ id: "401", date: SUNDAY_1PM, home: TEAMS.KC, away: TEAMS.LAC, broadcasts: [{ name: "CBS" }], state: "in", period: 4, homeScore: 20, awayScore: 17, detail: "Q4 3:12" }),
  espnEvent({ id: "402", date: SUNDAY_425PM, home: TEAMS.DAL, away: TEAMS.NYG, broadcasts: [{ name: "FOX" }] }),
  espnEvent({ id: "403", date: SUNDAY_820PM, home: TEAMS.BUF, away: TEAMS.NYJ, broadcasts: [{ name: "NBC" }, { name: "Peacock", type: "Streaming" }] }),
  espnEvent({ id: "404", date: MONDAY_815PM, home: TEAMS.LAC, away: TEAMS.LV, broadcasts: [{ name: "ESPN" }, { name: "ABC" }] }),
  espnEvent({ id: "405", date: THURSDAY_815PM, home: TEAMS.KC, away: TEAMS.LV, broadcasts: [{ name: "Prime Video", type: "Streaming" }] }),
]);

export const MLB = scoreboard([
  espnEvent({ id: "501", date: "2026-10-18T23:10:00Z", home: TEAMS.SD, away: TEAMS.LAD, broadcasts: [{ name: "SportsNet LA", market: "Away" }, { name: "Padres.TV", market: "Home" }] }),
  espnEvent({ id: "502", date: "2026-10-18T23:10:00Z", home: TEAMS.ATL, away: TEAMS.NYM, broadcasts: [{ name: "SNY", market: "Away" }, { name: "FanDuel SN SO", market: "Home" }] }),
  espnEvent({ id: "503", date: "2026-10-18T23:40:00Z", home: TEAMS.PHI, away: TEAMS.NYM, broadcasts: [{ name: "PIX11", market: "Away" }, { name: "NBCS Philadelphia", market: "Home" }] }),
  espnEvent({ id: "504", date: "2026-10-19T00:08:00Z", home: TEAMS.LAD, away: TEAMS.PHI, broadcasts: [{ name: "TBS" }], state: "in", period: 9, homeScore: 3, awayScore: 2, detail: "Top 9th" }),
  espnEvent({ id: "505", date: "2026-10-19T23:00:00Z", home: TEAMS.SF, away: TEAMS.LAD, broadcasts: [{ name: "Apple TV", type: "Streaming" }] }),
]);

export const NHL = scoreboard([
  espnEvent({ id: "601", date: "2026-10-19T02:30:00Z", home: TEAMS.SJ, away: TEAMS.LA, broadcasts: [{ name: "FDSN West", market: "Away" }, { name: "NBCS California", market: "Home" }] }),
  espnEvent({ id: "602", date: "2026-10-18T23:00:00Z", home: TEAMS.BOS, away: TEAMS.NYR, broadcasts: [{ name: "MSG", market: "Away" }, { name: "NESN", market: "Home" }] }),
  espnEvent({ id: "603", date: "2026-10-18T23:30:00Z", home: TEAMS.LA, away: TEAMS.BOS, broadcasts: [{ name: "TNT" }], state: "post", period: 3, homeScore: 4, awayScore: 1 }),
  espnEvent({ id: "604", date: "2026-10-19T00:00:00Z", home: TEAMS.NYR, away: TEAMS.LA, broadcasts: [{ name: "ESPN" }] }),
]);

export const NBA = scoreboard([
  espnEvent({ id: "701", date: "2026-10-18T23:30:00Z", home: TEAMS.KNICKS, away: TEAMS.CELTICS, broadcasts: [{ name: "NBC" }, { name: "Peacock", type: "Streaming" }], state: "in", period: 4, homeScore: 101, awayScore: 99, detail: "Q4 2:10" }),
  espnEvent({ id: "702", date: "2026-10-19T02:00:00Z", home: TEAMS.LAKERS, away: TEAMS.WARRIORS, broadcasts: [{ name: "Prime Video", type: "Streaming" }] }),
  espnEvent({ id: "703", date: "2026-10-19T23:00:00Z", home: TEAMS.PISTONS, away: TEAMS.KNICKS, broadcasts: [{ name: "MSG", market: "Away" }, { name: "FanDuel SN DET", market: "Home" }] }),
  espnEvent({ id: "704", date: "2026-10-20T23:30:00Z", home: TEAMS.CELTICS, away: TEAMS.LAKERS, broadcasts: [{ name: "ESPN" }] }),
]);
