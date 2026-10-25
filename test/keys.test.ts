import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeLine, chooseEvdevTarget, createKeySender, evdevCommand, evdevPacket, inputCommand, parseKeyLayout, parseProbe, PROBE_SCRIPT,
  TokenBucket, type KeySender, type KeySenderOptions,
} from "../server/tv/keys";
import type { AdbExec } from "../server/adb";
import type { AllowedKey } from "../lib/types";

const SERIAL = "192.168.1.40:5555";
const REAL_PROBE = readFileSync(join(__dirname, "fixtures", "key-probe-aftha001.txt"), "utf8");
const NO_EVDEV_PROBE = "@elf 01\n@print 41 00 42\n@cmd No shell command implementation.\n@end\n";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeOpts {
  probe?: string;
  /** ms an `input keyevent` takes (the JVM start). */
  inputMs?: number;
  evdevMs?: number;
  /** Exit code for evdev writes. */
  evdevCode?: () => number;
  /** Never answer commands matching this. */
  hang?: RegExp;
  /** Exit the shell (as if the TV dropped) when a command matches. */
  dieOn?: RegExp;
  /** adb prints this and exits as soon as it starts. */
  offline?: boolean;
  enoent?: boolean;
}

/** A stand-in for `adb -s serial shell`: reads scripts from stdin, answers each sentinel like sh would. */
function fakeAdb(o: FakeOpts = {}) {
  const spawns: string[][] = [];
  const commands: string[] = [];
  const procs: EventEmitter[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const spawn = (bin: string, args: string[]) => {
    spawns.push([bin, ...args]);
    const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: Writable; kill: (s?: string) => boolean; dead: boolean; ended: boolean };
    procs.push(proc);
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.dead = false;
    proc.ended = false;
    const die = (code: number) => {
      if (proc.dead) return;
      proc.dead = true;
      setImmediate(() => proc.emit("exit", code, null));
    };
    proc.kill = () => (die(137), true);
    let pending = "";
    proc.stdin = new Writable({
      write(chunk, _enc, cb) {
        pending += String(chunk);
        let m: RegExpExecArray | null;
        while ((m = /^([\s\S]*?)\necho "__GP_(\d+):\$\?"\n/.exec(pending))) {
          pending = pending.slice(m[0].length);
          const script = m[1].replace(/^\n+/, "");
          const id = m[2];
          if (script === "exit") continue;
          commands.push(script);
          if (o.hang?.test(script)) continue;
          if (o.dieOn?.test(script)) {
            die(255);
            continue;
          }
          let out = "";
          let code = 0;
          let ms = 1;
          if (script === PROBE_SCRIPT) out = o.probe ?? REAL_PROBE;
          else if (script.startsWith("print -n")) {
            ms = o.evdevMs ?? 2;
            code = o.evdevCode?.() ?? 0;
          } else if (/^(cmd )?input keyevent/.test(script)) ms = o.inputMs ?? 5;
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          setTimeout(() => {
            inFlight--;
            if (!proc.dead) proc.stdout.write(`${out}__GP_${id}:${code}\n`);
          }, ms);
        }
        cb();
      },
      final(cb) {
        proc.ended = true;
        die(0);
        cb();
      },
    });
    if (o.enoent) {
      setImmediate(() => proc.emit("error", Object.assign(new Error("spawn adb ENOENT"), { code: "ENOENT" })));
      proc.dead = true;
    } else if (o.offline) {
      setImmediate(() => {
        proc.stderr.write(`error: device '${SERIAL}' not found\n`);
        setTimeout(() => die(1), 2);
      });
    }
    return proc as unknown as ChildProcessWithoutNullStreams;
  };
  return { spawn, spawns, commands, procs, maxInFlight: () => maxInFlight };
}

let senders: KeySender[] = [];
function sender(fake: ReturnType<typeof fakeAdb>, opts: Partial<KeySenderOptions> = {}) {
  const logs: Record<string, unknown>[] = [];
  const s = createKeySender({ serial: SERIAL, bin: "adb", spawn: fake.spawn, log: (e) => logs.push(e), ...opts });
  senders.push(s);
  return { s, logs };
}
afterEach(() => {
  for (const s of senders) s.close();
  senders = [];
});

const keyLines = (cmds: string[]) => cmds.filter((c) => c !== PROBE_SCRIPT);
/** Decode an evdev command back into [scancode, value] key events (SYNs dropped). */
function decodeEvdev(cmd: string, bits = 32): Array<[number, number]> {
  const hex = [...cmd.matchAll(/\\x([0-9a-f]{2})/g)].map((m) => parseInt(m[1], 16));
  const buf = Buffer.from(hex);
  const size = bits === 32 ? 16 : 24;
  const ts = size - 8;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < buf.length; i += size) {
    const type = buf.readUInt16LE(i + ts);
    if (type === 1) out.push([buf.readUInt16LE(i + ts + 2), buf.readInt32LE(i + ts + 4)]);
  }
  return out;
}

