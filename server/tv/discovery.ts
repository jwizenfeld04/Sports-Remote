import { connect as tcpConnect } from "node:net";
import { networkInterfaces } from "node:os";

// Finding TVs on the home network, for the setup wizard. Two ways:
//  - Google TV / Android 11+ advertise wireless debugging over mDNS; `adb mdns services` lists them.
//  - Fire TVs (and Android TVs with network debugging on) listen on TCP 5555; a quick scan of the server's own
//    /24 networks finds them. Only private ranges are scanned, and only when someone presses "Find TVs".

export interface MdnsService {
  name: string;
  type: "connect" | "pairing" | "legacy";
  host: string;
  port: number;
}

/** Lines look like `adb-1A2B3C-xYz	_adb-tls-connect._tcp	192.168.1.40:37123` (tabs or spaces). */
export function parseMdnsServices(out: string): MdnsService[] {
  const seen = new Set<string>();
  const res: MdnsService[] = [];
  for (const line of out.split("\n")) {
    const m = /^(\S+)\s+(_adb(?:-tls-(connect|pairing))?\._tcp)\.?\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\s*$/.exec(line.trim());
    if (!m) continue;
    const type = m[3] === "connect" ? "connect" : m[3] === "pairing" ? "pairing" : "legacy";
    const key = `${type}|${m[4]}:${m[5]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({ name: m[1], type, host: m[4], port: Number(m[5]) });
  }
  return res;
}

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
// Docker bridges and the like: never scan these.
const SKIP_IFACE = /^(docker|br-|veth|virbr|lo|tailscale|tun|wg|zt|cni|flannel|kube)/;

/** The /24 prefixes of this machine's private LAN addresses, e.g. ["192.168.1"]. */
/** This machine's own private IPv4 addresses on real (not Docker/VPN) interfaces. */
export function lanAddresses(ifaces = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (SKIP_IFACE.test(name)) continue;
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal && PRIVATE.some((re) => re.test(a.address))) out.push(a.address);
  }
  return out;
}

export function lanPrefixes(ifaces = networkInterfaces()): string[] {
  const out = new Set<string>();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (SKIP_IFACE.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (!PRIVATE.some((re) => re.test(a.address))) continue;
      out.add(a.address.split(".").slice(0, 3).join("."));
    }
  }
  return [...out];
}

export type Probe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

export const tcpProbe: Probe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const s = tcpConnect({ host, port });
    const done = (ok: boolean) => {
      s.removeAllListeners();
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

/** Hosts in the given /24 prefixes with `port` open. 254 hosts × N prefixes, `concurrency` at a time. */
export async function scanForAdb(
  prefixes: string[],
  { port = 5555, timeoutMs = 400, concurrency = 64, probe = tcpProbe, skip = new Set<string>() }: { port?: number; timeoutMs?: number; concurrency?: number; probe?: Probe; skip?: Set<string> } = {},
): Promise<string[]> {
  const hosts = prefixes.slice(0, 4).flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`)).filter((h) => !skip.has(h));
  const found: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const h = hosts[next++];
      if (await probe(h, port, timeoutMs)) found.push(h);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return found.sort((a, b) => Number(a.split(".")[3]) - Number(b.split(".")[3]));
}
