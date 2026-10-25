import { describe, expect, it } from "vitest";
import { rankRoutes, resolveGame, isResolvedRoute } from "../lib/resolve";
import { isSundayAfternoon } from "../lib/availability";
import { localGuideMatch, titleMatches } from "../lib/guideMatch";
import type { LaunchRoute } from "../lib/types";
import { ctx, game, guideWith, settings, v1Household } from "./helpers";

// Regressions against the v1 household (New York; antenna through Plex, Sunday Ticket, ESPN Unlimited, Prime Video,
// Paramount+, Fox One, HBO Max, MLB.TV). Every v1 decision should still come out the same way.

const first = (r: ReturnType<typeof resolveGame>) => r.routes[0]?.service;
const services = (r: ReturnType<typeof resolveGame>) => [...new Set(r.routes.map((x) => x.service))];

describe("NFL Sunday afternoon: Sunday Ticket vs the local station", () => {
  const chargersAtChiefs = game("nfl:401"); // Sunday 1:00 PM ET on CBS, not a NY team

  it("goes to Sunday Ticket when the guide shows a different game on the local CBS", () => {
    const guide = guideWith([{ network: "cbs", title: "NFL Football | Buffalo Bills at Miami Dolphins" }]);
    const r = resolveGame(chargersAtChiefs, ctx(guide));
    expect(r.routes[0]).toMatchObject({ service: "youtube_tv", certain: true });
    expect(services(r)).not.toContain("plex");
  });

  it("goes to the antenna (Plex) when the local CBS is showing this game: Sunday Ticket would black it out", () => {
    const guide = guideWith([{ network: "cbs", title: "NFL Football | Los Angeles Chargers at Kansas City Chiefs" }]);
    const r = resolveGame(chargersAtChiefs, ctx(guide));
    expect(r.routes[0]).toMatchObject({ service: "plex", certain: true });
    expect(services(r)).not.toContain("youtube_tv");
  });

  it("without a guide, both are only 'probably', Sunday Ticket first", () => {
    const r = resolveGame(chargersAtChiefs, ctx(null));
    expect(services(r).slice(0, 2)).toEqual(["youtube_tv", "plex"]);
    expect(r.routes.every((x) => !x.certain)).toBe(true);
  });

  it("a Giants game is local: antenna first, Fox One as the alternate, never Sunday Ticket", () => {
    const r = resolveGame(game("nfl:402"), ctx(null)); // Giants at Cowboys, Sunday 4:25 on FOX
    expect(r.routes[0]).toMatchObject({ service: "plex", network: "fox", certain: true });
    expect(services(r)).toContain("fox_one");
    expect(services(r)).not.toContain("youtube_tv");
  });
});

describe("NFL primetime", () => {
  it("SNF -> antenna (NBC); Peacock isn't owned", () => {
    const r = resolveGame(game("nfl:403"), ctx());
    expect(first(r)).toBe("plex");
    expect(services(r)).not.toContain("peacock");
  });
  it("MNF on ESPN and ABC -> ESPN's game link first", () => {
    expect(resolveGame(game("nfl:404"), ctx()).routes[0]).toMatchObject({ service: "espn", level: "game" });
  });
  it("TNF -> Prime Video only", () => {
    expect(services(resolveGame(game("nfl:405"), ctx()))).toEqual(["prime_video"]);
  });
});

