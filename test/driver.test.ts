import { mkdtempSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FireTvAdbDriver, RateLimiter } from "../server/driver";
import { makeAdbExec, type AdbExec } from "../server/adb";
import { APP_BY_ID } from "../lib/catalog/apps";
import type { LaunchRoute, ServiceId } from "../lib/types";
import type { PlexClient } from "../server/plex";
import type { MlbSchedule } from "../server/mlb";
import { game, withApp } from "./helpers";

const SERIAL = "10.0.0.5:5555";

/** Scripted fake: decides output from the argv; records every call. */
function fakeExec(opts: {
  device?: "device" | "unauthorized" | "offline" | "none";
  fg?: (calls: string[][]) => string; // package in front
  activity?: string;
  amStart?: (uri: string) => string;
  monkey?: string;
  resolveLauncher?: string;
  resolveLauncherFor?: (category: string) => string; // per intent category, overrides resolveLauncher
}) {
  const calls: string[][] = [];
  const exec: AdbExec = async (args) => {
    calls.push(args);
    const out = (stdout: string, code = 0) => ({ stdout, stderr: "", code });
    if (args[0] === "connect") return out(`connected to ${SERIAL}`);
    if (args[0] === "devices") {
      const d = opts.device ?? "device";
      return out(d === "none" ? "List of devices attached\n" : `List of devices attached\n${SERIAL}\t${d}\n`);
    }
    const sh = args.slice(3);
    if (sh[0] === "dumpsys" && sh[2] === "activities") {
      const pkg = opts.fg?.(calls) ?? "com.amazon.tv.launcher";
      return out(`  topResumedActivity=ActivityRecord{1 u0 ${pkg}/${opts.activity ?? ".MainActivity"} t1}`);
    }
    if (sh[0] === "dumpsys" && sh[1] === "power") return out("mWakefulness=Awake");
    if (sh[0] === "cmd") return out(opts.resolveLauncherFor?.(sh[5]) ?? opts.resolveLauncher ?? "priority=0 preferredOrder=0\nnone");
    if (sh[0] === "am" && sh.includes("android.intent.action.VIEW")) return out((opts.amStart ?? (() => "Starting: Intent {}\nStatus: ok"))(sh[6]));
    if (sh[0] === "am" || sh[0] === "monkey") return out(opts.monkey ?? "Events injected: 1");
    if (sh[0] === "input") return out("");
    return out("", 1);
  };
  return { exec, calls };
}

const lastStarted = (calls: string[][]) => {
  const starts = calls.filter((c) => c[3] === "am" || c[3] === "monkey");
  return starts.at(-1)?.join(" ") ?? "";
};

function driver(exec: AdbExec, extra: Partial<ConstructorParameters<typeof FireTvAdbDriver>[0]> = {}) {
  let t = 0;
  return new FireTvAdbDriver({
    serial: SERIAL,
    exec,
    apps: () => APP_BY_ID,
    sleep: async (ms) => void (t += ms),
    now: () => t,
    verifyTimeoutMs: 2000,
    ...extra,
  });
}

const req = (service: ServiceId, network: LaunchRoute["network"], gameId = "nfl:401") => ({
  requestId: "7a1d2c3e-0000-4000-8000-000000000001",
  game: game(gameId),
  route: { service: ({ paramount: "paramount_plus", mlbtv: "mlb", prime: "prime_video", youtube_st: "youtube_tv" } as Record<string, string>)[service] ?? service, network, level: "app" as const, certain: true, reason: "test" },
});

