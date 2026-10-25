import type {
  AllowedKey, Game, LaunchAttempt, LaunchError, LaunchLevel, LaunchOutcome, LaunchResult, LaunchRoute, ServiceId, TvStatus,
} from "../lib/types";
import { isVerified, packageFor, routesToTry, type AppDef, type Platform, type RouteDef } from "../lib/catalog/apps";
import { renderOutcome, varsFor } from "../lib/messages";
import {
  amStartOk, buildUri, forceStopArgs, foregroundArgs, keyArgs, launcherArgs, LAUNCHER_CATEGORIES, parseLauncherActivity, parseScreenOn, powerArgs, resolveLauncherArgs, shellArgs,
  viewIntentArgs, type AdbExec,
} from "./adb";
import type { PlexClient } from "./plex";
import type { KeySender } from "./tv/keys";
import { enterApp, LaunchHistory } from "./navigation/entry";
import type { MlbSchedule } from "./mlb";
import type { NbaSchedule } from "./nba";
import { etDay, type EspnWatch } from "./espnWatch";
import { openGameViaSearch } from "./youtubeTv";
import { tuneViaGuide } from "./plexGuide";
import { openPrimeGame, primeScreenFromPage } from "./primeVideo";
import type { Screencap } from "./adb";
import type { Ocr, OcrBoxes } from "./ocr";

export interface DriverOptions {
  serial: string; // "192.168.1.50:5555"
  exec: AdbExec;
  apps: () => ReadonlyMap<string, AppDef>;
  platform?: () => Platform; // default firetv
  /** Package actually installed per app id, when the TV has been checked (Google TV and Fire TV names differ). */
  installed?: () => Record<string, string> | null;
  plex?: PlexClient | null;
  mlb?: MlbSchedule | null;
  nba?: NbaSchedule | null;
  espn?: EspnWatch | null;
  // Screen reading for routes that drive an app with the remote (YouTube TV). Without it those routes are skipped.
  screen?: { capture: Screencap; ocr: Ocr; boxes?: OcrBoxes } | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  verifyTimeoutMs?: number;
  log?: (entry: Record<string, unknown>) => void;
  /** Fast remote keys over a persistent shell (server/tv/keys.ts). Without it, each key is a one-shot `input keyevent`. */
  keys?: KeySender | null;
  /** false: always restart an app before driving it (the pre-0.2 behavior). Default true. */
  warmEntry?: boolean;
}

export interface LaunchRequest {
  requestId: string;
  game: Game;
  route: LaunchRoute;
  wake?: boolean;
  /** Called with a short message as a slow launch moves through its steps. */
  onProgress?: (message: string) => void;
}

/** Sliding-window limiter. */
export class RateLimiter {
  private hits: number[] = [];
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  take(): boolean {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
}

export function parseForegroundActivity(out: string): { pkg: string; activity: string } | null {
  const m =
    out.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[:=]\s*ActivityRecord\{[^}]*?\s([a-zA-Z0-9_.]+)\/([^\s}]+)/) ??
    out.match(/mFocusedApp=.*?\s([a-zA-Z0-9_.]+)\/([^\s}]+)/);
  return m ? { pkg: m[1], activity: m[2] } : null;
}

// Fox One's channel links are keyed by call sign.
const CALL_SIGNS: Partial<Record<string, string>> = { fs1: "FS1", fs2: "FS2", btn: "BTN" };

const PROFILE_RE = /profile|whoswatching|who_is_watching|userselect|selectuser|account.?picker/i;

export class AndroidTvDriver {
  private busy = false;
  private launchLimit: RateLimiter;
  private keyLimit: RateLimiter;
  private last: { outcome?: string; error?: string } = {};
  private launcherCache = new Map<string, string | null>();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private connected: TvStatus["adb"] = "offline";

  private history = new LaunchHistory();

  private async readText(): Promise<string> {
    const png = await this.o.screen?.capture();
    return png ? this.o.screen!.ocr(png) : "";
  }

  /** Stop background work (the key shell). */
  close(): void {
    this.o.keys?.close();
  }

  constructor(private o: DriverOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.launchLimit = new RateLimiter(10, 60_000, this.now);
    this.keyLimit = new RateLimiter(120, 60_000, this.now);
  }

