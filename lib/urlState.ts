import { DEFAULT_FILTERS, type FilterState, type SortMode, type StatusFilter, type TimeWindow } from "./filters";
import type { League, NetworkId, ServiceId } from "./types";
import { LEAGUES } from "./types";
import { APP_BY_ID } from "./catalog/apps";
import { NETWORK_LABEL } from "./networks";

const STATUSES: StatusFilter[] = ["live", "upcoming", "final"];
const TIMES: TimeWindow[] = ["now", "tonight", "today", "tomorrow", "week"];
const SORTS: SortMode[] = ["smart", "time", "league"];
const NETWORKS = Object.keys(NETWORK_LABEL) as NetworkId[];

const list = <T extends string>(v: string | null, allowed: readonly T[]): T[] =>
  (v ?? "").split(",").filter((x): x is T => (allowed as readonly string[]).includes(x));

/** Parse filters from a query string. Unknown or invalid values fall back to defaults. */
export function parseFilters(search: string): FilterState {
  const p = new URLSearchParams(search);
  const f: FilterState = { ...DEFAULT_FILTERS };
  if (p.has("q")) f.q = (p.get("q") ?? "").slice(0, 100);
  if (p.has("league")) f.leagues = list<League>(p.get("league"), LEAGUES);
  if (p.has("status")) f.status = list<StatusFilter>(p.get("status"), STATUSES);
  const time = p.get("time") as TimeWindow | null;
  if (time && TIMES.includes(time)) f.time = time;
  f.favorites = p.get("fav") === "1";
  f.myServices = p.get("mine") === "1";
  const svc = p.get("service") as ServiceId | null;
  f.service = svc && APP_BY_ID.has(svc) ? svc : null;
  if (p.has("net")) f.networks = list<NetworkId>(p.get("net"), NETWORKS);
  f.quality = p.get("quality") === "1";
  f.close = p.get("close") === "1";
  const sort = p.get("sort") as SortMode | null;
  if (sort && SORTS.includes(sort)) f.sort = sort;
  return f;
}

/** Serialize only what differs from the defaults, so URLs stay short. */
export function serializeFilters(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.leagues.length) p.set("league", f.leagues.join(","));
  if (f.status.join() !== DEFAULT_FILTERS.status.join()) p.set("status", f.status.join(","));
  if (f.time !== DEFAULT_FILTERS.time) p.set("time", f.time);
  if (f.favorites) p.set("fav", "1");
  if (f.myServices) p.set("mine", "1");
  if (f.service) p.set("service", f.service);
  if (f.networks.length) p.set("net", f.networks.join(","));
  if (f.quality) p.set("quality", "1");
  if (f.close) p.set("close", "1");
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  return p.toString();
}
