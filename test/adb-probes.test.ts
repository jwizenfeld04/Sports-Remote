import { describe, expect, it } from "vitest";
import { keyArgs, mediaPlaying, mediaSessionArgs, parseAmStart, parseForeground, parseMediaSessions, parsePidof, pidofArgs } from "../server/adb";
import { parseForegroundActivity } from "../server/driver";

// Shapes taken from real `adb shell` output (trimmed).
const MEDIA = `MEDIA SESSION SERVICE (dumpsys media_session)

Sessions Stack - have 2 sessions:
  PlexMediaSession com.plexapp.android/PlexMediaSession (userId=0)
    ownerPid=8123, ownerUid=10085, userId=0
    package=com.plexapp.android
    launchIntent=null
    mediaButtonReceiver=MBR {pi=null, type=0}
    active=true
    flags=3
    rating type=0
    controller=android.media.session.ISessionController$Stub$Proxy@4d2f0a1
    state=PlaybackState {state=3, position=125000, buffered position=0, speed=1.0, updated=10234, actions=823, custom actions=[], active item id=-1, error=null}
    audioAttrs=AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_UNKNOWN flags=0x800 tags= bundle=null
  com.amazon.firebat/PrimeSession (userId=0)
    ownerPid=9001, ownerUid=10090, userId=0
    package=com.amazon.firebat
    active=false
    state=PlaybackState {state=2, position=0, buffered position=0, speed=0.0, updated=0, actions=0, custom actions=[], active item id=-1, error=null}
`;

describe("adb probes", () => {
  it("pidof is a fixed argv, rejects hostile packages, and parses", () => {
    expect(pidofArgs("com.plexapp.android")).toEqual(["pidof", "'com.plexapp.android'"]);
    expect(() => pidofArgs("com.x; reboot")).toThrow();
    expect(parsePidof("8123\n")).toBe(8123);
    expect(parsePidof("8123 8124\n")).toBe(8123);
    expect(parsePidof("")).toBe(null);
  });

  it("media_session: per-package state, and 'playing' only for an active playing/buffering session", () => {
    expect(mediaSessionArgs()).toEqual(["dumpsys", "media_session"]);
    const s = parseMediaSessions(MEDIA);
    expect(s).toEqual([
      { pkg: "com.plexapp.android", active: true, state: "playing" },
      { pkg: "com.amazon.firebat", active: false, state: "paused" },
    ]);
    expect(mediaPlaying(s, "com.plexapp.android")).toBe(true);
    expect(mediaPlaying(s, "com.amazon.firebat")).toBe(false);
    expect(mediaPlaying(s, "com.amazon.firetv.youtube.tv")).toBe(null); // no session: unknown
    expect(mediaPlaying(null, "x.y")).toBe(null);
    expect(parseMediaSessions(MEDIA.replace("state=3", "state=6"))[0].state).toBe("buffering");
    expect(parseMediaSessions(MEDIA.replace("state=3", "state=42"))[0].state).toBe("other");
  });

  it("am start -W: launch state, onNewIntent delivery, total time", () => {
    const warm = "Starting: Intent { act=android.intent.action.VIEW dat=plex://live-tv/dvr.guide/ota/2 pkg=com.plexapp.android }\nWarning: Activity not started, intent has been delivered to currently running top-most instance.\nStatus: ok\nLaunchState: HOT\nActivity: com.plexapp.android/tv.plex.app.MainActivity\nTotalTime: 0\nWaitTime: 12\nComplete";
    expect(parseAmStart(warm)).toEqual({ ok: true, launchState: "HOT", deliveredToRunning: true, totalTimeMs: 0 });
    const cold = "Starting: Intent { act=android.intent.action.VIEW }\nStatus: ok\nLaunchState: COLD\nActivity: x/y\nTotalTime: 2311\nComplete";
    expect(parseAmStart(cold)).toEqual({ ok: true, launchState: "COLD", deliveredToRunning: false, totalTimeMs: 2311 });
    // Fire OS 7 (Android 9): no LaunchState line.
    expect(parseAmStart("Starting: Intent {}\nStatus: ok\nThisTime: 900\nTotalTime: 900")).toMatchObject({ ok: true, launchState: null, totalTimeMs: 900 });
    expect(parseAmStart("Error: Activity not started, unable to resolve Intent").ok).toBe(false);
  });

  it("parseForeground agrees with the driver's parser", () => {
    for (const out of [
      "  topResumedActivity=ActivityRecord{1 u0 com.plexapp.android/tv.plex.app.MainActivity t1}",
      "  mResumedActivity: ActivityRecord{2 u0 com.amazon.firebat/com.amazon.pyrocore.IgnitionActivity t9}",
      "  mFocusedApp=AppWindowToken{x token=Token{y ActivityRecord{z u0 com.amazon.tv.launcher/.Main t2}}}",
      "nothing here",
    ]) expect(parseForeground(out)).toEqual(parseForegroundActivity(out));
  });

  it("SEARCH is an allowed key", () => {
    expect(keyArgs("SEARCH")).toEqual(["input", "keyevent", "KEYCODE_SEARCH"]);
  });
});
