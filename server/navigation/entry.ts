import type { AllowedKey } from "../../lib/types";
import {
  forceStopArgs, foregroundArgs, keyArgs, mediaPlaying, mediaSessionArgs, parseAmStart, parseForeground, parseMediaSessions,
  parsePidof, pidofArgs, viewIntentArgs, type AmStartInfo, type MediaSession,
} from "../adb";
import { ytSearchReady } from "../youtubeTv";
import { plexGuideReady } from "../plexGuide";
import { primeSearchReady } from "../primeVideo";

// How to get into an app before a navigator drives it.
//
// Cold entry (force-stop, start fresh) puts the app in a known state but costs 30-70 s and throws away whatever the
// person was watching. When the app is already running, warm entry sends the same link without restarting it and
// checks that the expected screen (search results, the guide) turns up within a short window; if it doesn't, it
// falls back to cold entry. When the same game was launched in the same app minutes ago and video is still playing,
// there is nothing to do.
//
// planEntry() is pure (observation in, plan out) so every case is testable; enterApp() runs a plan with injected
// adb/screen/clock deps and reports what it tried and why it fell back.

export type NavigatorId = "youtube_tv_search" | "plex_guide" | "prime_search";

/** What the app in front is showing, as far as entry cares. */
export type AppScreen = "playback" | "popup" | "profile" | "ready" | "other" | "unreadable";

/** The last successful launch on a TV. */
export interface LaunchRecord {
  gameId: string;
  service: string;
  tvId: string;
  /** Epoch ms (same clock as `now`). */
  at: number;
}

/** In-memory last-launch-per-TV store. */
export class LaunchHistory {
  private byTv = new Map<string, LaunchRecord>();
  record(r: LaunchRecord) {
    this.byTv.set(r.tvId, r);
  }
  last(tvId: string): LaunchRecord | null {
    return this.byTv.get(tvId) ?? null;
  }
  forget(tvId: string) {
    this.byTv.delete(tvId);
  }
}

export interface EntryObservation {
  foreground: { pkg: string; activity: string } | null;
  /** The app's process is running (in front or not). */
  running: boolean;
  /** OCR text of a screenshot taken now ("" = nothing readable: video or a black frame); null = not read. */
  screenText: string | null;
  media: MediaSession[] | null;
}

export interface EntryContext {
  navigator: NavigatorId;
  pkg: string;
  service: string;
  gameId: string;
  tvId: string;
  now: number;
  last?: LaunchRecord | null;
  /** false: always cold (e.g. a TV where warm entry keeps failing). Default true. */
  allowWarm?: boolean;
  /** How long a launch counts as "recent" for the already-playing check. Default 4 hours (a long game). */
  recentMs?: number;
  /** Warm readiness window. Default 10 s. */
  readyTimeoutMs?: number;
}

export interface EntryStep {
  key: AllowedKey;
  /** Wait after the press. */
  waitMs: number;
}

export type EntryPlan =
  | { kind: "skip"; reason: string }
  | {
      kind: "warm";
      reason: string;
      screen: AppScreen;
      /** Keys before the link (only when the app is in front). */
      steps: EntryStep[];
      /** If the first link doesn't reach the expected screen: press these and send the link once more. */
      retrySteps: EntryStep[];
      readyTimeoutMs: number;
    }
  | { kind: "cold"; reason: string };

const POPUP_RE = /still\s+watching|continue\s+watching\s+exit|are\s+you\s+still\s+there/i;
const PROFILE_RE = /who.?s\s+watching/i;

/** The expected screen after the link, per navigator, judged from the whole screen's text. */
export function entryReady(nav: NavigatorId, text: string): boolean {
  if (nav === "youtube_tv_search") return ytSearchReady(text);
  if (nav === "plex_guide") return plexGuideReady(text);
  return primeSearchReady(text);
}

export function classifyScreen(nav: NavigatorId, text: string | null, playing: boolean | null): AppScreen {
  if (text === null) return "unreadable";
  if (POPUP_RE.test(text)) return "popup";
  if (PROFILE_RE.test(text)) return "profile";
  if (playing || !text.trim()) return "playback";
  if (entryReady(nav, text)) return "ready";
  return "other";
}

/** Skip when the same game was launched in the same app on this TV recently and video is still going. */
export function alreadyPlaying(ctx: EntryContext, obs: EntryObservation): { skip: boolean; reason: string } {
  const l = ctx.last;
  if (!l) return { skip: false, reason: "no previous launch" };
  if (l.tvId !== ctx.tvId || l.gameId !== ctx.gameId || l.service !== ctx.service) return { skip: false, reason: "a different game or app last time" };
  if (ctx.now - l.at > (ctx.recentMs ?? 4 * 3600_000)) return { skip: false, reason: "last launch too long ago" };
  if (obs.foreground?.pkg !== ctx.pkg) return { skip: false, reason: "app not in front" };
  const media = mediaPlaying(obs.media, ctx.pkg);
  if (media === true) return { skip: true, reason: "same game, media session playing" };
  if (media === false) return { skip: false, reason: "media session not playing" };
  // No session to ask: a black (DRM) or empty frame means video is up; any readable page means it isn't.
  if (obs.screenText !== null && !obs.screenText.trim()) return { skip: true, reason: "same game, video on screen (no readable text)" };
  return { skip: false, reason: "a page is on screen, not video" };
}

