// Fast remote-control key presses.
//
// Why this exists: `adb shell input keyevent X` per press costs one adb client spawn, one new shell
// session and, above all, one JVM start. On Android 9 `/system/bin/input` is a script that execs
// `app_process` (measured on a Fire OS 7 TV: 1.3-3 s per JVM start, against ~50 ms for spawn + session
// and ~8 ms for a command on an already-open shell). Concurrent presses start concurrent JVMs on a
// weak CPU, so a burst of taps stacks up seconds of lag and can land out of order.
//
// What this does instead:
//   1. One persistent `adb -s <serial> shell` per TV. Commands go to its stdin, and each one is
//      followed by `echo "__GP_<id>:$?"` so we know when it finished and how it exited. It restarts
//      itself when it dies and closes after a quiet spell.
//   2. Backends, fastest first, each chosen only if a read-only probe says it will work:
//        evdev  - write the key's down/up `struct input_event`s straight to a /dev/input/eventN node
//                 with mksh's builtin `print` (no fork, no JVM; one write() per batch). The shell user
//                 is in group `input` on Fire OS / Android TV, and the device's keylayout (.kl) maps
//                 the Linux scancode to the Android keycode we want. ~10 ms per press.
//        cmd    - `cmd input keyevent K...` (Android 11+: native binary + binder call, no JVM).
//        input  - `input keyevent K1 K2 ...` (JVM; slow, but one JVM for a whole batch).
//   3. One FIFO queue. While a command is running, new presses wait and are sent together as one
//      batch. At most `maxQueue` presses wait; extra ones are dropped so holding a button can't build
//      a backlog that keeps the TV moving after you let go.
//   4. A token bucket (burst 10, 8/s) instead of a 120/min window, so normal remote use never hits it.
//
// Security: nothing from a request reaches the shell. Keys are checked against ALLOWED_KEYS, keycodes
// come from KEYCODES, scancodes are integers we parsed and range-checked, device paths must match
// /dev/input/eventN, and every line is checked against a strict pattern before it is written.

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AllowedKey, LaunchError } from "../../lib/types";
import { ALLOWED_KEYS } from "../../lib/types";
import { isAllowedKey, KEYCODES, type AdbExec } from "../adb";

export type Backend = "evdev" | "cmd" | "input";

export interface KeyResult {
  ok: boolean;
  error?: LaunchError;
  /** The press was dropped because too many were already waiting (holding a button). Not an error. */
  dropped?: boolean;
  backend?: Backend | "exec";
}

export interface KeySender {
  /** Queue a press. Resolves once it has been sent (or dropped, or failed). */
  press(key: AllowedKey): Promise<KeyResult>;
  /** Open the shell and run the probe now, so the first press doesn't pay for it. Never throws. */
  warm(): Promise<void>;
  /** Forget the probe (e.g. after reconnecting to a different TV) and close the shell. */
  reset(): void;
  /** Close the shell and stop timers. Pending presses fail. */
  close(): void;
  info(): { backend: Backend | null; device: string | null; shellOpen: boolean; queued: number };
}