describe("FireTvAdbDriver.launch", () => {
  it("app-only service: launches the app, verifies it, returns the app-only message", async () => {
    let launched = false;
    const { exec, calls } = fakeExec({ fg: (c) => (launched || lastStarted(c).includes("monkey") ? ((launched = true), "com.cbs.ott") : "com.amazon.tv.launcher") });
    const r = await driver(exec).launch(req("paramount", "cbs"));
    expect(r).toMatchObject({ ok: true, outcome: "app", level: "app", verified: true, persistent: true, title: "Opened Paramount+" });
    expect(r.message).toContain("Go to **Live TV** and choose your local **CBS** station.");
    // Tried the unverified live-TV deep link first, then the launcher.
    expect(calls.some((c) => c.join(" ").includes("'https://www.paramountplus.com/live-tv/'"))).toBe(true);
    expect(r.attempts.map((a) => a.level)).toEqual(["channel", "app"]);
  });

  it("wakes the TV first", async () => {
    const { exec, calls } = fakeExec({ fg: () => "com.cbs.ott" });
    await driver(exec).launch(req("paramount", "cbs"));
    const wakeIdx = calls.findIndex((c) => c.join(" ").includes("KEYCODE_WAKEUP"));
    const amIdx = calls.findIndex((c) => c[3] === "am");
    expect(wakeIdx).toBeGreaterThan(-1);
    expect(wakeIdx).toBeLessThan(amIdx);
  });

  it("an unverified deep link that lands says so and keeps the app-only path", async () => {
    const { exec } = fakeExec({ fg: () => "com.cbs.ott" });
    const r = await driver(exec).launch(req("paramount", "cbs"));
    expect(r).toMatchObject({ outcome: "channel", level: "channel", persistent: true });
    expect(r.message).toContain("If it isn't on the right channel");
  });

  it("a verified deep link auto-hides", async () => {
    const apps = withApp("paramount_plus", (a) => ({ ...a, routes: [{ ...a.routes[0], verified: ["firetv"] }] }));
    const { exec } = fakeExec({ fg: () => "com.cbs.ott" });
    const r = await driver(exec, { apps: () => apps }).launch(req("paramount", "cbs"));
    expect(r).toMatchObject({ outcome: "channel", persistent: false, title: "On TV: CBS in Paramount+" });
  });

  it("falls back to the app when am start fails", async () => {
    const { exec, calls } = fakeExec({
      amStart: () => "Error: Activity not started, unable to resolve Intent",
      fg: (c) => (lastStarted(c).includes("monkey") ? "com.cbs.ott" : "launcher"),
    });
    const r = await driver(exec).launch(req("paramount", "cbs"));
    expect(r.outcome).toBe("app");
    expect(r.attempts[0]).toMatchObject({ level: "channel", ok: false, error: "am start failed" });
    expect(lastStarted(calls)).toContain("monkey -p 'com.cbs.ott'");
  });

  it("launches a leanback-only app (e.g. HBO Max on Fire TV) by its resolved activity, not monkey", async () => {
    const { exec, calls } = fakeExec({
      resolveLauncherFor: (c) => (c.endsWith("LEANBACK_LAUNCHER") ? "priority=0\ncom.hbo.hbonow/com.wbd.beam.BeamActivity" : "No activity found"),
      fg: () => "com.hbo.hbonow",
    });
    const r = await driver(exec).launch(req("hbo_max", "tnt", "nhl:603"));
    expect(r.outcome).toBe("app");
    expect(lastStarted(calls)).toBe("-s 10.0.0.5:5555 shell am start -W -n 'com.hbo.hbonow/com.wbd.beam.BeamActivity'".replace("10.0.0.5:5555", SERIAL));
    expect(calls.filter((c) => c[3] === "monkey")).toHaveLength(0);
  });

  it("uses the resolved launcher activity when there is one", async () => {
    const { exec, calls } = fakeExec({ resolveLauncher: "priority=0\ncom.hbo.hbonow/com.wbd.beam.Launcher", fg: () => "com.hbo.hbonow" });
    await driver(exec).launch(req("hbo_max", "tnt", "nhl:603"));
    expect(lastStarted(calls)).toContain("am start -W -n 'com.hbo.hbonow/com.wbd.beam.Launcher'");
  });

  it("detects a profile picker", async () => {
    const { exec } = fakeExec({ fg: () => "com.hbo.hbonow", activity: "com.wbd.ProfilePickerActivity" });
    const r = await driver(exec).launch(req("hbo_max", "tnt", "nhl:603"));
    expect(r).toMatchObject({ outcome: "profile_picker", title: "HBO Max is asking who's watching", persistent: true });
  });

  it("unverified when the app was started but never came to the front", async () => {
    const { exec } = fakeExec({ fg: () => "com.amazon.tv.launcher" });
    const r = await driver(exec).launch(req("hbo_max", "tnt", "nhl:603"));
    expect(r).toMatchObject({ outcome: "unverified", ok: false, persistent: true });
  });

  it("device offline and unauthorized fail cleanly", async () => {
    for (const device of ["none", "offline", "unauthorized"] as const) {
      const r = await driver(fakeExec({ device }).exec).launch(req("plex", "cbs"));
      expect(r).toMatchObject({ ok: false, outcome: "failed", error: "device_offline", title: "Couldn't reach the TV" });
    }
  });

  it("MLB.TV builds the game deep link from the gamePk", async () => {
    const mlb = { gamePkFor: async () => "776543" } as unknown as MlbSchedule;
    const { exec, calls } = fakeExec({ fg: () => APP_BY_ID.get("mlb")!.packages.firetv![0] });
    const r = await driver(exec, { mlb }).launch(req("mlbtv", "mlbtv", "mlb:501"));
    expect(calls.some((c) => c.join(" ").includes("'mlbatbat://mlbtv?date=") && c.join(" ").includes("&gamepk=776543'"))).toBe(true);
    expect(r.outcome).toBe("game");
  });

  it("MLB.TV skips the game link when there's no gamePk", async () => {
    const mlb = { gamePkFor: async () => null } as unknown as MlbSchedule;
    const { exec } = fakeExec({ fg: () => APP_BY_ID.get("mlb")!.packages.firetv![0] });
    const r = await driver(exec, { mlb }).launch(req("mlbtv", "mlbtv", "mlb:501"));
    expect(r.outcome).toBe("app");
    expect(r.attempts.map((a) => a.level)).toEqual(["app"]);
  });

  it("Plex without a guide route opens the app with the Live TV path", async () => {
    const { exec } = fakeExec({ fg: (c) => (lastStarted(c).includes("monkey") ? "com.plexapp.android" : "launcher") });
    const r = await driver(exec).launch(req("plex", "cbs"));
    expect(r.outcome).toBe("app");
    expect(r.message).toContain("Go to **Live TV & DVR**, open the **Guide**, and choose **CBS**.");
  });

  it("one launch at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { exec } = fakeExec({ fg: () => "com.cbs.ott" });
    const slow: AdbExec = async (a, t) => {
      if (a[0] === "connect" || a[0] === "devices") await gate;
      return exec(a, t);
    };
    const d = driver(slow);
    const first = d.launch(req("paramount", "cbs"));
    const second = await d.launch(req("paramount", "cbs"));
    expect(second).toMatchObject({ outcome: "failed", error: "busy" });
    release();
    expect((await first).ok).toBe(true);
  });

  it("rate limits launches", async () => {
    const { exec } = fakeExec({ fg: () => "com.cbs.ott" });
    const d = driver(exec);
    for (let i = 0; i < 10; i++) expect((await d.launch(req("paramount", "cbs"))).error).toBeUndefined();
    expect((await d.launch(req("paramount", "cbs"))).error).toBe("busy");
  });
});

