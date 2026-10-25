import type { AllowedKey } from "../lib/types";
import { awayAtHome, hasName, hasPhrase, namesTeam, POPUP_RE } from "./navigation/match";

// YouTube TV has no link to a single game, but its search link opens results for a team with that team's
// "Upcoming Games" row (the next game first), and a game card opens a page titled "<Away> at <Home>" with a
// "Watch now" button. This drives that path with the remote keys and READS THE SCREEN at each step, so it
// only presses Watch now when the page really shows the requested matchup. Anything else stops without
// starting playback and the driver falls back to opening the app with on-screen steps.

export { hasName };

export interface NavDeps {
  press(key: AllowedKey): Promise<void>;
  /** Re-send the search link (in case the profile picker swallowed it). */
  reopen(): Promise<void>;
  /** Text on the TV right now (screenshot + OCR); "" when nothing readable (video playing, black screen). */
  read(): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Optional: tell the person watching the screen what's happening. */
  note?(message: string): void;
}

/** The two teams. With a city (a Game has one), a nickname shared across leagues is checked against it too. */
export interface NavTeams {
  home: { name: string; city?: string };
  away: { name: string; city?: string };
}

export type NavResult = { ok: true } | { ok: false; reason: "no_results" | "wrong_page" | "ocr_failed" };

const ACTIONS_RE = /watch\s*now|\babout\b/i;

/** The game's own page: both teams and its action menu. (The results page for one team never names both.) */
export function isGamePage(text: string, g: NavTeams): boolean {
  return namesTeam(text, g.home) && namesTeam(text, g.away) && awayAtHome(text, g.away, g.home) && ACTIONS_RE.test(text);
}

const RESULTS_RE = /upcoming games|top picks|on demand/i;
const MAX_CARDS = 6;
const PROFILE_RE = /who.?s\s+watching/i;
const MAX_POPUPS = 3;

/** The search results (or the profile picker in front of them) are on screen: what a sent search link leads to. */
export const ytSearchReady = (text: string) => RESULTS_RE.test(text) || PROFILE_RE.test(text);

// Row titles, matched like names (a misread letter in "Upcoming" must not hide the row).
const gamesRowShown = (t: string) => hasPhrase(t, "upcoming games") || hasPhrase(t, "live games");
/** The games row is the top row: it's on screen and the rows above it ("Top picks") have scrolled away. */
const atGamesRow = (t: string) => gamesRowShown(t) && !hasPhrase(t, "top picks");
/** Some game's page, but not this one (the action menu is there, the teams aren't). */
const otherGamePage = (t: string, g: NavTeams) => ACTIONS_RE.test(t) && !isGamePage(t, g) && !gamesRowShown(t);

async function waitFor(d: NavDeps, ok: (t: string) => boolean, ms: number, every = 1500): Promise<string | null> {
  const end = d.now() + ms;
  for (;;) {
    const t = await d.read();
    if (ok(t)) return t;
    if (d.now() >= end) return null;
    await d.sleep(every);
  }
}

/**
 * Starting from the search link already sent: wait for the results, find the team's game cards, open them in order until one is this matchup,
 * confirm the matchup, then press Watch now. Never presses Watch on a page that isn't this matchup.
 */
