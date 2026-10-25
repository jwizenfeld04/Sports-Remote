import type { AllowedKey } from "../lib/types";
import type { NavTeams } from "./youtubeTv";
import { namesTeam, POPUP_RE, sameText } from "./navigation/match";
import type { OcrPage } from "./ocr";

// Prime Video has no per-game link the server can build, but its search link
// (https://app.primevideo.com/search?phrase=<teams>) lists the game first in a "Top Sports" row. Focus starts on
// the on-screen keyboard; six RIGHT presses leave it, one DOWN reaches the first game tile, and the header then
// names the focused game. SELECT opens a side panel with "Watch Live" for a game that's on. This reads the screen at
// every step and only presses play on a game that is live and whose panel names both teams.

export interface PrimeScreen {
  /** Text of the focused tile's header (top, right of the keyboard). */
  header: string;
  /** Text of the right-hand panel that opens on SELECT. */
  panel: string;
  /** All text on screen. */
  all: string;
}

export interface PrimeNavDeps {
  press(key: AllowedKey): Promise<void>;
  screen(): Promise<PrimeScreen>;
  sleep(ms: number): Promise<void>;
  now(): number;
  note?(message: string): void;
}

/**
 * Split an OCR page into the focused tile's header, the side panel and everything. Every cut is a fraction of the
 * frame, so a 3840×2160 screenshot reads like a 1920×1080 one; a page without a width is assumed 16:9.
 */
export function primeScreenFromPage(page: OcrPage): PrimeScreen {
  const { words, height, width = Math.round((height * 16) / 9) } = page;
  const join = (keep: (w: { left: number; top: number }) => boolean) => words.filter(keep).map((w) => w.text).join(" ");
  return {
    header: join((w) => w.left > width * 0.3 && w.top < height * 0.43), // the focused tile's title, right of the keyboard
    panel: join((w) => w.left > width * 0.6), // the side panel that opens on SELECT
    all: join(() => true),
  };
}

export type PrimeNavResult = { ok: true; played: boolean } | { ok: false; reason: "no_results" | "not_found" | "no_panel" | "no_playback" | "unreadable" };

const RESULTS_RE = /top sports|leagues and teams|more to explore/i;
const PROFILE_RE = /who.?s\s+watching/i;
const PANEL_RE = /watch\s+live|more details|add to watchlist/i;
const MAX_TILES = 4;

/** Search results (or the profile picker in front of them) are on screen: what the search link leads to. */
export const primeSearchReady = (text: string) => RESULTS_RE.test(text) || PROFILE_RE.test(text);
const KEYBOARD_COLUMNS = 6;

const both = (text: string, g: NavTeams) => namesTeam(text, g.home) && namesTeam(text, g.away);