export interface KeySenderOptions {
  serial: string;
  bin?: string;
  /** Injectable for tests. */
  spawn?: (bin: string, args: string[]) => ChildProcessWithoutNullStreams;
  /** Used only if the persistent shell can't be started at all: the old one-shot `adb shell input keyevent`. */
  exec?: AdbExec;
  /** Order to try. Default: evdev, cmd, input. */
  backends?: Backend[];
  /** Presses allowed to wait behind the one being sent. Default 3. */
  maxQueue?: number;
  /** Most keys in one command. Default 8. */
  maxBatch?: number;
  /** Close the shell after this long without presses. Default 10 min. */
  idleMs?: number;
  /** Per-command timeout for key commands (the probe gets 8 s). Default 5 s (a cold JVM can take 3). */
  commandTimeoutMs?: number;
  /** Re-run the probe after this long even if nothing failed. Default 30 min. */
  probeTtlMs?: number;
  rate?: { burst: number; perSecond: number };
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------- pure helpers (exported for tests)

const EV_KEY = 1;
const EV_SYN = 0;
const SYN_REPORT = 0;
const KEY_MAX = 0x2ff;
const DEVICE_RE = /^\/dev\/input\/event\d{1,3}$/;
const KEYCODE_VALUES = new Set(Object.values(KEYCODES));

/** Android keycode names without the KEYCODE_ prefix, as they appear in .kl files. */
const klName = (k: AllowedKey) => KEYCODES[k].replace(/^KEYCODE_/, "");

/**
 * Read-only probe, run once per shell session (cached for probeTtlMs). Prints:
 *   @elf <class byte of /system/bin/sh>   01 = 32-bit userland (16-byte input_event), 02 = 64-bit (24)
 *   @print <hex of print -n '\x41\x00\x42'> must be "41 00 42" for the evdev writer to work
 *   @cmd <first line of `cmd input`>         "No shell command implementation." on Android <= 10
 *   @dev <path> <writable 0|1> <kl file>      per input device, from dumpsys input
 *   @kl <path> key <scancode> <KEYCODE>       that device's keylayout lines
 *   @caps <path> ...                          `getevent -p` KEY section: scancodes the kernel accepts
 * It never writes anything on the TV.
 */
export const PROBE_SCRIPT = [
  `echo "@elf $(od -An -tx1 -j4 -N1 /system/bin/sh 2>/dev/null)"`,
  `echo "@print $(print -n '\\x41\\x00\\x42' 2>/dev/null | od -An -tx1 2>/dev/null)"`,
  `echo "@cmd $(cmd input 2>&1 | head -n 1)"`,
  `dumpsys input 2>/dev/null | grep -E '^ +(Path|KeyLayoutFile): ' | while read k v; do`,
  `  case "$k" in`,
  `    Path:) p="$v" ;;`,
  `    KeyLayoutFile:)`,
  `      case "$p" in /dev/input/event*) ;; *) continue ;; esac`,
  `      w=0; [ -w "$p" ] && w=1`,
  `      echo "@dev $p $w $v"`,
  `      [ -n "$v" ] && grep -E '^key +[0-9]+ +[A-Z_0-9]+' "$v" 2>/dev/null | sed "s|^|@kl $p |"`,
  `      [ "$w" = 1 ] && [ -n "$v" ] && getevent -p "$p" 2>/dev/null | sed "s|^|@caps $p |"`,
  `      p="" ;;`,
  `  esac`,
  `done`,
  `echo "@end"`,
].join("\n");

export interface ProbedDevice {
  path: string;
  writable: boolean;
  keyLayout: string;
  /** Android keycode name (no KEYCODE_ prefix) -> first scancode mapped to it. */
  layout: Map<string, number>;
  /** Scancodes the kernel device advertises (EV_KEY bits), or null if unknown. */
  caps: Set<number> | null;
}

export interface Probe {
  bits: 32 | 64 | null;
  printOk: boolean;
  cmdInput: boolean;
  devices: ProbedDevice[];
  complete: boolean;
}

/** `key <scancode> <KEYCODE> [FLAGS...]` lines (skips `key usage ...`). First mapping wins, like EventHub. */
export function parseKeyLayout(lines: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const m = /^key\s+(\d+)\s+([A-Z][A-Z0-9_]*)\b/.exec(l.trim());
    if (!m) continue;
    const code = Number(m[1]);
    if (code > 0 && code <= KEY_MAX && !out.has(m[2])) out.set(m[2], code);
  }
  return out;
}

