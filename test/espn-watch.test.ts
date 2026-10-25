import { describe, expect, it } from "vitest";
import { EspnWatch, pickAiring, type WatchAiring } from "../server/espnWatch";
import { FireTvAdbDriver } from "../server/driver";
import { APP_BY_ID } from "../lib/catalog/apps";
import { buildUri, type AdbExec } from "../server/adb";
import type { Game } from "../lib/types";

// Airings copied from ESPN's Watch API for Monday Night Football and an ESPN+ NHL game
// (2026-10-12), trimmed to the fields we read.
const MNF = "401872994";
const NHL = "401892487";
const AIRINGS: WatchAiring[] = [
  { id: "0a30f679-31ac-405a-b5df-2db82b1282b3", name: "MNF Playbook", type: "LIVE", language: "en", isReAir: false, network: { shortName: "NFL Network" }, competition: { id: MNF } },
  { id: "f2376d04-5fa4-4acc-a071-2abc1502c5e7", name: "MNF with Peyton and Eli", type: "LIVE", language: "en", isReAir: false, network: { shortName: "ESPN2" }, competition: { id: MNF } },
  { id: "39d27f25-d6ca-4f5b-9542-11d5bb77ef1b", name: "Buffalo Bills vs. Los Angeles Rams", type: "LIVE", language: "en", isReAir: false, network: { shortName: "ESPN" }, competition: { id: MNF } },
  { id: "1af49893-4986-47fb-a6da-f4c9d33ab21f", name: "En Español", type: "LIVE", language: "es", isReAir: false, network: { shortName: "ESPN Deportes" }, competition: { id: MNF } },
  { id: "79a2d260-a106-4b66-9457-ce2e8c60a3b2", feedName: "Wild Broadcast", type: "LIVE", language: "en", isReAir: false, network: { shortName: "ESPN+" }, competition: { id: NHL } },
  { id: "51dc9e37-8cd9-4361-9dbe-f46dd1daf738", feedName: "Golden Knights Broadcast", type: "LIVE", language: "en", isReAir: false, network: { shortName: "ESPN+" }, competition: { id: NHL } },
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Replay", type: "OVER", language: "en", isReAir: true, network: { shortName: "ESPN" }, competition: { id: MNF } },
];

const team = (name: string, city: string) => ({ id: "1", abbr: name.slice(0, 3).toUpperCase(), name, city, displayName: `${city} ${name}` });
const mnf = {
  id: `nfl:${MNF}`, league: "nfl", startTime: "2026-10-13T00:15:00Z", state: "in", detail: "Q3",
  home: team("Rams", "Los Angeles"), away: team("Bills", "Buffalo"), broadcasts: [],
} as Game;

describe("pickAiring", () => {
  it("takes the airing on the wanted network", () => {
    expect(pickAiring(AIRINGS, MNF, "espn")).toBe("39d27f25-d6ca-4f5b-9542-11d5bb77ef1b");
    expect(pickAiring(AIRINGS, MNF, "espn2")).toBe("f2376d04-5fa4-4acc-a071-2abc1502c5e7");
  });
  it("an ABC simulcast of an ESPN game uses the ESPN airing", () => {
    expect(pickAiring(AIRINGS, MNF, "abc")).toBe("39d27f25-d6ca-4f5b-9542-11d5bb77ef1b");
  });
  it("never picks a Spanish feed, a replay or another game's airing", () => {
    expect(pickAiring(AIRINGS, MNF, "espnu")).not.toBe("1af49893-4986-47fb-a6da-f4c9d33ab21f");
    expect(pickAiring(AIRINGS, MNF, "espnu")).not.toBe("aaaaaaaa-0000-4000-8000-000000000001");
    expect(pickAiring(AIRINGS, "999", "espn")).toBeNull();
  });
  it("an NFL Network game picks the NFL Network airing (it's in ESPN's package now)", () => {
    expect(pickAiring(AIRINGS, MNF, "nflnet")).toBe("0a30f679-31ac-405a-b5df-2db82b1282b3");
  });
  it("ESPN+ games with several feeds take the first live one", () => {
    expect(pickAiring(AIRINGS, NHL, "espn_plus")).toBe("79a2d260-a106-4b66-9457-ce2e8c60a3b2");
  });
  it("ignores airings that aren't live or whose id isn't a uuid", () => {
    const bad: WatchAiring[] = [
      { id: "not-a-uuid", type: "LIVE", competition: { id: "1" } },
      { id: "39d27f25-d6ca-4f5b-9542-11d5bb77ef1b", type: "UPCOMING", competition: { id: "1" } },
    ];
    expect(pickAiring(bad, "1", "espn")).toBeNull();
  });
});

