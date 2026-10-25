import { describe, expect, it } from "vitest";
import type { Broadcast, Game, League } from "../lib/types";
import { classifyLabel } from "../lib/catalog/networks";
import { TEAMS, METROS } from "../lib/catalog/teams";
import { availability } from "../lib/availability";
import { resolveGame, type Household, type ResolveContext } from "../lib/resolve";
import { coverage, gainFrom, sampleWeek } from "../lib/coverage";
import { SUBSCRIPTIONS } from "../lib/catalog/subscriptions";
import { APPS, APP_BY_ID } from "../lib/catalog/apps";
import { LOCAL_TEAMS } from "../lib/catalog/localTeams";
import labels from "./fixtures/espn-labels.json";

const team = (key: string) => {
  const t = TEAMS.find((x) => x.key === key);
  if (!t) throw new Error(key);
  return { id: key, abbr: t.abbr, name: t.name, city: t.city, displayName: t.displayName };
};

let n = 0;
/** A game with ESPN-style labels: "NBC", "MSG:away", "NESN:home". */
function game(league: League, home: string, away: string, tags: string[], startTime = "2026-11-04T00:30:00Z"): Game {
  const broadcasts: Broadcast[] = tags.map((t) => {
    const [raw, market] = t.split(":");
    const c = classifyLabel(raw);
    const scope = (market as Broadcast["scope"]) ?? "national";
    return { network: c.network, outlet: c.outlet, raw, scope, regional: c.network === "local", kind: "tv", radio: c.radio };
  });
  return { id: `${league}:${++n}`, league, startTime, state: "pre", detail: "", home: team(`${league}:${home}`), away: team(`${league}:${away}`), broadcasts };
}

const metroTeams = (id: string) => Object.entries(METROS.find((m) => m.id === id)!.teams).flatMap(([lg, abbrs]) => abbrs!.map((a) => `${lg}:${a}`));

function ctx(h: Partial<Household> & { metro?: string }, extra: Partial<ResolveContext> = {}): ResolveContext {
  return {
    household: {
      market: { localTeams: h.market?.localTeams ?? (h.metro ? metroTeams(h.metro) : []), localSources: h.market?.localSources ?? {} },
      subscriptions: h.subscriptions ?? [],
      tveSignIns: h.tveSignIns ?? [],
      servicePriority: h.servicePriority ?? {},
    },
    platform: "firetv",
    installedApps: null,
    guide: null,
    ...extra,
  };
}

const sub = (id: string, tier?: string, addOns: string[] = []) => ({ id, tier, addOns });

describe("catalog integrity", () => {
  it("every subscription's apps exist, tiers are unique, and the default tier is real", () => {
    for (const s of SUBSCRIPTIONS) {
      for (const a of s.apps) expect(APP_BY_ID.has(a), `${s.id} -> ${a}`).toBe(true);
      for (const u of s.unlocks ?? []) expect(APP_BY_ID.has(u.app)).toBe(true);
      const ids = (s.tiers ?? []).map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      if (s.defaultTier) expect(ids).toContain(s.defaultTier);
    }
  });

  it("app routes only use declared params, and every app id is unique", () => {
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length);
    for (const a of APPS) {
      for (const r of a.routes) {
        const used = [...(r.template ?? "").matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
        for (const u of used) expect(r.params, `${a.id} {${u}}`).toHaveProperty(u);
      }
    }
  });

  it("the local-team table only names real teams and real subscriptions", () => {
    const subs = new Set(SUBSCRIPTIONS.map((s) => s.id));
    for (const [key, t] of Object.entries(LOCAL_TEAMS)) {
      expect(TEAMS.some((x) => x.key === key), key).toBe(true);
      for (const s of t.subs) expect(subs.has(s), `${key} -> ${s}`).toBe(true);
    }
  });

  it("classifies every ESPN label seen in Oct 2026 the same way", () => {
    for (const [label, want] of Object.entries(labels as Record<string, string>)) {
      const c = classifyLabel(label);
      expect(`${c.network}${c.outlet ? "/" + c.outlet : ""}${c.radio ? " radio" : ""}`, label).toBe(want);
    }
  });
});

