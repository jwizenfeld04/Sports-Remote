import type { GuideEntry, LocalGuide, NetworkId } from "../lib/types";

// Talks to the Plex Media Server on this machine with a fixed set of calls: list the providers,
// list Live TV channels, read the guide grid, and ask a player to play a channel (Companion,
// proxied by the server to the Fire TV's Plex app). The token is sent only in a header and is
// never put in URLs, logs or error messages.

export interface PlexConfig {
  url: string; // e.g. http://127.0.0.1:32400
  token: string;
  playerId?: string; // the TV Plex app's client identifier, if it advertises as a player
  channelMap?: Partial<Record<"abc" | "cbs" | "fox" | "nbc", string>>; // network -> call sign, from setup
}

export interface Program {
  show: string;
  episode?: string;
}

export interface PlexChannel {
  key: string; // what playMedia needs
  identifier: string;
  callSign: string;
  name: string; // "WCBS 2.1"
  number: string;
  network: NetworkId | null;
}

// Which local station is which network. Three sources, in order:
//  1. the household's own mapping (setup: "which channel is your CBS?"),
//  2. well-known call signs (network-owned stations in the biggest markets),
//  3. the guide itself: shows that only one network airs (CBS Evening News, The Simpsons ...).
type Local = "abc" | "cbs" | "fox" | "nbc";
const OWNED: Record<Local, string[]> = {
  cbs: ["WCBS", "KCBS", "WBBM", "KYW", "WBZ", "KPIX", "KTVT", "WJZ", "WCCO", "KCNC", "KDKA", "WFOR", "KOVR", "WWJ"],
  nbc: ["WNBC", "KNBC", "WMAQ", "WCAU", "WBTS", "KNTV", "KXAS", "WRC", "WTVJ", "KNSD", "WVIT"],
  abc: ["WABC", "KABC", "WLS", "WPVI", "KGO", "KTRK", "WTVD", "KFSN"],
  fox: ["WNYW", "KTTV", "WFLD", "WTXF", "WFXT", "KTVU", "KDFW", "WTTG", "KRIV", "WAGA", "WJBK", "KMSP", "KSAZ", "WTVT", "WOFL", "KCPQ"],
};

export function networkForCallSign(callSign: string, map: Partial<Record<Local, string>> = {}): NetworkId | null {
  const c = callSign.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const [net, sign] of Object.entries(map)) if (sign && c.startsWith(sign.toUpperCase().replace(/[^A-Z0-9]/g, ""))) return net as Local;
  for (const [net, signs] of Object.entries(OWNED) as [Local, string[]][]) if (signs.some((x) => c === x || c.startsWith(x + "DT") || c.startsWith(x + "TV") || c === x + "HD")) return net;
  return null;
}