describe("EspnWatch", () => {
  const fakeFetch = (airings: unknown, status = 200) => {
    const calls: { url: string; body: any }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ data: { airings } }), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("asks for the game's Eastern day and caches it", async () => {
    const { f, calls } = fakeFetch(AIRINGS);
    const w = new EspnWatch("k", f);
    expect(await w.airingIdFor(mnf, "espn")).toBe("39d27f25-d6ca-4f5b-9542-11d5bb77ef1b");
    await w.airingIdFor(mnf, "espn2");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.variables).toMatchObject({ day: "2026-10-12", countryCode: "US", deviceType: "DESKTOP" });
    expect(calls[0].url).toContain("apiKey=k");
  });

  it("throws on an HTTP error so the driver can fall back", async () => {
    await expect(new EspnWatch("k", fakeFetch([], 500).f).airingIdFor(mnf, "espn")).rejects.toThrow("500");
  });
});

describe("ESPN route through the driver", () => {
  const route = APP_BY_ID.get("espn")!.routes[0];

  it("the template builds the link the ESPN TV app accepts", () => {
    expect(buildUri(route, { airingId: "39d27f25-d6ca-4f5b-9542-11d5bb77ef1b" })).toBe(
      "sportscenter://x-callback-url/showWatchStream?playID=39d27f25-d6ca-4f5b-9542-11d5bb77ef1b",
    );
    expect(() => buildUri(route, { airingId: "x; reboot" })).toThrow();
  });

  const launch = async (espn: { airingIdFor: () => Promise<string | null> } | null) => {
    const calls: string[][] = [];
    const exec: AdbExec = async (args) => {
      calls.push(args);
      const sh = args.slice(3);
      const out = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (args[0] === "connect") return out("connected");
      if (args[0] === "devices") return out("List of devices attached\n10.0.0.5:5555\tdevice\n");
      if (sh[0] === "dumpsys" && sh[2] === "activities") return out("  topResumedActivity=ActivityRecord{1 u0 com.espn.gtv/.Main t1}");
      if (sh[0] === "dumpsys") return out("mWakefulness=Awake");
      if (sh[0] === "am") return out("Status: ok");
      return out("");
    };
    let t = 0;
    const d = new FireTvAdbDriver({ serial: "10.0.0.5:5555", exec, apps: () => APP_BY_ID, espn: espn as never, sleep: async (ms) => void (t += ms), now: () => t, verifyTimeoutMs: 2000 });
    const r = await d.launch({
      requestId: "7a1d2c3e-0000-4000-8000-000000000001",
      game: mnf,
      route: { service: "espn", network: "espn", level: "game", reason: "test", certain: true },
    });
    return { r, calls };
  };

  it("sends the airing link to the ESPN package", async () => {
    const { r, calls } = await launch({ airingIdFor: async () => "39d27f25-d6ca-4f5b-9542-11d5bb77ef1b" });
    expect(r).toMatchObject({ ok: true, level: "game", outcome: "game" });
    const sent = calls.find((c) => c.join(" ").includes("showWatchStream"))!.join(" ");
    expect(sent).toContain("'sportscenter://x-callback-url/showWatchStream?playID=39d27f25-d6ca-4f5b-9542-11d5bb77ef1b' 'com.espn.gtv'");
  });

  it("falls back to the app when ESPN has no airing or isn't configured", async () => {
    for (const espn of [null, { airingIdFor: async () => null }, { airingIdFor: async () => { throw new Error("down"); } }]) {
      const { r, calls } = await launch(espn);
      expect(r.level).toBe("app");
      expect(calls.some((c) => c.join(" ").includes("showWatchStream"))).toBe(false);
    }
  });
});
