// "proxy" mode: a reverse proxy in front of us has already signed the person in and tells us who
// they are in a request header. We believe that header only from addresses in trustedProxies.
import type { Role } from "./permissions";

/** Header names used by common authenticating proxies. */
export const PROXY_PRESETS = {
  tailscale: "Tailscale-User-Login", // `tailscale serve` with identity headers
  authelia: "Remote-User",
  authentik: "Remote-User",
  cloudflare: "Cf-Access-Authenticated-User-Email", // Cloudflare Access
} as const;
export type ProxyPreset = keyof typeof PROXY_PRESETS;
export const DEFAULT_PROXY_HEADER = "Remote-User";

export interface ProxySettings {
  header: string; // e.g. "Remote-User"
  admins: string[]; // identities (usernames or emails) that are admins
  members: string[]; // identities that are members
  allowAnyAuthenticated: boolean; // anyone the proxy lets through becomes a member
}

/** Every identity header we know of. All of them are removed from requests that don't come from a trusted proxy. */
export function identityHeaders(settings?: ProxySettings | null): string[] {
  const names = new Set<string>(Object.values(PROXY_PRESETS).map((h) => h.toLowerCase()));
  if (settings) names.add(settings.header.toLowerCase());
  return [...names];
}

const normId = (s: string) => s.trim().toLowerCase();

/** Header names must be plain tokens; refuse anything else so config can't smuggle in odd values. */
export function validHeaderName(h: unknown): h is string {
  return typeof h === "string" && /^[A-Za-z0-9-]{1,64}$/.test(h);
}

export function normalizeProxySettings(input: {
  header?: string; preset?: ProxyPreset; admins?: string[]; members?: string[]; allowAnyAuthenticated?: boolean;
}): ProxySettings {
  const header = input.header ?? (input.preset ? PROXY_PRESETS[input.preset] : DEFAULT_PROXY_HEADER);
  if (!validHeaderName(header)) throw new Error("Proxy header must be a plain header name.");
  const clean = (l: string[] | undefined) => [...new Set((l ?? []).map(normId).filter((s) => s.length > 0 && s.length <= 256))];
  return { header, admins: clean(input.admins), members: clean(input.members), allowAnyAuthenticated: !!input.allowAnyAuthenticated };
}

/**
 * The identity and role for a request from a trusted proxy, or null if the header is missing or
 * the person isn't allowed in. Admins win over members.
 */
export function proxyIdentity(settings: ProxySettings, headers: Record<string, string | string[] | undefined>): { identity: string; role: Role } | null {
  const raw = headers[settings.header.toLowerCase()];
  if (typeof raw !== "string") return null; // missing, or sent twice (ambiguous)
  const identity = normId(raw);
  if (!identity || identity.length > 256) return null;
  if (settings.admins.includes(identity)) return { identity, role: "admin" };
  if (settings.members.includes(identity) || settings.allowAnyAuthenticated) return { identity, role: "member" };
  return null;
}
