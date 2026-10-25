// YouTube TV (com.amazon.firetv.youtube.tv, a Cobalt web app) as the navigator sees it:
//
//   cold start: splash -> "Who's watching?" (optional) -> search results for the link's query
//   results:    focus starts on the search icon; DOWN walks rows ("Top picks", ..., "Upcoming Games", "On demand"),
//               the focused row scrolls to the top; on the games row RIGHT/LEFT move between cards
//   card:       a game card opens "<Away City> <Away> at <Home City> <Home>  Watch now  About"; a blocked card does
//               nothing; some cards start a video straight away
//   game page:  SELECT on the focused "Watch now" starts the game (marked "watch" with the game id)
//   playback:   an OSD names the game for a few seconds, then video (black when DRM-protected); BACK -> game page
//   Live tab:   (tv.youtube.com/live) SELECT plays a channel live. A running app IGNORES a warm VIEW intent while on
//               the Live tab or in any playback (community reports) unless SEARCH was pressed first: SEARCH opens
//               the in-app search page, where links are handled.

import type { AppInstance, AppModel, WarmIntentMode } from "../tv";
import { line, lines, type SimWord } from "../frame";

export interface SimTeam {
  city: string;
  name: string;
  abbr: string;
}
export interface SimGame {
  id: string;
  away: SimTeam;
  home: SimTeam;
  date?: string;
  live?: boolean;
}

export type YtCard = { kind: "game"; game: SimGame } | { kind: "blocked" } | { kind: "video"; title: string };

export interface YtSearchResult {
  /** The page heading: the team searched for. */
  header: string;
  /** Rows above the games row (default ["Top picks"]). */
  rowsBefore?: string[];
  gamesRow?: "Upcoming Games" | "Live Games";
  cards: YtCard[];
}

export interface YtConfig {
  /** Results for a search query; null shows "No results". */
  search(query: string): YtSearchResult | null;
  profilePicker?: boolean;
  /** Picking the profile drops the link: the app lands on Home and the search has to be sent again. */
  linkLostAfterProfile?: boolean;
  splashMs?: number;
  searchLoadMs?: number;
  pageLoadMs?: number;
  playStartMs?: number;
  osdMs?: number;
  secureVideo?: boolean;
  warmIntent?: WarmIntentMode;
  /** A warm search link for the query already on screen keeps the old focus (the page doesn't reload). */
  warmSameQueryKeepsFocus?: boolean;
}

export interface YtVars {
  pending: string | null;
  query: string | null;
  result: YtSearchResult | null;
  focus: number; // 0 = search icon, n = row n-1
  card: number;
  page: SimGame | null;
  playing: string | null; // game id or video title
}

export const YTTV_PKG = "com.amazon.firetv.youtube.tv";

const rowsOf = (r: YtSearchResult) => [...(r.rowsBefore ?? ["Top picks"]), r.gamesRow ?? "Upcoming Games", "On demand"];
const gamesIndex = (r: YtSearchResult) => (r.rowsBefore ?? ["Top picks"]).length;
export const matchup = (g: SimGame) => `${g.away.city} ${g.away.name} at ${g.home.city} ${g.home.name}`;

export function youtubeTvApp(cfg: YtConfig): AppModel<YtVars> {
  const m = buildYoutubeTv(cfg);
  // KEYCODE_SEARCH opens the in-app search page from anywhere the app takes keys (stops playback).
  for (const [id, def] of Object.entries(m.screens)) {
    if (def.dropsKeys || id === "search_page" || id === "profile") continue;
    def.keys = {
      ...def.keys,
      SEARCH: (a) => {
        a.vars.playing = null;
        a.go("search_page");
      },
    };
  }
  return m;
}

