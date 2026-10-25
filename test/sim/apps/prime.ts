// Prime Video (com.amazon.firebat) search as the navigator sees it:
//
//   link:     https://app.primevideo.com/search?phrase=<teams> opens search with the phrase typed in
//   search:   an on-screen keyboard on the left (6 columns; focus starts on its first key), the results to the right:
//             a "Top Sports" row of game tiles, then "Leagues and teams" and "More to explore". Leaving the keyboard
//             (RIGHT from its last column) lands on the filter chips; DOWN from there reaches the first tile
//   header:   with a tile focused, the top right names it: "<Away> vs. <Home>  LIVE|UPCOMING  Included with Prime"
//   SELECT:   on a tile opens a panel on the right third: "Watch Live" first for a live game (marked "watch"),
//             "More details" first for an upcoming one (opens a details page)
//   playback: DRM video, so screenshots are black; BACK returns to the panel

import type { AppInstance, AppModel, WarmIntentMode } from "../tv";
import { line, lines, type SimWord } from "../frame";

export interface PrimeTile {
  id: string;
  away: string;
  home: string;
  live: boolean;
  date?: string;
  /** The panel's title when it differs from the tile's ("San Francisco Giants vs. St. Louis Cardinals"). */
  panelTitle?: string;
}

export interface PrimeConfig {
  search(phrase: string): PrimeTile[];
  profilePicker?: boolean;
  splashMs?: number;
  searchLoadMs?: number;
  panelMs?: number;
  playStartMs?: number;
  warmIntent?: WarmIntentMode;
  /** Keyboard columns before focus leaves it (the navigator assumes 6). */
  keyboardCols?: number;
}

type Focus = { area: "kb"; col: number; row: number } | { area: "chip" } | { area: "tile"; i: number };

export interface PrimeVars {
  pending: string | null;
  phrase: string;
  tiles: PrimeTile[];
  focus: Focus;
  panel: "closed" | "loading" | "open";
  playing: string | null;
}

export const PRIME_PKG = "com.amazon.firebat";