describe("FireTvAdbDriver status and keys", () => {
  it("reports connection, screen and foreground", async () => {
    const { exec } = fakeExec({ fg: () => "com.plexapp.android" });
    expect(await driver(exec).status("ok")).toMatchObject({ adb: "connected", screenOn: true, foreground: "com.plexapp.android", plex: "ok" });
  });
  it("sends allowlisted keys", async () => {
    const { exec, calls } = fakeExec({});
    expect(await driver(exec).key("SELECT")).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual(["-s", SERIAL, "shell", "input", "keyevent", "KEYCODE_DPAD_CENTER"]);
  });
  it("RateLimiter slides", () => {
    let t = 0;
    const l = new RateLimiter(2, 1000, () => t);
    expect([l.take(), l.take(), l.take()]).toEqual([true, true, false]);
    t = 1001;
    expect(l.take()).toBe(true);
  });
});

describe("makeAdbExec with a fake adb binary", () => {
  it("passes argv straight through, no local shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-adb-"));
    const log = join(dir, "log");
    const bin = join(import.meta.dirname, "fake-adb.mjs");
    chmodSync(bin, 0o755);
    process.env.FAKE_ADB_LOG = log;
    process.env.FAKE_ADB_SERIAL = SERIAL;
    process.env.FAKE_ADB_FG = "com.cbs.ott";
    const d = new FireTvAdbDriver({ serial: SERIAL, exec: makeAdbExec(bin), apps: () => APP_BY_ID, verifyTimeoutMs: 500 });
    const r = await d.launch(req("paramount", "cbs"));
    expect(r.ok).toBe(true);
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    expect(lines[0]).toEqual(["devices"]);
    expect(lines).toContainEqual(["-s", SERIAL, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "'https://www.paramountplus.com/live-tv/'", "'com.cbs.ott'"]);
  });
});

describe("apps without a TV package", () => {
  it("wake the TV and return the steps instead of failing", async () => {
    const { exec, calls } = fakeExec({ fg: () => "com.amazon.tv.launcher" });
    const r = await driver(exec).launch({ ...req("paramount", "cbs"), route: { service: "team_app", network: "local", level: "app", certain: true, reason: "t" } });
    expect(r).toMatchObject({ ok: true, outcome: "manual", title: "Open your team's app on the TV" });
    expect(calls.some((c) => c.join(" ").includes("KEYCODE_WAKEUP"))).toBe(true);
    expect(calls.some((c) => c.includes("am"))).toBe(false);
  });
});