export async function openGameViaSearch(deps: NavDeps, g: NavTeams, opts: { watch?: boolean } = {}): Promise<NavResult> {
  // A frame grabbed mid-transition can be cut short and make the reader fail. Treat that as "nothing readable
  // yet" and retry; only a run of failures means the screen can't be read at all.
  let bad = 0;
  // Once the results are up, a "still watching?" or "who's watching?" dialog can cover them and swallow keys:
  // dismiss it (SELECT is its default button) and tell the step that was waiting.
  let armed = false;
  let popups = 0;
  let interrupted = false;
  deps.note?.("Waiting for YouTube TV to start...");
  const readOnce = async () => {
    try {
      const t = await deps.read();
      bad = 0;
      return t;
    } catch (e) {
      if (++bad >= 5) throw e;
      return "";
    }
  };
  const d: NavDeps = {
    ...deps,
    read: async () => {
      let t = await readOnce();
      while (armed && popups < MAX_POPUPS && POPUP_RE.test(t)) {
        popups++;
        interrupted = true;
        d.note?.("Closing a popup...");
        await deps.press("SELECT");
        await deps.sleep(1500);
        t = await readOnce();
      }
      return t;
    },
  };
  /** Read after a key: a black or empty frame (the page redrawing) is read again before it counts. */
  const readSettled = async () => {
    let t = await d.read();
    for (let i = 0; i < 2 && !t.trim(); i++) {
      await d.sleep(800);
      t = await d.read();
    }
    return t;
  };
  const ready = (t: string) => RESULTS_RE.test(t) || PROFILE_RE.test(t);
  let seen: string | null;
  try {
    // Cold starts on older sticks take 25 s or more before the results show.
    seen = await waitFor(d, ready, 40_000);
    if (seen && PROFILE_RE.test(seen)) {
      // Cold start: the first profile is pre-selected. Pick it; the app normally keeps the search and shows the
      // results. If it doesn't, send the search link again.
      d.note?.("Choosing the profile...");
      await d.press("SELECT");
      // A press sent while the picker is still settling can be lost: if it's still asking after 5 s, press again.
      let picks = 1;
      let pickedAt = d.now();
      const end = d.now() + 15_000;
      seen = null;
      for (;;) {
        const t = await d.read();
        if (RESULTS_RE.test(t) && !PROFILE_RE.test(t)) {
          seen = t;
          break;
        }
        if (d.now() >= end) break;
        if (PROFILE_RE.test(t) && picks < 3 && d.now() - pickedAt >= 5000) {
          picks++;
          pickedAt = d.now();
          await d.press("SELECT");
        }
        await d.sleep(1500);
      }
      if (!seen) {
        await d.reopen();
        seen = await waitFor(d, (t) => RESULTS_RE.test(t), 25_000);
      }
    }
  } catch {
    return { ok: false, reason: "ocr_failed" };
  }
  if (!seen) return { ok: false, reason: "no_results" };
  armed = true;

  d.note?.("Looking for the game...");
  // Focus starts on the search icon. Move down until the games row is the top row on screen (the rows above it,
  // like "Top picks", differ per team), then open its first card: the team's next game.
  try {
    let atRow = false;
    let prev = seen;
    let ups = 0;
    for (let i = 0; i < 6 && !atRow; i++) {
      await d.press("DOWN");
      await d.sleep(1500);
      let t = await readSettled();
      atRow = atGamesRow(t);
      // The games row was on screen and now it's gone: it scrolled off the top, so this DOWN went one row too far
      // (the frame that showed it at the top was misread). Step back up once.
      if (!atRow && ups < 1 && t.trim() && gamesRowShown(prev) && !gamesRowShown(t)) {
        ups++;
        await d.press("UP");
        await d.sleep(1500);
        t = await readSettled();
        atRow = atGamesRow(t);
      }
      prev = t;
    }
    if (!atRow) return { ok: false, reason: "no_results" };
  } catch {
    return { ok: false, reason: "ocr_failed" };
  }
  // The games row isn't always in date order, and some cards are blocked (they open nothing). Try the cards left
  // to right; only a page naming both teams gets the Watch press.
  try {
    for (let card = 0; card < MAX_CARDS; card++) {
      if (card > 0) {
        await d.press("RIGHT");
        await d.sleep(1000);
      }
      let page: string | null = null;
      let last = "";
      for (let tries = 0; tries < 2 && !page; tries++) {
        interrupted = false;
        await d.press("SELECT");
        // Wait for the game page. A blocked card never changes the screen: three reads of the games row in a row
        // mean nothing opened. Another game's page, seen three times, is not going to turn into this one.
        let rowStreak = 0;
        let otherStreak = 0;
        const end = d.now() + 12_000;
        while (d.now() < end) {
          const t = await d.read();
          last = t;
          if (isGamePage(t, g)) {
            page = t;
            break;
          }
          rowStreak = atGamesRow(t) ? rowStreak + 1 : 0;
          otherStreak = otherGamePage(t, g) ? otherStreak + 1 : 0;
          if (rowStreak >= 3 || otherStreak >= 3) break;
          await d.sleep(1200);
        }
        // Only a popup that ate the SELECT earns a second press on the same card.
        if (!page && !(interrupted && atGamesRow(last))) break;
      }
      if (page) {
        if (opts.watch !== false) {
          d.note?.("Found it. Starting the game...");
          await d.press("SELECT"); // "Watch now" is focused when the page opens
          await d.sleep(2000);
          // A lost press leaves this game's page up: press once more (it's the right page, so that's safe).
          let still = 0;
          for (let i = 0; i < 3 && still < 2; i++) {
            if (!isGamePage(await d.read(), g)) break;
            still++;
            if (still < 2) await d.sleep(1200);
          }
          if (still >= 2) {
            await d.press("SELECT");
            await d.sleep(2000);
          }
        }
        return { ok: true };
      }
      // Still on the games row (a blocked card, or a misread frame): nothing to back out of.
      if (atGamesRow(last)) continue;
      // Another game's page or a video opened: back out to the row and try the next card.
      await d.press("BACK");
      if (!(await waitFor(d, atGamesRow, 4000))) {
        // Still that other game's page 4 s later: the BACK was lost, press it again. (Only on that page: a second
        // BACK on the results would leave them, so a blank or unknown screen never gets one.)
        if (otherGamePage(await d.read(), g)) await d.press("BACK");
        if (!(await waitFor(d, atGamesRow, 8000))) return { ok: false, reason: "wrong_page" };
      }
    }
  } catch {
    return { ok: false, reason: "ocr_failed" };
  }
  return { ok: false, reason: "wrong_page" };
}
