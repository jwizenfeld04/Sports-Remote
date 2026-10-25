import { describe, expect, it } from "vitest";
import type { AdbExec } from "../server/adb";
import { connectArgs, pairArgs, parseConnectOutput, parsePairOutput, serialOf } from "../server/tv/commands";
import { detectPlatform, deviceProps, friendlyModel, installedApps, parseGetprop, parsePackages } from "../server/tv/detect";
import { lanPrefixes, parseMdnsServices, scanForAdb } from "../server/tv/discovery";
import { servicesFromAnswers } from "../server/tv/mdns";
import { connectTv, findConnectPort, identifyTv, pairTv, waitForApproval } from "../server/tv/pairing";

const FIRE_PROPS = `[ro.product.manufacturer]: [Amazon]
[ro.product.brand]: [Amazon]
[ro.product.model]: [AFTKA]
[ro.build.version.sdk]: [30]
[ro.build.version.fireos]: [8.1.0.3]
[ro.build.characteristics]: [tv]`;
const CCGTV_PROPS = `[ro.product.manufacturer]: [Google]
[ro.product.brand]: [google]
[ro.product.model]: [Chromecast]
[ro.build.version.sdk]: [34]
[ro.build.characteristics]: [nosdcard,tv]`;

const APPS = [
  { id: "youtube_tv", packages: { firetv: ["com.amazon.firetv.youtube.tv"], googletv: ["com.google.android.youtube.tvunplugged"] } },
  { id: "espn", packages: { firetv: ["com.espn.gtv"], googletv: ["com.espn.score_center"] } },
  { id: "netflix", packages: { firetv: ["com.netflix.ninja"], googletv: ["com.netflix.ninja"] } },
];

describe("tv commands", () => {
  it("validates hosts, ports and pairing codes", () => {
    expect(connectArgs("192.168.1.40", 5555)).toEqual(["connect", "192.168.1.40:5555"]);
    expect(pairArgs("192.168.1.40", 37123, "123456")).toEqual(["pair", "192.168.1.40:37123", "123456"]);
    expect(() => serialOf("192.168.1.400", 5555)).toThrow();
    expect(() => serialOf("-oProxy", 5555)).toThrow();
    expect(() => serialOf("tv; rm -rf /", 5555)).toThrow();
    expect(() => serialOf("tv.lan", 0)).toThrow();
    expect(() => pairArgs("tv.lan", 4000, "12345")).toThrow();
    expect(() => pairArgs("tv.lan", 4000, "12345a")).toThrow();
  });

  it("parses adb pair and connect output", () => {
    expect(parsePairOutput("Successfully paired to 192.168.1.40:37123 [guid=adb-1A2B-xyz]")).toEqual({ ok: true, guid: "adb-1A2B-xyz" });
    expect(parsePairOutput("Failed: Wrong password or connection was dropped.")).toEqual({ ok: false, error: "wrong_code" });
    expect(parsePairOutput("error: unable to connect to 192.168.1.40:1")).toEqual({ ok: false, error: "unreachable" });
    expect(parseConnectOutput("connected to 192.168.1.40:5555")).toBe("connected");
    expect(parseConnectOutput("already connected to 192.168.1.40:5555")).toBe("connected");
    expect(parseConnectOutput("failed to authenticate to 192.168.1.40:5555")).toBe("unauthorized");
    expect(parseConnectOutput("cannot connect to 192.168.1.40:5555: Connection refused (111)")).toBe("refused");
    expect(parseConnectOutput("failed to connect to '192.168.1.40:5555': Connection timed out")).toBe("unreachable");
  });
});