const k = (key: AllowedKey, waitMs: number): EntryStep => ({ key, waitMs });

/**
 * Per-app keys before a warm link, from what's on screen.
 *  - YouTube TV ignores a link on its Live tab and during playback; KEYCODE_SEARCH first opens in-app search,
 *    where links are handled (community configs: ~20 s -> ~5 s).
 *  - Plex: BACK out of live TV to the guide, then the guide link resets the guide to its first row.
 *  - Prime Video: just the search link.
 *  - Any app: a "still watching?" popup is dismissed with SELECT (its default button is "continue").
 */
function warmSteps(nav: NavigatorId, screen: AppScreen): EntryStep[] {
  const steps: EntryStep[] = [];
  if (screen === "popup") steps.push(k("SELECT", 1500));
  if (nav === "youtube_tv_search") {
    if (screen === "profile") steps.push(k("SELECT", 3000));
    steps.push(k("SEARCH", 1500));
  } else if (nav === "plex_guide") {
    if (screen === "playback") steps.push(k("BACK", 2000));
  }
  return steps;
}

export function planEntry(ctx: EntryContext, obs: EntryObservation): EntryPlan {
  const skip = alreadyPlaying(ctx, obs);
  if (skip.skip) return { kind: "skip", reason: skip.reason };
  if (ctx.allowWarm === false) return { kind: "cold", reason: "warm entry disabled" };
  const inFront = obs.foreground?.pkg === ctx.pkg;
  if (!inFront && !obs.running) return { kind: "cold", reason: "app not running" };
  const readyTimeoutMs = ctx.readyTimeoutMs ?? 10_000;
  const retrySteps = ctx.navigator === "youtube_tv_search" ? [k("SEARCH", 1500)] : [];
  if (!inFront) return { kind: "warm", reason: "app running in the background", screen: "unreadable", steps: [], retrySteps, readyTimeoutMs };
  const screen = classifyScreen(ctx.navigator, obs.screenText, mediaPlaying(obs.media, ctx.pkg));
  if (screen === "profile" && ctx.navigator !== "youtube_tv_search") return { kind: "cold", reason: "profile picker in front" };
  const steps = warmSteps(ctx.navigator, screen);
  return { kind: "warm", reason: `app in front (${screen})`, screen, steps, retrySteps: steps.length ? [] : retrySteps, readyTimeoutMs };
}

// --- executor ---

export interface EntryDeps {
  /** `adb shell <argv>` on the TV. */
  shell(argv: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string; code: number }>;
  /** Screen text now (screenshot + OCR); "" when nothing is readable. May throw. */
  read(): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
  note?(message: string): void;
}

export interface EntryRequest extends Omit<EntryContext, "now"> {
  /** The navigator's link (search or guide), already built and validated. */
  uri: string;
  /** For progress messages ("Restarting YouTube TV..."). */
  label?: string;
  /** Pause between force-stop and the link. Default 1.5 s. */
  coldSettleMs?: number;
}

export interface EntryAttempt {
  strategy: "warm" | "cold";
  ok: boolean;
  ms: number;
  steps?: string[];
  am?: AmStartInfo;
  /** Warm: time from the link to the expected screen. */
  readyMs?: number;
  error?: "link_rejected" | "not_ready" | "not_in_front" | "adb_error";
}

export interface EntryTelemetry {
  observed: { foreground: string | null; activity: string | null; running: boolean; screen: AppScreen; media: boolean | null; ms: number };
  plan: EntryPlan["kind"];
  planReason: string;
  attempts: EntryAttempt[];
  /** Why warm entry gave way to cold. */
  fallback?: string;
  totalMs: number;
}

export interface EntryResult {
  strategy: "skip" | "warm" | "cold";
  /** The link was accepted (am start succeeded). Always true for skip. After cold, the caller still checks the foreground. */
  linkOk: boolean;
  telemetry: EntryTelemetry;
}

/** Look at the TV: what's in front, whether the app runs, and (only when the app is in front) its media session and screen. */
export async function observe(deps: EntryDeps, pkg: string): Promise<EntryObservation> {
  const fgOut = await deps.shell(foregroundArgs(), 5000).catch(() => null);
  const foreground = fgOut ? parseForeground(fgOut.stdout) : null;
  if (foreground?.pkg !== pkg) {
    const pid = await deps.shell(pidofArgs(pkg), 5000).catch(() => null);
    return { foreground, running: !!pid && pid.code === 0 && parsePidof(pid.stdout) !== null, screenText: null, media: null };
  }
  const mediaOut = await deps.shell(mediaSessionArgs(), 5000).catch(() => null);
  const media = mediaOut && mediaOut.code === 0 ? parseMediaSessions(mediaOut.stdout) : null;
  const screenText = await deps.read().catch(() => null);
  return { foreground, running: true, screenText, media };
}

