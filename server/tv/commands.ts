// adb client commands for setting up a TV: connect, pair, discover, and read what it is and what's installed.
// Like server/adb.ts these return argv for execFile (no local shell). Every value is validated first.

const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function assertHost(host: string): void {
  if (!HOST_RE.test(host) || host.startsWith("-")) throw new Error("invalid host");
  const m = IPV4_RE.exec(host);
  if (m && m.slice(1).some((o) => Number(o) > 255)) throw new Error("invalid host");
}

export function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
}

export const serialOf = (host: string, port: number) => {
  assertHost(host);
  assertPort(port);
  return `${host}:${port}`;
};

export const connectArgs = (host: string, port: number) => ["connect", serialOf(host, port)];
export const disconnectArgs = (host: string, port: number) => ["disconnect", serialOf(host, port)];

/** Google TV / Android 11+ wireless debugging: the six-digit code and pairing port shown on the TV. */
export function pairArgs(host: string, port: number, code: string): string[] {
  if (!/^\d{6}$/.test(code)) throw new Error("pairing code must be 6 digits");
  return ["pair", serialOf(host, port), code];
}

export const mdnsServicesArgs = () => ["mdns", "services"];
export const devicesArgs = () => ["devices", "-l"];

// Read-only shell reads, appended after `-s <serial> shell`.
export const getpropArgs = () => ["getprop"];
export const listPackagesArgs = () => ["pm", "list", "packages"];

export function parsePairOutput(out: string): { ok: boolean; guid?: string; error?: string } {
  const m = /Successfully paired to \S+(?: \[guid=([^\]]+)\])?/.exec(out);
  if (m) return { ok: true, guid: m[1] };
  if (/wrong password|Failed: Wrong password/i.test(out)) return { ok: false, error: "wrong_code" };
  if (/connection refused|unable to connect|failed to connect|timed out/i.test(out)) return { ok: false, error: "unreachable" };
  return { ok: false, error: "pair_failed" };
}

export function parseConnectOutput(out: string): "connected" | "unauthorized" | "refused" | "unreachable" | "failed" {
  if (/already connected to|connected to/i.test(out) && !/failed|unable/i.test(out)) return "connected";
  if (/unauthorized|authenticate/i.test(out)) return "unauthorized";
  if (/refused/i.test(out)) return "refused";
  if (/timed out|no route|unreachable|cannot connect|failed to connect/i.test(out)) return "unreachable";
  return "failed";
}