  private get platform(): Platform {
    return this.o.platform?.() ?? "firetv";
  }

  /** The package to start for an app on this TV, or null if the app has none on this platform. */
  pkgOf(app: AppDef): string | null {
    return packageFor(app, this.platform, this.o.installed?.()?.[app.id]);
  }

  private shell(argv: string[], timeoutMs?: number) {
    return this.o.exec(shellArgs(this.o.serial, argv), timeoutMs);
  }

  /** `adb connect`, then read the device state. */
  async connect(): Promise<TvStatus["adb"]> {
    await this.o.exec(["connect", this.o.serial], 8000);
    this.connected = await this.deviceState();
    if (this.connected === "connected") void this.o.keys?.warm(); // keep the one-time probe out of the first press
    return this.connected;
  }

  async deviceState(): Promise<TvStatus["adb"]> {
    const r = await this.o.exec(["devices"], 5000);
    const line = r.stdout.split("\n").find((l) => l.startsWith(this.o.serial + "\t") || l.startsWith(this.o.serial + " "));
    if (!line) return "offline";
    if (/\tdevice\b|\sdevice$/.test(line)) return "connected";
    if (/unauthorized/.test(line)) return "unauthorized";
    return "offline";
  }

  /** Reconnect if needed; used by the watchdog. */
  async ensureConnected(): Promise<TvStatus["adb"]> {
    const state = await this.deviceState();
    if (state === "connected") {
      void this.o.keys?.warm();
      return (this.connected = state);
    }
    return this.connect();
  }

  async status(plexState: TvStatus["plex"] = "unconfigured"): Promise<TvStatus> {
    const t0 = this.now();
    const adb = await this.deviceState();
    this.connected = adb;
    if (adb !== "connected") return { adb, screenOn: null, foreground: null, plex: plexState, latencyMs: null };
    const [fg, pw] = await Promise.all([this.shell(foregroundArgs()), this.shell(powerArgs())]);
    return {
      adb,
      screenOn: parseScreenOn(pw.stdout),
      foreground: parseForegroundActivity(fg.stdout)?.pkg ?? null,
      plex: plexState,
      latencyMs: this.now() - t0,
    };
  }

  async key(k: AllowedKey): Promise<{ ok: boolean; dropped?: boolean; error?: LaunchError }> {
    if (this.o.keys) {
      // Has its own queue and rate limit: holding a key drops extras instead of building a backlog.
      const r = await this.o.keys.press(k);
      return r.ok ? { ok: true, ...(r.dropped ? { dropped: true } : {}) } : { ok: false, error: (r.error as LaunchError) ?? "adb_error" };
    }
    if (!this.keyLimit.take()) {
      this.o.log?.({ evt: "key_rate_limited", key: k });
      return { ok: false, error: "busy" };
    }
    const r = await this.shell(keyArgs(k), 5000);
    if (r.code !== 0) this.o.log?.({ evt: "key_error", key: k, code: r.code, stderr: (r.stderr || r.stdout).slice(0, 200) });
    return r.code === 0 ? { ok: true } : { ok: false, error: "adb_error" };
  }

  private async foreground() {
    const r = await this.shell(foregroundArgs(), 5000);
    return parseForegroundActivity(r.stdout);
  }

  /** Poll until `pkg` is in front (or time out). */
  private async waitForeground(pkg: string): Promise<{ ok: boolean; fg: { pkg: string; activity: string } | null }> {
    const deadline = this.now() + (this.o.verifyTimeoutMs ?? 5000);
    let fg = null;
    do {
      fg = await this.foreground();
      if (fg?.pkg === pkg) return { ok: true, fg };
      await this.sleep(400);
    } while (this.now() < deadline);
    return { ok: false, fg };
  }

  private async launcherActivity(pkg: string): Promise<string | null> {
    if (this.launcherCache.has(pkg)) return this.launcherCache.get(pkg)!;
    let act: string | null = null;
    for (const category of LAUNCHER_CATEGORIES) {
      act = parseLauncherActivity((await this.shell(resolveLauncherArgs(pkg, category), 5000)).stdout, pkg);
      if (act) break;
    }
    this.launcherCache.set(pkg, act);
    return act;
  }