describe("detect", () => {
  it("tells Fire TV from Google TV and names the model", () => {
    const fire = deviceProps(parseGetprop(FIRE_PROPS));
    expect(detectPlatform(fire, new Set())).toBe("firetv");
    expect(friendlyModel(fire)).toBe("Fire TV Stick 4K Max");
    expect(fire.sdk).toBe(30);
    const gtv = deviceProps(parseGetprop(CCGTV_PROPS));
    expect(detectPlatform(gtv, new Set(["com.google.android.apps.tv.launcherx"]))).toBe("googletv");
    expect(friendlyModel(gtv)).toBe("Chromecast with Google TV");
    const phone = deviceProps(parseGetprop("[ro.product.manufacturer]: [samsung]\n[ro.build.characteristics]: [phone]"));
    expect(detectPlatform(phone, new Set(["com.android.launcher3"]))).toBeNull();
  });

  it("matches installed packages to catalog apps per platform", () => {
    const pk = parsePackages("package:com.google.android.youtube.tvunplugged\npackage:com.netflix.ninja\npackage:com.espn.gtv\njunk line\n");
    expect(installedApps(APPS, "googletv", pk)).toEqual([
      { id: "youtube_tv", package: "com.google.android.youtube.tvunplugged" },
      { id: "netflix", package: "com.netflix.ninja" },
    ]);
    expect(installedApps(APPS, "firetv", pk).map((a) => a.id)).toEqual(["espn", "netflix"]);
  });
});

describe("discovery", () => {
  it("parses adb mdns services", () => {
    const out = `List of discovered mdns services
adb-1A2B3C-xYz\t_adb-tls-connect._tcp\t192.168.1.40:37123
adb-1A2B3C-xYz\t_adb-tls-pairing._tcp.\t192.168.1.40:41001
adb-1A2B3C-xYz\t_adb-tls-connect._tcp\t192.168.1.40:37123
foo bar`;
    expect(parseMdnsServices(out)).toEqual([
      { name: "adb-1A2B3C-xYz", type: "connect", host: "192.168.1.40", port: 37123 },
      { name: "adb-1A2B3C-xYz", type: "pairing", host: "192.168.1.40", port: 41001 },
    ]);
  });

  it("scans only private LAN interfaces, never docker or tailscale ones", () => {
    const iface = (address: string) => [{ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "", cidr: null }];
    expect(lanPrefixes({
      eth0: iface("192.168.1.11"), docker0: iface("172.17.0.1"), tailscale0: iface("100.100.1.1"), wlan0: iface("8.8.8.8"), "br-abc": iface("172.18.0.1"),
    } as never)).toEqual(["192.168.1"]);
  });

  it("reads Google TV wireless-debugging services out of raw mDNS answers", () => {
    const svc = servicesFromAnswers([
      { name: "_adb-tls-connect._tcp.local", type: "PTR", data: "adb-1A2B-x._adb-tls-connect._tcp.local" },
      { name: "adb-1A2B-x._adb-tls-connect._tcp.local", type: "SRV", data: { target: "Android-3.local", port: 37123 } },
      { name: "Android-3.local", type: "A", data: "192.168.1.40" },
      { name: "_adb-tls-pairing._tcp.local", type: "PTR", data: "adb-1A2B-x._adb-tls-pairing._tcp.local" }, // no SRV: skipped
      { name: "_googlecast._tcp.local", type: "PTR", data: "Chromecast._googlecast._tcp.local" },
    ]);
    expect(svc).toEqual([{ name: "adb-1A2B-x", type: "connect", host: "192.168.1.40", port: 37123 }]);
  });

  it("finds hosts with ADB open", async () => {
    const open = new Set(["10.0.0.30", "10.0.0.7"]);
    const found = await scanForAdb(["10.0.0"], { probe: async (h) => open.has(h), concurrency: 16 });
    expect(found).toEqual(["10.0.0.7", "10.0.0.30"]);
  });
});

// A tiny scripted adb: each call is matched by its first args.
function fakeAdb(handler: (args: string[]) => string, calls: string[][] = []): AdbExec {
  return async (args) => {
    calls.push(args);
    return { stdout: handler(args), stderr: "", code: 0 };
  };
}