describe("availability rules", () => {
  const boston = { localTeams: new Set(metroTeams("boston")) };

  it("a national label with no local label is an exclusive", () => {
    const a = availability(game("nba", "NY", "BOS", ["Prime Video"]), boston);
    expect(a.exclusive).toBe(true);
    expect(a.needs).toEqual([expect.objectContaining({ kind: "network", network: "prime" })]);
  });

  it("an out-of-market regional NBA game needs League Pass; your local team's needs its outlet", () => {
    const g = game("nba", "MIN", "NY", ["DAZN MIN:home", "MSG:away"]);
    expect(availability(g, boston).needs).toEqual([expect.objectContaining({ kind: "package", network: "nba_league_pass" })]);
    const ny = { localTeams: new Set(metroTeams("new_york")) };
    const a = availability(g, ny);
    expect(a.needs).toEqual([expect.objectContaining({ kind: "outlet", outlet: "msg", team: "nba:NY" })]);
    expect(a.notes.join(" ")).toMatch(/blacks out your local teams/);
  });

  it("NHL ESPN+ next to local feeds is the out-of-market package; alone with Hulu it's an exclusive", () => {
    const regional = availability(game("nhl", "SEA", "LA", ["ESPN+", "KONG:home", "ABTV:away"]), boston);
    expect(regional.needs).toEqual([expect.objectContaining({ network: "nhl_power_play" })]);
    const excl = availability(game("nhl", "SEA", "LA", ["ESPN+", "Hulu", "Disney+"]), boston);
    expect(excl.exclusive).toBe(true);
    expect(excl.needs.map((x) => (x as { network: string }).network)).toContain("espn_plus");
    expect(excl.needs.map((x) => (x as { network: string }).network)).not.toContain("nhl_power_play");
  });

  it("MLB 'Prime Video' is the Yankees' local stream, not a national game", () => {
    const g = game("mlb", "NYY", "BOS", ["Prime Video", "NESN:away", "MLB.TV"]);
    const inNy = availability(g, { localTeams: new Set(metroTeams("new_york")) });
    expect(inNy.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "outlet", outlet: "prime_local", team: "mlb:NYY" })]));
    const elsewhere = availability(g, { localTeams: new Set(metroTeams("chicago")) });
    expect(elsewhere.needs).toEqual([expect.objectContaining({ network: "mlbtv" })]);
  });

  it("NFL Sunday CBS: local team -> your station; otherwise Sunday Ticket or (maybe) your station", () => {
    const sunday = "2026-11-08T18:00:00Z"; // 1 PM ET
    const local = availability(game("nfl", "NE", "BUF", ["CBS"], sunday), boston);
    expect(local.needs).toEqual([expect.objectContaining({ network: "cbs", certain: true })]);
    const away = availability(game("nfl", "KC", "LAC", ["CBS"], sunday), boston);
    expect(away.needs).toEqual([
      expect.objectContaining({ network: "nfl_sunday_ticket", certain: false }),
      expect.objectContaining({ network: "cbs", certain: false }),
    ]);
  });

  it("a stale regional label for a local team explains itself instead of routing", () => {
    const a = availability(game("nba", "DET", "BOS", ["FanDuel SN DET:home", "NBC Sports BO:away"]), { localTeams: new Set(["nba:DET"]) });
    expect(a.needs).toEqual([]);
    expect(a.notes.join(" ")).toMatch(/doesn't say which current network/);
    expect(a.notes.join(" ")).not.toMatch(/FanDuel Sports Network/);
  });

  it("radio labels are ignored", () => {
    expect(availability(game("nba", "BOS", "NY", ["ERADM", "ESPN"]), boston).needs).toHaveLength(1);
  });
});

