// Plex (com.plexapp.android) Live TV as the guide navigator sees it:
//
//   link:     plex://live-tv/dvr.guide/ota/<dvr key> opens the DVR guide
//   loading:  the tab bar and clock show first ("Guide What's On DVR Schedule ... 1:21 AM") and keys are lost
//   guide:    the header (top 44% of the frame) names the focused program; the grid below lists every visible
//             channel's programs; DOWN/UP move rows, RIGHT/LEFT move along a row in time
//   SELECT:   on a program that's airing tunes the channel (marked "watch" with the call sign); on any other
//             program opens a Record menu over the guide
//   live TV:  an OSD names the channel for a few seconds, then video; BACK returns to the guide (or Home)

import type { AppInstance, AppModel, WarmIntentMode } from "../tv";
import { line, lines, type SimWord } from "../frame";

export interface SimProgram {
  show: string;
  episode?: string;
}

export interface SimChannel {
  call: string; // "ABC"
  number: string; // "7.1"
  /** Programs in time order; `now` is the index of the one on the air. */
  programs: SimProgram[];
  now: number;
}

export interface PlexConfig {
  channels: SimChannel[];
  splashMs?: number;
  /** Time from the guide link to a usable grid (tabs-only frames before that). */
  guideLoadMs?: number;
  /** Same, when the app was already running (a warm link). */
  warmGuideLoadMs?: number;
  /** Where the cursor starts in time, relative to the program on now (-1: the TV's guide lags and shows the last one). */
  startOffset?: number;
  /** Offsets (relative to now) that SELECT will tune; default [0]. A lagging guide also tunes from -1. */
  tunable?: number[];
  /** The grid ignores DOWN until it has had a horizontal key (seen right after launch on a Fire TV). */
  downNeedsHorizontal?: boolean;
  /** A warm guide link keeps the cursor on the row it was on (the last channel tuned). */
  retainCursor?: boolean;
  /** Where BACK from live TV goes. */
  backFromLive?: "guide" | "home";
  tuneMs?: number;
  osdMs?: number;
  warmIntent?: WarmIntentMode;
}

export interface PlexVars {
  pending: string | null;
  row: number;
  offset: number; // cursor column, relative to each channel's program on now
  woke: boolean;
  playing: string | null; // call sign
  menu: boolean;
}

export const PLEX_PKG = "com.plexapp.android";
const TABS = "Guide What's On DVR Schedule Recording Priority Browse";

