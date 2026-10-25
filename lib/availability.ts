import type { Broadcast, Game, League, LocalGuide } from "./types";
import { NETWORK_KIND, NETWORK_LABEL, OUTLET_LABEL, type NetworkId, type OutletId } from "./catalog/networks";
import { teamKey } from "./teams";
import { localGuideMatch } from "./guideMatch";

// What it takes to watch one game where you live. Pure: games come from ESPN, the market from the profile.
//
// The rules (from ESPN's labels and each league's 2026 rights, see docs/coverage.md):
//  - A national label with no home/away label in the same game is a national exclusive: only that network.
//  - A home/away label is that team's local outlet: it only helps if that team is one of your local teams.
//  - NBA/MLB/NHL regional games (ones with local outlets) are on the league's out-of-market package, unless a
//    team in the game is local to you (blacked out). Exclusives are never on the package.
//  - NFL Sunday-afternoon CBS/FOX games are regional by TV market even though ESPN calls them national: your
//    local station has the ones it carries; Sunday Ticket has the rest.
//  - ESPN puts "MLB.TV", "ESPN+" (NHL) and "NBA League Pass" on games like networks; they're the packages.
//    MLB "Prime Video" is the Yankees' in-market stream, i.e. a local outlet.

export interface MarketView {
  localTeams: ReadonlySet<string>; // team keys
}

export type Need =
  | { kind: "network"; network: NetworkId; certain: boolean; why: string; guide?: boolean } // guide: the local guide confirmed it
  | { kind: "outlet"; outlet: OutletId; team: string; certain: boolean; why: string }
  | { kind: "package"; network: NetworkId; certain: boolean; why: string };

export interface Availability {
  needs: Need[]; // any one of these is enough
  /** Why some options don't apply here (blackouts, closed networks). Shown when nothing covers the game. */
  notes: string[];
  exclusive: boolean;
  tbd: boolean; // no TV listing yet
}

const ET = "America/New_York";

export function easternParts(iso: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), hour: Number(get("hour")), minute: Number(get("minute")) };
}

/** NFL Sunday-afternoon window (12:00–17:00 ET kickoffs), where CBS/FOX games are regional. */
export function isSundayAfternoon(iso: string): boolean {
  const { weekday, hour } = easternParts(iso);
  return weekday === 0 && hour >= 12 && hour < 17;
}

const LEAGUE_NETWORKS: NetworkId[] = ["nbatv", "mlbnet", "nhlnet", "nflnet"];
const PACKAGE_OF: Record<Exclude<League, "nfl">, NetworkId> = { nba: "nba_league_pass", mlb: "mlbtv", nhl: "nhl_power_play" };
const PACKAGE_NAME: Record<Exclude<League, "nfl">, string> = { nba: "NBA League Pass", mlb: "MLB.TV", nhl: "ESPN's NHL Power Play" };

/** The team a home/away label belongs to. */
const teamOf = (g: Game, b: Broadcast) => teamKey(g.league, b.scope === "away" ? g.away : g.home);

