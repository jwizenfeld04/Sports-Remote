import type { AdbExec } from "../adb";
import { shellArgs } from "../adb";
import {
  connectArgs, devicesArgs, getpropArgs, listPackagesArgs, mdnsServicesArgs, pairArgs, parseConnectOutput, parsePairOutput, serialOf,
} from "./commands";
import { detectPlatform, deviceProps, friendlyModel, installedApps, parseGetprop, parsePackages, type AppPackages, type DeviceProps, type Platform } from "./detect";
import { parseMdnsServices, type MdnsService } from "./discovery";
import { browseAdb } from "./mdns";

// The steps the setup wizard walks through to add a TV.
//
// Fire TV (and Android TVs with network debugging): connect to host:5555. The first time, the TV shows
// "Allow USB debugging?" and adb reports "unauthorized" until someone ticks "Always allow" and presses OK.
//
// Google TV / Android TV 11+ (wireless debugging): the TV shows an IP:port and a six-digit code under
// "Pair device with pairing code". `adb pair` with those, then connect to the *connect* port, which is
// different and changes on reboot. mDNS (`_adb-tls-connect._tcp`) tells us the current one.

export type ConnectState = "connected" | "unauthorized" | "refused" | "unreachable" | "failed" | "offline";

export interface TvIdentity {
  serial: string;
  platform: Platform | null;
  props: DeviceProps;
  name: string;
  apps: { id: string; package: string }[];
  /** False when the package list couldn't be read (every TV has packages): installed apps are unknown, not "none". */
  packagesRead: boolean;
}

export async function deviceState(exec: AdbExec, serial: string): Promise<ConnectState> {
  const r = await exec(devicesArgs(), 5000);
  const line = r.stdout.split("\n").find((l) => l.startsWith(serial + " ") || l.startsWith(serial + "\t"));
  if (!line) return "offline";
  if (/\sdevice\b/.test(line)) return "connected";
  if (/unauthorized/.test(line)) return "unauthorized";
  return "offline";
}

/** Connect and report where we are. "unauthorized" means: look at the TV and allow this computer. */
export async function connectTv(exec: AdbExec, host: string, port: number): Promise<ConnectState> {
  const serial = serialOf(host, port);
  const r = await exec(connectArgs(host, port), 10_000);
  const said = parseConnectOutput(r.stdout + r.stderr);
  if (said === "refused" || said === "unreachable") return said;
  // adb says "connected" even while the TV is still asking; `adb devices` has the truth.
  const state = await deviceState(exec, serial);
  return state === "offline" ? said : state;
}

/** Poll until the person approves the prompt on the TV, or time out. */
export async function waitForApproval(
  exec: AdbExec, host: string, port: number,
  { timeoutMs = 60_000, every = 2000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = Date.now } = {},
): Promise<ConnectState> {
  const end = now() + timeoutMs;
  let s = await connectTv(exec, host, port);
  while (s === "unauthorized" && now() < end) {
    await sleep(every);
    s = await deviceState(exec, serialOf(host, port));
    if (s === "offline") s = await connectTv(exec, host, port);
  }
  return s;
}

export async function pairTv(exec: AdbExec, host: string, pairPort: number, code: string): Promise<{ ok: boolean; error?: string }> {
  const r = await exec(pairArgs(host, pairPort, code), 20_000);
  if (/unknown command|Usage:.*adb/i.test(r.stderr + r.stdout) && !/Successfully/.test(r.stdout)) {
    return { ok: false, error: "adb_too_old" }; // adb < 30 has no `pair`
  }
  return parsePairOutput(r.stdout + r.stderr);
}

/**
 * The current wireless-debugging connect port for a host. Our own mDNS browse first (distro adb builds have no
 * mDNS backend), then adb's, in case it's Google's platform-tools. null = ask the person for the port.
 */
export async function findConnectPort(exec: AdbExec, host: string, browse: () => Promise<MdnsService[]> = browseAdb): Promise<number | null> {
  const ours = (await browse().catch(() => [])).find((s) => s.host === host && s.type === "connect");
  if (ours) return ours.port;
  const r = await exec(mdnsServicesArgs(), 8000);
  const svc = parseMdnsServices(r.stdout).find((s) => s.host === host && s.type === "connect");
  return svc?.port ?? null;
}

/** What is it, and which catalog apps does it have? Needs a connected device. */
export async function identifyTv(exec: AdbExec, host: string, port: number, catalogApps: AppPackages[]): Promise<TvIdentity> {
  const serial = serialOf(host, port);
  const [gp, pk] = await Promise.all([exec(shellArgs(serial, getpropArgs()), 8000), exec(shellArgs(serial, listPackagesArgs()), 15_000)]);
  const props = deviceProps(parseGetprop(gp.stdout));
  const packages = parsePackages(pk.stdout);
  const platform = detectPlatform(props, packages);
  return {
    serial,
    platform,
    props,
    name: friendlyModel(props),
    apps: platform ? installedApps(catalogApps, platform, packages) : [],
    packagesRead: pk.code === 0 && packages.size > 0,
  };
}
