// Measure how long a remote key press takes on a real TV, per method.
//
//   npx tsx scripts/bench-keys.ts --serial 192.168.1.40:5555            # dry run: nothing on screen changes
//   npx tsx scripts/bench-keys.ts --serial ... --yes-press-keys          # also inject a no-op key (see below)
//   npx tsx scripts/bench-keys.ts --serial ... --yes-press-keys --visible-key DOWN   # and a real, visible key
//
// Dry run (default) only runs read-only commands: `true`, a `content query` of one setting (to time a
// JVM start, which is what `input keyevent` pays per press), the key probe (dumpsys input, keylayouts,
// getevent -p), and an evdev-sized write to /dev/null.
//
// --yes-press-keys injects KEY_F24 (or another scancode the TV's keyboard device accepts but its
// keylayout leaves unmapped), which Android delivers as KEYCODE_UNKNOWN: apps ignore it. It still
// counts as user activity, so it can dismiss a screensaver and resets the sleep timer. It also runs
// `input keyevent KEYCODE_UNKNOWN` a few times to time the old JVM path. Nothing else is pressed
// unless you also pass --visible-key <KEY>, which presses that key (from the allowlist) through
// the real KeySender: `--visible-key DOWN` moves the focus on screen.
//
// Leaves nothing running: every adb shell it opens is closed before it exits.

import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAllowedKey } from "../server/adb";
import { chooseEvdevTarget, createKeySender, evdevCommand, evdevPacket, parseProbe, PROBE_SCRIPT } from "../server/tv/keys";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const serial = opt("--serial") ?? process.env.TV_SERIAL;
const n = Number(opt("--n") ?? 20);
const press = flag("--yes-press-keys");
const visible = opt("--visible-key");
const bin = process.env.ADB_BIN ?? "adb";
if (!serial || !/^[A-Za-z0-9.:_-]{1,100}$/.test(serial)) {
  console.error("usage: bench-keys.ts --serial <host:port> [--n 20] [--yes-press-keys [--visible-key DOWN]]");
  process.exit(2);
}
if (visible && (!press || !isAllowedKey(visible))) {
  console.error("--visible-key needs --yes-press-keys and an allowlisted key (UP, DOWN, SELECT, ...)");
  process.exit(2);
}

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows: Array<[string, string]> = [];
function report(name: string, xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const line = `n=${s.length}  median=${q(0.5).toFixed(1)} ms  p95=${q(0.95).toFixed(1)} ms  min=${s[0].toFixed(1)} ms`;
  rows.push([name, line]);
  console.log(`${name.padEnd(56)} ${line}`);
}

const oneShot = (args: string[]) =>
  new Promise<{ ms: number; out: string; code: number }>((resolve) => {
    const t = now();
    execFile(bin, ["-s", serial!, ...args], { timeout: 20_000 }, (err, out, errOut) =>
      resolve({ ms: now() - t, out: String(out) + String(errOut), code: err ? 1 : 0 }));
  });

/** A bare persistent shell for timing (the app's PersistentShell only accepts key lines). */
function rawShell() {
  const p: ChildProcessWithoutNullStreams = spawn(bin, ["-s", serial!, "shell"], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let id = 0;
  let waiter: { id: number; resolve: (s: { out: string; code: number }) => void } | null = null;
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d: string) => {
    buf += d;
    const m = waiter && new RegExp(`__GP_${waiter.id}:(\\d+)\\r?\\n`).exec(buf);
    if (m && waiter) {
      const w = waiter;
      waiter = null;
      const out = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      w.resolve({ out, code: Number(m[1]) });
    }
  });
  p.stderr.on("data", () => {});
  return {
    run: (script: string) =>
      new Promise<{ out: string; code: number; ms: number }>((resolve) => {
        const t = now();
        waiter = { id: ++id, resolve: (r) => resolve({ ...r, ms: now() - t }) };
        p.stdin.write(`${script}\necho "__GP_${id}:$?"\n`);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        p.once("exit", () => resolve());
        p.stdin.end("exit\n");
        setTimeout(() => p.kill("SIGKILL"), 1500).unref();
      }),
  };
}

async function times(name: string, count: number, fn: () => Promise<number>, gapMs = 0) {
  const xs: number[] = [];
  for (let i = 0; i < count; i++) {
    xs.push(await fn());
    if (gapMs) await sleep(gapMs);
  }
  report(name, xs);
}