describe("pairing flows", () => {
  it("Fire TV: unauthorized until the prompt is accepted", async () => {
    let approved = false;
    let polls = 0;
    const exec = fakeAdb((a) => {
      if (a[0] === "connect") return "connected to 192.168.1.40:5555";
      if (a[0] === "devices") {
        if (++polls >= 3) approved = true;
        return `List of devices attached\n192.168.1.40:5555\t${approved ? "device product:x model:AFTKA" : "unauthorized"}\n`;
      }
      return "";
    });
    expect(await connectTv(exec, "192.168.1.40", 5555)).toBe("unauthorized");
    let t = 0;
    const s = await waitForApproval(exec, "192.168.1.40", 5555, { sleep: async () => void (t += 2000), now: () => t, every: 2000 });
    expect(s).toBe("connected");
  });

  it("Google TV: pair with the code, find the connect port over mDNS, connect, identify", async () => {
    const calls: string[][] = [];
    const exec = fakeAdb((a) => {
      if (a[0] === "pair") return a[2] === "246810" ? "Successfully paired to 192.168.1.40:41001 [guid=adb-X]" : "Failed: Wrong password";
      if (a[0] === "mdns") return "adb-X\t_adb-tls-connect._tcp\t192.168.1.40:37123\n";
      if (a[0] === "connect") return "connected to 192.168.1.40:37123";
      if (a[0] === "devices") return "192.168.1.40:37123\tdevice\n";
      if (a.includes("getprop")) return CCGTV_PROPS;
      if (a.includes("pm")) return "package:com.google.android.apps.tv.launcherx\npackage:com.google.android.youtube.tvunplugged\n";
      return "";
    }, calls);
    expect(await pairTv(exec, "192.168.1.40", 41001, "111111")).toEqual({ ok: false, error: "wrong_code" });
    expect(await pairTv(exec, "192.168.1.40", 41001, "246810")).toMatchObject({ ok: true });
    const port = await findConnectPort(exec, "192.168.1.40", async () => []);
    expect(port).toBe(37123);
    expect(await connectTv(exec, "192.168.1.40", port!)).toBe("connected");
    const id = await identifyTv(exec, "192.168.1.40", port!, APPS);
    expect(id).toMatchObject({ platform: "googletv", name: "Chromecast with Google TV", packagesRead: true, apps: [{ id: "youtube_tv", package: "com.google.android.youtube.tvunplugged" }] });
    // Nothing but allowlisted shapes went to adb.
    for (const c of calls) expect(["pair", "mdns", "connect", "devices", "-s"]).toContain(c[0]);
  });

  it("an unreadable package list means 'unknown', not 'nothing installed'", async () => {
    const exec = fakeAdb((a) => (a.includes("getprop") ? CCGTV_PROPS : ""), []);
    expect(await identifyTv(exec, "192.168.1.40", 5555, APPS)).toMatchObject({ packagesRead: false, apps: [] });
  });

  it("reports an adb too old to pair", async () => {
    const exec: AdbExec = async () => ({ stdout: "", stderr: "adb: unknown command pair\nUsage: adb [options]", code: 1 });
    expect(await pairTv(exec, "192.168.1.40", 41001, "246810")).toEqual({ ok: false, error: "adb_too_old" });
  });
});

describe("Google TV port changes", () => {
  it("an offline Google TV found on a new port over mDNS gets the new port", async () => {
    const { TvManager } = await import("../server/tv/manager");
    const changes: [string, number][] = [];
    const exec: AdbExec = async (a) => ({ stdout: a[0] === "devices" ? "List of devices attached\n" : "", stderr: "", code: 0 });
    const m = new TvManager({
      exec, shared: {}, onPortChange: (id, port) => changes.push([id, port]),
      browse: async () => [{ name: "adb-X", type: "connect", host: "192.168.1.40", port: 40999 }],
    });
    m.sync([{ id: "den", name: "Den", host: "192.168.1.40", port: 37123, platform: "googletv", apps: [], appsCheckedAt: null }]);
    await Promise.all([m.watchdog(), m.watchdog()]); // overlapping calls share one check
    expect(changes).toEqual([["den", 40999]]);
    await m.watchdog(); // looked less than a minute ago: no second browse
    expect(changes).toHaveLength(1);
    m.close();
  });
});
