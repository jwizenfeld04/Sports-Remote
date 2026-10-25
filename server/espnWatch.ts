import type { Game, NetworkId } from "../lib/types";

// Map an ESPN game to the airing id that the ESPN app's player link takes:
//   sportscenter://x-callback-url/showWatchStream?playID=<airing id>
// ESPN's Watch service lists a day's airings, each tagged with the scoreboard game id in
// `competition.id`. The API is unofficial (the same one the community Channels DVR projects use),
// and it needs ESPN's client key, which is configured, not built in. Any failure returns null and
// the driver falls back to opening the app with on-screen steps.

type Fetch = typeof fetch;

const ENDPOINT = "https://watch.graph.api.espn.com/api";

const QUERY = `query Airings($countryCode: String!, $deviceType: DeviceType!, $tz: String!, $day: String!, $limit: Int) {
  airings(countryCode: $countryCode, deviceType: $deviceType, tz: $tz, day: $day, limit: $limit) {
    id name type startDateTime feedName language isReAir
    network { shortName }
    competition { id }
  }
}`;

export interface WatchAiring {
  id: string;
  name?: string;
  type?: string; // LIVE, REPLAY, ...
  startDateTime?: string;
  feedName?: string | null;
  language?: string | null;
  isReAir?: boolean;
  network?: { shortName?: string | null } | null;
  competition?: { id?: string | null } | null;
}

// Which airing networks to prefer for each of our network ids, best first.
const WANTED: Partial<Record<NetworkId, string[]>> = {
  espn: ["ESPN"],
  espn2: ["ESPN2"],
  espnu: ["ESPNU"],
  espnews: ["ESPNEWS"],
  secn: ["SEC Network"],
  accn: ["ACC Network"],
  espn_plus: ["ESPN+"],
  nflnet: ["NFL Network"],
  abc: ["ABC", "ESPN"], // ABC simulcasts of ESPN games show up under ESPN
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isEnglish = (a: WatchAiring) => !a.language || /^en/i.test(a.language);

/** Best live airing of a game for a network: that network's, else any other English live one. */
export function pickAiring(airings: WatchAiring[], eventId: string, network: NetworkId): string | null {
  const live = airings.filter(
    (a) => String(a.competition?.id ?? "") === eventId && a.type === "LIVE" && !a.isReAir && UUID_RE.test(a.id ?? ""),
  );
  const english = live.filter(isEnglish);
  for (const name of WANTED[network] ?? []) {
    const hit = english.find((a) => a.network?.shortName === name);
    if (hit) return hit.id;
  }
  return english[0]?.id ?? null;
}

export const etDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export class EspnWatch {
  private cache = new Map<string, { at: number; airings: WatchAiring[] }>();
  constructor(private apiKey: string, private fetchImpl: Fetch = fetch, private now = () => Date.now()) {}

  private async airingsOn(day: string): Promise<WatchAiring[]> {
    const hit = this.cache.get(day);
    if (hit && this.now() - hit.at < 5 * 60_000) return hit.airings;
    const res = await this.fetchImpl(`${ENDPOINT}?apiKey=${encodeURIComponent(this.apiKey)}&features=pbov7`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://www.espn.com", Referer: "https://www.espn.com/" },
      body: JSON.stringify({
        query: QUERY,
        operationName: "Airings",
        variables: { countryCode: "US", deviceType: "DESKTOP", tz: "America/New_York", day, limit: 2000 },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`ESPN watch API ${res.status}`);
    const body: any = await res.json();
    const airings: WatchAiring[] = Array.isArray(body?.data?.airings) ? body.data.airings : [];
    this.cache.set(day, { at: this.now(), airings });
    return airings;
  }

  /** The airing uuid for a game on a network, or null when ESPN has no live airing for it. */
  async airingIdFor(game: Game, network: NetworkId): Promise<string | null> {
    const eventId = game.id.split(":")[1];
    if (!eventId) return null;
    return pickAiring(await this.airingsOn(etDay(game.startTime)), eventId, network);
  }
}
