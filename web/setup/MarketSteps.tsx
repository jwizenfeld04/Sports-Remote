import { useMemo, useState } from "react";
import type { League } from "../../lib/types";
import { LEAGUES } from "../../lib/types";
import type { Market, OwnedSubscription } from "../../lib/profile";
import { METROS, TEAMS } from "../../lib/catalog/teams";
import { LOCAL_TEAMS } from "../../lib/catalog/localTeams";
import { SUBSCRIPTION_BY_ID } from "../../lib/catalog/subscriptions";
import { OUTLET_LABEL } from "../../lib/catalog/networks";
import { entitlements } from "../../lib/entitlements";
import { LEAGUE_LABEL } from "../format";
import { SearchField } from "../components/ui";

const metroTeams = (id: string) => {
  const m = METROS.find((x) => x.id === id);
  return m ? Object.entries(m.teams).flatMap(([lg, abbrs]) => (abbrs ?? []).map((a) => `${lg}:${a}`)) : [];
};
const teamName = (key: string) => TEAMS.find((t) => t.key === key)?.displayName ?? key;
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

/** Where you live decides your local stations, your local teams' channels and what's blacked out. */
export function AreaStep({ market, onChange }: { market: Market; onChange: (m: Market) => void }) {
  const [adding, setAdding] = useState("");
  const pickMetro = (id: string) => {
    const m = METROS.find((x) => x.id === id);
    onChange({ ...market, metro: id || null, localTeams: id ? metroTeams(id) : [], timezone: m?.timezone ?? market.timezone });
  };
  const candidates = useMemo(() => TEAMS.filter((t) => !market.localTeams.includes(t.key) && adding && `${t.displayName} ${t.abbr}`.toLowerCase().includes(adding.toLowerCase())).slice(0, 8), [adding, market.localTeams]);
  const zones = ZONES.includes(market.timezone) ? ZONES : [market.timezone, ...ZONES];

  return (
    <div className="area-step">
      <div className="form-grid">
        <label className="field">
          <span>Metro area</span>
          <select value={market.metro ?? ""} onChange={(e) => pickMetro(e.target.value)} data-testid="metro-select">
            <option value="">Choose…</option>
            {METROS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Time zone</span>
          <select value={market.timezone} onChange={(e) => onChange({ ...market, timezone: e.target.value })}>
            {zones.map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("Pacific/", "").replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>
      <h3>Your local teams</h3>
      <p className="muted small">
        Their games air on your local channels, and out-of-market packages (NBA League Pass, MLB.TV, ESPN's NHL Power Play, Sunday Ticket) black them out.
        Blackout areas can be wider than the metro: add any team that's blacked out where you live.
      </p>
      {LEAGUES.map((l) => {
        const mine = market.localTeams.filter((k) => k.startsWith(`${l}:`));
        if (!mine.length) return null;
        return (
          <div key={l} className="team-row">
            <span className="team-row-league">{LEAGUE_LABEL[l]}</span>
            <div className="chips-wrap">
              {mine.map((k) => (
                <button key={k} type="button" className="chip on" onClick={() => onChange({ ...market, localTeams: market.localTeams.filter((x) => x !== k) })} aria-label={`Remove ${teamName(k)}`}>
                  {teamName(k)} ✕
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <SearchField placeholder="Add a local team" aria-label="Add a local team" value={adding} onChange={(e) => setAdding(e.target.value)} onClear={() => setAdding("")} />
      {candidates.length > 0 && (
        <div className="chips-wrap">
          {candidates.map((t) => (
            <button key={t.key} type="button" className="chip" onClick={() => (onChange({ ...market, localTeams: [...market.localTeams, t.key] }), setAdding(""))}>
              + {t.displayName} <span className="muted">{LEAGUE_LABEL[t.league]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Favorites go first in the list, and the coverage panel shows how many of their games you can watch. */
export function TeamsStep({ favorites, localTeams, onChange }: { favorites: string[]; localTeams: string[]; onChange: (f: string[]) => void }) {
  const [league, setLeague] = useState<League>("nfl");
  const [q, setQ] = useState("");
  const list = TEAMS.filter((t) => (q ? `${t.displayName} ${t.abbr} ${t.aliases.join(" ")}`.toLowerCase().includes(q.toLowerCase()) : t.league === league));
  const toggle = (k: string) => onChange(favorites.includes(k) ? favorites.filter((x) => x !== k) : [...favorites, k]);
  return (
    <div className="teams-step">
      <div className="teams-tools">
        <div className="segmented-wrap">
          {LEAGUES.map((l) => (
            <button key={l} type="button" className={`chip${league === l && !q ? " on" : ""}`} onClick={() => (setLeague(l), setQ(""))}>{LEAGUE_LABEL[l]}</button>
          ))}
        </div>
        <SearchField placeholder="Search teams" aria-label="Search teams" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} />
      </div>
      {localTeams.length > 0 && !favorites.some((f) => localTeams.includes(f)) && (
        <button type="button" className="link-btn small" onClick={() => onChange([...new Set([...favorites, ...localTeams])])}>Star all my local teams</button>
      )}
      <div className="team-grid">
        {list.map((t) => {
          const on = favorites.includes(t.key);
          return (
            <button key={t.key} type="button" className={`team-tile${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(t.key)} style={{ "--team": t.color } as React.CSSProperties} data-testid={`fav-${t.key}`}>
              <span className="team-swatch" aria-hidden />
              <span className="team-tile-name">{t.displayName}</span>
              {q && <span className="muted small">{LEAGUE_LABEL[t.league]}</span>}
              <span className="team-star" aria-hidden>{on ? "★" : "☆"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** For each local NBA/MLB/NHL team: where its games air, and which of your services (if any) has them. */
export function LocalStep({ market, subscriptions, tveSignIns, onChange }: {
  market: Market; subscriptions: OwnedSubscription[]; tveSignIns: string[]; onChange: (m: Market) => void;
}) {
  const teams = market.localTeams.filter((k) => !k.startsWith("nfl:"));
  const ents = useMemo(() => entitlements({ subscriptions, tveSignIns, localSources: {} }), [subscriptions, tveSignIns]);
  const owned = subscriptions.map((s) => s.id);
  if (!teams.length) return <p className="muted">No local NBA, MLB or NHL teams. NFL teams' games are on your local CBS, FOX, NBC and ABC stations.</p>;
  return (
    <ul className="local-list">
      {teams.map((k) => {
        const info = LOCAL_TEAMS[k];
        const auto = [...new Set(ents.filter((e) => info?.outlets.some((o) => e.grant === `outlet:${o}`)).map((e) => e.subscription))];
        const declared = market.localSources[k];
        const set = (ids: string[] | null) => {
          const next = { ...market.localSources };
          if (ids === null) delete next[k];
          else next[k] = ids;
          onChange({ ...market, localSources: next });
        };
        const suggestions = (info?.subs ?? []).filter((s) => !owned.includes(s)).map((s) => SUBSCRIPTION_BY_ID.get(s)?.name).filter(Boolean);
        return (
          <li key={k} className="local-item" data-testid={`local-${k}`}>
            <div className="local-head">
              <strong>{teamName(k)}</strong>
              <span className="muted small">{info ? info.outlets.map((o) => OUTLET_LABEL[o]).join(" / ") : "Local broadcast"}</span>
            </div>
            {info?.note && <p className="small muted">{info.note}</p>}
            <div className="local-status small">
              {declared?.length ? (
                <span className="ok">✓ You watch them on {declared.map((d) => SUBSCRIPTION_BY_ID.get(d)?.name ?? d).join(", ")}</span>
              ) : auto.length ? (
                <span className="ok">✓ On {auto.map((d) => SUBSCRIPTION_BY_ID.get(d)?.name ?? d).join(", ")}</span>
              ) : (
                <span className="warn">Not on your services{suggestions.length ? `: ${suggestions.slice(0, 3).join(", ")} would have them` : ""}</span>
              )}
            </div>
            {owned.length > 0 && (
              <label className="field inline small">
                <span>I watch them on</span>
                <select value={declared?.[0] ?? ""} onChange={(e) => set(e.target.value ? [e.target.value] : null)}>
                  <option value="">{auto.length ? "(automatic)" : "Choose…"}</option>
                  {subscriptions.map((s) => <option key={s.id} value={s.id}>{SUBSCRIPTION_BY_ID.get(s.id)?.name ?? s.id}</option>)}
                </select>
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}