  /** Drive an app after its link opened: read the screen, move with the remote, press Watch only on the right page. */
  private async navigate(r: RouteDef, req: LaunchRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
    const screen = this.o.screen!;
    const press = async (k: AllowedKey) => void (await this.shell(keyArgs(k), 5000));
    if (r.navigate === "plex_guide") {
      const target = await this.o.plex!.around(req.route.network).catch(() => null);
      if (!target) return { ok: false, reason: "no_program" };
      return tuneViaGuide(
        {
          press,
          screen: async () => {
            const png = await screen.capture();
            if (!png) return { header: "", all: "" };
            const { words, height } = await screen.boxes!(png);
            // Words come back in reading order; the header block is the part above the time ruler.
            return {
              header: words.filter((w) => w.top < height * 0.44).map((w) => w.text).join(" "),
              all: words.map((w) => w.text).join(" "),
            };
          },
          sleep: this.sleep,
          now: this.now,
          note: req.onProgress,
        },
        target,
      );
    }
    if (r.navigate === "prime_search") {
      return openPrimeGame(
        {
          press,
          screen: async () => {
            const png = await screen.capture();
            if (!png) return { header: "", panel: "", all: "" };
            return primeScreenFromPage(await screen.boxes!(png));
          },
          sleep: this.sleep,
          now: this.now,
          note: req.onProgress,
        },
        req.game,
        { play: req.game.state === "in" },
      );
    }
    const params = await this.paramsFor(r, req);
    return openGameViaSearch(
      {
        press,
        reopen: async () => {
          const out = await this.shell(viewIntentArgs(buildUri(r, params!), this.pkgOf(this.o.apps().get(req.route.service)!)!), 15_000);
          if (!amStartOk(out.stdout + out.stderr)) throw new Error("reopen failed");
        },
        read: async () => {
          const png = await screen.capture();
          return png ? await screen.ocr(png) : "";
        },
        sleep: this.sleep,
        now: this.now,
        note: req.onProgress,
      },
      req.game,
    );
  }

  private async paramsFor(route: RouteDef, req: LaunchRequest): Promise<Record<string, string> | null> {
    const out: Record<string, string> = {};
    for (const name of Object.keys(route.params)) {
      if (name === "gamePk") {
        const pk = await this.o.mlb?.gamePkFor(req.game).catch(() => null);
        if (!pk) return null;
        out.gamePk = pk;
      } else if (name === "callSign") {
        const sign = CALL_SIGNS[req.route.network];
        if (!sign) return null;
        out.callSign = sign;
      } else if (name === "dvrKey") {
        const key = await this.o.plex?.dvrKey().catch(() => null);
        if (!key) return null;
        out.dvrKey = key;
      } else if (name === "query") {
        // The search term is a server-side value, checked against the route's regex: the home team's full name for
        // YouTube TV, both nicknames for Prime Video (which lists the matchup first).
        out.query = route.navigate === "prime_search" ? `${req.game.away.name} ${req.game.home.name}` : req.game.home.displayName;
      } else if (name === "nbaGameId") {
        const id = await this.o.nba?.gameIdFor(req.game).catch(() => null);
        if (!id) return null;
        out.nbaGameId = id;
      } else if (name === "gameDate") {
        out.gameDate = etDay(req.game.startTime);
      } else if (name === "airingId") {
        const id = await this.o.espn?.airingIdFor(req.game, req.route.network).catch(() => null);
        if (!id) return null;
        out.airingId = id;
      } else if (name !== "channelKey") {
        return null; // a param we don't know how to source: skip this route
      }
    }
    return out;
  }

  /** Open an app to its home screen and report whether it came to the front (setup's "test it"). */
  async openApp(appId: string): Promise<{ ok: boolean; foreground: string | null; error?: string }> {
    const def = this.o.apps().get(appId);
    const pkg = def ? this.pkgOf(def) : null;
    if (!def || !pkg) return { ok: false, foreground: null, error: "not_installed" };
    if (this.busy) return { ok: false, foreground: null, error: "busy" };
    if ((await this.ensureConnected()) !== "connected") return { ok: false, foreground: null, error: "device_offline" };
    await this.shell(keyArgs("WAKEUP"), 3000);
    const act = await this.launcherActivity(pkg);
    await this.shell(launcherArgs(pkg, act ?? undefined), 15_000);
    const v = await this.waitForeground(pkg);
    this.o.log?.({ evt: "app_test", app: appId, ok: v.ok, foreground: v.fg?.pkg });
    return { ok: v.ok, foreground: v.fg?.pkg ?? null, error: v.ok ? undefined : "not_in_front" };
  }