async function sendLink(deps: EntryDeps, uri: string, pkg: string): Promise<AmStartInfo> {
  const out = await deps.shell(viewIntentArgs(uri, pkg), 15_000);
  return parseAmStart(out.stdout + out.stderr);
}

/** Poll for the expected screen. The screen right after the link must differ from `before` if `before` already looked ready. */
async function waitReady(deps: EntryDeps, nav: NavigatorId, before: string | null, ms: number): Promise<boolean> {
  let changed = before === null || !entryReady(nav, before);
  const end = deps.now() + ms;
  for (;;) {
    const t = await deps.read().catch(() => "");
    if (!entryReady(nav, t)) changed = true;
    else if (changed || t !== before) return true;
    if (deps.now() >= end) return false;
    await deps.sleep(1000);
  }
}

/** Observe, plan and enter the app; warm attempts fall back to cold on their own. */
export async function enterApp(deps: EntryDeps, req: EntryRequest): Promise<EntryResult> {
  const t0 = deps.now();
  const obs = await observe(deps, req.pkg);
  const plan = planEntry({ ...req, now: deps.now() }, obs);
  const telemetry: EntryTelemetry = {
    observed: {
      foreground: obs.foreground?.pkg ?? null,
      activity: obs.foreground?.activity ?? null,
      running: obs.running,
      screen: plan.kind === "warm" ? plan.screen : classifyScreen(req.navigator, obs.screenText, mediaPlaying(obs.media, req.pkg)),
      media: mediaPlaying(obs.media, req.pkg),
      ms: deps.now() - t0,
    },
    plan: plan.kind,
    planReason: plan.reason,
    attempts: [],
    totalMs: 0,
  };
  const finish = (strategy: EntryResult["strategy"], linkOk: boolean): EntryResult => {
    telemetry.totalMs = deps.now() - t0;
    return { strategy, linkOk, telemetry };
  };
  if (plan.kind === "skip") {
    deps.note?.("Already playing.");
    return finish("skip", true);
  }

  if (plan.kind === "warm") {
    const w0 = deps.now();
    const attempt: EntryAttempt = { strategy: "warm", ok: false, ms: 0, steps: [] };
    telemetry.attempts.push(attempt);
    try {
      const press = async (steps: EntryStep[]) => {
        for (const s of steps) {
          await deps.shell(keyArgs(s.key), 5000);
          attempt.steps!.push(s.key);
          await deps.sleep(s.waitMs);
        }
      };
      await press(plan.steps);
      let before = plan.steps.length || !obs.screenText ? await deps.read().catch(() => null) : obs.screenText;
      const l0 = deps.now();
      attempt.am = await sendLink(deps, req.uri, req.pkg);
      attempt.steps!.push("link");
      let ready = attempt.am.ok && (await waitReady(deps, req.navigator, before, plan.readyTimeoutMs));
      if (attempt.am.ok && !ready && plan.retrySteps.length) {
        // The link was swallowed (YouTube TV on its Live tab): open search and send it once more.
        const fg = parseForeground((await deps.shell(foregroundArgs(), 5000)).stdout);
        if (fg?.pkg === req.pkg) {
          await press(plan.retrySteps);
          before = await deps.read().catch(() => null);
          attempt.am = await sendLink(deps, req.uri, req.pkg);
          attempt.steps!.push("link");
          ready = attempt.am.ok && (await waitReady(deps, req.navigator, before, Math.round(plan.readyTimeoutMs * 0.8)));
        }
      }
      attempt.ms = deps.now() - w0;
      if (!attempt.am.ok) attempt.error = "link_rejected";
      else if (!ready) attempt.error = "not_ready";
      else {
        attempt.ok = true;
        attempt.readyMs = deps.now() - l0;
        return finish("warm", true);
      }
    } catch {
      attempt.ms = deps.now() - w0;
      attempt.error = "adb_error";
    }
    telemetry.fallback = attempt.error === "not_ready" ? `expected screen not seen within ${plan.readyTimeoutMs} ms` : `warm entry failed: ${attempt.error}`;
  }

  // Cold: start from a known state.
  const c0 = deps.now();
  const attempt: EntryAttempt = { strategy: "cold", ok: false, ms: 0 };
  telemetry.attempts.push(attempt);
  deps.note?.(`Restarting ${req.label ?? "the app"}...`);
  await deps.shell(forceStopArgs(req.pkg), 5000);
  await deps.sleep(req.coldSettleMs ?? 1500);
  attempt.am = await sendLink(deps, req.uri, req.pkg);
  attempt.ok = attempt.am.ok;
  if (!attempt.ok) attempt.error = "link_rejected";
  attempt.ms = deps.now() - c0;
  return finish("cold", attempt.ok);
}
