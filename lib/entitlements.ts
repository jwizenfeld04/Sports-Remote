import type { League } from "./types";
import type { OwnedSubscription } from "./profile";
import { SUBSCRIPTION_BY_ID, type Grant, type SubscriptionDef } from "./catalog/subscriptions";
import type { Need } from "./availability";

// What a household's subscriptions let it watch, and in which apps.

export interface Entitlement {
  grant: Grant;
  subscription: string; // catalog subscription id
  apps: string[]; // where it plays, best first
  certain: boolean; // false = reported but not confirmed ("probably")
  via?: string; // e.g. "Signed in with YouTube TV"
}

export interface EntitlementInput {
  subscriptions: OwnedSubscription[];
  tveSignIns: string[]; // app ids signed in with a TV provider
  localSources: Record<string, string[]>; // team key -> subscription ids that carry its local games
}

function grantsOf(def: SubscriptionDef, owned: Pick<OwnedSubscription, "tier" | "addOns">): { grants: Grant[]; maybe: Grant[] } {
  const tier = def.tiers?.find((t) => t.id === (owned.tier ?? def.defaultTier)) ?? def.tiers?.[0];
  const addOns = (def.addOns ?? []).filter((a) => owned.addOns?.includes(a.id));
  return {
    grants: [...def.grants, ...(tier?.grants ?? []), ...addOns.flatMap((a) => a.grants)],
    maybe: [...(def.maybe ?? []), ...(tier?.maybe ?? []), ...addOns.flatMap((a) => a.maybe ?? [])],
  };
}

/** Add-ons can play somewhere other than the subscription's own app (League Pass as a Prime Video Channel). */
function appsFor(def: SubscriptionDef): string[] {
  return def.apps;
}

export function entitlements(input: EntitlementInput): Entitlement[] {
  const out: Entitlement[] = [];
  const push = (e: Entitlement) => {
    const dup = out.find((x) => x.grant === e.grant && x.subscription === e.subscription && x.apps.join() === e.apps.join());
    if (!dup) out.push(e);
    else if (e.certain && !dup.certain) Object.assign(dup, e);
  };
  for (const owned of input.subscriptions) {
    const def = SUBSCRIPTION_BY_ID.get(owned.id);
    if (!def) continue;
    const { grants, maybe } = grantsOf(def, owned);
    for (const g of grants) push({ grant: g, subscription: def.id, apps: appsFor(def), certain: true });
    for (const g of maybe) push({ grant: g, subscription: def.id, apps: appsFor(def), certain: false });
    // TV Everywhere: a live TV login unlocks other apps (ESPN with YouTube TV). Only once that app is signed in.
    for (const u of def.unlocks ?? []) {
      if (!input.tveSignIns.includes(u.app)) continue;
      const target = SUBSCRIPTION_BY_ID.get(u.subscription);
      if (!target) continue;
      const tg = grantsOf(target, { tier: u.tier, addOns: [] });
      for (const g of tg.grants) push({ grant: g, subscription: def.id, apps: [u.app], certain: !u.maybeOnly, via: `Signed in with ${def.name}` });
    }
  }
  return out;
}

const grantMatches = (grant: Grant, network: string, league: League) => grant === network || grant === `${network}@${league}`;

export interface Match {
  need: Need;
  ent: Entitlement;
  certain: boolean;
}

/** Every (need, entitlement) pair that works for this game. */
export function satisfy(needs: Need[], ents: Entitlement[], league: League, input: Pick<EntitlementInput, "localSources">): Match[] {
  const out: Match[] = [];
  const owned = new Set(ents.map((e) => e.subscription));
  for (const need of needs) {
    if (need.kind === "outlet") {
      // The household told us how they watch this team's local games: that counts, whatever our outlet table says.
      for (const sid of input.localSources[need.team] ?? []) {
        const def = SUBSCRIPTION_BY_ID.get(sid);
        if (!def || !owned.has(sid)) continue;
        if (sid === "antenna" && need.outlet !== "ota") continue; // an antenna only ever gets broadcast stations
        out.push({ need, ent: { grant: `outlet:${need.outlet}`, subscription: sid, apps: def.apps, certain: true, via: "You said this is how you watch them" }, certain: need.certain });
      }
      for (const ent of ents) {
        if (ent.grant === `outlet:${need.outlet}` && !out.some((m) => m.need === need && m.ent.subscription === ent.subscription)) {
          out.push({ need, ent, certain: need.certain && ent.certain });
        }
      }
      continue;
    }
    for (const ent of ents) {
      if (grantMatches(ent.grant, need.network, league)) out.push({ need, ent, certain: need.certain && ent.certain });
    }
  }
  return out;
}

/** Subscriptions in the catalog that would cover a need (for "what would fix this" suggestions). */
export function subscriptionsFor(need: Need, league: League): { id: string; tier?: string; certain: boolean }[] {
  const out: { id: string; tier?: string; certain: boolean }[] = [];
  for (const def of SUBSCRIPTION_BY_ID.values()) {
    const options = def.tiers?.length ? def.tiers.map((t) => ({ tier: t.id as string | undefined, ...grantsOf(def, { tier: t.id, addOns: [] }) })) : [{ tier: undefined, ...grantsOf(def, { addOns: [] }) }];
    for (const a of def.addOns ?? []) options.push({ tier: undefined, grants: [...a.grants], maybe: [...(a.maybe ?? [])] });
    const hit = (gs: Grant[]) => gs.some((g) => (need.kind === "outlet" ? g === `outlet:${need.outlet}` : grantMatches(g, need.network, league)));
    const sure = options.find((o) => hit(o.grants));
    const maybe = options.find((o) => hit(o.maybe));
    if (sure) out.push({ id: def.id, tier: sure.tier, certain: true });
    else if (maybe) out.push({ id: def.id, tier: maybe.tier, certain: false });
  }
  return out;
}