  async launch(req: LaunchRequest): Promise<LaunchResult> {
    const def = this.o.apps().get(req.route.service);
    const base = { requestId: req.requestId, service: req.route.service };
    if (!def) return this.fail(base, null, req, "unknown_service", []);
    const pkg = this.pkgOf(def);
    if (!pkg) {
      // An app we have no TV package for (a team's own app, some regional networks): wake the TV and show the steps.
      if (!(def.packages[this.platform]?.length)) {
        if (req.wake !== false && (await this.ensureConnected().catch(() => "offline")) === "connected") await this.shell(keyArgs("WAKEUP"), 3000).catch(() => {});
        return this.result(base, def, req, "manual", null, false, []);
      }
      return this.fail(base, def, req, "not_installed", []);
    }
    if (this.busy) return this.fail(base, def, req, "busy", []);
    if (!this.launchLimit.take()) return this.fail(base, def, req, "busy", []);
    this.busy = true;
    const attempts: LaunchAttempt[] = [];
    const started = this.now();
    // Keep each progress message with its time so a slow or failed launch can be read back from the log.
    const steps: { at: number; msg: string }[] = [];
    const userProgress = req.onProgress;
    req = { ...req, onProgress: (msg) => { steps.push({ at: this.now() - started, msg }); userProgress?.(msg); } };
    let outcome: string | undefined;
    let errorCode: string | undefined;
    this.o.log?.({ evt: "launch_start", requestId: req.requestId, game: req.game.id, matchup: `${req.game.away.abbr} @ ${req.game.home.abbr}`, state: req.game.state, service: req.route.service, network: req.route.network, level: req.route.level });
    try {
      const state = await this.ensureConnected();
      if (state !== "connected") return this.fail(base, def, req, "device_offline", attempts);
      if (req.wake !== false) await this.shell(keyArgs("WAKEUP"), 3000);

      let channelName: string | undefined;
      // 1. Deep links, best level first.
      for (const r of routesToTry(def, req.route.network, this.platform)) {
        const t0 = this.now();
        try {
          if (r.via === "plex") {
            if (!this.o.plex) continue;
            const ch = await this.o.plex.channelFor(req.route.network);
            if (!ch) continue;
            channelName = ch.name;
            await this.o.plex.playChannel(ch.key);
          } else {
            if (r.navigate && !this.o.screen) continue; // needs to read the screen
            if (r.navigate === "plex_guide" && (!this.o.screen?.boxes || !this.o.plex)) continue; // needs word positions and Plex
            if (r.navigate === "prime_search" && !this.o.screen?.boxes) continue; // needs word positions
            const params = await this.paramsFor(r, req);
            if (!params) continue;
            if (r.navigate) {
              // Already on this game: leave it. App running: switch inside it (no restart). Otherwise, or if the
              // switch doesn't reach the screen we expect: force-stop and start clean.
              const entry = await enterApp(
                { shell: (argv, t) => this.shell(argv, t), read: () => this.readText(), sleep: this.sleep, now: this.now, note: req.onProgress },
                {
                  navigator: r.navigate, pkg, uri: buildUri(r, params), service: def.id, gameId: req.game.id, tvId: this.o.serial,
                  last: this.history.last(this.o.serial), allowWarm: this.o.warmEntry !== false, label: def.label.replace(/ \(.*\)$/, ""),
                },
              );
              this.o.log?.({ evt: "entry", requestId: req.requestId, ...entry.telemetry });
              if (entry.strategy === "skip") {
                attempts.push({ level: r.level, via: r.via, ok: true, ms: this.now() - t0, error: undefined });
                return this.done(base, def, req, r.level, attempts, { unverifiedRoute: !isVerified(r, req.route.network, this.platform), channelName });
              }
              if (!entry.linkOk) {
                attempts.push({ level: r.level, via: "adb", ok: false, ms: this.now() - t0, error: "am start failed" });
                continue;
              }
            } else {
              const out = await this.shell(viewIntentArgs(buildUri(r, params), pkg), 15_000);
              if (!amStartOk(out.stdout + out.stderr)) {
                attempts.push({ level: r.level, via: "adb", ok: false, ms: this.now() - t0, error: "am start failed" });
                continue;
              }
            }
          }
          const v = await this.waitForeground(pkg);
          let navFailed: string | undefined;
          if (v.ok && r.navigate) {
            const nav = await this.navigate(r, req);
            if (!nav.ok) navFailed = nav.reason;
          }
          attempts.push({ level: r.level, via: r.via, ok: v.ok && !navFailed, foreground: v.fg?.pkg, ms: this.now() - t0, error: navFailed });
          if (v.ok && !navFailed && r.navigate) this.history.record({ gameId: req.game.id, service: def.id, tvId: this.o.serial, at: this.now() });
          if (v.ok && !navFailed) return this.done(base, def, req, r.level, attempts, { unverifiedRoute: !isVerified(r, req.route.network, this.platform), channelName, activity: v.fg?.activity });
        } catch (e) {
          attempts.push({ level: r.level, via: r.via, ok: false, ms: this.now() - t0, error: (e as Error).message.slice(0, 120) });
        }
      }

      // 2. App launch: always the floor.
      const t0 = this.now();
      const act = await this.launcherActivity(pkg);
      const out = await this.shell(launcherArgs(pkg, act ?? undefined), 15_000);
      const started = out.code === 0 && !/No activities found|Error|aborted/i.test(out.stdout + out.stderr);
      const v = started ? await this.waitForeground(pkg) : { ok: false, fg: null };
      attempts.push({ level: "app", via: "adb", ok: v.ok, foreground: v.fg?.pkg, ms: this.now() - t0, error: started ? undefined : "launch failed" });
      if (v.ok) return this.done(base, def, req, "app", attempts, { channelName, activity: v.fg?.activity });
      if (started) return this.result(base, def, req, "unverified", null, false, attempts, { channelName });
      return this.fail(base, def, req, "adb_error", attempts);
    } catch (e) {
      const msg = (e as Error).message;
      return this.fail(base, def, req, /timed? ?out|ETIMEDOUT/i.test(msg) ? "timeout" : "adb_error", attempts);
    } finally {
      this.busy = false;
      outcome = this.last.outcome;
      errorCode = this.last.error;
      this.o.log?.({
        evt: "launch", requestId: req.requestId, game: req.game.id, matchup: `${req.game.away.abbr} @ ${req.game.home.abbr}`,
        service: req.route.service, network: req.route.network, outcome, error: errorCode, ms: this.now() - started, steps, attempts,
      });
    }
  }