export function primeApp(cfg: PrimeConfig): AppModel<PrimeVars> {
  const cols = cfg.keyboardCols ?? 6;
  const tile = (v: PrimeVars) => (v.focus.area === "tile" ? v.tiles[v.focus.i] : undefined);
  const openSearch = (a: AppInstance<PrimeVars>, uri: string) => {
    const m = uri.match(/^https:\/\/app\.primevideo\.com\/search\?phrase=(.*)$/);
    if (!m) return a.go("home");
    a.vars.playing = null;
    a.vars.phrase = decodeURIComponent(m[1]);
    a.vars.tiles = cfg.search(a.vars.phrase);
    a.vars.focus = { area: "kb", col: 0, row: 0 };
    a.vars.panel = "closed";
    a.go("search_loading");
  };

  const searchWords = (v: PrimeVars): SimWord[] => {
    const out: SimWord[] = [
      ...line(v.phrase, 120, 90, 30), // the search box, left of the header area
      ...lines(["a b c d e f", "g h i j k l", "m n o p q r", "s t u v w x", "y z 1 2 3 4"], 80, 320, 34),
      ...line("Top Sports", 650, 560, 30),
      ...line("Leagues and teams", 650, 820, 30),
      ...line("More to explore", 650, 960, 30),
    ];
    v.tiles.slice(0, 4).forEach((t, i) => out.push(...line(`${t.away} vs. ${t.home}`, 650 + i * 320, 620, 22)));
    const t = tile(v);
    if (t) out.push(...line(`${t.away} vs. ${t.home}`, 650, 100, 44), ...line(`${t.live ? "LIVE" : "UPCOMING"} Included with Prime`, 650, 170, 26));
    if (v.panel === "open" && t) {
      out.push(
        ...line(`${t.live ? "LIVE" : "UPCOMING"} ${t.date ?? "Oct 15, 2026 7:00"}`, 1250, 200, 26),
        ...line(t.panelTitle ?? `${t.away} vs. ${t.home}`, 1250, 260, 34),
        ...line("Included with Prime", 1250, 320, 24),
        ...lines(t.live ? ["Watch Live: Main Broadcast", "More details", "Add to Watchlist"] : ["More details", "Add to Watchlist"], 1250, 420, 28),
      );
    }
    return out;
  };

  return {
    pkg: PRIME_PKG,
    label: "Prime Video",
    activity: "com.amazon.pyrocore.IgnitionActivity",
    secureVideo: true,
    warmIntent: cfg.warmIntent ?? "handled",
    vars: () => ({ pending: null, phrase: "", tiles: [], focus: { area: "kb", col: 0, row: 0 }, panel: "closed", playing: null }),
    start(a, uri) {
      a.vars.pending = uri;
      a.reset("splash");
    },
    intent(a, uri) {
      if (a.screen === "splash" || a.screen === "profile") {
        a.vars.pending = uri;
        return;
      }
      openSearch(a, uri);
    },
    screens: {
      splash: {
        draw: () => line("prime video", 800, 500, 56),
        dropsKeys: true,
        after: {
          ms: cfg.splashMs ?? 5000,
          to: (a) => {
            if (cfg.profilePicker) return "profile";
            return a.vars.pending ? "pending" : "home";
          },
        },
      },
      // A zero-length hop so a pending link is opened through the same code as a warm one.
      pending: {
        draw: () => [],
        dropsKeys: true,
        after: {
          ms: 0,
          to: (a) => {
            const uri = a.vars.pending!;
            a.vars.pending = null;
            const m = uri.match(/phrase=(.*)$/);
            a.vars.phrase = m ? decodeURIComponent(m[1]) : "";
            a.vars.tiles = cfg.search(a.vars.phrase);
            a.vars.focus = { area: "kb", col: 0, row: 0 };
            a.vars.panel = "closed";
            return "search_loading";
          },
        },
      },
      profile: {
        draw: () => [...line("Who's watching?", 700, 300, 56), ...line("Avi Kids Add account", 640, 600)],
        keys: {
          SELECT: (a) => {
            const uri = a.vars.pending;
            a.vars.pending = null;
            a.reset("home");
            if (uri) openSearch(a, uri);
          },
          BACK: () => undefined,
        },
      },
      home: {
        draw: () => [...line("Home Movies TV Shows Live TV Sports", 200, 60), ...lines(["Continue watching", "Top 10 in the US"], 120, 400)],
      },
      search_loading: {
        draw: (a) => [...line(a.vars.phrase, 120, 90, 30), ...lines(["a b c d e f", "g h i j k l"], 80, 320, 34)],
        dropsKeys: true,
        after: { ms: cfg.searchLoadMs ?? 3000, to: "search" },
      },
      search: {
        draw: (a) => searchWords(a.vars),
        keys: {
          RIGHT: (a) => {
            const f = a.vars.focus;
            if (a.vars.panel !== "closed") return;
            if (f.area === "kb") a.vars.focus = f.col + 1 >= cols ? { area: "chip" } : { ...f, col: f.col + 1 };
            else if (f.area === "tile") a.vars.focus = { area: "tile", i: Math.min(f.i + 1, a.vars.tiles.length - 1) };
          },
          LEFT: (a) => {
            const f = a.vars.focus;
            if (a.vars.panel !== "closed") return;
            if (f.area === "kb") a.vars.focus = { ...f, col: Math.max(0, f.col - 1) };
            else if (f.area === "chip") a.vars.focus = { area: "kb", col: cols - 1, row: 0 };
            else if (f.i === 0) a.vars.focus = { area: "kb", col: cols - 1, row: 2 };
            else a.vars.focus = { area: "tile", i: f.i - 1 };
          },
          DOWN: (a) => {
            const f = a.vars.focus;
            if (a.vars.panel !== "closed") return;
            if (f.area === "kb") a.vars.focus = { ...f, row: Math.min(4, f.row + 1) };
            else if (f.area === "chip" && a.vars.tiles.length) a.vars.focus = { area: "tile", i: 0 };
          },
          UP: (a) => {
            const f = a.vars.focus;
            if (a.vars.panel !== "closed") return;
            if (f.area === "kb") a.vars.focus = { ...f, row: Math.max(0, f.row - 1) };
            else if (f.area === "tile") a.vars.focus = { area: "chip" };
          },
          SELECT: (a) => {
            const t = tile(a.vars);
            if (!t) return a.mark("keyboard_select");
            if (a.vars.panel === "closed") {
              a.mark("open_tile", t.id);
              a.vars.panel = "loading";
              a.go("panel_loading");
            } else if (t.live) {
              a.vars.playing = t.id;
              a.mark("watch", t.id);
              a.go("play_loading");
            } else {
              a.mark("details", t.id);
              a.go("details");
            }
          },
          BACK: (a) => {
            if (a.vars.panel !== "closed") a.vars.panel = "closed";
            else if (!a.back()) a.tv.events.push({ t: a.now, type: "mark", pkg: PRIME_PKG, screen: "search", kind: "exit" });
          },
        },
      },
      panel_loading: {
        draw: (a) => searchWords(a.vars),
        dropsKeys: true,
        after: {
          ms: cfg.panelMs ?? 800,
          to: (a) => {
            a.vars.panel = "open";
            a.stack.pop(); // the search screen it opened over
            return "search";
          },
        },
      },
      details: {
        draw: (a) => {
          const t = tile(a.vars)!;
          return [...line(`${t.away} vs. ${t.home}`, 120, 200, 48), ...line("Details Add to Watchlist Trailer", 120, 400)];
        },
      },
      play_loading: {
        draw: () => [],
        dropsKeys: true,
        after: { ms: cfg.playStartMs ?? 3000, to: "playback" },
      },
      playback: {
        playback: true,
        draw: () => line("LIVE", 100, 950, 24), // never seen: Prime's video is DRM-protected, so the frame is black
        keys: {
          SELECT: (a) => a.mark("player_select"),
          BACK: (a) => {
            a.vars.playing = null;
            a.back();
          },
        },
      },
    },
  };
}
