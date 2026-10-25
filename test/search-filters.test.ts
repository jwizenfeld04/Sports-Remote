import { describe, expect, it } from "vitest";
import { buildIndex, search } from "../lib/search";
import { applyFilters, activeFilterCount, blockingFilter, DEFAULT_FILTERS, inWindow, isCloseGame, sections, VIEW_PRESETS, viewOf, type FilterState } from "../lib/filters";
import { parseFilters, serializeFilters } from "../lib/urlState";
import { resolveGame } from "../lib/resolve";
import type { Game, Resolution } from "../lib/types";
import { allGames, ctx, game, settings, v1Household } from "./helpers";

const games = allGames();
const index = buildIndex(games);
const ids = (gs: Game[]) => gs.map((g) => g.id);
const q = (query: string) => ids(search(index, games, query));

describe("search", () => {
  it("matches team names, cities and abbreviations", () => {
    expect(q("chargers")).toEqual(["nfl:401", "nfl:404"]);
    expect(q("kansas")).toEqual(["nfl:401", "nfl:405"]);
    expect(q("lad")).toEqual(["mlb:501", "mlb:504", "mlb:505"]);
  });
  it("matches nicknames", () => {
    expect(q("bolts")).toEqual(["nfl:401", "nfl:404"]);
    expect(q("blue crew")).toEqual(["mlb:501", "mlb:504", "mlb:505"]);
    expect(q("amazins")).toEqual(["mlb:502", "mlb:503"]);
    expect(q("g-men")).toEqual(["nfl:402"]);
  });
  it("ANDs words, including networks and leagues", () => {
    expect(q("kings espn")).toEqual(["nhl:604"]);
    expect(q("giants mlb")).toEqual(["mlb:505"]);
    expect(q("hockey tnt")).toEqual(["nhl:603"]);
  });
  it("'giants' finds both the NY and SF Giants", () => {
    expect(q("giants").sort()).toEqual(["mlb:505", "nfl:402"]);
  });
  it("is case and accent insensitive, and empty matches everything", () => {
    expect(q("CHÁRGERS")).toEqual(["nfl:401", "nfl:404"]);
    expect(q("   ")).toHaveLength(games.length);
  });
  it("filters 1,000 games in well under a frame", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...games[i % games.length], id: `nfl:${i}` }));
    const idx = buildIndex(many);
    // Best of several rounds, so a busy machine (the rest of the suite runs in parallel) doesn't fail it.
    const rounds = Array.from({ length: 5 }, () => {
      const t0 = performance.now();
      for (const term of ["c", "ch", "cha", "char", "charg"]) search(idx, many, term);
      return (performance.now() - t0) / 5;
    });
    expect(Math.min(...rounds)).toBeLessThan(16); // one frame at 60 Hz
  });
});

const now = new Date("2026-10-18T21:00:00Z"); // Sunday 5:00 PM ET
const resolutions = new Map<string, Resolution>(games.map((g) => [g.id, resolveGame(g, ctx())]));
const fctx = { settings: settings(), resolutions, now, index };
const run = (patch: Partial<FilterState>) => ids(applyFilters(games, { ...DEFAULT_FILTERS, ...patch }, fctx));

