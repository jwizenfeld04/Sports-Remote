import { useMemo, useState } from "react";
import type { OwnedSubscription } from "../../lib/profile";
import { SUBSCRIPTIONS, SUBSCRIPTION_BY_ID, type SubscriptionDef, type SubscriptionKind } from "../../lib/catalog/subscriptions";
import { APP_RECORD } from "../catalog";
import { Icon, SearchField, Segmented } from "../components/ui";

// Pick what the household pays for. Each card shows what it adds to coverage right now ("+42 games"),
// so the coverage panel next to it is the reason to tick or untick.

const GROUPS: { kind: SubscriptionKind; title: string; hint: string }[] = [
  { kind: "live_tv", title: "Live TV services", hint: "Cable-style bundles with local channels" },
  { kind: "streaming", title: "Streaming apps", hint: "Network and streaming apps with live sports" },
  { kind: "league", title: "League packages", hint: "Out-of-market games for one league" },
  { kind: "regional", title: "Your local teams' channels", hint: "Regional sports networks and team apps" },
  { kind: "antenna", title: "Antenna", hint: "Free over-the-air locals" },
];

interface Props {
  subscriptions: OwnedSubscription[];
  tveSignIns: string[];
  gain: (id: string, tier?: string) => number;
  onChange: (subs: OwnedSubscription[], tve: string[]) => void;
}

export function ServicesStep({ subscriptions, tveSignIns, gain, onChange }: Props) {
  const [q, setQ] = useState("");
  const owned = useMemo(() => new Map(subscriptions.map((s) => [s.id, s])), [subscriptions]);
  const matches = (s: SubscriptionDef) => !q || `${s.name} ${s.blurb}`.toLowerCase().includes(q.toLowerCase());

  const toggle = (def: SubscriptionDef) => {
    if (owned.has(def.id)) {
      // Drop TV Everywhere sign-ins that only this subscription unlocked.
      const still = new Set(subscriptions.filter((s) => s.id !== def.id).flatMap((s) => SUBSCRIPTION_BY_ID.get(s.id)?.unlocks?.map((u) => u.app) ?? []));
      onChange(subscriptions.filter((s) => s.id !== def.id), tveSignIns.filter((a) => still.has(a)));
    } else {
      onChange([...subscriptions, { id: def.id, tier: def.defaultTier, addOns: [] }], tveSignIns);
    }
  };
  const update = (id: string, patch: Partial<OwnedSubscription>) => onChange(subscriptions.map((s) => (s.id === id ? { ...s, ...patch } : s)), tveSignIns);
  const toggleTve = (app: string) => onChange(subscriptions, tveSignIns.includes(app) ? tveSignIns.filter((a) => a !== app) : [...tveSignIns, app]);

  return (
    <div className="svc-step">
      <SearchField placeholder="Find a service" aria-label="Find a service" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} />
      {GROUPS.map((grp) => {
        const list = SUBSCRIPTIONS.filter((s) => s.kind === grp.kind && matches(s));
        if (!list.length) return null;
        return (
          <section key={grp.kind} className="svc-group" aria-labelledby={`grp-${grp.kind}`}>
            <h3 id={`grp-${grp.kind}`}>{grp.title} <span className="muted small">{grp.hint}</span></h3>
            <div className="svc-grid">
              {list.map((def) => {
                const mine = owned.get(def.id);
                const adds = mine ? 0 : gain(def.id, def.defaultTier);
                return (
                  <article key={def.id} className={`svc-card${mine ? " on" : ""}`} data-testid={`svc-${def.id}`}>
                    <button type="button" className="svc-toggle" aria-pressed={!!mine} onClick={() => toggle(def)}>
                      <span className="svc-check" aria-hidden>{mine && <Icon name="check" size={16} />}</span>
                      <span className="svc-name">{def.name}</span>
                      {!mine && adds > 0 && <span className="svc-gain">+{adds}</span>}
                    </button>
                    <p className="svc-blurb small">{def.blurb}</p>
                    {def.confidence === "low" && <p className="svc-note small"><Icon name="info" size={14} /> Channel lineup not confirmed; coverage may be off.</p>}
                    {mine && def.tiers && def.tiers.length > 1 && (
                      <Segmented
                        label={`${def.name} plan`}
                        value={mine.tier ?? def.defaultTier ?? def.tiers[0].id}
                        options={def.tiers.map((t) => ({ value: t.id, label: t.name }))}
                        onChange={(tier) => update(def.id, { tier })}
                        className="svc-tiers"
                      />
                    )}
                    {mine && def.addOns && def.addOns.length > 0 && (
                      <div className="chips-wrap svc-addons">
                        {def.addOns.map((a) => {
                          const on = mine.addOns.includes(a.id);
                          return (
                            <button key={a.id} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => update(def.id, { addOns: on ? mine.addOns.filter((x) => x !== a.id) : [...mine.addOns, a.id] })}>
                              {on ? "✓ " : "+ "}{a.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {mine && def.unlocks?.map((u) => {
                      const target = SUBSCRIPTION_BY_ID.get(u.subscription);
                      const on = tveSignIns.includes(u.app);
                      return (
                        <label key={u.app} className="svc-tve small">
                          <input type="checkbox" checked={on} onChange={() => toggleTve(u.app)} />
                          <span>
                            I sign in to the <strong>{APP_RECORD[u.app]?.label ?? u.app}</strong> app with {def.name}
                            {u.app === "espn" ? " (opens ESPN games straight to the game)" : ""}
                            {u.maybeOnly ? <span className="muted"> · {target?.name} access not confirmed for {def.name}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                    {def.blackouts && mine && <p className="svc-note small"><Icon name="alert" size={14} /> {def.blackouts}</p>}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
