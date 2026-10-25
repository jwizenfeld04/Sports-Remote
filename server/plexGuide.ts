import type { AllowedKey } from "../lib/types";
import { hasName, POPUP_RE, sameText } from "./navigation/match";
import type { OcrPage } from "./ocr";

// Plex's Fire TV app can't be told to play a channel (it isn't a remote-controllable player), but it has a link
// that opens the DVR guide (plex://live-tv/dvr.guide/ota/<dvr key>). In the guide the header names the program
// under the cursor, and pressing SELECT on a program that's on now starts it. So: open the guide, wait until it's
// really loaded, move down until the header shows the program the server's guide says is on this channel now,
// and press SELECT only then.

export interface PlexScreen {
  /** Text in the header block (the focused program's title and details). */
  header: string;
  /** All text on screen. */
  all: string;
}

export interface PlexNavDeps {
  press(key: AllowedKey): Promise<void>;
  screen(): Promise<PlexScreen>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Optional: tell the person watching the screen what's happening. */
  note?(message: string): void;
}

export interface Program {
  show: string;
  episode?: string;
}

/** The channel's program on now, with its neighbours: the TV's guide can lag the clock by a few minutes. */
export interface PlexTarget {
  now: Program;
  prev?: Program;
  next?: Program;
}

/** Split an OCR page into the guide's header (the part above the time ruler) and everything. Relative, so any resolution works. */
export function plexScreenFromPage(page: OcrPage): PlexScreen {
  const { words, height } = page;
  return {
    header: words.filter((w) => w.top < height * 0.44).map((w) => w.text).join(" "),
    all: words.map((w) => w.text).join(" "),
  };
}

export type PlexNavResult = { ok: true } | { ok: false; reason: "no_guide" | "not_found" | "no_playback" | "unreadable" };

const GUIDE_RE = /what.?s\s+on/i;
// The tab bar and clock appear before the grid does; ready means a program's title and details are showing too.
const CHROME_RE = /guide|what.?s\s+on|dvr\s+schedule|recording\s+priority|browse|\b\d{1,2}:\d{2}\s*[ap]m\b/gi;
const hasProgram = (header: string) => header.replace(CHROME_RE, " ").replace(/[^A-Za-z]+/g, " ").trim().length >= 15;
const MAX_ROWS = 30;

/** The guide (tabs and a program) is on screen, judged from all the text: what the guide link leads to. */
export const plexGuideReady = (text: string) => GUIDE_RE.test(text) && hasProgram(text);
const MAX_NUDGES = 3;

const is = (header: string, p?: Program) => !!p && hasName(header, p.show) && (!p.episode || hasName(header, p.episode));

/** The cursor didn't move: the same header, allowing for OCR jitter (and the clock ticking over). */
const sameCell = (a: string, b: string) => sameText(a, b);

export async function tuneViaGuide(deps: PlexNavDeps, target: PlexTarget): Promise<PlexNavResult> {
  // A frame cut short mid-transition can make the reader fail: treat it as "nothing readable yet".
  let bad = 0;
  // Once the guide is up, a "still watching?" dialog can cover it and swallow keys: dismiss it (SELECT is its
  // default button). The steps below then see a key that did nothing and press again.
  let armed = false;
  let popups = 0;
  const screenOnce = async (): Promise<PlexScreen> => {
    try {
      const s = await deps.screen();
      bad = 0;
      return s;
    } catch (e) {
      if (++bad >= 5) throw e;
      return { header: "", all: "" };
    }
  };
  const d: PlexNavDeps = {
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

  /** A black or empty frame (a redraw) is read again before it counts, so a row is never skipped unread. */
  const settled = async () => {
    let s = await d.screen();
    for (let i = 0; i < 2 && !s.header.trim(); i++) {
      await d.sleep(800);
      s = await d.screen();
    }
    return s;
  };

  try {
    d.note?.("Opening the Live TV guide...");
    // Keys sent before the guide has loaded are dropped, so wait until its tabs and a program header are on screen.
    const end = d.now() + 45_000;
    let s = await d.screen();
    while (!(GUIDE_RE.test(s.all) && hasProgram(s.header))) {
      if (d.now() >= end) return { ok: false, reason: "no_guide" };
      await d.sleep(1500);
      s = await d.screen();
    }

    armed = true;

    // Down through the rows until the header shows this channel's program. A press that changes nothing was
    // probably dropped: wait and press again rather than counting it as a row. Reaching the bottom (nothing moves
    // any more) turns the search around once: a guide that was already open keeps its cursor on the last channel
    // tuned, so the channel can be above it.
    d.note?.("Finding the channel...");
    let rows = 0;
    let stuck = 0;
    let nudges = 0;
    let dir: "DOWN" | "UP" = "DOWN";
    while (!is(s.header, target.now)) {
      // On this channel's row but a neighbouring program: slide along the row to the one on now.
      if (nudges < MAX_NUDGES && (is(s.header, target.prev) || is(s.header, target.next))) {
        nudges++;
        await d.press(is(s.header, target.prev) ? "RIGHT" : "LEFT");
        await d.sleep(1500);
        s = await settled();
        continue;
      }
      if (rows >= MAX_ROWS) return { ok: false, reason: "not_found" };
      const before = s.header;
      await d.press(dir);
      await d.sleep(1500);
      s = await settled();
      if (sameCell(s.header, before)) {
        if (++stuck >= 5) {
          if (dir === "UP") return { ok: false, reason: "not_found" };
          dir = "UP";
          stuck = 0;
          rows = 0;
          continue;
        }
        // Right after launch the grid can ignore DOWN until it has had a horizontal key. RIGHT then LEFT wakes it
        // and ends on the same cell.
        if (stuck >= 2 && stuck <= 3) {
          await d.press("RIGHT");
          await d.sleep(1200);
          await d.press("LEFT");
          await d.sleep(1200);
        } else {
          await d.sleep(2000);
        }
        s = await settled();
        continue;
      }
      stuck = 0;
      rows++;
    }

    d.note?.("Starting playback...");
    const at = s;
    await d.press("SELECT");
    // When it plays, the guide (and its tabs) goes away. A popup or an error leaves it on screen.
    const until = d.now() + 15_000;
    let retried = false;
    let gone = 0;
    for (;;) {
      await d.sleep(1500);
      const after = await d.screen();
      // Gone means no tab bar and no header naming the program, twice in a row: one misread "What's On" must
      // not pass for playback (a Record menu over the guide once did).
      if (!GUIDE_RE.test(after.all) && !is(after.header, target.now)) {
        if (++gone >= 2) return { ok: true };
        continue;
      }
      gone = 0;
      // A lost press leaves the guide exactly as it was, on this program: press once more. (A menu or popup changes
      // the screen, so it never gets a second press.)
      if (!retried && d.now() >= until - 10_000 && is(after.header, target.now) && sameText(after.all, at.all)) {
        retried = true;
        await d.press("SELECT");
        continue;
      }
      if (d.now() >= until) return { ok: false, reason: "no_playback" };
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