console.log(`TV ${serial}  mode: ${press ? "PRESSING KEYS" : "dry run (read-only)"}\n`);
const sh = rawShell();
try {
  await sh.run("true");
  await times("one-shot `adb shell true` (spawn + new session)", n, async () => (await oneShot(["shell", "true"])).ms);
  await times("persistent shell: `true` (round trip)", n, async () => (await sh.run("true")).ms);
  const jvm = ["content", "query", "--uri", "content://settings/global", "--where", "\"name='adb_enabled'\""].join(" ");
  await times("persistent shell: JVM start (`content query`, read-only)", 3, async () => (await sh.run(jvm)).ms);

  const probeRun = await sh.run(PROBE_SCRIPT);
  const probe = parseProbe(probeRun.out);
  const target = chooseEvdevTarget(probe);
  rows.push(["key probe (once per shell session)", `${probeRun.ms.toFixed(0)} ms`]);
  console.log(`\nprobe: ${probeRun.ms.toFixed(0)} ms  userland=${probe.bits}-bit  print=${probe.printOk}  cmd input=${probe.cmdInput}`);
  console.log(`evdev device: ${target?.path ?? "none"}  keys: ${target ? Object.keys(target.codes).join(" ") : "-"}`);
  console.log(`backend the app would use: ${target ? "evdev" : probe.cmdInput ? "cmd input" : "input (JVM)"}\n`);

  const pktLen = evdevPacket(probe.bits ?? 32, [108]).length;
  const esc = [...evdevPacket(probe.bits ?? 32, [108])].map((x) => "\\x" + x.toString(16).padStart(2, "0")).join("");
  await times(`persistent shell: ${pktLen}-byte key packet to /dev/null`, n, async () => (await sh.run(`print -n '${esc}' >>/dev/null`)).ms);
  if (probe.cmdInput) await times("persistent shell: `cmd input` (help only)", 5, async () => (await sh.run("cmd input >/dev/null 2>&1")).ms);

  if (press) {
    if (target) {
      // A scancode the kernel device accepts but its keylayout doesn't map -> KEYCODE_UNKNOWN.
      const mapped = new Set([...probeRun.out.matchAll(new RegExp(`^@kl ${target.path} key +(\\d+) `, "gm"))].map((m) => Number(m[1])));
      const caps = probe.devices.find((d) => d.path === target.path)?.caps ?? new Set<number>();
      const noop = [194, 193, 192, 191, 190, 189, 188, 187, 186, 185, 184, 183, 240].find((c) => caps.has(c) && !mapped.has(c));
      if (noop === undefined) console.log("no unmapped scancode on the evdev device; skipping the evdev no-op test");
      else {
        const line = evdevCommand(target, [noop]);
        await times(`evdev inject no-op scancode ${noop} (KEYCODE_UNKNOWN)`, n, async () => {
          const r = await sh.run(line);
          if (r.code !== 0) throw new Error(`evdev write failed: ${r.out}`);
          return r.ms;
        }, 200);
        const seen = (await sh.run(`dumpsys input | grep -c "scanCode=${noop}"`)).out.trim();
        console.log(`  InputDispatcher saw scanCode=${noop}: ${Number(seen) > 0 ? `yes (${seen} recent entries)` : "NO, evdev injection isn't reaching Android"}`);
        rows.push([`evdev no-op reached InputDispatcher`, Number(seen) > 0 ? "yes" : "NO"]);
      }
    }
    await times("one-shot `adb shell input keyevent KEYCODE_UNKNOWN` (old path)", 3, async () => (await oneShot(["shell", "input", "keyevent", "KEYCODE_UNKNOWN"])).ms, 300);

    if (visible && isAllowedKey(visible)) {
      const keys = createKeySender({ serial: serial!, bin });
      try {
        await keys.warm();
        console.log(`\nKeySender backend: ${keys.info().backend} (${keys.info().device ?? "-"}), pressing ${visible}`);
        await times(`KeySender.press(${visible}) one at a time`, Math.min(n, 10), async () => {
          const t = now();
          const r = await keys.press(visible);
          if (!r.ok) throw new Error(`press failed: ${r.error}`);
          return now() - t;
        }, 400);
        const t = now();
        const burst = await Promise.all(Array.from({ length: 6 }, () => keys.press(visible)));
        rows.push([`KeySender burst of 6 x ${visible}`, `${(now() - t).toFixed(0)} ms total, ${burst.filter((r) => r.dropped).length} dropped`]);
        console.log(`burst of 6: ${(now() - t).toFixed(0)} ms total, ${burst.filter((r) => r.dropped).length} dropped`);
      } finally {
        keys.close();
      }
    }
  }
} finally {
  await sh.close();
}

console.log("\n| method | result |\n|---|---|");
for (const [k, v] of rows) console.log(`| ${k} | ${v} |`);
await sleep(200);
process.exit(0);