describe("probe parsing (real Fire TV AFTHA001 output)", () => {
  it("reads userland bitness, print support and cmd input", () => {
    const p = parseProbe(REAL_PROBE);
    expect(p).toMatchObject({ bits: 32, printOk: true, cmdInput: false, complete: true });
    expect(p.devices.map((d) => d.path)).toEqual(["/dev/input/event1", "/dev/input/event0", "/dev/input/event2", "/dev/input/event3", "/dev/input/event4", "/dev/input/event5"]);
  });

  it("picks amzkeyboard, which maps every allowlisted key", () => {
    const t = chooseEvdevTarget(parseProbe(REAL_PROBE))!;
    expect(t.path).toBe("/dev/input/event4");
    expect(t.bits).toBe(32);
    expect(t.codes).toEqual({
      UP: 103, DOWN: 108, LEFT: 105, RIGHT: 106, SELECT: 96, BACK: 158, HOME: 172, PLAY_PAUSE: 164, WAKEUP: 143,
      REWIND: 168, FAST_FORWARD: 208, VOLUME_UP: 115, VOLUME_DOWN: 114, MUTE: 113, SLEEP: 142,
    });
  });

  it("refuses evdev when print can't emit bytes, the node isn't writable, or the probe was cut off", () => {
    expect(chooseEvdevTarget(parseProbe(REAL_PROBE.replace("@print  41 00 42", "@print 5c 78 34 31")))).toBeNull();
    expect(chooseEvdevTarget(parseProbe(REAL_PROBE.replace(/@dev (\S+) 1 /g, "@dev $1 0 ")))).toBeNull();
    expect(chooseEvdevTarget(parseProbe(REAL_PROBE.replace("@end", "")))).toBeNull();
  });

  it("ignores keylayout entries the kernel device doesn't advertise", () => {
    const probe = [
      "@elf 02", "@print 41 00 42", "@cmd Usage: input [<source>] <command> [<arg>...]",
      "@dev /dev/input/event7 1 /x.kl", "@kl /dev/input/event7 key 103 DPAD_UP", "@kl /dev/input/event7 key 108 DPAD_DOWN WAKE",
      "@caps /dev/input/event7 add device 1: /dev/input/event7", "@caps /dev/input/event7     KEY (0001): 0067", "@caps /dev/input/event7     MSC (0004): 006c",
      "@end",
    ].join("\n");
    const p = parseProbe(probe);
    expect(p.cmdInput).toBe(true);
    expect(chooseEvdevTarget(p)).toEqual({ path: "/dev/input/event7", bits: 64, codes: { UP: 103 } });
  });

  it("parses .kl lines like EventHub (first mapping wins, usage lines skipped)", () => {
    const m = parseKeyLayout(["key 96 DPAD_CENTER", "key 353 DPAD_CENTER", "key usage 0x0c0041 DPAD_CENTER", "key 116 POWER WAKE", "# key 1 ESCAPE"]);
    expect([...m]).toEqual([["DPAD_CENTER", 96], ["POWER", 116]]);
  });
});

describe("command builders only emit allowlisted shapes", () => {
  it("evdev packet is down/SYN/up/SYN per key, 16 or 24 bytes per event", () => {
    expect(evdevPacket(32, [108]).length).toBe(64);
    expect(evdevPacket(64, [108, 103]).length).toBe(192);
    const cmd = evdevCommand({ path: "/dev/input/event4", bits: 32 }, [108, 103]);
    expect(cmd).toMatch(/^print -n '(\\x[0-9a-f]{2})+' >>\/dev\/input\/event4$/);
    expect(decodeEvdev(cmd)).toEqual([[108, 1], [108, 0], [103, 1], [103, 0]]);
  });

  it("rejects bad devices, scancodes and keys", () => {
    expect(() => evdevCommand({ path: "/dev/input/event4; reboot", bits: 32 }, [108])).toThrow();
    expect(() => evdevCommand({ path: "/data/local/tmp/x", bits: 32 }, [108])).toThrow();
    expect(() => evdevPacket(32, [0])).toThrow();
    expect(() => evdevPacket(32, [1.5])).toThrow();
    expect(() => inputCommand(["POWER" as AllowedKey], false)).toThrow();
    expect(inputCommand(["UP", "SELECT"], true)).toBe("cmd input keyevent KEYCODE_DPAD_UP KEYCODE_DPAD_CENTER");
  });

  it("assertSafeLine blocks anything else", () => {
    for (const bad of [
      "input keyevent KEYCODE_POWER", "input keyevent KEYCODE_HOME; reboot", "input text 'hi'", "am start -a x", "reboot",
      "print -n '\\x41' >>/dev/input/event4; reboot", "print -n '$(reboot)' >>/dev/input/event4", "input keyevent KEYCODE_HOME\nreboot",
    ]) expect(() => assertSafeLine(bad), bad).toThrow();
  });
});

