import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  amStartOk, buildUri, keyArgs, launcherArgs, LAUNCHER_CATEGORIES, parseLauncherActivity, parseScreenOn, resolveLauncherArgs, shellArgs, shellQuote, stripToPng, viewIntentArgs,
} from "../server/adb";
import { parseForegroundActivity } from "../server/driver";
import { APP_BY_ID, isValidTemplate } from "../lib/catalog/apps";
import { fill, renderOutcome, varsFor } from "../lib/messages";
import type { LaunchOutcome, ServiceId } from "../lib/types";
import { game } from "./helpers";

const HOSTILE = ["; reboot", "$(reboot)", "`reboot`", "a' ; reboot; echo '", "x\nreboot", "a && reboot", "a | sh", "'", "\"$HOME\"", "*", "~"];

describe("shellQuote", () => {
  it.each(HOSTILE)("a real POSIX shell sees %j as one literal argument", (s) => {
    // The TV's /system/bin/sh parses the joined string; prove the quoting with a local sh.
    const out = execFileSync("sh", ["-c", `printf '%s' ${shellQuote(s)}`]).toString();
    expect(out).toBe(s);
  });
  it("rejects NUL", () => {
    expect(() => shellQuote("a\0b")).toThrow();
  });
});

describe("adb builders", () => {
  it("VIEW intent", () => {
    expect(viewIntentArgs("https://www.mlb.com/tv/g12345", "com.bamnetworks.mobile.android.gameday.atbat")).toEqual([
      "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "'https://www.mlb.com/tv/g12345'", "'com.bamnetworks.mobile.android.gameday.atbat'",
    ]);
  });
  it("launcher with and without a resolved activity", () => {
    expect(launcherArgs("com.cbs.ott", "com.cbs.ott.MainActivity")).toEqual(["am", "start", "-W", "-n", "'com.cbs.ott/com.cbs.ott.MainActivity'"]);
    expect(launcherArgs("com.cbs.ott")).toEqual(["monkey", "-p", "'com.cbs.ott'", "-c", "android.intent.category.LAUNCHER", "1"]);
  });
  it("resolves launcher activities for TV-only apps (LEANBACK first)", () => {
    expect(LAUNCHER_CATEGORIES[0]).toBe("android.intent.category.LEANBACK_LAUNCHER");
    expect(resolveLauncherArgs("com.hbo.hbonow", LAUNCHER_CATEGORIES[0])).toEqual([
      "cmd", "package", "resolve-activity", "--brief", "-c", "android.intent.category.LEANBACK_LAUNCHER", "'com.hbo.hbonow'",
    ]);
    expect(parseLauncherActivity("priority=0 preferredOrder=0\ncom.hbo.hbonow/com.wbd.beam.BeamActivity\n", "com.hbo.hbonow")).toBe("com.wbd.beam.BeamActivity");
    expect(parseLauncherActivity("No activity found", "com.hbo.hbonow")).toBeNull();
    expect(parseLauncherActivity("other.app/Main", "com.hbo.hbonow")).toBeNull(); // wrong package never accepted
  });
  it("strips Fire OS's text preamble from a screenshot", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(stripToPng(Buffer.concat([Buffer.from("Init wrapper sys mutex successful. Pid:16385\n"), png]))?.equals(png)).toBe(true);
    expect(stripToPng(png)?.equals(png)).toBe(true);
    expect(stripToPng(Buffer.from("not an image"))).toBeNull();
  });
  it("keys come from the enum only", () => {
    expect(keyArgs("HOME")).toEqual(["input", "keyevent", "KEYCODE_HOME"]);
    expect(keyArgs("VOLUME_UP")).toEqual(["input", "keyevent", "KEYCODE_VOLUME_UP"]);
    expect(keyArgs("SLEEP")).toEqual(["input", "keyevent", "KEYCODE_SLEEP"]);
    expect(() => keyArgs("POWER; reboot" as never)).toThrow();
  });
  it.each(HOSTILE)("rejects hostile package names: %j", (p) => {
    expect(() => launcherArgs(`com.x${p}`)).toThrow();
    expect(() => viewIntentArgs("https://a.b/c", `com.x${p}`)).toThrow();
  });
  it("rejects hostile activities, serials and URIs", () => {
    expect(() => launcherArgs("com.cbs.ott", "Main;reboot")).toThrow();
    expect(() => shellArgs("1.2.3.4:5555;reboot", [])).toThrow();
    expect(() => viewIntentArgs("javascript:alert(1)", "com.cbs.ott")).toThrow();
  });
  it("buildUri validates and encodes params", () => {
    const r = APP_BY_ID.get("mlb")!.routes[0];
    const p = { gameDate: "2026-10-12", gamePk: "776543" };
    expect(buildUri(r, p)).toBe("mlbatbat://mlbtv?date=2026-10-12&gamepk=776543");
    expect(() => buildUri(r, { ...p, gamePk: "1; reboot" })).toThrow(/validation/);
    expect(() => buildUri(r, { ...p, gameDate: "tomorrow" })).toThrow(/validation/);
    expect(() => buildUri(r, {})).toThrow(/missing/);
    expect(() => buildUri({ ...r, template: "https://x.com/{other}" }, p)).toThrow(/undeclared/);
  });
});