describe("resolving to apps", () => {
  it("a YouTube TV household in Boston gets the Celtics locally and national games, and is told what's missing", () => {
    const c = ctx({ metro: "boston", subscriptions: [sub("youtube_tv", "base")] });
    const celtics = resolveGame(game("nba", "BOS", "MIA", ["NBC Sports BO:home", "Local 10:away"]), c);
    expect(celtics.routes[0]).toMatchObject({ service: "youtube_tv", network: "local", outlet: "nbcs_boston", certain: true });

    const nbc = resolveGame(game("nba", "NY", "BOS", ["NBC", "Peacock"]), c);
    expect(nbc.routes[0]).toMatchObject({ service: "youtube_tv", network: "nbc" });

    const prime = resolveGame(game("nba", "LAL", "GS", ["Prime Video"]), c);
    expect(prime.routes).toEqual([]);
    expect(prime.notCovered?.message).toMatch(/Prime Video isn't on your services/);
    expect(prime.notCovered?.suggestions.map((s) => s.id)).toContain("prime_video");
  });

  it("signing in to ESPN with YouTube TV puts the ESPN app (game links) ahead of YouTube TV", () => {
    const g = game("nba", "BOS", "NY", ["ESPN"]);
    const without = resolveGame(g, ctx({ metro: "boston", subscriptions: [sub("youtube_tv")] }));
    expect(without.routes.map((r) => r.service)).toEqual(["youtube_tv"]);
    const withEspn = resolveGame(g, ctx({ metro: "boston", subscriptions: [sub("youtube_tv")], tveSignIns: ["espn"] }));
    expect(withEspn.routes.map((r) => r.service)).toEqual(["espn", "youtube_tv"]);
    expect(withEspn.routes[0]).toMatchObject({ level: "game", reason: expect.stringMatching(/Signed in with YouTube TV/) });
  });

  it("League Pass opens out-of-market games in the NBA app, never your local team", () => {
    const c = ctx({ metro: "boston", subscriptions: [sub("nba_league_pass", "standard")] });
    const r = resolveGame(game("nba", "MIN", "MEM", ["DAZN MIN:home", "DAZN MEM:away"]), c);
    expect(r.routes[0]).toMatchObject({ service: "nba", network: "nba_league_pass", level: "game", levelVerified: false });
    const celtics = resolveGame(game("nba", "BOS", "MEM", ["NBC Sports BO:home", "DAZN MEM:away"]), c);
    expect(celtics.routes).toEqual([]);
    expect(celtics.notCovered?.suggestions.map((s) => s.id)).toEqual(expect.arrayContaining(["peacock", "youtube_tv"]));
  });

  it("the household's own answer for a local team wins over the outlet table", () => {
    // Our table says MSG; they say they watch the Knicks on Fubo.
    const g = game("nba", "NY", "BOS", ["MSG:home", "NBC Sports BO:away"]);
    const c = ctx({ market: { localTeams: ["nba:NY"], localSources: { "nba:NY": ["fubo"] } }, subscriptions: [sub("fubo", "sports")] });
    expect(resolveGame(g, c).routes[0]).toMatchObject({ service: "fubo", outlet: "msg", certain: true });
  });

  it("'probably' lineups rank below confirmed ones and say so", () => {
    const g = game("nba", "BOS", "NY", ["NBA TV"]);
    const c = ctx({ subscriptions: [sub("youtube_tv", "base"), sub("nba_league_pass", "nbatv")] });
    const r = resolveGame(g, c);
    expect(r.routes.map((x) => [x.service, x.certain])).toEqual([["nba", true], ["youtube_tv", false]]);
  });

  it("apps not installed on the TV go last", () => {
    const g = game("nfl", "BUF", "NYJ", ["NBC", "Peacock"], "2026-11-09T01:20:00Z");
    const c = ctx({ subscriptions: [sub("peacock"), sub("youtube_tv")] }, { installedApps: new Set(["youtube_tv"]) });
    const r = resolveGame(g, c);
    expect(r.routes[0].service).toBe("youtube_tv");
    expect(r.routes.find((x) => x.service === "peacock")?.installed).toBe(false);
  });

  it("Paramount+ Essential has CBS's NFL games but not other CBS sports", () => {
    const c = ctx({ metro: "boston", subscriptions: [sub("paramount_plus", "essential")] });
    expect(resolveGame(game("nfl", "NE", "BUF", ["CBS"], "2026-11-08T18:00:00Z"), c).routes[0]?.service).toBe("paramount_plus");
    expect(resolveGame(game("nba", "BOS", "NY", ["CBS"]), c).routes).toEqual([]);
  });

  it("household order wins between equal routes", () => {
    const g = game("nhl", "BOS", "NYR", ["TNT", "HBO Max"]);
    const subs = [sub("youtube_tv"), sub("hbo_max", "standard")];
    expect(resolveGame(g, ctx({ subscriptions: subs, servicePriority: { tnt: ["hbo_max", "youtube_tv"] } })).routes[0].service).toBe("hbo_max");
    expect(resolveGame(g, ctx({ subscriptions: subs, servicePriority: { tnt: ["youtube_tv", "hbo_max"] } })).routes[0].service).toBe("youtube_tv");
  });
});

describe("coverage report", () => {
  it("summarizes a typical week, lists gaps by size and the subscriptions that close them", () => {
    const week = sampleWeek(metroTeams("boston"));
    expect(week.length).toBeGreaterThan(150);
    const c = ctx({ metro: "boston", subscriptions: [sub("youtube_tv", "base")] });
    const rep = coverage(week, c, ["nba:BOS", "nfl:NE"]);
    expect(rep.total).toBe(week.length);
    expect(rep.yes + rep.maybe + rep.no).toBe(rep.total);
    expect(rep.byLeague.nfl!.yes).toBeGreaterThan(0);
    // Out-of-market NBA/MLB/NHL games are the big gaps for a YouTube TV-only household.
    const big = rep.gaps.slice(0, 3).map((g) => g.need);
    expect(big).toEqual(expect.arrayContaining(["MLB.TV"]));
    const mlb = rep.gaps.find((g) => g.need === "MLB.TV")!;
    expect(mlb.fixes[0]).toMatchObject({ id: "mlbtv" });
    expect(mlb.fixes[0].adds).toBeGreaterThan(30);
    const celtics = rep.favorites.find((f) => f.team === "nba:BOS")!;
    expect(celtics.total).toBeGreaterThan(0);
    expect(celtics.yes).toBe(celtics.total);
  });

  it("adding a subscription only ever adds coverage", () => {
    const week = sampleWeek(metroTeams("new_york"), undefined, 3);
    const c = ctx({ metro: "new_york", subscriptions: [sub("youtube_tv", "base")] });
    for (const id of ["peacock", "prime_video", "nba_league_pass", "espn", "gotham", "netflix"]) {
      expect(gainFrom(week, c, id)).toBeGreaterThanOrEqual(0);
    }
    expect(gainFrom(week, c, "gotham")).toBeGreaterThan(0); // Knicks, Rangers, Islanders, Devils, Yankees, Nets
  });

  it("everything off = nothing covered, and every gap suggests at least one fix", () => {
    const week = sampleWeek([]);
    const rep = coverage(week, ctx({}));
    expect(rep.yes).toBe(0);
    for (const g of rep.gaps) expect(g.fixes.length, g.need).toBeGreaterThan(0);
  });
});

describe("apps Sports Remote can't open itself", () => {
  it("a team-app household can watch their local team, as a manual route", async () => {
    const { resolveGame } = await import("../lib/resolve");
    const g = game("nba", "DAL", "BOS", ["MavsTV:home", "NBC Sports BO:away"]);
    const r = resolveGame(g, {
      household: { market: { localTeams: ["nba:DAL"], localSources: {} }, subscriptions: [{ id: "team_app", addOns: [] }], tveSignIns: [], servicePriority: {} },
      platform: "firetv", installedApps: new Set(["espn"]), guide: null, experimental: true,
    });
    expect(r.routes[0]).toMatchObject({ service: "team_app", manual: true, level: "app" });
    expect(r.routes[0].installed).toBeUndefined();
  });
});
