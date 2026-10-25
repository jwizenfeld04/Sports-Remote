import { describe, expect, it } from "vitest";
import { espnDays, NEUTRAL_TEAM_COLOR, normalizeScoreboard, scoreboardUrl } from "../lib/espn";
import { networkFromLabel } from "../lib/networks";
import { classifyLabel } from "../lib/catalog/networks";
import { espnEvent, MLB, NFL, NHL, scoreboard, SUNDAY_1PM, TEAMS } from "./fixtures/espn";

describe("normalizeScoreboard", () => {
  it("parses teams, state, scores and broadcasts", () => {
    const [g] = normalizeScoreboard("nfl", NFL);
    expect(g).toMatchObject({
      id: "nfl:401",
      league: "nfl",
      state: "in",
      detail: "Q4 3:12",
      period: 4,
      home: { abbr: "KC", name: "Chiefs", city: "Kansas City", displayName: "Kansas City Chiefs", score: 20 },
      away: { abbr: "LAC", name: "Chargers", score: 17 },
      broadcasts: [{ network: "cbs", raw: "CBS", scope: "national", regional: false, kind: "tv" }],
    });
  });

  it("has no scores for games that haven't started", () => {
    const g = normalizeScoreboard("nfl", NFL).find((x) => x.id === "nfl:402")!;
    expect(g.state).toBe("pre");
    expect(g.home.score).toBeUndefined();
  });

  it("flags regional networks and keeps their raw label", () => {
    const g = normalizeScoreboard("mlb", MLB).find((x) => x.id === "mlb:502")!;
    expect(g.broadcasts).toEqual([
      { network: "local", outlet: "sny", raw: "SNY", scope: "away", regional: true, kind: "tv" },
      { network: "local", outlet: "rsn", raw: "FanDuel SN SO", scope: "home", regional: true, kind: "tv" },
    ]);
  });

  it("marks streaming broadcasts", () => {
    const g = normalizeScoreboard("nfl", NFL).find((x) => x.id === "nfl:405")!;
    expect(g.broadcasts[0]).toMatchObject({ network: "prime", kind: "streaming" });
  });

  it("falls back to the legacy broadcasts field", () => {
    const sb = scoreboard([espnEvent({ id: "9", date: SUNDAY_1PM, home: TEAMS.KC, away: TEAMS.LAC, broadcasts: [{ name: "CBS" }, { name: "NFL Network" }], legacyOnly: true })]);
    const [g] = normalizeScoreboard("nfl", sb);
    expect(g.broadcasts.map((b) => b.network)).toEqual(["cbs", "nflnet"]);
  });

  it("skips malformed events instead of failing the whole league", () => {
    const sb = scoreboard([{ id: "bad" }, ...NHL.events]);
    expect(normalizeScoreboard("nhl", sb)).toHaveLength(NHL.events.length);
  });

  it("normalizes team colors to #rrggbb and keeps the logo URL", () => {
    const [g] = normalizeScoreboard("nfl", NFL);
    expect(g.away).toMatchObject({ color: "#0080c6", alternateColor: "#ffc20e", logo: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lac.png" });
    expect(g.home).toMatchObject({ color: "#e31837", alternateColor: "#ffb612" });
  });

  it("falls back to a neutral color for missing or malformed colors, and drops non-https logos", () => {
    const sb = scoreboard([espnEvent({ id: "7", date: SUNDAY_1PM, home: TEAMS.KC, away: TEAMS.LAC, broadcasts: [] })]) as { events: any[] };
    const [home, away] = sb.events[0].competitions[0].competitors;
    home.team.color = "red; background:url(x)";
    delete home.team.alternateColor;
    home.team.logo = "javascript:alert(1)";
    delete away.team.color;
    away.team.alternateColor = "#ABCDEF";
    const [g] = normalizeScoreboard("nfl", sb);
    expect(g.home).toMatchObject({ color: NEUTRAL_TEAM_COLOR, alternateColor: NEUTRAL_TEAM_COLOR, logo: undefined });
    expect(g.away).toMatchObject({ color: NEUTRAL_TEAM_COLOR, alternateColor: "#abcdef" });
  });

  it("handles a game with no broadcasts listed", () => {
    const sb = scoreboard([espnEvent({ id: "8", date: SUNDAY_1PM, home: TEAMS.KC, away: TEAMS.LAC, broadcasts: [] })]);
    expect(normalizeScoreboard("nfl", sb)[0].broadcasts).toEqual([]);
  });
});

describe("networkFromLabel", () => {
  it.each([
    ["CBS", "cbs"], ["FOX", "fox"], ["NBC", "nbc"], ["ABC", "abc"], ["ESPN", "espn"], ["ESPN2", "espn2"], ["ESPN+", "espn_plus"],
    ["Prime Video", "prime"], ["TNT", "tnt"], ["TBS", "tbs"], ["truTV", "trutv"], ["FS1", "fs1"], ["MLB.TV", "mlbtv"],
    ["NFL Network", "nflnet"], ["NHL Network", "nhlnet"], ["Apple TV", "apple"], ["Peacock", "peacock"],
  ])("%s -> %s", (raw, id) => {
    expect(networkFromLabel(raw)).toEqual({ network: id, regional: false });
  });

  it.each([
    ["SportsNet LA", "sportsnet_la"], ["Spectrum SportsNet LA", "spectrum_sn"], ["SNY", "sny"], ["YES", "yes"], ["MSG", "msg"], ["FDSN West", "rsn"],
    ["FanDuel SN SoCal", "rsn"], ["NESN", "nesn"], ["NBCS Philadelphia", "nbcs_philadelphia"], ["Padres.TV", "mlb_local"], ["PIX11", "ota"], ["WPIX", "ota"],
  ])("%s is a local outlet (%s)", (raw, outlet) => {
    expect(networkFromLabel(raw)).toEqual({ network: "local", regional: true });
    expect(classifyLabel(raw)).toEqual({ network: "local", outlet });
  });

  it("passes unknown labels through", () => {
    expect(networkFromLabel("Some New Thing")).toEqual({ network: "unknown", regional: false });
  });
});

describe("scoreboardUrl", () => {
  it("asks ESPN for one Eastern-time day (ESPN rejects yyyymmdd-yyyymmdd ranges with a 400)", () => {
    expect(scoreboardUrl("nhl", "20261017")).toBe("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261017&limit=300");
    expect(() => scoreboardUrl("nhl", "20261017-20261025")).toThrow();
  });

  it("lists every Eastern day in the window, including across DST changes", () => {
    expect(espnDays(new Date("2026-10-18T03:00:00Z"), new Date("2026-10-25T12:00:00Z"))).toEqual([
      "20261017", "20261018", "20261019", "20261020", "20261021", "20261022", "20261023", "20261024", "20261025",
    ]);
    // Nov 1 2026 is 25 h long in New York; Mar 8 2026 is 23 h.
    expect(espnDays(new Date("2026-10-31T04:30:00Z"), new Date("2026-11-03T05:30:00Z"))).toEqual(["20261031", "20261101", "20261102", "20261103"]);
    expect(espnDays(new Date("2026-03-07T04:59:00Z"), new Date("2026-03-10T04:00:00Z"))).toEqual(["20260306", "20260307", "20260308", "20260309", "20260310"]);
  });
});