function buildYoutubeTv(cfg: YtConfig): AppModel<YtVars> {
  const open = (a: AppInstance<YtVars>, uri: string) => {
    const m = uri.match(/^youtubetv:\/\/search\?query=(.*)$/);
    if (m) {
      const query = decodeURIComponent(m[1]);
      if (cfg.warmSameQueryKeepsFocus && a.vars.query === query && a.screen === "results") return;
      a.vars.playing = null;
      a.vars.query = query;
      a.vars.result = cfg.search(query);
      a.vars.focus = 0;
      a.vars.card = 0;
      a.go("search_loading");
    } else if (/^https:\/\/tv\.youtube\.com\/live/.test(uri)) a.go("live");
    else a.go("home");
  };
  const afterSplash = (a: AppInstance<YtVars>) => {
    if (cfg.profilePicker) return "profile";
    const uri = a.vars.pending;
    a.vars.pending = null;
    if (uri && /^https:\/\/tv\.youtube\.com\/live/.test(uri)) return "live";
    return uri && a.vars.result ? "search_loading" : "home";
  };

  return {
    pkg: YTTV_PKG,
    label: "YouTube TV",
    activity: "dev.cobalt.app.MainActivity",
    secureVideo: cfg.secureVideo ?? true,
    warmIntent: cfg.warmIntent ?? { except: ["live", "live_playback", "playback", "video"] },
    vars: () => ({ pending: null, query: null, result: null, focus: 0, card: 0, page: null, playing: null }),
    start(a, uri) {
      a.vars.pending = uri;
      if (uri) {
        const m = uri.match(/query=(.*)$/);
        if (m) {
          a.vars.query = decodeURIComponent(m[1]);
          a.vars.result = cfg.search(a.vars.query);
        }
      }
      a.reset("splash");
    },
    intent(a, uri) {
      if (a.screen === "splash") {
        a.vars.pending = uri; // handled once the app has loaded
        return;
      }
      open(a, uri);
    },
    screens: {
      splash: {
        draw: () => line("YouTube TV", 820, 500, 48),
        dropsKeys: true,
        after: { ms: cfg.splashMs ?? 7000, to: afterSplash },
      },
      profile: {
        draw: () => [...line("Who's watching?", 700, 300, 56), ...line("Avi Add account Settings", 640, 600)],
        keys: {
          SELECT: (a) => {
            const uri = a.vars.pending;
            a.vars.pending = null;
            a.reset("home");
            if (uri && !cfg.linkLostAfterProfile) open(a, uri);
          },
          BACK: () => undefined,
        },
      },
      home: {
        draw: () => [...line("Home Live Library", 200, 60), ...lines(["Continue watching", "Recommended for you", "Sports"], 120, 400)],
      },
      live: {
        draw: () => [...line("Home Live Library", 200, 60), ...lines(["Live guide", "NFL Sunday Ticket", "News Sports Entertainment"], 120, 300)],
        keys: {
          SELECT: (a) => {
            a.vars.playing = "live:FOX";
            a.mark("live_channel", "FOX");
            a.go("live_playback");
          },
        },
      },
      live_playback: {
        playback: true,
        draw: () => [],
        keys: {
          BACK: (a) => {
            a.vars.playing = null;
            a.back();
          },
        },
      },
      search_page: {
        draw: () => [...line("Search", 120, 60, 40), ...lines(["a b c d e f g", "h i j k l m n", "o p q r s t u"], 120, 300), ...line("Recent searches", 900, 300)],
      },
      search_loading: {
        draw: () => [],
        dropsKeys: true,
        after: { ms: cfg.searchLoadMs ?? 2500, to: (a) => (a.vars.result ? "results" : "noresults") },
      },
      noresults: {
        draw: (a) => line(`No results found for ${a.vars.query ?? ""}`, 300, 400),
      },
      results: {
        draw: (a) => drawResults(a.vars),
        keys: {
          DOWN: (a) => void (a.vars.focus = Math.min(a.vars.focus + 1, rowsOf(a.vars.result!).length)),
          UP: (a) => void (a.vars.focus = Math.max(a.vars.focus - 1, 0)),
          RIGHT: (a) => {
            if (a.vars.focus - 1 === gamesIndex(a.vars.result!)) a.vars.card = Math.min(a.vars.card + 1, a.vars.result!.cards.length - 1);
          },
          LEFT: (a) => {
            if (a.vars.focus - 1 === gamesIndex(a.vars.result!)) a.vars.card = Math.max(a.vars.card - 1, 0);
          },
          SELECT: (a) => {
            const r = a.vars.result!;
            if (a.vars.focus - 1 !== gamesIndex(r)) return a.mark("open_other_row", rowsOf(r)[a.vars.focus - 1] ?? "search");
            const c = r.cards[a.vars.card];
            if (!c || c.kind === "blocked") return;
            if (c.kind === "video") {
              a.vars.playing = c.title;
              a.mark("autoplay", c.title);
              return a.go("video");
            }
            a.vars.page = c.game;
            a.go("page_loading");
          },
        },
      },
      page_loading: {
        draw: () => [],
        dropsKeys: true,
        after: { ms: cfg.pageLoadMs ?? 1500, to: "gamepage" },
      },
      gamepage: {
        draw: (a) => {
          const g = a.vars.page!;
          return [
            ...line(`${g.date ?? "Oct 18, 2026"}${g.live ? " LIVE" : ""}`, 120, 160, 28),
            ...line(matchup(g), 120, 220, 48),
            ...line("Watch now About Upcoming", 120, 420),
          ];
        },
        keys: {
          SELECT: (a) => {
            a.vars.playing = a.vars.page!.id;
            a.mark("watch", a.vars.page!.id);
            a.go("play_loading");
          },
        },
      },
      play_loading: {
        draw: () => [],
        dropsKeys: true,
        after: { ms: cfg.playStartMs ?? 2500, to: "playback" },
      },
      playback: {
        playback: true,
        draw: (a) => (a.now - a.enteredAt < (cfg.osdMs ?? 4000) && a.vars.page ? line(`${matchup(a.vars.page)} LIVE`, 100, 900, 28) : []),
        keys: {
          SELECT: (a) => a.mark("player_select"),
          BACK: (a) => {
            a.vars.playing = null;
            a.back(); // play_loading was replaced, so this is the game page
          },
        },
      },
      video: {
        playback: true,
        draw: (a) => (a.now - a.enteredAt < 3000 ? line(a.vars.playing ?? "", 100, 900, 28) : []),
        keys: {
          BACK: (a) => {
            a.vars.playing = null;
            a.back();
          },
        },
      },
    },
  };
}

function drawResults(v: YtVars): SimWord[] {
  const r = v.result!;
  const rows = rowsOf(r);
  const start = Math.max(0, v.focus - 1);
  const out: SimWord[] = [];
  if (start === 0) out.push(...line(r.header, 120, 80, 48));
  rows.slice(start, start + 3).forEach((title, i) => {
    const y = 300 + i * 240;
    out.push(...line(title, 120, y));
    if (rows.indexOf(title) === gamesIndex(r)) {
      r.cards.slice(0, 5).forEach((c, j) => {
        const label = c.kind === "game" ? `${c.game.away.abbr} ${c.game.home.abbr} NFL ST - FOX` : c.kind === "video" ? "Highlights" : "Sunday Ticket";
        out.push(...line(label, 120 + j * 340, y + 60, 24));
      });
    }
  });
  return out;
}