export function parseProbe(out: string): Probe {
  const probe: Probe = { bits: null, printOk: false, cmdInput: false, devices: [], complete: false };
  const byPath = new Map<string, ProbedDevice>();
  const klLines = new Map<string, string[]>();
  const capState = new Map<string, { inKey: boolean; set: Set<number> }>();
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("@elf ")) {
      const b = line.slice(5).trim();
      probe.bits = b === "01" ? 32 : b === "02" ? 64 : null;
    } else if (line.startsWith("@print ")) {
      probe.printOk = line.slice(7).trim().split(/\s+/).join(" ") === "41 00 42";
    } else if (line.startsWith("@cmd ")) {
      const t = line.slice(5).trim();
      // Implemented `cmd input` prints help ("Usage: input ..."); Android <= 10 prints the error below.
      probe.cmdInput = t.length > 0 && !/No shell command implementation|Can't find service|not found|inaccessible/i.test(t);
    } else if (line.startsWith("@dev ")) {
      const [path, w, kl = ""] = line.slice(5).trim().split(/\s+/);
      if (!DEVICE_RE.test(path) || byPath.has(path)) continue;
      const d: ProbedDevice = { path, writable: w === "1", keyLayout: kl, layout: new Map(), caps: null };
      byPath.set(path, d);
      probe.devices.push(d);
    } else if (line.startsWith("@kl ")) {
      const rest = line.slice(4);
      const sp = rest.indexOf(" ");
      const path = rest.slice(0, sp);
      if (!klLines.has(path)) klLines.set(path, []);
      klLines.get(path)!.push(rest.slice(sp + 1));
    } else if (line.startsWith("@caps ")) {
      const rest = line.slice(6);
      const sp = rest.indexOf(" ");
      const path = sp < 0 ? rest : rest.slice(0, sp);
      let body = sp < 0 ? "" : rest.slice(sp + 1);
      let st = capState.get(path);
      if (!st) capState.set(path, (st = { inKey: false, set: new Set() }));
      const header = /^\s*([A-Z]+) \(([0-9a-f]{4})\):(.*)$/.exec(body);
      if (header) {
        st.inKey = header[1] === "KEY" && header[2] === "0001";
        body = header[3];
      } else if (/^\s*(input props|name|events|add device|location|id|version)\b/.test(body)) {
        st.inKey = false;
        continue;
      }
      if (!st.inKey) continue;
      for (const tok of body.trim().split(/\s+/)) if (/^[0-9a-f]{4}$/.test(tok)) st.set.add(parseInt(tok, 16));
    } else if (line.startsWith("@end")) {
      probe.complete = true;
    }
  }
  for (const d of probe.devices) {
    d.layout = parseKeyLayout(klLines.get(d.path) ?? []);
    const caps = capState.get(d.path);
    d.caps = caps && caps.set.size > 0 ? caps.set : null;
  }
  return probe;
}

export interface EvdevTarget {
  path: string;
  bits: 32 | 64;
  /** Scancode for each key this device can send. Keys missing here go to the next backend. */
  codes: Partial<Record<AllowedKey, number>>;
}

/**
 * The writable device that can send the most of our keys (a scancode in its keylayout that the
 * kernel device also advertises). Ties go to the first one dumpsys lists. Null if evdev can't work.
 */
export function chooseEvdevTarget(probe: Probe): EvdevTarget | null {
  if (!probe.complete || !probe.printOk || probe.bits === null) return null;
  let best: EvdevTarget | null = null;
  let bestCount = 0;
  for (const d of probe.devices) {
    if (!d.writable || !d.caps) continue;
    const codes: Partial<Record<AllowedKey, number>> = {};
    let n = 0;
    for (const k of ALLOWED_KEYS) {
      const code = d.layout.get(klName(k));
      if (code !== undefined && d.caps.has(code)) {
        codes[k] = code;
        n++;
      }
    }
    if (n > bestCount) {
      best = { path: d.path, bits: probe.bits, codes };
      bestCount = n;
    }
  }
  return best;
}

/** Bytes for one `struct input_event` (timestamp left 0: the kernel stamps injected events itself). */
function inputEvent(bits: 32 | 64, type: number, code: number, value: number): Buffer {
  const ts = bits === 32 ? 8 : 16;
  const b = Buffer.alloc(ts + 8);
  b.writeUInt16LE(type, ts);
  b.writeUInt16LE(code, ts + 2);
  b.writeInt32LE(value, ts + 4);
  return b;
}

/** down, SYN, up, SYN for each scancode, in order. */
export function evdevPacket(bits: 32 | 64, scancodes: number[]): Buffer {
  const parts: Buffer[] = [];
  for (const c of scancodes) {
    if (!Number.isInteger(c) || c <= 0 || c > KEY_MAX) throw new Error("invalid scancode");
    parts.push(inputEvent(bits, EV_KEY, c, 1), inputEvent(bits, EV_SYN, SYN_REPORT, 0), inputEvent(bits, EV_KEY, c, 0), inputEvent(bits, EV_SYN, SYN_REPORT, 0));
  }
  return Buffer.concat(parts);
}