describe("filters", () => {
  it("defaults to live and upcoming this week: live first, then upcoming by start time", () => {
    const out = run({});
    expect(out).not.toContain("nhl:603"); // final
    expect(out.slice(0, 3)).toEqual(["nfl:401", "nba:701", "mlb:504"]); // live
    const upcoming = out.slice(3).map((id) => Date.parse(game(id).startTime));
    expect(upcoming).toEqual([...upcoming].sort((a, b) => a - b)); // favorites don't jump ahead of earlier games
  });
  it("favorite teams lead the live games only", () => {
    const only = (favorites: string[]) => ids(applyFilters(games, DEFAULT_FILTERS, { ...fctx, settings: settings({ favorites }) }));
    // Phillies are the only favorite: their live game moves ahead of the earlier-starting Chargers game...
    expect(only(["mlb:PHI"]).slice(0, 2)).toEqual(["mlb:504", "nfl:401"]);
    // ...but the Phillies' upcoming game (mlb:503) stays in start-time order.
    const out = only(["mlb:PHI"]);
    expect(out.indexOf("mlb:503")).toBeGreaterThan(out.indexOf("mlb:501"));
    expect(only([]).slice(0, 3)).toEqual(["nfl:401", "nba:701", "mlb:504"]);
  });
  it("splits into Live / Upcoming / Final sections, favorites first only within Live", () => {
    const s = settings({ favorites: ["mlb:PHI", "nhl:NYR"] });
    const all = applyFilters(games, { ...DEFAULT_FILTERS, status: [], sort: "time" }, { ...fctx, settings: s });
    const sec = sections(all, s);
    expect(ids(sec.live)).toEqual(["mlb:504", "nfl:401", "nba:701"]);
    expect(ids(sec.upcoming)[0]).toBe("nfl:402"); // earliest, not the favorite Rangers game
    expect(ids(sec.final)).toEqual(["nhl:603"]);
  });
  it("league, status and favorites", () => {
    expect(run({ leagues: ["nhl"] })).toEqual(["nhl:602", "nhl:604", "nhl:601"]);
    expect(run({ status: ["live"] })).toEqual(["nfl:401", "nba:701", "mlb:504"]);
    expect(run({ status: ["final"] })).toEqual(["nhl:603"]);
    const favs = settings({ favorites: v1Household().preferences.favorites });
    expect(ids(applyFilters(games, { ...DEFAULT_FILTERS, favorites: true, leagues: ["mlb"] }, { ...fctx, settings: favs }))).toEqual(["mlb:504", "mlb:501", "mlb:502", "mlb:503", "mlb:505"]);
  });
  it("on my services hides games nothing can show", () => {
    const out = run({ myServices: true });
    expect(out).not.toContain("mlb:502"); // Mets on SNY
    expect(out).not.toContain("mlb:505"); // Apple TV
    expect(out).toContain("mlb:501"); // MLB.TV
  });
  it("a specific service and a network", () => {
    expect(run({ service: "hbo_max" })).toEqual(["mlb:504"]);
    // "Watch on X" means the Play button opens X: an alternate route doesn't count.
    for (const svc of ["plex", "youtube_st", "fox_one"] as const) {
      for (const id of run({ service: svc, status: [], time: "week" })) expect(resolutions.get(id)!.routes[0].service).toBe(svc);
    }
    expect(run({ networks: ["fox"] })).toEqual(["nfl:402"]);
  });
  it("launch quality needs a verified game or channel route", () => {
    // Confirmed: ESPN game links, YouTube TV game search, and Plex channel tuning. App-only routes (HBO Max, Fox One),
    // unconfirmed game links (Prime Video) and games nothing can show don't qualify.
    expect(run({ quality: true }).sort()).toEqual(["mlb:501", "mlb:503", "nba:701", "nba:704", "nfl:401", "nfl:402", "nfl:403", "nfl:404", "nhl:601", "nhl:604"]);
  });
  it("close games: late and tight", () => {
    expect(run({ close: true })).toEqual(["nfl:401", "nba:701", "mlb:504"]);
    expect(isCloseGame({ ...game("nfl:401"), period: 3 })).toBe(false);
    expect(isCloseGame({ ...game("nfl:401"), home: { ...game("nfl:401").home, score: 40 } })).toBe(false);
  });
  it("time windows in Eastern time", () => {
    const tonight = { ...game("nfl:403") }; // 8:20 PM ET Sunday
    expect(inWindow(tonight, "tonight", now)).toBe(true);
    expect(inWindow(tonight, "today", now)).toBe(true);
    expect(inWindow(game("nfl:404"), "tomorrow", now)).toBe(true); // Monday 8:15 PM ET
    expect(inWindow(game("nfl:404"), "today", now)).toBe(false);
    expect(inWindow(game("nfl:401"), "now", now)).toBe(true); // live
    expect(inWindow(game("nfl:405"), "week", now)).toBe(true);
    // Late West Coast start: 10:30 PM ET is still "tonight" and "today".
    expect(inWindow(game("nhl:601"), "tonight", now)).toBe(true);
  });
  it("time windows follow the household's timezone", () => {
    const at = (iso: string) => ({ ...game("nfl:402"), state: "pre" as const, startTime: iso });
    const six = at("2026-10-18T22:00:00Z"); // 6 PM ET = 3 PM PT
    expect(inWindow(six, "tonight", now, "America/New_York")).toBe(true);
    expect(inWindow(six, "tonight", now, "America/Los_Angeles")).toBe(false);
    // 9:30 PM Sunday in LA is already Monday in New York.
    const late = new Date("2026-10-19T04:30:00Z");
    const mondayNoonPT = at("2026-10-19T19:00:00Z");
    expect(inWindow(mondayNoonPT, "today", late, "America/New_York")).toBe(true);
    expect(inWindow(mondayNoonPT, "today", late, "America/Los_Angeles")).toBe(false);
    expect(inWindow(mondayNoonPT, "tomorrow", late, "America/Los_Angeles")).toBe(true);
    expect(inWindow(six, "tonight", now, "Not/AZone")).toBe(true); // bad zone: Eastern
  });
  it("sorts by start time or league", () => {
    expect(run({ sort: "time" }).slice(0, 2)).toEqual(["nfl:401", "nfl:402"]);
    expect(run({ sort: "league" })[0].startsWith("nfl:")).toBe(true);
  });
  it("names the filter that hid everything", () => {
    const f = { ...DEFAULT_FILTERS, q: "chargers", leagues: ["nhl" as const] };
    expect(applyFilters(games, f, fctx)).toEqual([]);
    expect(blockingFilter(games, f, fctx)).toBe("leagues");
    expect(blockingFilter(games, { ...DEFAULT_FILTERS, q: "zzzz" }, fctx)).toBe("q");
    expect(blockingFilter(games, { ...DEFAULT_FILTERS, close: true, leagues: ["nhl"] }, fctx)).toBe("close");
  });
  it("view presets map to status + time, and unknown combinations to none", () => {
    expect(viewOf(DEFAULT_FILTERS)).toBe("all");
    for (const v of ["live", "today", "upcoming", "all"] as const) expect(viewOf({ ...DEFAULT_FILTERS, ...VIEW_PRESETS[v] })).toBe(v);
    expect(viewOf({ ...DEFAULT_FILTERS, status: ["upcoming", "live"] })).toBe("all"); // order doesn't matter
    expect(viewOf({ ...DEFAULT_FILTERS, time: "tonight" })).toBeNull();
    expect(viewOf({ ...DEFAULT_FILTERS, status: ["live", "upcoming", "final"] })).toBeNull();
    expect(run(VIEW_PRESETS.live)).toEqual(["nfl:401", "nba:701", "mlb:504"]);
    expect(run(VIEW_PRESETS.upcoming)).not.toContain("nfl:401");
    expect(run(VIEW_PRESETS.today)).not.toContain("nfl:404"); // Monday
  });
  it("counts active filters", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, favorites: true, leagues: ["nfl"], time: "today" })).toBe(3);
  });
});

describe("URL state", () => {
  it("round-trips", () => {
    const f: FilterState = { q: "giants", leagues: ["nfl", "mlb"], status: ["live"], time: "tonight", favorites: true, myServices: true, service: "plex", networks: ["fox"], quality: true, close: true, sort: "time" };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });
  it("keeps defaults out of the URL", () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe("");
    expect(serializeFilters({ ...DEFAULT_FILTERS, q: "kings" })).toBe("q=kings");
  });
  it("ignores unknown and invalid values", () => {
    const f = parseFilters("?league=nfl,xfl,<script>&status=bogus&time=forever&service=not_an_app&sort=x&net=fox,zzz&evil=1");
    expect(f).toEqual({ ...DEFAULT_FILTERS, leagues: ["nfl"], status: [], networks: ["fox"] });
  });
});