describe("token bucket", () => {
  it("allows a burst, then refills at the sustained rate", () => {
    let t = 0;
    const b = new TokenBucket(10, 8, () => t);
    expect(Array.from({ length: 12 }, () => b.take()).filter(Boolean).length).toBe(10);
    t += 250; // 2 tokens
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
  });
});

describe("FastKeySender", () => {
  it("uses one persistent shell and evdev for every press", async () => {
    const fake = fakeAdb();
    const { s } = sender(fake);
    for (const k of ["DOWN", "DOWN", "SELECT", "BACK"] as AllowedKey[]) expect(await s.press(k)).toEqual({ ok: true, backend: "evdev" });
    expect(fake.spawns).toEqual([["adb", "-s", SERIAL, "shell"]]);
    const lines = keyLines(fake.commands);
    expect(lines.every((l) => l.endsWith(">>/dev/input/event4"))).toBe(true);
    expect(lines.flatMap((l) => decodeEvdev(l)).filter(([, v]) => v === 1).map(([c]) => c)).toEqual([108, 108, 96, 158]);
    expect(s.info()).toMatchObject({ backend: "evdev", device: "/dev/input/event4", shellOpen: true });
  });

  it("warm() runs the probe up front so the first press is just the write", async () => {
    const fake = fakeAdb();
    const { s } = sender(fake);
    await s.warm();
    expect(fake.commands).toEqual([PROBE_SCRIPT]);
    const t0 = Date.now();
    await s.press("UP");
    expect(Date.now() - t0).toBeLessThan(100);
    expect(fake.commands.length).toBe(2);
  });

  it("presses tapped while one is in flight go out together, in order", async () => {
    const fake = fakeAdb({ evdevMs: 30 });
    const { s } = sender(fake, { maxQueue: 8 });
    await s.warm();
    const keys: AllowedKey[] = ["DOWN", "DOWN", "RIGHT", "SELECT", "UP"];
    const rs = await Promise.all(keys.map((k) => s.press(k)));
    expect(rs.every((r) => r.ok && !r.dropped)).toBe(true);
    const lines = keyLines(fake.commands);
    expect(lines.length).toBe(2); // the first press alone, then everything that queued behind it
    expect(lines.flatMap((l) => decodeEvdev(l)).filter(([, v]) => v === 1).map(([c]) => c)).toEqual([108, 108, 106, 96, 103]);
    expect(fake.maxInFlight()).toBe(1);
  });

  it("with a slow JVM `input`, holding a key can't queue a backlog: extras are dropped and batched", async () => {
    const fake = fakeAdb({ probe: NO_EVDEV_PROBE, inputMs: 150 });
    const { s, logs } = sender(fake, { maxQueue: 3, rate: { burst: 100, perSecond: 100 } });
    await s.warm();
    const presses: Promise<{ ok: boolean; dropped?: boolean }>[] = [];
    for (let i = 0; i < 10; i++) {
      presses.push(s.press("DOWN"));
      await sleep(10); // a held button / fast thumb
    }
    const rs = await Promise.all(presses);
    const lines = keyLines(fake.commands);
    expect(lines).toEqual(["input keyevent KEYCODE_DPAD_DOWN", "input keyevent KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN"]);
    expect(rs.filter((r) => r.dropped).length).toBe(6);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(logs.filter((l) => l.evt === "key_dropped").length).toBe(6);
  });

  it("rate limits with a token bucket (burst 10, then ~8/s) instead of a per-minute window", async () => {
    const fake = fakeAdb();
    let t = 0;
    const { s } = sender(fake, { now: () => t, maxQueue: 50 });
    await s.warm();
    const rs = await Promise.all(Array.from({ length: 12 }, () => s.press("UP")));
    expect(rs.filter((r) => r.ok).length).toBe(10);
    expect(rs.filter((r) => r.error === "busy").length).toBe(2);
    t += 1000;
    expect((await s.press("UP")).ok).toBe(true);
  });

  it("falls back to `input` (same batch, no loss) when an evdev write fails, and re-probes", async () => {
    let fail = true;
    const fake = fakeAdb({ evdevCode: () => (fail ? 1 : 0) });
    const { s } = sender(fake);
    expect(await s.press("HOME")).toEqual({ ok: true, backend: "input" });
    expect(keyLines(fake.commands)).toEqual([expect.stringMatching(/^print -n/), "input keyevent KEYCODE_HOME"]);
    fail = false;
    expect(await s.press("HOME")).toEqual({ ok: true, backend: "evdev" });
    expect(fake.commands.filter((c) => c === PROBE_SCRIPT).length).toBe(2);
  });

  it("gives up on evdev after two failures in a row", async () => {
    const fake = fakeAdb({ evdevCode: () => 1 });
    const { s } = sender(fake);
    await s.press("UP");
    await s.press("UP");
    expect(await s.press("UP")).toEqual({ ok: true, backend: "input" });
    expect(keyLines(fake.commands).filter((l) => l.startsWith("print")).length).toBe(2);
  });

  it("sends keys the evdev device can't map through `input`, keeping order", async () => {
    const probe = REAL_PROBE.replace(/^@kl \/dev\/input\/event4 key 142 .*$/m, "");
    const fake = fakeAdb({ probe, evdevMs: 20 });
    const { s } = sender(fake);
    await s.warm();
    await Promise.all((["UP", "SLEEP", "DOWN"] as AllowedKey[]).map((k) => s.press(k)));
    const lines = keyLines(fake.commands);
    expect(lines.length).toBe(3);
    expect(decodeEvdev(lines[0])[0][0]).toBe(103);
    expect(lines[1]).toBe("input keyevent KEYCODE_SLEEP");
    expect(decodeEvdev(lines[2])[0][0]).toBe(108);
  });

  it("restarts the shell after it dies, without resending the press that may have landed", async () => {
    let n = 0;
    const fake = fakeAdb({ dieOn: { test: (s: string) => s.startsWith("print") && ++n === 2 } as RegExp });
    const { s } = sender(fake);
    expect((await s.press("UP")).ok).toBe(true);
    expect(await s.press("DOWN")).toEqual({ ok: false, error: "adb_error" });
    expect((await s.press("LEFT")).ok).toBe(true);
    expect(fake.spawns.length).toBe(2);
    const sent = keyLines(fake.commands).map((l) => decodeEvdev(l)[0][0]);
    expect(sent).toEqual([103, 108, 105]); // DOWN tried exactly once
  });

  it("times out a hung command, kills that shell and opens a fresh one", async () => {
    let hang = true;
    const fake = fakeAdb({ hang: { test: (s: string) => s.startsWith("print") && hang } as RegExp });
    const { s } = sender(fake, { commandTimeoutMs: 50 });
    expect(await s.press("UP")).toEqual({ ok: false, error: "timeout" });
    hang = false;
    expect((await s.press("UP")).ok).toBe(true);
    expect(fake.spawns.length).toBe(2);
  });

  it("reports device_offline when adb can't find the TV", async () => {
    const fake = fakeAdb({ offline: true });
    const { s } = sender(fake);
    expect(await s.press("UP")).toEqual({ ok: false, error: "device_offline" });
  });

  it("falls back to one-shot exec when the adb binary can't be spawned", async () => {
    const fake = fakeAdb({ enoent: true });
    const calls: string[][] = [];
    const exec: AdbExec = async (args) => (calls.push(args), { stdout: "", stderr: "", code: 0 });
    const { s } = sender(fake, { exec });
    expect(await s.press("BACK")).toEqual({ ok: true, backend: "exec" });
    expect(calls).toEqual([["-s", SERIAL, "shell", "input", "keyevent", "KEYCODE_BACK"]]);
  });

  it("closes the shell after the idle timeout and reopens on the next press", async () => {
    const fake = fakeAdb();
    const { s } = sender(fake, { idleMs: 30 });
    await s.press("UP");
    await sleep(60);
    expect(s.info().shellOpen).toBe(false);
    expect((fake.procs[0] as unknown as { ended: boolean }).ended).toBe(true);
    await s.press("UP");
    expect(fake.spawns.length).toBe(2);
  });

  it("only ever writes probe, evdev or allowlisted input lines to the shell", async () => {
    const fake = fakeAdb({ evdevCode: () => 1 });
    const { s } = sender(fake);
    expect(await s.press("rm -rf /" as AllowedKey)).toEqual({ ok: false, error: "bad_params" });
    await Promise.all((["UP", "VOLUME_UP", "SLEEP", "WAKEUP"] as AllowedKey[]).map((k) => s.press(k)));
    for (const c of fake.commands) if (c !== PROBE_SCRIPT) expect(() => assertSafeLine(c)).not.toThrow();
  });
});