/** mksh builtin print with \xHH escapes, appended to the device node: one write(), no fork. */
export function evdevCommand(target: { path: string; bits: 32 | 64 }, scancodes: number[]): string {
  if (!DEVICE_RE.test(target.path)) throw new Error("invalid device");
  const esc = [...evdevPacket(target.bits, scancodes)].map((x) => "\\x" + x.toString(16).padStart(2, "0")).join("");
  return assertSafeLine(`print -n '${esc}' >>${target.path}`);
}

export function inputCommand(keys: AllowedKey[], viaCmd: boolean): string {
  if (keys.length === 0) throw new Error("no keys");
  for (const k of keys) if (!isAllowedKey(k)) throw new Error("key not allowed");
  return assertSafeLine(`${viaCmd ? "cmd input" : "input"} keyevent ${keys.map((k) => KEYCODES[k]).join(" ")}`);
}

const EVDEV_LINE = /^print -n '(?:\\x[0-9a-f]{2})+' >>\/dev\/input\/event\d{1,3}$/;
const INPUT_LINE = /^(?:cmd input|input) keyevent((?: KEYCODE_[A-Z_]+)+)$/;

/** The only lines the persistent shell will ever be given (besides PROBE_SCRIPT and the sentinel). */
export function assertSafeLine(line: string): string {
  if (EVDEV_LINE.test(line)) return line;
  const m = INPUT_LINE.exec(line);
  if (m && m[1].trim().split(" ").every((c) => KEYCODE_VALUES.has(c))) return line;
  throw new Error("refusing to send an unexpected command to the TV shell");
}

/** Token bucket: `burst` presses at once, refilled at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(private burst: number, private perSecond: number, private now: () => number = Date.now) {
    this.tokens = burst;
    this.at = now();
  }
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.perSecond);
    this.at = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// ---------------------------------------------------------------- persistent shell

export class ShellError extends Error {
  constructor(message: string, readonly kind: "exited" | "timeout" | "spawn" | "offline", readonly maybeRan: boolean) {
    super(message);
  }
}

interface Pending {
  id: number;
  resolve: (r: { code: number; out: string }) => void;
  reject: (e: ShellError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_BUF = 256 * 1024;

/** One `adb -s serial shell` kept open. Runs one command at a time; callers queue above it. */
export class PersistentShell {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private errTail = "";
  private seq = 0;
  private current: Pending | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private recentDeaths: number[] = [];

  constructor(
    private serial: string,
    private o: { bin: string; spawn: NonNullable<KeySenderOptions["spawn"]>; idleMs: number; now: () => number; log?: KeySenderOptions["log"] },
  ) {
    if (!/^[A-Za-z0-9.:_-]{1,100}$/.test(serial)) throw new Error("invalid serial");
  }

  get open() {
    return this.proc !== null;
  }

  /** True if the shell died 3 times within 10 s: stop hammering adb and let the caller fall back. */
  get flapping() {
    const t = this.o.now();
    this.recentDeaths = this.recentDeaths.filter((d) => t - d < 10_000);
    return this.recentDeaths.length >= 3;
  }

  private start() {
    let p: ChildProcessWithoutNullStreams;
    try {
      p = this.o.spawn(this.o.bin, ["-s", this.serial, "shell"]);
    } catch (e) {
      throw new ShellError(`spawn failed: ${(e as Error).message}`, "spawn", false);
    }
    this.proc = p;
    this.buf = "";
    this.errTail = "";
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdout.on("data", (d: string) => this.onData(p, d));
    p.stderr.on("data", (d: string) => (this.errTail = (this.errTail + d).slice(-500)));
    p.stdin.on("error", () => {}); // EPIPE when it dies; reported through 'exit'
    p.on("error", (e: NodeJS.ErrnoException) => this.onExit(p, `adb error: ${e.message}`, e.code === "ENOENT" || e.code === "EACCES"));
    p.on("exit", (code, sig) => this.onExit(p, `shell exited (${sig ?? code})`));
    this.o.log?.({ evt: "key_shell_open" });
  }

