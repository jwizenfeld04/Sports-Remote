import { useEffect, useMemo, useState } from "react";
import type { Settings } from "../../lib/types";
import { entitlements } from "../../lib/entitlements";
import { NETWORK_LABEL, type NetworkId } from "../../lib/catalog/networks";
import { TEAM_BY_KEY } from "../../lib/teams";
import { APP_RECORD } from "../catalog";
import type { HouseholdView } from "../api";
import { Button, Icon, IconButton, Sheet, SwitchRow } from "./ui";

interface Props {
  settings: Settings;
  household: HouseholdView;
  isAdmin: boolean;
  ocrMissing?: boolean;
  onSetup: () => void;
  onSave: (s: Settings) => void;
  onLogout: () => void;
  onClose: () => void;
}

/** Networks two or more of the household's apps can show, with those apps. */
function sharedNetworks(h: HouseholdView): [NetworkId, string[]][] {
  const byNet = new Map<string, Set<string>>();
  for (const e of entitlements({ subscriptions: h.subscriptions, tveSignIns: h.tveSignIns, localSources: h.market.localSources })) {
    if (e.grant.startsWith("outlet:") || !e.certain) continue;
    const net = e.grant.split("@")[0];
    if (!(net in NETWORK_LABEL)) continue;
    const set = byNet.get(net) ?? new Set();
    e.apps.forEach((a) => set.add(a));
    byNet.set(net, set);
  }
  return [...byNet].filter(([, apps]) => apps.size > 1).map(([n, apps]) => [n as NetworkId, [...apps]]);
}

export function SettingsSheet({ settings, household, isAdmin, ocrMissing, onSetup, onSave, onLogout, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const shared = useMemo(() => sharedNetworks(household), [household]);

  const order = (n: NetworkId, apps: string[]): string[] => {
    const pri = draft.servicePriority[n] ?? [];
    return [...pri.filter((id) => apps.includes(id)), ...apps.filter((id) => !pri.includes(id))];
  };
  const move = (n: NetworkId, apps: string[], i: number, d: -1 | 1) => {
    const o = order(n, apps);
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setDraft({ ...draft, servicePriority: { ...draft.servicePriority, [n]: o } });
  };
  const label = (id: string) => APP_RECORD[id]?.label ?? id;

  return (
    <Sheet labelledBy="settings-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="settings-title" className="sheet-title">Settings</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      <div className="sheet-body">
        {isAdmin && (
          <section className="settings-section">
            <button type="button" className="setup-link" onClick={onSetup} data-testid="open-setup">
              <Icon name="tv" />
              <span>
                <strong>Services, TVs and your area</strong>
                <span className="muted">{household.subscriptions.length} services · {household.tvs.length} TV{household.tvs.length === 1 ? "" : "s"} · {household.market.localTeams.length} local teams</span>
              </span>
              <Icon name="chevron-right" />
            </button>
          </section>
        )}

        <section className="settings-section">
          <h3>Favorite teams</h3>
          <div className="chips-wrap">
            {draft.favorites.length === 0 && <p className="muted">Star teams from any game to add them.</p>}
            {draft.favorites.map((f) => (
              <button key={f} type="button" className="chip on" onClick={() => setDraft({ ...draft, favorites: draft.favorites.filter((x) => x !== f) })} aria-label={`Remove ${TEAM_BY_KEY.get(f)?.displayName ?? f}`}>
                {TEAM_BY_KEY.get(f)?.name ?? f.split(":")[1]} <span className="muted">{f.split(":")[0].toUpperCase()}</span> ✕
              </button>
            ))}
          </div>
        </section>

        {isAdmin && shared.length > 0 && (
          <section className="settings-section">
            <h3>Which app first</h3>
            <p className="muted small">When more than one of your apps has a game, the first one here opens.</p>
            {shared.map(([n, apps]) => (
              <div key={n} className="priority-row">
                <span className="priority-net">{NETWORK_LABEL[n]}</span>
                <ol>
                  {order(n, apps).map((id, i, all) => (
                    <li key={id}>
                      <span>{label(id)}</span>
                      <button type="button" className="icon-btn small" disabled={i === 0} onClick={() => move(n, apps, i, -1)} aria-label={`Move ${label(id)} up for ${NETWORK_LABEL[n]}`}>↑</button>
                      <button type="button" className="icon-btn small" disabled={i === all.length - 1} onClick={() => move(n, apps, i, 1)} aria-label={`Move ${label(id)} down for ${NETWORK_LABEL[n]}`}>↓</button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        )}

        <section className="settings-section">
          <div className="group-list">
            <SwitchRow label="One-tap send" detail="Skip the confirm sheet" checked={draft.oneTapSend} onChange={(v) => setDraft({ ...draft, oneTapSend: v })} testId="setting-one-tap" />
            {isAdmin && (
              <SwitchRow
                label="Screen-reading launches"
                detail="Lets the server drive YouTube TV, Plex and Prime Video to the game by reading the TV screen. Experimental; slower."
                checked={draft.experimentalLaunches}
                onChange={(v) => setDraft({ ...draft, experimentalLaunches: v })}
                testId="setting-experimental"
              />
            )}
            {isAdmin && ocrMissing && <p className="warn small settings-note">Screen reading is off: tesseract isn't installed on the server (apt install tesseract-ocr). These apps open to their home screen instead.</p>}
          </div>
        </section>

        {draft.presets.length > 0 && (
          <section className="settings-section">
            <h3>Saved views</h3>
            <div className="chips-wrap">
              {draft.presets.map((p) => (
                <button key={p.name} type="button" className="chip on" onClick={() => setDraft({ ...draft, presets: draft.presets.filter((x) => x !== p) })} aria-label={`Delete ${p.name}`}>
                  {p.name} ✕
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="sheet-actions">
          <Button variant="ghost" onClick={onLogout}>Sign out of this device</Button>
          <Button variant="primary" onClick={() => onSave(draft)} data-testid="settings-save">Save</Button>
        </div>
      </div>
    </Sheet>
  );
}
