import { describe, expect, it } from "vitest";
import { PlexClient, networkForCallSign } from "../server/plex";
import { matchGamePk, MlbSchedule, type MlbScheduleGame } from "../server/mlb";
import { game } from "./helpers";

const TOKEN = "SECRET-PLEX-TOKEN-xyz";

/** Fake Plex Media Server: answers the handful of endpoints PlexClient uses. */
function fakePlex(over: Partial<Record<string, unknown>> = {}) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const t = Math.floor(Date.parse("2026-10-18T16:30:00Z") / 1000);
  const routes: Record<string, unknown> = {
    "/media/providers": { MediaContainer: { MediaProvider: [{ identifier: "com.plexapp.plugins.library" }, { identifier: "tv.plex.providers.epg.cloud:2" }] } },
    "/tv.plex.providers.epg.cloud:2/lineups/dvr/channels": {
      MediaContainer: {
        Channel: [
          { key: "/livetv/channels/wcbs", identifier: "002", callSign: "WCBS-DT", channelVcn: "2.1" },
          { key: "/livetv/channels/wnyw", identifier: "005", callSign: "WNYW", channelVcn: "5.1" },
          { key: "/livetv/channels/wnet", identifier: "013", callSign: "WNET", channelVcn: "13.1" },
        ],
      },
    },
    "/tv.plex.providers.epg.cloud:2/grid": {
      MediaContainer: {
        Metadata: [
          { grandparentTitle: "NFL Football", title: "Los Angeles Chargers at Kansas City Chiefs", Media: [{ channelIdentifier: "002", channelCallSign: "WCBS-DT", beginsAt: t + 1800, endsAt: t + 1800 + 3 * 3600 }] },
          { title: "Nature", Media: [{ channelIdentifier: "013", beginsAt: t, endsAt: t + 3600 }] },
        ],
      },
    },
    "/identity": { MediaContainer: { machineIdentifier: "abcdef0123456789abcdef0123456789" } },
    "/player/playback/playMedia": {},
    "/clients": { MediaContainer: { Server: [{ name: "Fire TV", machineIdentifier: "firetv-123", product: "Plex for Android (TV)" }] } },
    ...over,
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    requests.push({ url, headers: init?.headers as Record<string, string> });
    const body = routes[u.pathname];
    if (body === undefined) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests, now: () => t * 1000 };
}

