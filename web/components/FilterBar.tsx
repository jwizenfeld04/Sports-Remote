import type { League, NetworkId, ServiceId } from "../../lib/types";
import { LEAGUES } from "../../lib/types";
import { DEFAULT_FILTERS, VIEW_PRESETS, viewOf, type FilterState, type SortMode, type StatusFilter, type TimeWindow, type ViewPreset } from "../../lib/filters";
import type { AppDef as ServiceDef } from "../../lib/catalog/apps";
import { NETWORK_LABEL } from "../../lib/networks";
import { LEAGUE_LABEL } from "../format";
import { Icon, PopUpButton, Segmented, SwitchRow, type MenuOption } from "./ui";

const TIMES: MenuOption<TimeWindow>[] = [
  { value: "now", label: "Now", detail: "Live or starting within the hour" }, { value: "tonight", label: "Tonight" },
  { value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }, { value: "week", label: "This week" },
];
const STATUSES: [StatusFilter, string][] = [["live", "Live"], ["upcoming", "Upcoming"], ["final", "Final scores"]];
const SORTS: MenuOption<SortMode>[] = [
  { value: "smart", label: "Smart", detail: "Live first, then by start time" }, { value: "time", label: "Start time" }, { value: "league", label: "League" },
];
const VIEWS: { value: ViewPreset; label: string; testId: string }[] = [
  { value: "live", label: "Live", testId: "view-live" }, { value: "today", label: "Today", testId: "view-today" },
  { value: "upcoming", label: "Upcoming", testId: "view-upcoming" }, { value: "all", label: "All", testId: "view-all" },
];

export function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** League segmented control: All or one league. A multi-league URL shows no segment selected (and a token). */
export function LeagueControl({ filters: f, onChange }: { filters: FilterState; onChange: (f: FilterState) => void }) {
  const value: League | "all" | null = f.leagues.length === 0 ? "all" : f.leagues.length === 1 ? f.leagues[0] : null;
  return (
    <Segmented
      label="League"
      className="seg-league"
      value={value}
      options={[{ value: "all" as const, label: "All", testId: "filter-league-all" }, ...LEAGUES.map((l) => ({ value: l, label: LEAGUE_LABEL[l], testId: `filter-league-${l}` }))]}
      onChange={(v) => onChange({ ...f, leagues: v === "all" ? [] : [v] })}
    />
  );
}

/** Status + time presets (Live / Today / Upcoming / All). Finer combinations live in the popover. */
export function ViewControl({ filters: f, onChange }: { filters: FilterState; onChange: (f: FilterState) => void }) {
  return (
    <Segmented label="Show" className="seg-view" value={viewOf(f)} options={VIEWS} onChange={(v) => onChange({ ...f, ...VIEW_PRESETS[v] })} />
  );
}

export interface FilterToken { key: string; label: string; clear: Partial<FilterState> }

/** Active filters the segmented controls can't show: drive the badge count and the removable tokens. */
export function filterTokens(f: FilterState, services: Record<string, ServiceDef>): FilterToken[] {
  const out: FilterToken[] = [];
  if (f.leagues.length > 1) out.push({ key: "leagues", label: f.leagues.map((l) => LEAGUE_LABEL[l]).join(" + "), clear: { leagues: [] } });
  if (!viewOf(f)) {
    if (f.status.join() !== DEFAULT_FILTERS.status.join()) {
      const label = f.status.length ? STATUSES.filter(([s]) => f.status.includes(s)).map(([, l]) => l).join(", ") : "No status";
      out.push({ key: "status", label, clear: { status: DEFAULT_FILTERS.status } });
    }
    if (f.time !== DEFAULT_FILTERS.time) out.push({ key: "time", label: TIMES.find((t) => t.value === f.time)!.label, clear: { time: DEFAULT_FILTERS.time } });
  }
  if (f.favorites) out.push({ key: "favorites", label: "Favorite teams", clear: { favorites: false } });
  if (f.myServices) out.push({ key: "myServices", label: "On my services", clear: { myServices: false } });
  if (f.service) out.push({ key: "service", label: `Watch on ${services[f.service]?.label ?? f.service}`, clear: { service: null } });
  if (f.networks.length) out.push({ key: "networks", label: f.networks.map((n) => NETWORK_LABEL[n]).join(", "), clear: { networks: [] } });
  if (f.quality) out.push({ key: "quality", label: "Opens game or channel", clear: { quality: false } });
  if (f.close) out.push({ key: "close", label: "Close games", clear: { close: false } });
  return out;
}

/** Everything but search and league goes back to the defaults. */
export const resetFilters = (f: FilterState): FilterState => ({ ...DEFAULT_FILTERS, q: f.q, leagues: f.leagues });

