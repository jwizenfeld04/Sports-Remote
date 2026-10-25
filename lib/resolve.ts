import type { Game, LaunchLevel, LaunchRoute, LocalGuide, Resolution } from "./types";
import { LEVEL_RANK } from "./types";
import type { Market, OwnedSubscription } from "./profile";
import { availability, type Need } from "./availability";
import { entitlements, satisfy, subscriptionsFor, type Entitlement } from "./entitlements";
import { APP_BY_ID, bestLevel, packageFor, verifiedLevel, type AppDef, type Platform } from "./catalog/apps";
import { NETWORK_LABEL, OUTLET_LABEL, type NetworkId } from "./catalog/networks";
import { SUBSCRIPTION_BY_ID } from "./catalog/subscriptions";

// Game -> ranked launch routes for this household. Pure: the same code runs in the browser and on the server,
// so the card shows exactly what pressing Play will do.

export interface Household {
  market: Pick<Market, "localTeams" | "localSources">;
  subscriptions: OwnedSubscription[];
  tveSignIns: string[];
  servicePriority: Partial<Record<string, string[]>>; // network -> app ids
}

export interface ResolveContext {
  household: Household;
  platform: Platform;
  installedApps: ReadonlySet<string> | null; // null = unknown (no TV checked yet): treat everything as installed
  guide: LocalGuide | null;
  experimental?: boolean; // screen-reading navigators allowed (default true)
}

/** Entitlements are the same for every game: compute once per household and reuse. */
const cache = new WeakMap<Household, Entitlement[]>();
function entsFor(h: Household): Entitlement[] {
  let e = cache.get(h);
  if (!e) cache.set(h, (e = entitlements({ subscriptions: h.subscriptions, tveSignIns: h.tveSignIns, localSources: h.market.localSources })));
  return e;
}

const needNetwork = (n: Need): NetworkId => (n.kind === "outlet" ? "local" : n.network);
const needLabel = (n: Need) => (n.kind === "outlet" ? OUTLET_LABEL[n.outlet] : NETWORK_LABEL[n.network]);

function levelFor(app: AppDef, network: NetworkId, ctx: ResolveContext): { level: LaunchLevel; verified: boolean } {
  const allowNav = ctx.experimental !== false;
  const v = verifiedLevel(app, network, ctx.platform);
  const best = bestLevel(app, network, ctx.platform);
  const navOnly = app.routes.every((r) => !!r.navigate);
  if (!allowNav && navOnly) return { level: "app", verified: true };
  return LEVEL_RANK[best] > LEVEL_RANK[v] ? { level: best, verified: false } : { level: v, verified: true };
}

/**
 * Rank so the household's order wins, except a route two confirmed levels better (game vs app) jumps ahead.
 * Certain routes beat "probably" ones, and apps on the TV beat ones that aren't installed.
 */
export function rankRoutes(routes: LaunchRoute[]): LaunchRoute[] {
  // Unconfirmed levels count one lower: a confirmed game link beats a screen-reading attempt that may not get there.
  const eff = (r: LaunchRoute) => LEVEL_RANK[r.level] - (r.levelVerified === false ? 1 : 0);
  const chosen = (r: LaunchRoute) => (r.priority !== undefined && r.priority < 10 ? r.priority : 99);
  const base = [...routes].sort((a, b) =>
    Number(!!b.installed) - Number(!!a.installed) || Number(!!a.manual) - Number(!!b.manual) || Number(b.certain) - Number(a.certain) ||
    chosen(a) - chosen(b) || eff(b) - eff(a) || (a.priority ?? 99) - (b.priority ?? 99));
  const out: LaunchRoute[] = [];
  for (const r of base) {
    let i = out.length;
    while (i > 0 && r.levelVerified !== false && eff(r) - eff(out[i - 1]) >= 2 && r.installed === out[i - 1].installed && r.certain === out[i - 1].certain) i--;
    out.splice(i, 0, r);
  }
  return out;
}

export function resolveGame(game: Game, ctx: ResolveContext): Resolution {
  const h = ctx.household;
  const local = new Set(h.market.localTeams);
  const av = availability(game, { localTeams: local }, ctx.guide);
  if (av.tbd) return { routes: [], notCovered: { network: "TBD", message: "No TV listing yet.", suggestions: [] }, needs: [] };

  const matches = satisfy(av.needs, entsFor(h), game.league, { localSources: h.market.localSources });
  const routes: LaunchRoute[] = [];
  for (const m of matches) {
    const network = needNetwork(m.need);
    m.ent.apps.forEach((appId, appIndex) => {
      const app = APP_BY_ID.get(appId);
      if (!app) return;
      if (routes.some((r) => r.service === appId && r.network === network)) return;
      const pri = h.servicePriority[network]?.indexOf(appId) ?? -1;
      const { level, verified } = levelFor(app, network, ctx);
      const sub = SUBSCRIPTION_BY_ID.get(m.ent.subscription);
      const manual = !packageFor(app, ctx.platform);
      routes.push({
        service: appId,
        network,
        outlet: m.need.kind === "outlet" ? m.need.outlet : undefined,
        level,
        levelVerified: verified,
        certain: m.certain,
        installed: manual ? undefined : ctx.installedApps ? ctx.installedApps.has(appId) : true,
        ...(manual ? { manual: true, level: "app" as const } : {}),
        subscription: m.ent.subscription,
        reason: [m.need.why, m.ent.via ?? (sub ? `with ${sub.name}` : "")].filter(Boolean).join(" · "),
        priority: pri >= 0 ? pri : 10 + routes.length + appIndex,
        local: appId === "plex" ? (m.need.kind === "network" && m.need.guide ? "guide" : "market") : undefined,
      });
    });
  }

  if (routes.length > 0) return { routes: rankRoutes(routes), needs: av.needs, notes: av.notes };

  // Not covered: say why, and what would cover it.
  const suggestions = av.needs.flatMap((n) => subscriptionsFor(n, game.league).map((s) => ({ ...s, need: needLabel(n) })));
  const uniq = suggestions.filter((s, i) => suggestions.findIndex((x) => x.id === s.id) === i);
  const first = av.needs[0];
  const label = first ? needLabel(first) : game.broadcasts[0]?.raw ?? "TBD";
  const message = av.needs.length === 0
    ? (av.notes[0] ?? `${game.broadcasts.map((b) => b.raw).join(", ")} isn't available where you live.`)
    : `${label} isn't on your services.${av.notes.length ? " " + av.notes.join(" ") : ""}`;
  return { routes: [], notCovered: { network: label, message, suggestions: uniq.slice(0, 6) }, needs: av.needs, notes: av.notes };
}

/** True when the client-sent route is one the server would produce for this game. */
export function isResolvedRoute(res: Resolution, r: Pick<LaunchRoute, "service" | "network">): boolean {
  return res.routes.some((x) => x.service === r.service && x.network === r.network);
}