export async function openPrimeGame(deps: PrimeNavDeps, g: NavTeams, opts: { play: boolean }): Promise<PrimeNavResult> {
  // A frame cut short mid-transition can make the reader fail: treat it as "nothing readable yet".
  let bad = 0;
  // Once the results are up, a "still watching?" / "who's watching?" dialog can cover them and swallow keys:
  // dismiss it (SELECT is its default button); the steps below see a key that did nothing and press again.
  let armed = false;
  let popups = 0;
  const screenOnce = async (): Promise<PrimeScreen> => {
    try {
      const s = await deps.screen();
      bad = 0;
      return s;
    } catch (e) {
      if (++bad >= 5) throw e;
      return { header: "", panel: "", all: "" };
    }
  };
  const d: PrimeNavDeps = {
    ...deps,
    screen: async () => {
      let s = await screenOnce();
      while (armed && popups < 3 && POPUP_RE.test(s.all)) {
        popups++;
        deps.note?.("Closing a popup...");
        await deps.press("SELECT");
        await deps.sleep(1500);
        s = await screenOnce();
      }
      return s;
    },
  };
  /** A black or empty frame (a redraw) is read again before it counts. */
  const settled = async () => {
    let s = await d.screen();
    for (let i = 0; i < 2 && !s.all.trim(); i++) {
      await d.sleep(800);
      s = await d.screen();
    }
    return s;
  };

  try {
    d.note?.("Searching Prime Video...");
    const end = d.now() + 45_000;
    let s = await d.screen();
    // The first profile is pre-selected. A press sent while the picker settles can be lost: still asking 5 s later
    // means press again (three times at most).
    let picks = 0;
    let pickedAt = 0;
    while (!RESULTS_RE.test(s.all) || PROFILE_RE.test(s.all)) {
      if (PROFILE_RE.test(s.all) && picks < 3 && (picks === 0 || d.now() - pickedAt >= 5000)) {
        picks++;
        pickedAt = d.now();
        await d.press("SELECT");
      }
      if (d.now() >= end) return { ok: false, reason: "no_results" };
      await d.sleep(1500);
      s = await d.screen();
    }
    armed = true;

    // Out of the keyboard and onto the first game tile.
    d.note?.("Looking for the game...");
    for (let i = 0; i < KEYBOARD_COLUMNS; i++) {
      await d.press("RIGHT");
      await d.sleep(350);
    }
    await d.press("DOWN");
    await d.sleep(1500);
    s = await settled();
    // No tile header means focus never reached the tiles: a RIGHT was lost (focus still in the keyboard) or the
    // DOWN was. One more RIGHT then DOWN at a time walks out of the keyboard from wherever it stopped.
    for (let i = 0; i < KEYBOARD_COLUMNS && !s.header.trim(); i++) {
      await d.press("RIGHT");
      await d.sleep(350);
      await d.press("DOWN");
      await d.sleep(1500);
      s = await settled();
    }

    // The header names the focused game: slide along the row until it's this matchup. A RIGHT that leaves the
    // header unchanged was lost (or hit the end of the row): press again without counting it, twice at most.
    let tiles = 0;
    let lost = 0;
    while (!both(s.header, g)) {
      if (++tiles >= MAX_TILES) return { ok: false, reason: "not_found" };
      const before = s.header;
      await d.press("RIGHT");
      await d.sleep(1500);
      s = await settled();
      if (s.header.trim() && sameText(s.header, before) && lost < 2) {
        lost++;
        tiles--;
      }
    }

    const tileHeader = s.header;
    await d.press("SELECT");
    const until = d.now() + 10_000;
    let reselected = false;
    let panel = (await d.screen()).panel;
    while (!(both(panel, g) && PANEL_RE.test(panel))) {
      if (d.now() >= until) return { ok: false, reason: "no_panel" };
      await d.sleep(1200);
      const now = await d.screen();
      panel = now.panel;
      // Still on the same tile with no panel after a few seconds: the SELECT was lost. The header names this game,
      // so a second press opens this game's panel.
      if (!reselected && !PANEL_RE.test(panel) && d.now() >= until - 6000 && both(now.header, g) && sameText(now.header, tileHeader)) {
        reselected = true;
        await d.press("SELECT");
      }
    }
    if (!opts.play) return { ok: true, played: false }; // not on yet: the game's panel is open

    d.note?.("Starting the game...");
    const panelText = panel;
    await d.press("SELECT"); // "Watch Live" is the first action in the panel for a game that's on
    const stop = d.now() + 15_000;
    let away = 0;
    let repressed = false;
    for (;;) {
      await d.sleep(1500);
      const after = await d.screen();
      // Playing: neither the search page nor a page naming both teams (details, watchlist) is on screen, twice in a
      // row (one black frame can be a glitch; Prime's video is DRM-protected, so playback itself reads as black).
      if (!RESULTS_RE.test(after.all) && !both(after.all, g)) {
        if (++away >= 2) return { ok: true, played: true };
        continue;
      }
      away = 0;
      // The same panel, untouched, five seconds on: the press was lost. It's this game's panel, so press again.
      if (!repressed && d.now() >= stop - 10_000 && sameText(after.panel, panelText)) {
        repressed = true;
        await d.press("SELECT");
        continue;
      }
      if (d.now() >= stop) return { ok: false, reason: "no_playback" };
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