export function FilterTokens({ filters, services, onChange }: { filters: FilterState; services: Record<string, ServiceDef>; onChange: (f: FilterState) => void }) {
  const tokens = filterTokens(filters, services);
  if (tokens.length === 0) return null;
  return (
    <div className="filter-tokens" role="group" aria-label="Active filters" data-testid="filter-tokens">
      {tokens.map((t) => (
        <button key={t.key} type="button" className="token" onClick={() => onChange({ ...filters, ...t.clear })} aria-label={`Remove filter: ${t.label}`} data-testid={`token-${t.key}`}>
          <span>{t.label}</span>
          <Icon name="close" size={12} />
        </button>
      ))}
      <button type="button" className="token-clear" onClick={() => onChange({ ...resetFilters(filters), leagues: filters.leagues.length > 1 ? [] : filters.leagues })} data-testid="tokens-clear">
        Clear all
      </button>
    </div>
  );
}

interface PanelProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  networks: NetworkId[];
  services: Record<string, ServiceDef>;
  presets: { name: string; query: string }[];
  onApplyPreset: (query: string) => void;
  onSavePreset: () => void;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `fg-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="group" aria-labelledby={id}>
      <h3 id={id} className="group-title">{title}</h3>
      <div className="group-list">{children}</div>
    </section>
  );
}

function MenuRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row row-menu">
      <span className="row-label" aria-hidden>{label}</span>
      {children}
    </div>
  );
}

/** Contents of the Filters popover: grouped inset lists with switches and pop-up menus. */
export function FilterPanel({ filters: f, onChange, networks, services, presets, onApplyPreset, onSavePreset }: PanelProps) {
  const set = (patch: Partial<FilterState>) => onChange({ ...f, ...patch });
  const dirty = JSON.stringify(resetFilters(f)) !== JSON.stringify(f);
  return (
    <div className="filter-panel">
      <header className="popover-head">
        <h2 className="popover-title">Filters</h2>
        <button type="button" className="text-btn" onClick={() => onChange(resetFilters(f))} disabled={!dirty} data-testid="clear-filters">Reset</button>
      </header>
      <div className="filter-columns">
        <div className="filter-col">
          <Group title="Status">
            {STATUSES.map(([s, label]) => (
              <SwitchRow key={s} label={label} checked={f.status.includes(s)} onChange={() => set({ status: toggle(f.status, s) })} testId={`filter-status-${s}`} />
            ))}
          </Group>
          <Group title="When & order">
            <MenuRow label="When">
              <PopUpButton label="When" value={f.time} options={TIMES} onChange={(time) => set({ time })} testId="filter-time" />
            </MenuRow>
            <MenuRow label="Sort by">
              <PopUpButton label="Sort by" value={f.sort} options={SORTS} onChange={(sort) => set({ sort })} testId="filter-sort" />
            </MenuRow>
          </Group>
        </div>
        <div className="filter-col">
          <Group title="Only show">
            <SwitchRow label="Favorite teams" detail="Games with a starred team" checked={f.favorites} onChange={(v) => set({ favorites: v })} testId="filter-favorites" />
            <SwitchRow label="On my services" detail="Hide games nothing can show" checked={f.myServices} onChange={(v) => set({ myServices: v })} testId="filter-my-services" />
            <SwitchRow label="Opens game or channel" detail="Skip app-only launches" checked={f.quality} onChange={(v) => set({ quality: v })} testId="filter-quality" />
            <SwitchRow label="Close games" detail="Late and within a score" checked={f.close} onChange={(v) => set({ close: v })} testId="filter-close" />
          </Group>
          <Group title="Where">
            <MenuRow label="Watch on">
              <PopUpButton
                label="Watch on"
                value={f.service ?? ""}
                options={[{ value: "", label: "Any" }, ...Object.values(services).map((s) => ({ value: s.id, label: s.label }))]}
                onChange={(v) => set({ service: (v || null) as ServiceId | null })}
                testId="filter-service"
              />
            </MenuRow>
            <MenuRow label="Network">
              <PopUpButton
                label="Network"
                value={f.networks[0] ?? ""}
                options={[{ value: "", label: "Any" }, ...networks.map((n) => ({ value: n, label: NETWORK_LABEL[n] }))]}
                onChange={(v) => set({ networks: v ? [v as NetworkId] : [] })}
                testId="filter-network"
              />
            </MenuRow>
          </Group>
        </div>
      </div>
      <Group title="Saved views">
        {presets.map((p) => (
          <button type="button" className="row row-link" key={p.name} onClick={() => onApplyPreset(p.query)} data-testid={`preset-${p.name.toLowerCase().replace(/\W+/g, "-")}`}>
            <span className="row-label">{p.name}</span>
            <Icon name="chevron-right" size={16} />
          </button>
        ))}
        <button type="button" className="row row-link row-accent" onClick={onSavePreset} data-testid="save-preset">
          <span className="row-label">Save this view...</span>
          <Icon name="plus" size={16} />
        </button>
      </Group>
    </div>
  );
}