  private onData(p: ChildProcessWithoutNullStreams, d: string) {
    if (p !== this.proc) return;
    this.buf += d;
    if (this.buf.length > MAX_BUF) this.buf = this.buf.slice(-MAX_BUF);
    const cur = this.current;
    if (!cur) {
      this.buf = ""; // nothing asked for it (motd, stray output)
      return;
    }
    const m = new RegExp(`__GP_${cur.id}:(\\d+)\\r?\\n`).exec(this.buf);
    if (!m) return;
    const out = this.buf.slice(0, m.index);
    this.buf = this.buf.slice(m.index + m[0].length);
    this.current = null;
    clearTimeout(cur.timer);
    this.armIdle();
    cur.resolve({ code: Number(m[1]), out });
  }

  private onExit(p: ChildProcessWithoutNullStreams, why: string, spawnFailed = false) {
    if (p !== this.proc) return;
    this.proc = null;
    this.recentDeaths.push(this.o.now());
    const err = this.errTail.trim();
    const offline = /device .*not found|device offline|no devices|unauthorized|closed|Connection refused/i.test(err);
    this.o.log?.({ evt: "key_shell_exit", why, stderr: err.slice(0, 200) });
    const cur = this.current;
    this.current = null;
    if (cur) {
      clearTimeout(cur.timer);
      cur.reject(spawnFailed ? new ShellError(why, "spawn", false) : new ShellError(err || why, offline ? "offline" : "exited", true));
    }
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.o.log?.({ evt: "key_shell_idle_close" });
      this.close();
    }, this.o.idleMs);
    this.idleTimer.unref?.();
  }

  /** Run one command. `script` must be PROBE_SCRIPT or pass assertSafeLine. */
  run(script: string, timeoutMs: number): Promise<{ code: number; out: string }> {
    if (script !== PROBE_SCRIPT) assertSafeLine(script);
    if (this.current) return Promise.reject(new Error("shell busy")); // the caller serializes
    if (!this.proc) this.start();
    const p = this.proc!;
    const id = ++this.seq;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.current?.id !== id) return;
        this.current = null;
        this.o.log?.({ evt: "key_shell_timeout", timeoutMs });
        this.kill(); // a wedged shell is no good for the next press either
        reject(new ShellError(`timed out after ${timeoutMs} ms`, "timeout", true));
      }, timeoutMs);
      this.current = { id, resolve, reject, timer };
      // The sentinel's text in the command ("$?") can't match its output pattern (digits), so a
      // terminal echo of the command line could never be mistaken for completion.
      p.stdin.write(`${script}\necho "__GP_${id}:$?"\n`);
    });
  }

  private kill() {
    const p = this.proc;
    this.proc = null;
    if (p) p.kill("SIGKILL");
  }

  close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const p = this.proc;
    this.proc = null;
    const cur = this.current;
    this.current = null;
    if (cur) {
      clearTimeout(cur.timer);
      cur.reject(new ShellError("closed", "exited", true));
    }
    if (!p) return;
    try {
      p.stdin.end("exit\n");
    } catch {
      /* already gone */
    }
    const t = setTimeout(() => p.kill("SIGKILL"), 1000);
    t.unref?.();
    p.once("exit", () => clearTimeout(t));
  }
}

// ---------------------------------------------------------------- the sender

interface Queued {
  key: AllowedKey;
  resolve: (r: KeyResult) => void;
}

class FastKeySender implements KeySender {
  private shell: PersistentShell;
  private queue: Queued[] = [];
  private running = false;
  private probe: Probe | null = null;
  private probedAt = 0;
  private target: EvdevTarget | null = null;
  private disabled = new Set<Backend>();
  private evdevFailures = 0;
  private bucket: TokenBucket;
  private closed = false;
  private o: Required<Omit<KeySenderOptions, "exec" | "log" | "rate">> & Pick<KeySenderOptions, "exec" | "log">;

