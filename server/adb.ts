import { execFile } from "node:child_process";
import type { AllowedKey } from "../lib/types";
import { ALLOWED_KEYS } from "../lib/types";
import { isValidPackage, type RouteDef } from "../lib/catalog/apps";

// The only command shapes this module can produce. Nothing here runs a local shell (execFile, no
// shell: true). `adb shell` joins its argv into ONE string that the TV's /system/bin/sh parses, so
// every argument that isn't a fixed literal goes through shellQuote().

/** POSIX single-quote: 'it'\''s' — safe for any byte except NUL, which we reject. */
export function shellQuote(s: string): string {
  if (s.includes("\0")) throw new Error("NUL byte in argument");
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export const KEYCODES: Record<AllowedKey, string> = {
  UP: "KEYCODE_DPAD_UP",
  DOWN: "KEYCODE_DPAD_DOWN",
  LEFT: "KEYCODE_DPAD_LEFT",
  RIGHT: "KEYCODE_DPAD_RIGHT",
  SELECT: "KEYCODE_DPAD_CENTER",
  BACK: "KEYCODE_BACK",
  HOME: "KEYCODE_HOME",
  PLAY_PAUSE: "KEYCODE_MEDIA_PLAY_PAUSE",
  WAKEUP: "KEYCODE_WAKEUP",
  REWIND: "KEYCODE_MEDIA_REWIND",
  FAST_FORWARD: "KEYCODE_MEDIA_FAST_FORWARD",
  VOLUME_UP: "KEYCODE_VOLUME_UP",
  VOLUME_DOWN: "KEYCODE_VOLUME_DOWN",
  MUTE: "KEYCODE_VOLUME_MUTE",
  SLEEP: "KEYCODE_SLEEP",
  SEARCH: "KEYCODE_SEARCH", // opens in-app search; YouTube TV needs it before a warm link from its Live tab
};

export const isAllowedKey = (k: unknown): k is AllowedKey => typeof k === "string" && (ALLOWED_KEYS as readonly string[]).includes(k);

function assertPackage(pkg: string) {
  if (!isValidPackage(pkg)) throw new Error(`invalid package: ${pkg}`);
}

/**
 * Fill a route template. Each declared param must be present and match its regex; values are
 * percent-encoded; undeclared placeholders are an error.
 */
export function buildUri(route: RouteDef, params: Record<string, string>): string {
  if (!route.template) throw new Error("route has no template");
  return route.template.replace(/\{([a-zA-Z]+)\}/g, (_, name: string) => {
    const re = route.params[name];
    if (re === undefined) throw new Error(`undeclared param {${name}}`);
    const v = params[name];
    if (v === undefined) throw new Error(`missing param ${name}`);
    if (!new RegExp(re).test(v)) throw new Error(`param ${name} failed validation`);
    return encodeURIComponent(v);
  });
}

// --- builders: return the argv that follows `adb -s <serial> shell` ---

export function viewIntentArgs(uri: string, pkg: string): string[] {
  assertPackage(pkg);
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(uri) || uri.length > 500) throw new Error("invalid uri");
  return ["am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", shellQuote(uri), shellQuote(pkg)];
}

export function launcherArgs(pkg: string, activity?: string): string[] {
  assertPackage(pkg);
  if (activity) {
    if (!/^[a-zA-Z0-9_.$]+$/.test(activity)) throw new Error("invalid activity");
    return ["am", "start", "-W", "-n", shellQuote(`${pkg}/${activity}`)];
  }
  return ["monkey", "-p", shellQuote(pkg), "-c", LAUNCHER_CATEGORIES[1], "1"];
}

export function keyArgs(key: AllowedKey): string[] {
  if (!isAllowedKey(key)) throw new Error("key not allowed");
  return ["input", "keyevent", KEYCODES[key]];
}

export const foregroundArgs = () => ["dumpsys", "activity", "activities"];
export const powerArgs = () => ["dumpsys", "power"];
/** TV-only apps (HBO Max, ...) register just LEANBACK_LAUNCHER, so try it first, then LAUNCHER. */
export const LAUNCHER_CATEGORIES = ["android.intent.category.LEANBACK_LAUNCHER", "android.intent.category.LAUNCHER"] as const;

/** Cold-start an app so it opens in a known state (leftover pages, videos or its other mode can't shift the keys). */
export function forceStopArgs(pkg: string): string[] {
  assertPackage(pkg);
  return ["am", "force-stop", shellQuote(pkg)];
}

export const resolveLauncherArgs = (pkg: string, category: (typeof LAUNCHER_CATEGORIES)[number] = LAUNCHER_CATEGORIES[1]) => {
  assertPackage(pkg);
  return ["cmd", "package", "resolve-activity", "--brief", "-c", category, shellQuote(pkg)];
};

/** Activity class from `resolve-activity --brief` output ("pkg/Activity" on the last line), or null. */
export function parseLauncherActivity(out: string, pkg: string): string | null {
  const m = out.trim().split("\n").pop()?.trim().match(/^([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.$]+)$/);
  return m && m[1] === pkg ? m[2] : null;
}

/** `screencap -p` over exec-out can start with a text line (Fire OS: "Init wrapper sys mutex..."). Keep from the PNG signature on. */
export function stripToPng(buf: Buffer): Buffer | null {
  const i = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return i < 0 ? null : buf.subarray(i);
}

// --- output parsing ---

/** Screen on/off from `dumpsys power`. */
export function parseScreenOn(out: string): boolean | null {
  const m = out.match(/mWakefulness=(\w+)/);
  if (m) return m[1] === "Awake";
  const d = out.match(/Display Power: state=(\w+)/);
  return d ? d[1] === "ON" : null;
}