describe("MLB", () => {
  it("Dodgers at Padres on their local outlets -> MLB.TV (out of market)", () => {
    const r = resolveGame(game("mlb:501"), ctx());
    expect(r.routes.map((x) => x.subscription)).toEqual(expect.arrayContaining(["mlbtv"]));
    expect(r.routes.every((x) => x.certain)).toBe(true);
  });
  it("Mets on SNY -> not covered: the antenna doesn't get SNY, and MLB.TV blacks out local teams", () => {
    const r = resolveGame(game("mlb:502"), ctx());
    expect(r.routes).toEqual([]);
    expect(r.notCovered?.message).toMatch(/SNY/);
  });
  it("Mets on PIX11 -> antenna", () => {
    expect(first(resolveGame(game("mlb:503"), ctx()))).toBe("plex");
  });
  it("postseason on TBS -> HBO Max, never MLB.TV", () => {
    expect(services(resolveGame(game("mlb:504"), ctx()))).toEqual(["hbo_max"]);
  });
  it("Apple TV exclusive -> not covered", () => {
    const r = resolveGame(game("mlb:505"), ctx());
    expect(r.routes).toEqual([]);
    expect(r.notCovered?.message).toMatch(/^Apple TV isn't on your services\./);
    expect(r.notCovered?.suggestions?.map((s) => s.id)).toContain("apple_tv");
  });
});

describe("NHL", () => {
  it("Kings at Sharks on their local outlets -> ESPN (NHL Power Play)", () => {
    expect(resolveGame(game("nhl:601"), ctx()).routes[0]).toMatchObject({ service: "espn", network: "nhl_power_play" });
  });
  it("Rangers on MSG -> not covered, Power Play blacks them out", () => {
    const r = resolveGame(game("nhl:602"), ctx());
    expect(r.routes).toEqual([]);
    expect(r.notCovered?.message).toMatch(/MSG/);
  });
  it("TNT -> HBO Max", () => {
    expect(services(resolveGame(game("nhl:603"), ctx()))).toEqual(["hbo_max"]);
  });
  it("national ESPN game -> ESPN", () => {
    expect(first(resolveGame(game("nhl:604"), ctx()))).toBe("espn");
  });
});

describe("NBA", () => {
  it("NBC game -> antenna; Prime game -> Prime Video; ESPN game -> ESPN", () => {
    expect(first(resolveGame(game("nba:701"), ctx()))).toBe("plex");
    expect(first(resolveGame(game("nba:702"), ctx()))).toBe("prime_video");
    expect(first(resolveGame(game("nba:704"), ctx()))).toBe("espn");
  });
  it("Knicks on MSG -> not covered", () => {
    expect(resolveGame(game("nba:703"), ctx()).routes).toEqual([]);
  });
});

describe("a different household", () => {
  it("a YouTube TV household in New York watches the Mets on SNY", () => {
    const c = v1Household();
    c.subscriptions = [{ id: "youtube_tv", addOns: [] }];
    c.market.localSources = {};
    expect(first(resolveGame(game("mlb:502"), ctx(null, settings(), c)))).toBe("youtube_tv");
  });
  it("a household with nothing gets suggestions instead of routes", () => {
    const c = v1Household();
    c.subscriptions = [];
    const r = resolveGame(game("nfl:404"), ctx(null, settings(), c));
    expect(r.routes).toEqual([]);
    expect(r.notCovered?.suggestions?.length).toBeGreaterThan(0);
  });
});

describe("priority and ranking", () => {
  const route = (service: string, level: LaunchRoute["level"], extra: Partial<LaunchRoute> = {}): LaunchRoute =>
    ({ service, network: "cbs", level, reason: "", certain: true, levelVerified: true, ...extra });

  it("a confirmed route two levels better jumps ahead of priority; one level better doesn't", () => {
    expect(rankRoutes([route("plex", "app", { priority: 0 }), route("paramount_plus", "game", { priority: 1 })]).map((x) => x.service)).toEqual(["paramount_plus", "plex"]);
    expect(rankRoutes([route("plex", "app", { priority: 0 }), route("paramount_plus", "channel", { priority: 1 })]).map((x) => x.service)).toEqual(["plex", "paramount_plus"]);
  });
  it("an unconfirmed level doesn't jump the user's order", () => {
    expect(rankRoutes([route("plex", "app", { priority: 0 }), route("paramount_plus", "game", { levelVerified: false, priority: 1 })]).map((x) => x.service)).toEqual(["plex", "paramount_plus"]);
  });
  it("certain routes beat 'probably' ones, and installed apps beat missing ones", () => {
    expect(rankRoutes([route("a", "game", { certain: false }), route("b", "app")]).map((x) => x.service)).toEqual(["b", "a"]);
    expect(rankRoutes([route("a", "game", { installed: false }), route("b", "app", { installed: true })]).map((x) => x.service)).toEqual(["b", "a"]);
  });
  it("honors a reordered service priority", () => {
    const abcOnly = { ...game("nfl:404"), broadcasts: [{ network: "abc" as const, raw: "ABC", scope: "national" as const, regional: false, kind: "tv" as const }] };
    const espnFirst = settings({ servicePriority: { abc: ["espn", "plex"] } });
    const plexFirst = settings({ servicePriority: { abc: ["plex", "espn"] } });
    // ESPN's game link is one level above Plex's channel route, so the user's order decides.
    expect(first(resolveGame(abcOnly, ctx(null, espnFirst)))).toBe("espn");
    expect(first(resolveGame(abcOnly, ctx(null, plexFirst)))).toBe("plex");
  });

  it("explains a game with no listing", () => {
    const g = { ...game("nfl:403"), broadcasts: [] };
    expect(resolveGame(g, ctx()).notCovered?.message).toMatch(/No TV listing yet/);
  });

  it("isResolvedRoute accepts only routes the server produced", () => {
    const res = resolveGame(game("nfl:402"), ctx());
    expect(isResolvedRoute(res, { service: "fox_one", network: "fox" })).toBe(true);
    expect(isResolvedRoute(res, { service: "mlb", network: "fox" })).toBe(false);
  });
});

describe("guide matching", () => {
  const g = game("nfl:401");
  it("needs both teams in the title", () => {
    expect(titleMatches(g, "NFL Football | Chargers at Chiefs")).toBe(true);
    expect(titleMatches(g, "NFL Football | Chargers at Broncos")).toBe(false);
  });
  it("doesn't match on short aliases like LA", () => {
    expect(titleMatches(g, "LA Story | Kansas City Chiefs special")).toBe(false);
  });
  it("matches nicknames", () => {
    expect(titleMatches(g, "The Bolts visit the Chiefs")).toBe(true);
  });
  it("ignores programs that don't cover kickoff", () => {
    const guide = guideWith([{ title: "Chargers at Chiefs (replay)", start: "2026-10-18T23:00:00Z", end: "2026-10-19T02:00:00Z" }]);
    expect(localGuideMatch(g, guide, ["cbs"])).toBeNull();
  });
  it("Sunday afternoon window is 12:00 to 17:00 ET", () => {
    expect(isSundayAfternoon("2026-10-18T17:00:00Z")).toBe(true); // 1:00 PM EDT
    expect(isSundayAfternoon("2026-10-18T20:25:00Z")).toBe(true); // 4:25 PM
    expect(isSundayAfternoon("2026-10-19T00:20:00Z")).toBe(false); // 8:20 PM
    expect(isSundayAfternoon("2026-10-17T17:00:00Z")).toBe(false); // Saturday
    expect(isSundayAfternoon("2026-12-20T18:00:00Z")).toBe(true); // 1:00 PM EST
  });
});