describe("adb output parsing", () => {
  it("foreground activity across Fire OS versions", () => {
    expect(parseForegroundActivity("  topResumedActivity=ActivityRecord{6f1 u0 com.cbs.ott/.MainActivity t42}")).toEqual({ pkg: "com.cbs.ott", activity: ".MainActivity" });
    expect(parseForegroundActivity("  mResumedActivity: ActivityRecord{a1b2 u0 com.plexapp.android/com.plexapp.plex.activities.SplashActivity t7}")).toEqual({
      pkg: "com.plexapp.android", activity: "com.plexapp.plex.activities.SplashActivity",
    });
    expect(parseForegroundActivity("nothing")).toBeNull();
  });
  it("screen state", () => {
    expect(parseScreenOn("mWakefulness=Awake")).toBe(true);
    expect(parseScreenOn("mWakefulness=Asleep")).toBe(false);
    expect(parseScreenOn("Display Power: state=OFF")).toBe(false);
  });
  it("am start status", () => {
    expect(amStartOk("Starting: Intent { act=android.intent.action.VIEW }\nStatus: ok\nTotalTime: 812")).toBe(true);
    expect(amStartOk("Starting: Intent {}\nError: Activity not started, unable to resolve Intent")).toBe(false);
  });
});

describe("catalog routes", () => {
  it("every built-in template passes the validator", () => {
    for (const a of APP_BY_ID.values()) for (const r of a.routes) if (r.template) expect(isValidTemplate(r.template), `${a.id} ${r.template}`).toBe(true);
  });
  it.each(["https://x.com/'$(reboot)", "https://x.com/`id`", "javascript:alert(1)", "file:///etc/passwd"])("rejects %s", (t) => {
    expect(isValidTemplate(t)).toBe(false);
  });
});

describe("fallback messages", () => {
  const g = game("nfl:401");
  const outcomes: LaunchOutcome[] = ["game", "channel", "app", "profile_picker", "unverified", "failed"];
  it("render for every service and outcome with no unfilled placeholders", () => {
    for (const def of APP_BY_ID.values()) {
      const v = varsFor(g, "espn", def, "WCBS 2.1");
      for (const o of outcomes) {
        for (const unverifiedRoute of [false, true]) {
          const m = renderOutcome(o, def, v, { unverifiedRoute, error: "device_offline" });
          expect(m.title + m.message).not.toMatch(/\{[a-z]+\}|undefined/);
        }
      }
    }
  });
  it("app-only is persistent and includes the path", () => {
    const def = APP_BY_ID.get("paramount_plus")!;
    const m = renderOutcome("app", def, varsFor(g, "cbs", def));
    expect(m).toEqual({ title: "Opened Paramount+", message: "Go to **Live TV** and choose your local **CBS** station. Use the remote below to finish.", persistent: true });
  });
  it("verified channel auto-hides; unverified channel stays with the path", () => {
    const def = APP_BY_ID.get("plex")!;
    const v = varsFor(g, "cbs", def, "WCBS 2.1");
    expect(renderOutcome("channel", def, v).persistent).toBe(false);
    const u = renderOutcome("channel", def, v, { unverifiedRoute: true });
    expect(u.persistent).toBe(true);
    expect(u.message).toContain("Go to **Live TV & DVR**, open the **Guide**, and choose **WCBS 2.1**.");
  });
  it("fill only replaces known placeholders", () => {
    expect(fill("{away} at {home} {evil}", { away: "A", home: "H", network: "", channel: "", service: "" })).toBe("A at H {evil}");
  });
});