export function plexApp(cfg: PlexConfig): AppModel<PlexVars> {
  const chans = cfg.channels;
  const cell = (v: PlexVars, row = v.row) => {
    const c = chans[row];
    // The real guide runs days ahead: past the last listed program there's always another one.
    return c.programs[Math.max(0, c.now + v.offset)] ?? { show: "Paid Programming", episode: "Programming to be announced" };
  };
  const openGuide = (a: AppInstance<PlexVars>, warm: boolean) => {
    a.vars.playing = null;
    a.vars.menu = false;
    if (!(warm && cfg.retainCursor)) a.vars.row = 0;
    a.vars.offset = cfg.startOffset ?? 0;
    a.vars.woke = !cfg.downNeedsHorizontal;
    a.go(warm ? "guide_loading_warm" : "guide_loading");
  };
  const header = (v: PlexVars): SimWord[] => {
    const p = cell(v);
    return [
      ...line(`${TABS}`, 80, 40, 28),
      ...line("12:46 AM", 1650, 40, 28),
      ...line(p.show, 80, 140, 52),
      ...line(p.episode ?? p.show, 80, 220, 32),
      ...line(`${chans[v.row].call} TV-PG 20m left Hosts and details of the program`, 80, 290, 26),
    ];
  };
  const grid = (v: PlexVars): SimWord[] => {
    const out: SimWord[] = [...line("Favorites", 80, 500, 26)];
    const first = Math.max(0, v.row - 1);
    chans.slice(first, first + 5).forEach((c, i) => {
      const y = 560 + i * 100;
      out.push(...line(`${c.number} ${c.call}`, 80, y, 26));
      const now = c.programs[c.now];
      const next = c.programs[c.now + 1];
      out.push(...line(now.show, 400, y, 26));
      if (next) out.push(...line(next.show, 1200, y, 26));
    });
    return out;
  };
  const tabsOnly = (): SimWord[] => [...line(TABS, 80, 40, 28), ...line("1:21 AM", 1650, 40, 28), ...line(chans[0]?.call ?? "", 80, 600, 26)];

  return {
    pkg: PLEX_PKG,
    label: "Plex",
    activity: "com.plexapp.plex.activities.SplashActivity",
    warmIntent: cfg.warmIntent ?? "handled",
    vars: () => ({ pending: null, row: 0, offset: 0, woke: true, playing: null, menu: false }),
    start(a, uri) {
      a.vars.pending = uri;
      a.reset("splash");
    },
    intent(a, uri) {
      if (a.screen === "splash") {
        a.vars.pending = uri;
        return;
      }
      if (/^plex:\/\/live-tv\/dvr\.guide/.test(uri)) openGuide(a, true);
    },
    screens: {
      splash: {
        draw: () => line("plex", 900, 500, 64),
        dropsKeys: true,
        activity: "com.plexapp.plex.activities.SplashActivity",
        after: {
          ms: cfg.splashMs ?? 4000,
          to: (a) => {
            if (a.vars.pending && /^plex:\/\/live-tv\/dvr\.guide/.test(a.vars.pending)) {
              a.vars.pending = null;
              a.vars.row = 0;
              a.vars.offset = cfg.startOffset ?? 0;
              a.vars.woke = !cfg.downNeedsHorizontal;
              return "guide_loading";
            }
            return "home";
          },
        },
      },
      home: {
        activity: "tv.plex.app.MainActivity",
        draw: () => [...line("Home Movies TV Shows Live TV Discover", 200, 60), ...lines(["Continue Watching", "Recently Added Movies"], 120, 400)],
      },
      guide_loading: {
        activity: "tv.plex.app.MainActivity",
        draw: tabsOnly,
        dropsKeys: true,
        after: { ms: cfg.guideLoadMs ?? 6000, to: "guide" },
      },
      guide_loading_warm: {
        activity: "tv.plex.app.MainActivity",
        draw: tabsOnly,
        dropsKeys: true,
        after: { ms: cfg.warmGuideLoadMs ?? 1500, to: "guide" },
      },
      guide: {
        activity: "tv.plex.app.MainActivity",
        draw: (a) => [...header(a.vars), ...grid(a.vars), ...(a.vars.menu ? line("Record Program Record Series Cancel", 700, 450, 30) : [])],
        keys: {
          DOWN: (a) => {
            if (a.vars.menu || !a.vars.woke) return;
            a.vars.row = Math.min(a.vars.row + 1, chans.length - 1);
          },
          UP: (a) => {
            if (a.vars.menu || !a.vars.woke) return;
            a.vars.row = Math.max(a.vars.row - 1, 0);
          },
          RIGHT: (a) => {
            if (a.vars.menu) return;
            a.vars.woke = true;
            a.vars.offset = Math.min(a.vars.offset + 1, 12);
          },
          LEFT: (a) => {
            if (a.vars.menu) return;
            a.vars.woke = true;
            // A live guide can't scroll into the past: no further left than where it opened.
            a.vars.offset = Math.max(a.vars.offset - 1, Math.min(0, cfg.startOffset ?? 0));
          },
          SELECT: (a) => {
            if (a.vars.menu) return;
            if ((cfg.tunable ?? [0]).includes(a.vars.offset)) {
              a.vars.playing = chans[a.vars.row].call;
              a.mark("watch", chans[a.vars.row].call);
              a.go("tuning");
            } else {
              a.vars.menu = true;
              a.mark("record_menu", chans[a.vars.row].call);
            }
          },
          BACK: (a) => {
            if (a.vars.menu) a.vars.menu = false;
            else a.reset("home");
          },
        },
      },
      tuning: {
        activity: "com.plexapp.plex.player.PlayerActivity",
        draw: (a) => line(`Tuning ${a.vars.playing}`, 800, 500),
        dropsKeys: true,
        after: { ms: cfg.tuneMs ?? 3000, to: "live" },
      },
      live: {
        activity: "com.plexapp.plex.player.PlayerActivity",
        playback: true,
        draw: (a) => {
          if (a.now - a.enteredAt >= (cfg.osdMs ?? 4000)) return [];
          const c = chans.find((x) => x.call === a.vars.playing);
          return c ? line(`${c.number} ${c.call} ${c.programs[c.now].show} LIVE`, 100, 950, 28) : [];
        },
        keys: {
          SELECT: (a) => a.mark("player_select"),
          BACK: (a) => {
            a.vars.playing = null;
            if (cfg.backFromLive === "home") a.reset("home");
            else a.back(); // the guide, cursor still on that channel
          },
        },
      },
    },
  };
}