/** `am start -W` prints "Status: ok" on success; errors come as "Error:" lines. */
export function amStartOk(out: string): boolean {
  if (/^Error:|Exception|unable to resolve Intent/im.test(out)) return false;
  return /Status:\s*ok/i.test(out) || /Starting: Intent/.test(out);
}

// --- runner ---

export interface AdbExec {
  (args: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string; code: number }>;
}

/** Calls the adb binary directly with an argv array. ADB_BIN lets tests swap in a fake. */
export function makeAdbExec(bin = process.env.ADB_BIN ?? "adb"): AdbExec {
  return (args, timeoutMs = 10_000) =>
    new Promise((resolve) => {
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr) + (err && !stderr ? String(err.message) : ""), code });
      });
    });
}

/** `adb -s serial exec-out screencap -p`: the TV's current frame as a PNG (apps that block capture return black). */
export function screencapArgs(serial: string): string[] {
  if (!/^[A-Za-z0-9.:_-]{1,100}$/.test(serial)) throw new Error("invalid serial");
  return ["-s", serial, "exec-out", "screencap", "-p"];
}

export type Screencap = () => Promise<Buffer | null>;

/** Runs screencapArgs and returns the PNG (Fire OS prints a text line first, which stripToPng removes). */
export function makeScreencap(serial: string, bin = process.env.ADB_BIN ?? "adb"): Screencap {
  return () =>
    new Promise((resolve) => {
      execFile(bin, screencapArgs(serial), { encoding: "buffer", timeout: 15_000, maxBuffer: 32 << 20 }, (err, out) =>
        resolve(err ? null : stripToPng(out)));
    });
}

/** `adb -s serial shell <argv...>` */
export function shellArgs(serial: string, argv: string[]): string[] {
  if (!/^[A-Za-z0-9.:_-]{1,100}$/.test(serial)) throw new Error("invalid serial");
  return ["-s", serial, "shell", ...argv];
}

// --- read-only probes used to decide warm vs cold entry (server/navigation/entry.ts) ---

/** The resumed (in front) activity from `dumpsys activity activities`. Same rules as the driver's parser. */
export function parseForeground(out: string): { pkg: string; activity: string } | null {
  const m =
    out.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[:=]\s*ActivityRecord\{[^}]*?\s([a-zA-Z0-9_.]+)\/([^\s}]+)/) ??
    out.match(/mFocusedApp=.*?\s([a-zA-Z0-9_.]+)\/([^\s}]+)/);
  return m ? { pkg: m[1], activity: m[2] } : null;
}

/** `pidof <pkg>`: is the app's process running (toybox, Android 7+). */
export function pidofArgs(pkg: string): string[] {
  assertPackage(pkg);
  return ["pidof", shellQuote(pkg)];
}

/** First pid from `pidof` output, or null when the process isn't running. */
export function parsePidof(out: string): number | null {
  const m = out.trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

export const mediaSessionArgs = () => ["dumpsys", "media_session"];

export type MediaState = "none" | "stopped" | "paused" | "playing" | "fast_forwarding" | "rewinding" | "buffering" | "error" | "connecting" | "other";
export interface MediaSession {
  pkg: string;
  active: boolean;
  state: MediaState;
}

// android.media.session.PlaybackState constants.
const MEDIA_STATES: Record<number, MediaState> = { 0: "none", 1: "stopped", 2: "paused", 3: "playing", 4: "fast_forwarding", 5: "rewinding", 6: "buffering", 7: "error", 8: "connecting" };

/** Sessions from `dumpsys media_session`: each block has `package=`, `active=` and `state=PlaybackState {state=N, ...}`. */
export function parseMediaSessions(out: string): MediaSession[] {
  const sessions: MediaSession[] = [];
  let cur: MediaSession | null = null;
  for (const raw of out.split("\n")) {
    const l = raw.trim();
    const pkg = l.match(/^package=([a-zA-Z0-9_.]+)$/);
    if (pkg) {
      cur = { pkg: pkg[1], active: false, state: "none" };
      sessions.push(cur);
      continue;
    }
    if (!cur) continue;
    const active = l.match(/^active=(true|false)$/);
    if (active) cur.active = active[1] === "true";
    const st = l.match(/^state=PlaybackState \{state=(\d+)/);
    if (st) cur.state = MEDIA_STATES[Number(st[1])] ?? "other";
  }
  return sessions;
}

/** Is `pkg` playing (or buffering) per its media session? null when it has no session (unknown, not "no"). */
export function mediaPlaying(sessions: MediaSession[] | null, pkg: string): boolean | null {
  const mine = sessions?.filter((s) => s.pkg === pkg) ?? [];
  if (!mine.length) return null;
  return mine.some((s) => s.active && (s.state === "playing" || s.state === "buffering"));
}

export interface AmStartInfo {
  ok: boolean;
  /** Android 10+: COLD (process started), WARM (activity recreated), HOT (brought to front). */
  launchState: "COLD" | "WARM" | "HOT" | null;
  /** "intent has been delivered to currently running top-most instance": the running app got it via onNewIntent. */
  deliveredToRunning: boolean;
  totalTimeMs: number | null;
}

/** What `am start -W` says about how the intent landed. */
export function parseAmStart(out: string): AmStartInfo {
  const ls = out.match(/^LaunchState:\s*(COLD|WARM|HOT)/im);
  const tt = out.match(/^TotalTime:\s*(\d+)/im);
  return {
    ok: amStartOk(out),
    launchState: ls ? (ls[1].toUpperCase() as AmStartInfo["launchState"]) : null,
    deliveredToRunning: /intent has been delivered to currently running top-most instance/i.test(out),
    totalTimeMs: tt ? Number(tt[1]) : null,
  };
}
