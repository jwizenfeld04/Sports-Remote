// Request hygiene that doesn't depend on who you are: cookies, Host and Origin checks, and the
// security headers sent with every response.

type Headers = Record<string, string | string[] | undefined>;

export const COOKIE = "sr_session";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* a malformed %-escape in someone else's cookie isn't our problem */
    }
  }
  return out;
}

/**
 * The session cookie.
 * - HttpOnly: page scripts can't read it.
 * - SameSite=Strict: the browser never sends it on requests started by another site, not even
 *   top-level links. Lax would let a link from elsewhere arrive signed in; we don't need that.
 *   An installed home-screen app (PWA) opens the start URL as a same-site navigation, so Strict
 *   doesn't sign it out. (The Origin check in csrfOk is a second, independent CSRF defense.)
 * - Secure when the browser is talking HTTPS to us (directly or through a trusted proxy).
 *   Over plain HTTP on the LAN it must be off, or the browser would drop the cookie.
 */
export function sessionCookie(value: string, maxAgeSec: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeSec)}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie("", 0, secure);
}

/** Hosts we answer to. Domain names outside these patterns are refused (DNS-rebinding defense). */
export function allowedHost(allowedHosts: string[], host: string | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  if (allowedHosts.map((x) => x.toLowerCase()).includes(h)) return true;
  const name = h.replace(/:\d+$/, "");
  // Configured names may omit the port.
  if (allowedHosts.map((x) => x.toLowerCase()).includes(name)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;
  if (name === "localhost" || /^\[[0-9a-f:.]+\]$/.test(name)) return true; // IP literals can't be rebound
  return /\.ts\.net$/.test(name) || /^[a-z0-9-]+\.local$/.test(name);
}

/** POST/PUT/DELETE must be JSON from our own origin: a page elsewhere can't drive the TV. */
export function csrfOk(method: string, headers: Headers): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  // A DELETE usually has no body; it still needs the Origin check below.
  if (method !== "DELETE") {
    const ct = String(headers["content-type"] ?? "");
    if (!ct.toLowerCase().startsWith("application/json")) return false;
  }
  const origin = headers.origin;
  if (typeof origin !== "string") return false;
  try {
    return new URL(origin).host.toLowerCase() === String(headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Content-Security-Policy for the app.
 * - Scripts only from our own origin. The bootstrap state is inlined as
 *   <script id="sr-state" type="application/json">: a "data block" with a non-JavaScript type is
 *   never executed, so script-src doesn't apply to it and it needs no nonce or hash.
 * - Styles only from our own origin. React's `style={...}` props are set through the CSSOM
 *   (element.style), which CSP doesn't restrict, so 'unsafe-inline' isn't needed.
 * - Images from us, data: URIs and ESPN's logo CDN.
 */
export function contentSecurityPolicy(extra: { imgSrc?: string[]; connectSrc?: string[] } = {}): string {
  const img = ["'self'", "data:", "https://a.espncdn.com", ...(extra.imgSrc ?? [])];
  const connect = ["'self'", ...(extra.connectSrc ?? [])];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src ${img.join(" ")}`,
    `connect-src ${connect.join(" ")}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Headers for every response. HSTS only over HTTPS (browsers ignore it over HTTP anyway). */
export function securityHeaders(https: boolean, csp = contentSecurityPolicy()): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  // 180 days; no includeSubDomains, since a home domain often hosts other things on plain HTTP.
  if (https) h["Strict-Transport-Security"] = "max-age=15552000";
  return h;
}