describe("PlexClient", () => {
  it("maps NY call signs to networks", () => {
    expect(networkForCallSign("WCBS-DT")).toBe("cbs");
    expect(networkForCallSign("wnyw")).toBe("fox");
    expect(networkForCallSign("KNBC")).toBe("nbc");
    expect(networkForCallSign("WPIX")).toBeNull(); // independent station, not a network
    expect(networkForCallSign("WNET")).toBeNull();
    // Affiliates aren't in the owned-station table: the household's channel map names them.
    expect(networkForCallSign("WXIX-DT", { fox: "WXIX" })).toBe("fox");
  });

  it("lists channels with names from Plex Live TV", async () => {
    const f = fakePlex();
    const plex = new PlexClient({ url: "http://127.0.0.1:32400", token: TOKEN }, f.fetchImpl, f.now);
    const ch = await plex.channels();
    expect(ch.map((c) => [c.name, c.network])).toEqual([["WCBS-DT 2.1", "cbs"], ["WNYW 5.1", "fox"], ["WNET 13.1", null]]);
  });

  it("reads the local guide for the NY network channels only", async () => {
    const f = fakePlex();
    const plex = new PlexClient({ url: "http://127.0.0.1:32400", token: TOKEN }, f.fetchImpl, f.now);
    const g = await plex.localGuide();
    expect(g.entries).toEqual([
      {
        network: "cbs", channelKey: "/livetv/channels/wcbs", channelName: "WCBS-DT 2.1",
        title: "NFL Football | Los Angeles Chargers at Kansas City Chiefs",
        show: "NFL Football", episode: "Los Angeles Chargers at Kansas City Chiefs",
        start: "2026-10-18T17:00:00.000Z", end: "2026-10-18T20:00:00.000Z",
      },
    ]);
    // Cached: a second call makes no new requests.
    const n = f.requests.length;
    await plex.localGuide();
    expect(f.requests.length).toBe(n);
  });

  it("plays a channel on the Fire TV through the server's Companion proxy", async () => {
    const f = fakePlex();
    const plex = new PlexClient({ url: "http://127.0.0.1:32400", token: TOKEN, playerId: "firetv-123" }, f.fetchImpl, f.now);
    await plex.playChannel("/livetv/channels/wcbs");
    const play = f.requests.find((r) => r.url.includes("/player/playback/playMedia"))!;
    const u = new URL(play.url);
    expect(u.searchParams.get("key")).toBe("/livetv/channels/wcbs");
    expect(u.searchParams.get("machineIdentifier")).toBe("abcdef0123456789abcdef0123456789");
    expect(play.headers["X-Plex-Target-Client-Identifier"]).toBe("firetv-123");
  });

  it("refuses to play a channel key it didn't list", async () => {
    const f = fakePlex();
    const plex = new PlexClient({ url: "http://127.0.0.1:32400", token: TOKEN, playerId: "firetv-123" }, f.fetchImpl, f.now);
    await expect(plex.playChannel("/library/metadata/1/delete")).rejects.toThrow("Unknown channel");
  });

  it("never puts the token in URLs or error messages", async () => {
    const f = fakePlex({ "/identity": undefined });
    const plex = new PlexClient({ url: "http://127.0.0.1:32400", token: TOKEN, playerId: "firetv-123" }, f.fetchImpl, f.now);
    const err = await plex.playChannel("/livetv/channels/wcbs").catch((e: Error) => e);
    expect(String(err)).not.toContain(TOKEN);
    for (const r of f.requests) {
      expect(r.url).not.toContain(TOKEN);
      expect(r.headers["X-Plex-Token"]).toBe(TOKEN);
    }
  });

  it("rejects a malformed PLEX_URL", () => {
    expect(() => new PlexClient({ url: "http://x/path?q=1", token: TOKEN })).toThrow();
  });
});

describe("MLB gamePk lookup", () => {
  const sched = (pk: number, date: string, home = "San Diego Padres", away = "Los Angeles Dodgers"): MlbScheduleGame => ({
    gamePk: pk, gameDate: date, teams: { home: { team: { name: home } }, away: { team: { name: away } } },
  });
  const g = game("mlb:501"); // Dodgers at Padres 2026-10-18T23:10Z

  it("matches on teams and start time", () => {
    expect(matchGamePk(g, [sched(1, "2026-10-18T23:10:00Z", "Atlanta Braves", "New York Mets"), sched(776543, "2026-10-18T23:10:00Z")])).toBe("776543");
  });
  it("picks the right half of a doubleheader", () => {
    expect(matchGamePk(g, [sched(11, "2026-10-18T17:10:00Z"), sched(22, "2026-10-18T23:05:00Z")])).toBe("22");
  });
  it("returns null when nothing matches", () => {
    expect(matchGamePk(g, [sched(1, "2026-10-18T23:10:00Z", "Atlanta Braves", "New York Mets")])).toBeNull();
    expect(matchGamePk(g, [sched(1, "2026-10-20T23:10:00Z")])).toBeNull();
  });
  it("fetches the Eastern-date schedule once per hour", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ dates: [{ games: [sched(776543, "2026-10-18T23:10:00Z")] }] }));
    }) as typeof fetch;
    const m = new MlbSchedule(fetchImpl, () => 0);
    expect(await m.gamePkFor(g)).toBe("776543");
    expect(await m.gamePkFor(g)).toBe("776543");
    expect(urls).toEqual(["https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-10-18"]);
    expect(await m.gamePkFor(game("nfl:401"))).toBeNull();
  });
});
