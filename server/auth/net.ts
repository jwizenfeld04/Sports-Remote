// Trusted reverse proxies, and working out the real client address and protocol behind them.
import { BlockList, isIP } from "node:net";

/** Named groups people can put in TRUSTED_PROXIES instead of spelling out CIDRs. */
const NAMED: Record<string, string[]> = {
  loopback: ["127.0.0.0/8", "::1/128"],
};

/**
 * Normalize an address so comparisons work: drops IPv6 brackets, a trailing :port, a zone id, and
 * the ::ffff: prefix of IPv4-mapped IPv6 addresses. Returns null if it isn't an IP address.
 */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let a = raw.trim();
  const bracketed = a.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) a = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a)) a = a.replace(/:\d+$/, ""); // "1.2.3.4:5678"
  a = a.replace(/%.*$/, "").toLowerCase(); // zone id: fe80::1%eth0
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) a = mapped[1];
  return isIP(a) ? a : null;
}

/** A set of CIDR ranges (IPv4 and IPv6). Single addresses and the names above are accepted too. */
export class TrustList {
  private list = new BlockList();
  readonly entries: string[];

  constructor(entries: string[]) {
    this.entries = [];
    for (const raw of entries) {
      const e = raw.trim().toLowerCase();
      if (!e) continue;
      const expanded = NAMED[e] ?? [e];
      for (const cidr of expanded) this.add(cidr, raw);
      this.entries.push(e);
    }
  }

  private add(cidr: string, original: string) {
    const [addr, bits] = cidr.split("/");
    const ip = normalizeIp(addr);
    if (!ip) throw new Error(`Not an IP address or CIDR range: "${original}"`);
    const family = isIP(ip) === 4 ? "ipv4" : "ipv6";
    const max = family === "ipv4" ? 32 : 128;
    const prefix = bits === undefined ? max : Number(bits);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (bits !== undefined && !/^\d+$/.test(bits))) {
      throw new Error(`Bad prefix length in "${original}"`);
    }
    // Trusting a huge range means trusting ordinary devices to say who they are.
    if (prefix < 8) throw new Error(`"${original}" is far too wide to trust: list your proxy's address or its Docker network`);
    this.list.addSubnet(ip, prefix, family);
  }

  get empty() {
    return this.entries.length === 0;
  }

  has(addr: string | undefined | null): boolean {
    const ip = normalizeIp(addr);
    if (!ip) return false;
    return this.list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  }
}

/** Throws a readable error for a bad list; used when validating config. */
/**
 * Trusted ranges that contain one of this machine's own LAN addresses, i.e. ranges ordinary phones and laptops on
 * the Wi-Fi come from. A proxy on the LAN should be listed by its single address instead. Docker, Tailscale and other
 * virtual interfaces don't count: their ranges hold containers and tunnels, not household devices.
 */
export function lanOverlaps(entries: string[], lanAddresses: string[]): string[] {
  return entries.filter((e) => {
    if (e === "loopback") return false;
    const t = new TrustList([e]);
    const single = !e.includes("/") || /\/(32|128)$/.test(e);
    return !single && lanAddresses.some((a) => t.has(a));
  });
}

export function parseTrustedProxies(value: string | string[] | undefined): string[] {
  const list = (Array.isArray(value) ? value : (value ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
  new TrustList(list); // validate
  return list;
}

export interface ClientInfo {
  ip: string; // the real client, as best we can tell
  proto: "http" | "https";
  viaProxy: boolean; // the TCP peer is one of our trusted proxies
}

type Headers = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(",") : v ?? "");

/**
 * Where did this request really come from?
 *
 * Only a trusted proxy may tell us. If the TCP peer is trusted, walk X-Forwarded-For from the right
 * (each proxy appends the address it saw) and stop at the first address that isn't one of our
 * proxies: that's the client. Anything further left was supplied by the client and can be forged.
 * Otherwise the peer itself is the client and forwarded headers are ignored.
 */
export function clientInfo(peer: string | undefined, headers: Headers, trusted: TrustList, socketEncrypted = false): ClientInfo {
  const peerIp = normalizeIp(peer) ?? peer ?? "";
  const own: ClientInfo = { ip: peerIp, proto: socketEncrypted ? "https" : "http", viaProxy: false };
  if (!trusted.has(peerIp)) return own;

  const hops = first(headers["x-forwarded-for"]).split(",").map((s) => s.trim()).filter(Boolean);
  let ip = peerIp;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalizeIp(hops[i]);
    if (!hop) break; // garbage: stop and keep the last good address
    ip = hop;
    if (!trusted.has(hop)) break;
  }
  // The right-most value was set by the proxy closest to us, which is the one we trust.
  const protos = first(headers["x-forwarded-proto"]).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const last = protos[protos.length - 1];
  const proto = last === "https" ? "https" : last === "http" ? "http" : own.proto;
  return { ip, proto, viaProxy: true };
}
