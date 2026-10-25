import type { AllowedKey, Game, LaunchResult, LocalGuide, NetworkId, ServiceId, Settings, TvStatus } from "../lib/types";
import type { Market, OwnedSubscription, Tv } from "../lib/profile";

export type AuthMode = "pin" | "accounts" | "proxy";

/** The signed-in person, as GET /api/auth/me returns it. */
export interface Me {
  role: "admin" | "member";
  userId: string | null;
  username: string | null;
  via: "session" | "proxy";
  mode: AuthMode | null;
  permissions: string[];
}

export interface HouseholdView {
  setupComplete: boolean;
  market: Market;
  subscriptions: OwnedSubscription[];
  tveSignIns: string[];
  tvs: Tv[];
  integrations: { plex: { url: string; channelMap: Partial<Record<"abc" | "cbs" | "fox" | "nbc", string>>; status: string } | null; espnWatch: boolean };
}

export type TvView = TvStatus & { id: string; name: string; platform: "firetv" | "googletv"; apps: string[] | null };

export interface Boot {
  authed: boolean;
  /** When not signed in: how to sign in. mode is null until first-run setup is done. */
  auth?: { mode: AuthMode | null; setupRequired: boolean };
  me?: Me;
  games?: Game[];
  fetchedAt?: string | null;
  stale?: boolean;
  feedError?: string | null;
  guide?: LocalGuide | null;
  settings?: Settings;
  version?: string;
  household?: HouseholdView;
  tvs?: TvView[];
  /** What the server can do: adb and OCR (tesseract) installed. */
  capabilities?: { adb: boolean; ocr: boolean };
}

async function json<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

/** Initial state inlined by the server into index.html; falls back to a request. */
export async function loadBoot(): Promise<Boot> {
  const el = document.getElementById("sr-state");
  if (el?.textContent) {
    try {
      return JSON.parse(el.textContent) as Boot;
    } catch {
      /* fall through */
    }
  }
  return (await json<Boot>("GET", "/api/bootstrap")).data;
}

let reported = 0;
/** Send a browser-side problem to the server log (at most a few per page load). */
export function reportClientError(kind: "error" | "rejection" | "api", message: string, extra: { stack?: string; where?: string } = {}) {
  if (reported++ >= 5) return;
  void fetch("/api/client-log", {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true,
    body: JSON.stringify({ kind, message: message.slice(0, 500), stack: extra.stack?.slice(0, 2000), where: (extra.where ?? location.pathname).slice(0, 200) }),
  }).catch(() => {});
}

export type KeyResponse = { status: number; data: { ok: boolean; error?: string; dropped?: boolean } | null };

// Remote key presses: one request in flight at a time, so presses reach the TV in the order they were
// tapped (parallel requests can overtake each other through the proxy). The first press goes out
// immediately; while it's in flight up to KEY_QUEUE_MAX more wait, and any beyond that are dropped
// (resolved as ok + dropped) so holding a button can't keep the TV moving after you let go. The server
// batches what arrives while it is busy, so a short queue here is enough.
const KEY_QUEUE_MAX = 3;
const KEY_TIMEOUT_MS = 8000;
let keyInFlight = false;
const keyWaiting: Array<() => void> = [];

function postKey(key: AllowedKey, tv?: string): Promise<KeyResponse> {
  keyInFlight = true;
  const ctl = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), KEY_TIMEOUT_MS) : undefined;
  const p = fetch("/api/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tv ? { key, tv } : { key }),
    credentials: "same-origin",
    signal: ctl?.signal,
  }).then(async (res) => {
    const text = await res.text();
    let data: KeyResponse["data"] = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page from a proxy */
    }
    return { status: res.status, data };
  });
  void p.catch(() => {}).finally(() => {
    clearTimeout(timer);
    const next = keyWaiting.shift();
    if (next) next();
    else keyInFlight = false;
  });
  return p;
}

function sendKey(key: AllowedKey, tv?: string): Promise<KeyResponse> {
  if (!keyInFlight) return postKey(key, tv);
  if (keyWaiting.length >= KEY_QUEUE_MAX) return Promise.resolve({ status: 200, data: { ok: true, dropped: true } });
  return new Promise((resolve, reject) => keyWaiting.push(() => postKey(key, tv).then(resolve, reject)));
}

export const api = {
  bootstrap: () => json<Boot>("GET", "/api/bootstrap").then((r) => r.data),
  /** pin mode: { pin } (member) or { password } (admin); accounts mode: { username, password }. */
  login: (body: { pin: string } | { password: string } | { username: string; password: string }) =>
    json<Me | { error: string }>("POST", "/api/auth/login", body),
  logout: () => json<null>("POST", "/api/auth/logout", {}),
  me: () => json<Me>("GET", "/api/auth/me"),
  launch: (body: { requestId: string; gameId: string; tv?: string; route?: { service: ServiceId; network: NetworkId } }) =>
    json<LaunchResult>("POST", "/api/launch", body),
  /** Ordered and non-blocking: see sendKey. */
  key: (key: AllowedKey, tv?: string) => sendKey(key, tv),
  saveHousehold: (h: { market?: Market; subscriptions?: OwnedSubscription[]; tveSignIns?: string[] }) => json<HouseholdView>("PUT", "/api/household", h),
  completeSetup: () => json<{ ok: boolean }>("POST", "/api/setup/complete", {}),
  discoverTvs: () => json<{ mdns: { name: string; type: string; host: string; port: number }[]; adb5555: string[] }>("POST", "/api/tvs/discover", {}),
  connectTv: (host: string, port: number, wait = false) => json<{ state: string }>("POST", "/api/tvs/connect", { host, port, wait }),
  pairTv: (host: string, pairPort: number, code: string, connectPort?: number) =>
    json<{ ok: boolean; error?: string; connectPort?: number | null; state?: string }>("POST", "/api/tvs/pair", { host, pairPort, code, ...(connectPort ? { connectPort } : {}) }),
  identifyTv: (host: string, port: number) => json<{ platform: "firetv" | "googletv" | null; name: string; model: string; sdk: number | null; apps: string[] }>("POST", "/api/tvs/identify", { host, port }),
  addTv: (tv: { name: string; host: string; port: number; platform: "firetv" | "googletv"; model?: string; apps: string[] }) => json<Tv>("POST", "/api/tvs", tv),
  updateTv: (id: string, patch: { name?: string; port?: number; default?: boolean }) => json<Tv>("PATCH", `/api/tvs/${id}`, patch),
  removeTv: (id: string) => json<null>("DELETE", `/api/tvs/${id}`),
  refreshTvApps: (id: string) => json<{ apps: string[]; platform: string | null }>("POST", `/api/tvs/${id}/apps`, {}),
  testApp: (id: string, app: string) => json<{ ok: boolean; foreground: string | null; error?: string }>("POST", `/api/tvs/${id}/test`, { app }),
  savePlex: (p: { url: string; token?: string; channelMap?: Record<string, string> }) =>
    json<{ ok: boolean; error?: string; channels?: { callSign: string; network: string | null }[] }>("PUT", "/api/integrations/plex", p),
  removePlex: () => json<{ ok: boolean }>("DELETE", "/api/integrations/plex"),
  saveEspnKey: (key: string | null) => json<{ ok: boolean }>("PUT", "/api/integrations/espn", { key }),
  saveSettings: (s: Settings) => json<Settings>("PUT", "/api/settings", s),
};

export function newRequestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));
}