// Shows only one network airs nationally. Matched against guide titles (case-insensitive, whole words).
const FINGERPRINTS: Record<Local, RegExp> = {
  cbs: /\b(cbs evening news|cbs mornings|cbs saturday morning|face the nation|60 minutes|the nfl today|the price is right|the young and the restless|the bold and the beautiful)\b/i,
  nbc: /\b(nbc nightly news|meet the press|football night in america|the tonight show|late night with seth meyers|today with jenna)\b/i,
  abc: /\b(world news tonight|good morning america|gma3|general hospital|jimmy kimmel live|this week with george stephanopoulos|the view)\b/i,
  fox: /\b(fox nfl sunday|fox news sunday|the simpsons|family guy|bob's burgers|fox nfl kickoff)\b/i,
};

/** Guess each channel's network from a day of guide titles: the network whose shows it airs most (2+ hits). */
export function inferNetworks(items: { channel: string; title: string }[]): Map<string, Local> {
  const score = new Map<string, Record<Local, number>>();
  for (const it of items) {
    for (const [net, re] of Object.entries(FINGERPRINTS) as [Local, RegExp][]) {
      if (!re.test(it.title)) continue;
      const s = score.get(it.channel) ?? { abc: 0, cbs: 0, fox: 0, nbc: 0 };
      s[net]++;
      score.set(it.channel, s);
    }
  }
  const out = new Map<string, Local>();
  for (const [ch, s] of score) {
    const [best, n] = (Object.entries(s) as [Local, number][]).sort((a, b) => b[1] - a[1])[0];
    if (n >= 2) out.set(ch, best);
  }
  // One station per network: keep the channel with the most hits.
  const byNet = new Map<Local, string>();
  for (const [ch, net] of out) {
    const prev = byNet.get(net);
    if (!prev || score.get(ch)![net] > score.get(prev)![net]) byNet.set(net, ch);
  }
  return new Map([...byNet].map(([net, ch]) => [ch, net]));
}

type Fetch = typeof fetch;

export class PlexError extends Error {}

export class PlexClient {
  private provider: string | null = null;
  private channelCache: { at: number; channels: PlexChannel[] } | null = null;
  private guideCache: { at: number; guide: LocalGuide } | null = null;

  constructor(private cfg: PlexConfig, private fetchImpl: Fetch = fetch, private now = () => Date.now()) {
    if (!/^https?:\/\/[A-Za-z0-9.\-:[\]]+$/.test(cfg.url.replace(/\/$/, ""))) throw new PlexError("PLEX_URL must be scheme://host:port");
  }

  private async get(path: string, headers: Record<string, string> = {}): Promise<any> {
    const url = this.cfg.url.replace(/\/$/, "") + path;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "X-Plex-Token": this.cfg.token,
          "X-Plex-Client-Identifier": "sports-remote",
          "X-Plex-Product": "Sports Remote",
          ...headers,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      throw new PlexError(`Plex request failed: ${path.split("?")[0]}`);
    }
    if (!res.ok) throw new PlexError(res.status === 401 ? "Plex refused the token" : "That address didn't answer like a Plex server");
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new PlexError("That address didn't answer like a Plex server");
    }
  }

  /** The EPG provider path, e.g. "/tv.plex.providers.epg.cloud:2". */
  async epgProvider(): Promise<string> {
    if (this.provider) return this.provider;
    const body = await this.get("/media/providers");
    const providers: any[] = body?.MediaContainer?.MediaProvider ?? [];
    const epg = providers.find((p) => String(p.identifier ?? "").startsWith("tv.plex.providers.epg"));
    if (!epg) throw new PlexError("No Live TV guide provider found in Plex");
    const id = String(epg.identifier);
    if (!/^tv\.plex\.providers\.epg\.[a-z]+:\d+$/.test(id)) throw new PlexError("Unexpected provider id");
    this.provider = `/${id}`;
    return this.provider;
  }

  async channels(): Promise<PlexChannel[]> {
    if (this.channelCache && this.now() - this.channelCache.at < 3600_000) return this.channelCache.channels;
    const p = await this.epgProvider();
    const body = await this.get(`${p}/lineups/dvr/channels`);
    const raw: any[] = body?.MediaContainer?.Channel ?? [];
    const channels = raw.map((c): PlexChannel => {
      const callSign = String(c.callSign ?? c.title ?? "");
      const number = String(c.channelVcn ?? c.vcn ?? "");
      return {
        key: String(c.key ?? c.identifier ?? ""),
        identifier: String(c.identifier ?? ""),
        callSign,
        name: [callSign, number].filter(Boolean).join(" "),
        number,
        network: networkForCallSign(callSign, this.cfg.channelMap),
      };
    });
    // Stations we couldn't place: look at a day of the guide.
    if (channels.some((c) => !c.network) && Object.values(this.cfg.channelMap ?? {}).filter(Boolean).length < 4) {
      try {
        const t = Math.floor(this.now() / 1000);
        const body = await this.get(`${p}/grid?type=1,4&beginsAt<=${t + 24 * 3600}&endsAt>=${t}`);
        const items: { channel: string; title: string }[] = [];
        for (const it of body?.MediaContainer?.Metadata ?? []) {
          for (const m of it.Media ?? []) items.push({ channel: String(m.channelIdentifier ?? m.channelCallSign ?? ""), title: [it.grandparentTitle, it.title].filter(Boolean).join(" ") });
        }
        const guessed = inferNetworks(items);
        const taken = new Set(channels.map((c) => c.network).filter(Boolean));
        for (const c of channels) {
          const g = guessed.get(c.identifier) ?? guessed.get(c.callSign);
          if (!c.network && g && !taken.has(g)) (c.network = g), taken.add(g);
        }
      } catch {
        /* the guide is optional here */
      }
    }
    this.channelCache = { at: this.now(), channels };
    return channels;
  }

  /** What's on the local network stations from now until a few hours out. Cached 5 minutes. */
  async localGuide(hours = 6): Promise<LocalGuide> {
    if (this.guideCache && this.now() - this.guideCache.at < 300_000) return this.guideCache.guide;
    const t = Math.floor(this.now() / 1000);
    const entries = await this.guideEntries(t, t + hours * 3600);
    const guide = { entries, fetchedAt: new Date(this.now()).toISOString() };
    this.guideCache = { at: this.now(), guide };
    return guide;
  }

  /** Guide entries for the local network stations that overlap [fromSec, toSec]. */
  private async guideEntries(fromSec: number, toSec: number): Promise<GuideEntry[]> {
    const p = await this.epgProvider();
    const channels = await this.channels();
    const byId = new Map(channels.map((c) => [c.identifier, c]));
    const byCall = new Map(channels.map((c) => [c.callSign.toUpperCase(), c]));
    const body = await this.get(`${p}/grid?type=1,4&beginsAt<=${toSec}&endsAt>=${fromSec}`);
    const items: any[] = body?.MediaContainer?.Metadata ?? [];
    const entries: GuideEntry[] = [];
    for (const it of items) {
      for (const m of it.Media ?? []) {
        const ch = byId.get(String(m.channelIdentifier ?? "")) ?? byCall.get(String(m.channelCallSign ?? "").toUpperCase());
        const network = ch?.network ?? networkForCallSign(String(m.channelCallSign ?? ""), this.cfg.channelMap);
        if (!network) continue;
        entries.push({
          network,
          channelKey: ch?.key ?? String(m.channelIdentifier ?? ""),
          channelName: ch?.name ?? String(m.channelCallSign ?? ""),
          title: [it.grandparentTitle, it.parentTitle, it.title, it.summary].filter(Boolean).join(" | "),
          show: String(it.grandparentTitle ?? it.title ?? "") || undefined,
          episode: it.grandparentTitle && it.title ? String(it.title) : undefined,
          start: new Date(Number(m.beginsAt ?? it.beginsAt) * 1000).toISOString(),
          end: new Date(Number(m.endsAt ?? it.endsAt) * 1000).toISOString(),
        });
      }
    }
    return entries;
  }

  /** The Live TV DVR's key, used in the app's guide link (plex://live-tv/dvr.guide/ota/<key>). */
  async dvrKey(): Promise<string | null> {
    const body = await this.get("/livetv/dvrs");
    const key = String(body?.MediaContainer?.Dvr?.[0]?.key ?? "");
    return /^[0-9]{1,4}$/.test(key) ? key : null;
  }

  /**
   * The program before, the one on now, and the one after on a network's main channel. The TV's guide can lag the
   * clock by a few minutes (its grid is cached), so the cursor may sit on a neighbour of "now".
   */
  async around(network: NetworkId): Promise<{ prev?: Program; now: Program; next?: Program } | null> {
    const ch = await this.channelFor(network);
    if (!ch) return null;
    const t = this.now();
    const sec = Math.floor(t / 1000);
    const mine = (await this.guideEntries(sec - 2 * 3600, sec + 3 * 3600))
      .filter((x) => x.channelName === ch.name && x.show)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const i = mine.findIndex((x) => Date.parse(x.start) <= t && t < Date.parse(x.end));
    if (i < 0) return null;
    const prog = (e?: GuideEntry): Program | undefined => (e ? { show: e.show!, episode: e.episode } : undefined);
    return { prev: prog(mine[i - 1]), now: prog(mine[i])!, next: prog(mine[i + 1]) };
  }

  async channelFor(network: NetworkId): Promise<PlexChannel | null> {
    return (await this.channels()).find((c) => c.network === network) ?? null;
  }

  /** Server identity, needed by playMedia. */
  async machineIdentifier(): Promise<string> {
    const body = await this.get("/identity");
    const id = String(body?.MediaContainer?.machineIdentifier ?? "");
    if (!/^[a-f0-9]{20,64}$/i.test(id)) throw new PlexError("Unexpected Plex identity");
    return id;
  }

  /**
   * Ask the Fire TV's Plex app to play a Live TV channel. The server proxies the Companion command
   * to the player named by X-Plex-Target-Client-Identifier. `channelKey` must be one of our channels.
   */
  async playChannel(channelKey: string): Promise<void> {
    if (!this.cfg.playerId) throw new PlexError("PLEX_PLAYER_ID is not set");
    const ch = (await this.channels()).find((c) => c.key === channelKey);
    if (!ch) throw new PlexError("Unknown channel");
    const server = await this.machineIdentifier();
    const u = new URL(this.cfg.url);
    const q = new URLSearchParams({
      key: ch.key,
      machineIdentifier: server,
      address: u.hostname,
      port: u.port || "32400",
      protocol: u.protocol.replace(":", ""),
      offset: "0",
      commandID: String(Math.floor(this.now() / 1000)),
    });
    await this.get(`/player/playback/playMedia?${q}`, { "X-Plex-Target-Client-Identifier": this.cfg.playerId });
  }

  /** Clients the server can see (to find PLEX_PLAYER_ID during setup). */
  async players(): Promise<{ name: string; id: string; product: string }[]> {
    const body = await this.get("/clients");
    return (body?.MediaContainer?.Server ?? []).map((s: any) => ({
      name: String(s.name ?? ""), id: String(s.machineIdentifier ?? ""), product: String(s.product ?? ""),
    }));
  }
}