  constructor(opts: KeySenderOptions) {
    this.o = {
      bin: process.env.ADB_BIN ?? "adb",
      spawn: (bin, args) => nodeSpawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] }),
      backends: ["evdev", "cmd", "input"],
      maxQueue: 3,
      maxBatch: 8,
      idleMs: 10 * 60_000,
      commandTimeoutMs: 5000,
      probeTtlMs: 30 * 60_000,
      now: Date.now,
      ...opts,
    };
    const rate = opts.rate ?? { burst: 10, perSecond: 8 };
    this.bucket = new TokenBucket(rate.burst, rate.perSecond, this.o.now);
    this.shell = new PersistentShell(opts.serial, { bin: this.o.bin, spawn: this.o.spawn, idleMs: this.o.idleMs, now: this.o.now, log: this.o.log });
  }

  info() {
    return { backend: this.pickBackend(), device: this.target?.path ?? null, shellOpen: this.shell.open, queued: this.queue.length };
  }

  press(key: AllowedKey): Promise<KeyResult> {
    if (!isAllowedKey(key)) return Promise.resolve({ ok: false, error: "bad_params" });
    if (this.closed) return Promise.resolve({ ok: false, error: "device_offline" });
    if (this.queue.length >= this.o.maxQueue) {
      this.o.log?.({ evt: "key_dropped", key, queued: this.queue.length });
      return Promise.resolve({ ok: true, dropped: true });
    }
    if (!this.bucket.take()) {
      this.o.log?.({ evt: "key_rate_limited", key });
      return Promise.resolve({ ok: false, error: "busy" });
    }
    return new Promise((resolve) => {
      this.queue.push({ key, resolve });
      void this.pump();
    });
  }

  async warm(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      await this.ensureProbe();
    } catch {
      /* the next press will try again */
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  reset() {
    this.probe = null;
    this.target = null;
    this.disabled.clear();
    this.evdevFailures = 0;
    this.shell.close();
  }

  close() {
    this.closed = true;
    this.shell.close();
    for (const q of this.queue.splice(0)) q.resolve({ ok: false, error: "device_offline" });
  }

  private pickBackend(): Backend | null {
    for (const b of this.o.backends) {
      if (this.disabled.has(b)) continue;
      if (b === "evdev" && this.target) return b;
      if (b === "cmd" && this.probe?.cmdInput) return b;
      if (b === "input") return b;
    }
    return null;
  }

  private async ensureProbe() {
    const stale = this.o.now() - this.probedAt > this.o.probeTtlMs;
    if (this.probe && !stale) return;
    const wantsProbe = this.o.backends.some((b) => b === "evdev" || b === "cmd");
    if (!wantsProbe) {
      this.probe = { bits: null, printOk: false, cmdInput: false, devices: [], complete: true };
      this.probedAt = this.o.now();
      return;
    }
    const t0 = this.o.now();
    let r: { code: number; out: string };
    try {
      r = await this.shell.run(PROBE_SCRIPT, 8000);
    } catch (e) {
      if (e instanceof ShellError && (e.kind === "offline" || e.kind === "spawn")) throw e;
      // The shell works (or will after a restart) but the probe didn't finish: use plain `input` over
      // the persistent shell for now and probe again in a minute.
      this.probe = { bits: null, printOk: false, cmdInput: false, devices: [], complete: false };
      this.target = null;
      this.probedAt = this.o.now() - this.o.probeTtlMs + 60_000;
      this.o.log?.({ evt: "key_probe_failed", msg: String((e as Error).message).slice(0, 200) });
      return;
    }
    this.probe = parseProbe(r.out);
    this.probedAt = this.o.now();
    this.target = this.o.backends.includes("evdev") ? chooseEvdevTarget(this.probe) : null;
    this.o.log?.({
      evt: "key_probe", ms: this.o.now() - t0, complete: this.probe.complete, bits: this.probe.bits, printOk: this.probe.printOk,
      cmdInput: this.probe.cmdInput, device: this.target?.path ?? null, evdevKeys: this.target ? Object.keys(this.target.codes).length : 0,
      backend: this.pickBackend(),
    });
  }

  private async pump() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const batch = this.queue.splice(0, this.o.maxBatch);
        const result = await this.sendBatch(batch.map((q) => q.key));
        for (const q of batch) q.resolve(result);
      }
    } finally {
      this.running = false;
    }
  }

  /** Send keys in order, splitting into runs when some keys can't go through evdev. */
  private async sendBatch(keys: AllowedKey[]): Promise<KeyResult> {
    if (this.shell.flapping) return this.execFallback(keys);
    try {
      await this.ensureProbe();
    } catch (e) {
      if (e instanceof ShellError && e.kind === "offline") return { ok: false, error: "device_offline" };
      return this.execFallback(keys);
    }
    let last: KeyResult = { ok: true };
    let i = 0;
    while (i < keys.length) {
      const backend = this.pickBackend();
      if (!backend) return { ok: false, error: "adb_error" };
      const evdevOk = (k: AllowedKey) => backend === "evdev" && this.target?.codes[k] !== undefined;
      const viaEvdev = evdevOk(keys[i]);
      let j = i;
      while (j < keys.length && evdevOk(keys[j]) === viaEvdev) j++;
      const run = keys.slice(i, j);
      last = await this.sendRun(run, viaEvdev ? "evdev" : backend === "evdev" ? this.nextNonEvdev() : backend);
      if (!last.ok) return last;
      i = j;
    }
    return last;
  }

  private nextNonEvdev(): Backend {
    return this.probe?.cmdInput && !this.disabled.has("cmd") && this.o.backends.includes("cmd") ? "cmd" : "input";
  }

  private async sendRun(keys: AllowedKey[], backend: Backend): Promise<KeyResult> {
    const line = backend === "evdev" && this.target
      ? evdevCommand(this.target, keys.map((k) => this.target!.codes[k]!))
      : inputCommand(keys, backend === "cmd");
    const t0 = this.o.now();
    try {
      const r = await this.shell.run(line, this.o.commandTimeoutMs);
      if (r.code === 0) {
        if (backend === "evdev") this.evdevFailures = 0;
        this.o.log?.({ evt: "key_sent", keys, backend, ms: this.o.now() - t0 });
        return { ok: true, backend };
      }
      // The command ran and failed, so nothing was injected: safe to retry on the next backend.
      this.o.log?.({ evt: "key_backend_failed", backend, code: r.code, out: r.out.slice(0, 200) });
      if (backend === "input") return { ok: false, error: "adb_error" }; // last resort: never disabled
      if (backend === "evdev") {
        // The node may have been renumbered (a Bluetooth remote reconnecting): re-probe before the
        // next batch, and give up on evdev for this session after a second failure in a row.
        this.target = null;
        this.probedAt = 0;
        if (++this.evdevFailures >= 2) this.disabled.add("evdev");
      } else {
        this.disabled.add(backend);
      }
      return this.sendRun(keys, backend === "evdev" ? this.nextNonEvdev() : "input");
    } catch (e) {
      const err = e as ShellError;
      this.o.log?.({ evt: "key_error", backend, keys, kind: err.kind, msg: String(err.message).slice(0, 200) });
      // The shell died or hung mid-command: the keys may already be on screen, so don't resend them.
      if (err.kind === "offline") return { ok: false, error: "device_offline" };
      if (err.kind === "timeout") return { ok: false, error: "timeout" };
      if (err.kind === "spawn") return this.execFallback(keys);
      return { ok: false, error: "adb_error" };
    }
  }

  /** Last resort when the persistent shell can't run: the old one-shot path, one adb + JVM per batch. */
  private async execFallback(keys: AllowedKey[]): Promise<KeyResult> {
    if (!this.o.exec) return { ok: false, error: "adb_error" };
    const r = await this.o.exec(["-s", this.o.serial, "shell", "input", "keyevent", ...keys.map((k) => KEYCODES[k])], 8000);
    if (r.code !== 0) this.o.log?.({ evt: "key_error", backend: "exec", code: r.code, stderr: (r.stderr || r.stdout).slice(0, 200) });
    return r.code === 0 ? { ok: true, backend: "exec" } : { ok: false, error: /not found|offline/i.test(r.stderr) ? "device_offline" : "adb_error" };
  }
}

export function createKeySender(opts: KeySenderOptions): KeySender {
  return new FastKeySender(opts);
}