export function availability(g: Game, market: MarketView, guide: LocalGuide | null = null): Availability {
  const notes: string[] = [];
  const bs = g.broadcasts.filter((b) => !b.radio);
  if (bs.length === 0) return { needs: [], notes: ["No TV listing yet."], exclusive: false, tbd: true };

  const homeLocal = market.localTeams.has(teamKey(g.league, g.home));
  const awayLocal = market.localTeams.has(teamKey(g.league, g.away));
  const anyLocal = homeLocal || awayLocal;

  // Reinterpret a few labels by league (see the header).
  const items = bs.map((b) => {
    if (g.league === "mlb" && b.network === "prime") return { ...b, network: "local" as const, outlet: "prime_local" as const, scope: "home" as const, yankees: true };
    if (g.league === "nhl" && b.network === "espn_plus") return { ...b, nhlEspnPlus: true };
    return b;
  });
  const hasLocal = items.some((b) => b.network === "local");
  const nationalTv = items.filter((b) => b.network !== "local" && b.network !== "unknown" && NETWORK_KIND[b.network] !== "package" && !("nhlEspnPlus" in b));
  // NHL "ESPN+" alongside other broadcasts is the out-of-market feed; on its own (with Disney+/Hulu) it's an exclusive.
  const nhlOnlyStreaming = g.league === "nhl" && items.some((b) => "nhlEspnPlus" in b) && !hasLocal &&
    nationalTv.every((b) => b.network === "disney_plus" || b.network === "hulu");
  const exclusive = !hasLocal && (nationalTv.length > 0 || nhlOnlyStreaming);

  const needs: Need[] = [];

  // 1. NFL Sunday afternoon on CBS/FOX: regional by market.
  const sunday = g.league === "nfl" && isSundayAfternoon(g.startTime) ? items.find((b) => b.network === "cbs" || b.network === "fox") : undefined;
  if (sunday) {
    const net = sunday.network;
    const onGuide = localGuideMatch(g, guide, ["cbs", "fox"]);
    if (anyLocal || onGuide) {
      needs.push({ kind: "network", network: onGuide ?? net, certain: true, guide: !!onGuide, why: anyLocal ? "Your local team: on your local station" : `Your local ${NETWORK_LABEL[onGuide!]} station is showing it` });
    } else if (guide?.fetchedAt && guide.entries.some((e) => e.network === net)) {
      // The guide knows what the local station shows, and it isn't this game.
      needs.push({ kind: "package", network: "nfl_sunday_ticket", certain: true, why: "Out-of-market Sunday game" });
    } else {
      needs.push({ kind: "package", network: "nfl_sunday_ticket", certain: false, why: "Out-of-market Sunday game (if your local station isn't showing it)" });
      needs.push({ kind: "network", network: net, certain: false, why: `If your local ${NETWORK_LABEL[net]} station is showing it` });
    }
    return { needs, notes, exclusive: false, tbd: false };
  }

  // 2. National networks.
  for (const b of nationalTv) {
    if (needs.some((n) => n.kind === "network" && n.network === b.network)) continue;
    // League-owned networks are blacked out in the teams' home markets when a local outlet has the game.
    if (LEAGUE_NETWORKS.includes(b.network) && hasLocal && anyLocal) {
      notes.push(`${NETWORK_LABEL[b.network]} is blacked out where you live for this game; it's on your local broadcast.`);
      continue;
    }
    needs.push({ kind: "network", network: b.network, certain: true, why: exclusive ? `National game on ${NETWORK_LABEL[b.network]}` : `On ${NETWORK_LABEL[b.network]}` });
  }
  if (nhlOnlyStreaming) needs.push({ kind: "network", network: "espn_plus", certain: true, why: "ESPN+ exclusive" });

  // 3. Local outlets, for your local teams only.
  for (const b of items) {
    if (b.network !== "local" || !b.outlet) continue;
    const team = "yankees" in b ? `mlb:NYY` : teamOf(g, b);
    if (!market.localTeams.has(team)) continue;
    if (b.outlet === "rsn") {
      notes.push("Your local team's listing doesn't say which current network carries it.");
      continue;
    }
    if (needs.some((n) => n.kind === "outlet" && n.outlet === b.outlet && n.team === team)) continue;
    needs.push({ kind: "outlet", outlet: b.outlet, team, certain: true, why: `Your local team's broadcast (${b.raw})` });
  }

  // 4. Out-of-market packages.
  if (g.league !== "nfl" && hasLocal) {
    const pkg = PACKAGE_OF[g.league];
    if (anyLocal) {
      notes.push(`${PACKAGE_NAME[g.league]} blacks out your local teams.`);
    } else {
      needs.push({ kind: "package", network: pkg, certain: true, why: `Out-of-market game on ${PACKAGE_NAME[g.league]}` });
      if (g.league === "mlb" && items.some((b) => b.network === "mlb_gotd")) {
        needs.push({ kind: "package", network: "mlb_gotd", certain: true, why: "MLB.TV game of the day in ESPN Unlimited" });
      }
    }
  } else if (g.league !== "nfl" && exclusive) {
    notes.push(`National exclusive: not on ${PACKAGE_NAME[g.league]}.`);
  }

  return { needs, notes, exclusive, tbd: false };
}