  private done(
    base: { requestId: string; service: ServiceId }, def: AppDef, req: LaunchRequest, level: LaunchLevel,
    attempts: LaunchAttempt[], o: { unverifiedRoute?: boolean; channelName?: string; activity?: string },
  ): LaunchResult {
    const outcome: LaunchOutcome = o.activity && PROFILE_RE.test(o.activity) ? "profile_picker" : level;
    return this.result(base, def, req, outcome, level, true, attempts, o);
  }

  private result(
    base: { requestId: string; service: ServiceId }, def: AppDef, req: LaunchRequest, outcome: LaunchOutcome,
    level: LaunchLevel | null, verified: boolean, attempts: LaunchAttempt[], o: { unverifiedRoute?: boolean; channelName?: string } = {},
  ): LaunchResult {
    const vars = varsFor(req.game, req.route.network, def, o.channelName);
    const m = renderOutcome(outcome, def, vars, { level, unverifiedRoute: o.unverifiedRoute });
    this.last = { outcome };
    return { ...base, ok: outcome !== "unverified", level, verified, outcome, ...m, attempts };
  }

  private fail(
    base: { requestId: string; service: ServiceId }, def: AppDef | null, req: LaunchRequest, error: LaunchError, attempts: LaunchAttempt[],
  ): LaunchResult {
    const vars = def ? varsFor(req.game, req.route.network, def) : null;
    const m = renderOutcome("failed", def, vars, { error });
    this.last = { outcome: "failed", error };
    return { ...base, ok: false, level: null, verified: false, outcome: "failed", ...m, attempts, error };
  }
}

/** @deprecated old name, kept for tests and the CLI. */
export { AndroidTvDriver as FireTvAdbDriver };
