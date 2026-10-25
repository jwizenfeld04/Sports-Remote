import makeMdns from "multicast-dns";
import type { MdnsService } from "./discovery";

// Debian's and Ubuntu's adb packages are built without adb's mDNS backend, so `adb mdns services` prints
// nothing. Google TV's wireless-debugging connect port changes on every reboot, so we browse for it ourselves.
// Needs host networking in Docker (multicast doesn't cross the default bridge).

const TYPES = { connect: "_adb-tls-connect._tcp.local", pairing: "_adb-tls-pairing._tcp.local" } as const;

interface Answer {
  name: string;
  type: string;
  data: unknown;
}

/** Turn a pile of mDNS answers into services: PTR -> instance, SRV -> target + port, A -> address. */
export function servicesFromAnswers(answers: Answer[]): MdnsService[] {
  const srv = new Map<string, { target: string; port: number }>();
  const addr = new Map<string, string>();
  const instances: { name: string; type: MdnsService["type"] }[] = [];
  for (const a of answers) {
    if (a.type === "PTR" && typeof a.data === "string") {
      const type = a.name === TYPES.connect ? "connect" : a.name === TYPES.pairing ? "pairing" : null;
      if (type) instances.push({ name: a.data, type });
    } else if (a.type === "SRV" && a.data && typeof a.data === "object") {
      const d = a.data as { target?: string; port?: number };
      if (d.target && d.port) srv.set(a.name, { target: d.target, port: d.port });
    } else if (a.type === "A" && typeof a.data === "string") {
      addr.set(a.name, a.data);
    }
  }
  const out: MdnsService[] = [];
  const seen = new Set<string>();
  for (const i of instances) {
    const s = srv.get(i.name);
    const host = s ? addr.get(s.target) : undefined;
    if (!s || !host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) continue;
    const key = `${i.type}|${host}:${s.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: i.name.split(".")[0], type: i.type, host, port: s.port });
  }
  return out;
}

/** Ask the LAN who offers wireless debugging, listen for `ms`, return what answered. Never throws. */
export async function browseAdb(ms = 2500): Promise<MdnsService[]> {
  let m: ReturnType<typeof makeMdns>;
  try {
    m = makeMdns();
  } catch {
    return [];
  }
  const answers: Answer[] = [];
  m.on("response", (res: { answers?: Answer[]; additionals?: Answer[] }) => {
    answers.push(...(res.answers ?? []), ...(res.additionals ?? []));
  });
  m.on("error", () => {});
  m.query({ questions: [{ name: TYPES.connect, type: "PTR" }, { name: TYPES.pairing, type: "PTR" }] });
  await new Promise((r) => setTimeout(r, ms));
  m.destroy();
  return servicesFromAnswers(answers);
}
