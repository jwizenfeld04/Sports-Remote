// A scriptable TV for testing navigators without a TV.
//
// Each installed app is a state machine of screens (see AppModel). The TV keeps a simulated clock: nothing happens
// between calls, and time only moves when someone sleeps or pays the cost of a key press, a screenshot or an intent.
// Loading screens resolve after N simulated ms. Randomness (dropped keys, misreads, black frames) comes from a
// seeded RNG, so a failing seed replays exactly.
//
// The TV can be driven three ways:
//   - navigator deps:  tv.navDeps() / tv.plexDeps() / tv.primeDeps()  (NavDeps, PlexNavDeps, PrimeNavDeps)
//   - an AdbExec fake: tv.adbExec()  plus  tv.driverScreen()  for FireTvAdbDriver end to end
//   - directly:        tv.press(), tv.view(), tv.forceStop(), tv.launch(), tv.snapshot()

import type { AllowedKey } from "../../lib/types";
import { KEYCODES, type AdbExec } from "../../server/adb";
import type { NavDeps } from "../../server/youtubeTv";
import { plexScreenFromPage, type PlexNavDeps } from "../../server/plexGuide";
import { primeScreenFromPage, type PrimeNavDeps } from "../../server/primeVideo";
import type { OcrPage } from "../../server/ocr";
import { fakePng, fakePngInfo, line, misread, readingOrder, REF_H, REF_W, scaleWords, type SimWord } from "./frame";

// --- clock and randomness ---

export class SimClock {
  t = 0;
  now = () => this.t;
  advance(ms: number) {
    this.t += Math.max(0, ms);
  }
}

/** mulberry32: small, fast, good enough for test perturbations. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- app models ---

/** How a running app treats a VIEW intent (onNewIntent). */
export type WarmIntentMode = "handled" | "ignored" | { from: readonly string[] } | { except: readonly string[] };

export function handlesWarm(mode: WarmIntentMode, screen: string): boolean {
  if (mode === "handled") return true;
  if (mode === "ignored") return false;
  return "from" in mode ? mode.from.includes(screen) : !mode.except.includes(screen);
}

export interface ScreenDef<V> {
  /** Words on screen, in the 1920×1080 reference frame. */
  draw(a: AppInstance<V>): SimWord[];
  /** Key handlers. A missing BACK goes back one screen (or out to the launcher from the first); other missing keys do nothing. */
  keys?: Partial<Record<AllowedKey, (a: AppInstance<V>) => void>>;
  /** Timed transition: after `ms` on this screen (times the slow-load factor), replace it with `to`. */
  after?: { ms: number | ((a: AppInstance<V>) => number); to: string | ((a: AppInstance<V>) => string) };
  /** Video is playing here (media session "playing"; a black frame when the app's video is DRM-protected). */
  playback?: boolean;
  /** Keys pressed here are lost (the app is still loading). */
  dropsKeys?: boolean;
  /** Activity name in `dumpsys activity` while this screen is up (default: the app's). */
  activity?: string;
}

export interface AppModel<V = any> {
  pkg: string;
  label: string;
  activity: string;
  /** DRM video: screenshots come back black on playback screens. */
  secureVideo?: boolean;
  /** Default onNewIntent behaviour (a TV can override it per app). */
  warmIntent?: WarmIntentMode;
  /** Fresh process state. */
  vars(): V;
  /** Process start. `uri` is the VIEW intent that started it (null from the launcher). Must go() to a screen. */
  start(a: AppInstance<V>, uri: string | null): void;
  /** A VIEW intent delivered to the running app. */
  intent(a: AppInstance<V>, uri: string): void;
  screens: Record<string, ScreenDef<V>>;
}

export class AppInstance<V = any> {
  screen = "";
  enteredAt = 0;
  stack: string[] = [];
  vars: V;
  constructor(public model: AppModel<V>, public tv: SimTv) {
    this.vars = model.vars();
  }
  get now() {
    return this.tv.clock.now();
  }
  get rng() {
    return this.tv.rng;
  }
  get def(): ScreenDef<V> {
    const d = this.model.screens[this.screen];
    if (!d) throw new Error(`${this.model.pkg}: no screen ${this.screen}`);
    return d;
  }
  /** Navigate forward (BACK returns here). */
  go(screen: string) {
    if (this.screen) this.stack.push(this.screen);
    this.set(screen);
  }
  /** Swap the current screen (a loading screen resolving). */
  replace(screen: string) {
    this.set(screen);
  }
  /** Back one screen; false when there's nothing to go back to. */
  back(): boolean {
    const prev = this.stack.pop();
    if (prev === undefined) return false;
    this.set(prev);
    return true;
  }
  /** Start over from one screen (the stack is cleared). */
  reset(screen: string) {
    this.stack = [];
    this.set(screen);
  }
  /** Record something a test can check later (e.g. "watch" with the content that started). */
  mark(kind: string, data?: unknown) {
    this.tv.events.push({ t: this.now, type: "mark", pkg: this.model.pkg, screen: this.screen, kind, data });
  }
  private set(screen: string) {
    if (!this.model.screens[screen]) throw new Error(`${this.model.pkg}: no screen ${screen}`);
    const from = this.screen;
    this.screen = screen;
    this.enteredAt = this.now;
    this.tv.events.push({ t: this.now, type: "screen", pkg: this.model.pkg, from, to: screen });
  }
}

// --- perturbations ---

export interface PopupSpec {
  /** Text drawn in the middle of the screen, e.g. STILL_WATCHING. */
  text: string;
  /** Only over this app (default: whatever is in front). */
  pkg?: string;
  /** When it appears: at a simulated time, when a screen comes up, or after N key presses. Default: immediately. */
  when?: { atMs?: number; screen?: string; afterKeys?: number };
  /** Keys that close it (default SELECT and BACK). Other keys are swallowed. */
  dismiss?: AllowedKey[];
  /** Hides everything under it (default false: the screen behind still shows around it). */
  covers?: boolean;
  /** While it's up the app ignores VIEW intents (default true). */
  modal?: boolean;
}

export const STILL_WATCHING = "Are you still watching? Continue watching Exit";
export const WHOS_WATCHING = "Who's watching? Avi Kids Add profile";

export interface Perturbations {
  /** Lose key presses: with probability p, or at these 0-based press indices, optionally only for some keys. */
  dropKeys?: { p?: number; at?: number[]; only?: AllowedKey[] };
  /** Multiply every loading time (2 = everything takes twice as long). */
  slowLoads?: number;
  /** Per-word probability that OCR misreads one character. */
  misread?: number;
  /** Per-screenshot probability of a black frame (DRM surface, a frame grabbed mid-transition). */
  blackFrames?: number;
  /** Per-screenshot probability that reading fails outright (a PNG cut short: "libpng error"). */
  readErrors?: number;
  popups?: PopupSpec[];
}

export interface SimCosts {
  keyMs: number; // adb input keyevent round trip
  readMs: number; // screencap + tesseract
  intentMs: number; // am start -W, app already running
  coldStartMs: number; // am start -W that has to start the process
  shellMs: number; // any other shell command
}

export const DEFAULT_COSTS: SimCosts = { keyMs: 150, readMs: 700, intentMs: 400, coldStartMs: 1500, shellMs: 120 };

export type SimEvent =
  | { t: number; type: "key"; key: AllowedKey; delivered: boolean; pkg: string; screen: string; popup?: string; index: number }
  | { t: number; type: "intent"; uri: string; pkg: string; warm: boolean; handled: boolean }
  | { t: number; type: "start"; pkg: string }
  | { t: number; type: "force-stop"; pkg: string }
  | { t: number; type: "screen"; pkg: string; from: string; to: string }
  | { t: number; type: "popup"; text: string; shown: boolean }
  | { t: number; type: "read"; pkg: string; screen: string; black: boolean; error: boolean; text: string }
  | { t: number; type: "mark"; pkg: string; screen: string; kind: string; data?: unknown };

export interface SimOptions {
  apps: AppModel[];
  seed?: number;
  /** Screenshot size (default 1920×1080). */
  resolution?: { width: number; height: number };
  perturb?: Perturbations;
  costs?: Partial<SimCosts>;
  /** Override onNewIntent behaviour per package. */
  warmIntent?: Record<string, WarmIntentMode>;
  serial?: string;
}

export const LAUNCHER_PKG = "com.amazon.tv.launcher";

const launcherModel: AppModel<Record<string, never>> = {
  pkg: LAUNCHER_PKG,
  label: "Home",
  activity: ".Main",
  vars: () => ({}),
  start: (a) => a.reset("home"),
  intent: () => undefined,
  screens: {
    home: {
      draw: () => [...line("Home Find Live Library", 200, 60), ...line("Recently used apps Your apps Settings", 200, 500)],
      keys: { BACK: () => undefined },
    },
  },
};

interface ActivePopup {
  spec: PopupSpec;
  pkg: string;
}

export class SimTv {
  readonly clock = new SimClock();
  readonly rng: () => number;
  readonly events: SimEvent[] = [];
  readonly costs: SimCosts;
  readonly width: number;
  readonly height: number;
  readonly serial: string;
  perturb: Perturbations;
  private models = new Map<string, AppModel>();
  private running = new Map<string, AppInstance>();
  private fg = LAUNCHER_PKG;
  private keyIndex = 0;
  private popupFired: boolean[];
  private popup: ActivePopup | null = null;
  private frames = new Map<number, SimWord[]>();
  private frameSeq = 1;
  private warmOverrides: Record<string, WarmIntentMode>;

  constructor(o: SimOptions) {
    this.rng = seeded(o.seed ?? 1);
    this.costs = { ...DEFAULT_COSTS, ...o.costs };
    this.width = o.resolution?.width ?? REF_W;
    this.height = o.resolution?.height ?? REF_H;
    this.serial = o.serial ?? "10.0.0.5:5555";
    this.perturb = o.perturb ?? {};
    this.popupFired = (this.perturb.popups ?? []).map(() => false);
    this.warmOverrides = o.warmIntent ?? {};
    for (const m of [launcherModel as AppModel, ...o.apps]) this.models.set(m.pkg, m);
    const home = new AppInstance(launcherModel, this);
    launcherModel.start(home, null);
    this.running.set(LAUNCHER_PKG, home);
  }

  // --- state ---

  get foreground(): string {
    return this.fg;
  }
  /** The running instance of an app (undefined when its process isn't running). */
  app<V = any>(pkg: string): AppInstance<V> | undefined {
    return this.running.get(pkg) as AppInstance<V> | undefined;
  }
  isRunning(pkg: string) {
    return this.running.has(pkg);
  }
  /** The app in front and its screen. */
  get current(): { pkg: string; screen: string } {
    return { pkg: this.fg, screen: this.running.get(this.fg)!.screen };
  }
  get activePopup(): string | null {
    return this.popup?.spec.text ?? null;
  }
  marks(kind?: string) {
    return this.events.filter((e): e is Extract<SimEvent, { type: "mark" }> => e.type === "mark" && (!kind || e.kind === kind));
  }
  keys() {
    return this.events.filter((e): e is Extract<SimEvent, { type: "key" }> => e.type === "key");
  }

  // --- time ---

  async sleep(ms: number) {
    this.spend(ms);
  }
  private spend(ms: number) {
    this.clock.advance(ms);
    this.tick();
  }
  /** Run timed transitions and popups that are due. */
  tick() {
    const slow = this.perturb.slowLoads ?? 1;
    for (let guard = 0; guard < 50; guard++) {
      let moved = false;
      for (const a of this.running.values()) {
        const after = a.def.after;
        if (!after) continue;
        const ms = (typeof after.ms === "function" ? after.ms(a) : after.ms) * slow;
        if (this.clock.now() - a.enteredAt >= ms) {
          // The new screen started when the timer was due, not now (a long sleep can cover several transitions).
          const due = a.enteredAt + ms;
          a.replace(typeof after.to === "function" ? after.to(a) : after.to);
          a.enteredAt = due;
          moved = true;
        }
      }
      if (!moved) break;
    }
    this.checkPopups();
  }

  private checkPopups() {
    if (this.popup) return;
    const specs = this.perturb.popups ?? [];
    for (let i = 0; i < specs.length; i++) {
      if (this.popupFired[i]) continue;
      const s = specs[i];
      if (s.pkg && s.pkg !== this.fg) continue;
      const w = s.when ?? {};
      if (w.atMs !== undefined && this.clock.now() < w.atMs) continue;
      if (w.afterKeys !== undefined && this.keyIndex < w.afterKeys) continue;
      if (w.screen !== undefined && this.running.get(this.fg)?.screen !== w.screen) continue;
      this.popupFired[i] = true;
      this.popup = { spec: s, pkg: this.fg };
      this.events.push({ t: this.clock.now(), type: "popup", text: s.text, shown: true });
      return;
    }
  }

  // --- input ---

  async press(key: AllowedKey): Promise<void> {
    this.spend(this.costs.keyMs);
    const index = this.keyIndex++;
    const d = this.perturb.dropKeys;
    const eligible = !d?.only || d.only.includes(key);
    const dropped = !!d && eligible && ((d.at?.includes(index) ?? false) || (d.p !== undefined && this.rng() < d.p));
    const a = this.running.get(this.fg)!;
    this.events.push({ t: this.clock.now(), type: "key", key, delivered: !dropped, pkg: this.fg, screen: a.screen, popup: this.popup?.spec.text, index });
    if (dropped) return;
    if (key === "HOME") {
      this.fg = LAUNCHER_PKG;
      this.popup = null;
    } else if (this.popup) {
      if ((this.popup.spec.dismiss ?? ["SELECT", "BACK"]).includes(key)) {
        this.events.push({ t: this.clock.now(), type: "popup", text: this.popup.spec.text, shown: false });
        this.popup = null;
      }
    } else if (!a.def.dropsKeys) {
      const h = a.def.keys?.[key];
      if (h) h(a);
      else if (key === "BACK" && !a.back()) this.fg = LAUNCHER_PKG; // back out of the app's first screen
    }
    this.tick();
  }

  /** A VIEW intent for `pkg` (am start -a VIEW -d uri pkg). Cold-starts the app if it isn't running. */
  view(uri: string, pkg: string): { ok: boolean; warm: boolean; handled: boolean } {
    const m = this.models.get(pkg);
    if (!m || m === launcherModel) return { ok: false, warm: false, handled: false };
    const existing = this.running.get(pkg);
    if (!existing) {
      this.spend(this.costs.coldStartMs);
      const a = this.startProcess(m, uri);
      this.events.push({ t: this.clock.now(), type: "intent", uri, pkg, warm: false, handled: true });
      void a;
      this.tick();
      return { ok: true, warm: false, handled: true };
    }
    this.spend(this.costs.intentMs);
    if (this.fg !== pkg) {
      this.fg = pkg;
      if (this.popup && this.popup.pkg !== pkg) this.popup = null;
    }
    const mode = this.warmOverrides[pkg] ?? m.warmIntent ?? "handled";
    const blocked = !!this.popup && this.popup.spec.modal !== false;
    const handled = !blocked && handlesWarm(mode, existing.screen);
    this.events.push({ t: this.clock.now(), type: "intent", uri, pkg, warm: true, handled });
    if (handled) m.intent(existing, uri);
    this.tick();
    return { ok: true, warm: true, handled };
  }

  /** Start from the launcher (am start -n / monkey): resumes a running app, cold-starts otherwise. */
  launch(pkg: string): boolean {
    const m = this.models.get(pkg);
    if (!m) return false;
    if (this.running.has(pkg)) {
      this.spend(this.costs.intentMs);
      this.fg = pkg;
    } else {
      this.spend(this.costs.coldStartMs);
      this.startProcess(m, null);
    }
    this.tick();
    return true;
  }

  forceStop(pkg: string) {
    this.spend(this.costs.shellMs);
    if (pkg === LAUNCHER_PKG || !this.running.has(pkg)) return;
    this.running.delete(pkg);
    this.events.push({ t: this.clock.now(), type: "force-stop", pkg });
    if (this.popup?.pkg === pkg) this.popup = null;
    if (this.fg === pkg) this.fg = LAUNCHER_PKG;
  }

  private startProcess(m: AppModel, uri: string | null): AppInstance {
    const a = new AppInstance(m, this);
    this.running.set(m.pkg, a);
    this.fg = m.pkg;
    this.events.push({ t: this.clock.now(), type: "start", pkg: m.pkg });
    m.start(a, uri);
    return a;
  }

  // --- output ---

  /** What's really on screen, unperturbed, in screenshot coordinates. */
  truth(): SimWord[] {
    const a = this.running.get(this.fg)!;
    let words = a.def.playback && a.model.secureVideo ? [] : a.def.draw(a);
    if (this.popup) {
      const pop = line(this.popup.spec.text, 560, 480, 40);
      words = this.popup.spec.covers ? pop : [...words, ...pop];
    }
    return scaleWords(readingOrder(words), this.width, this.height);
  }

  /** One screenshot as a fake PNG (what `adb exec-out screencap -p` would return). Perturbations apply here. */
  async capture(): Promise<Buffer> {
    this.spend(this.costs.readMs / 2);
    const p = this.perturb;
    const a = this.running.get(this.fg)!;
    const error = (p.readErrors ?? 0) > 0 && this.rng() < p.readErrors!;
    const black = !error && (p.blackFrames ?? 0) > 0 && this.rng() < p.blackFrames!;
    let words: SimWord[] = black ? [] : this.truth();
    if (p.misread) words = words.map((w) => (this.rng() < p.misread! ? { ...w, text: misread(w.text, this.rng) } : w));
    this.events.push({ t: this.clock.now(), type: "read", pkg: this.fg, screen: a.screen, black, error, text: words.map((w) => w.text).join(" ") });
    const id = this.frameSeq++;
    this.frames.set(id, words);
    if (this.frames.size > 64) this.frames.delete(id - 64);
    // A truncated PNG: the OCR step will fail on it.
    return error ? Buffer.from([0x89, 0x50, 0x4e]) : fakePng(id, this.width, this.height);
  }

  /** tesseract TSV stand-in. */
  async boxes(png: Buffer): Promise<OcrPage> {
    this.spend(this.costs.readMs / 2);
    const { frameId, width, height } = fakePngInfo(png);
    return { words: (this.frames.get(frameId) ?? []).map((w) => ({ ...w })), width, height };
  }

  /** tesseract text stand-in. */
  async ocr(png: Buffer): Promise<string> {
    return (await this.boxes(png)).words.map((w) => w.text).join(" ");
  }

  /** Screen text now (capture + OCR). */
  async readText(): Promise<string> {
    return this.ocr(await this.capture());
  }
  async readPage(): Promise<OcrPage> {
    return this.boxes(await this.capture());
  }

  // --- adapters ---

  /** NavDeps for openGameViaSearch. `reopenUri` is the search link that reopen() re-sends. */
  navDeps(o: { reopenUri?: string; pkg?: string; note?: (m: string) => void } = {}): NavDeps {
    return {
      press: (k) => this.press(k),
      reopen: async () => {
        if (!o.reopenUri || !o.pkg) throw new Error("no reopen link");
        this.view(o.reopenUri, o.pkg);
      },
      read: () => this.readText(),
      sleep: (ms) => this.sleep(ms),
      now: this.clock.now,
      note: o.note,
    };
  }

  plexDeps(o: { note?: (m: string) => void } = {}): PlexNavDeps {
    return {
      press: (k) => this.press(k),
      screen: async () => plexScreenFromPage(await this.readPage()),
      sleep: (ms) => this.sleep(ms),
      now: this.clock.now,
      note: o.note,
    };
  }

  primeDeps(o: { note?: (m: string) => void } = {}): PrimeNavDeps {
    return {
      press: (k) => this.press(k),
      screen: async () => primeScreenFromPage(await this.readPage()),
      sleep: (ms) => this.sleep(ms),
      now: this.clock.now,
      note: o.note,
    };
  }

  /** The driver's `screen` option: screenshots and OCR from this TV. */
  driverScreen() {
    return { capture: () => this.capture(), ocr: (png: Buffer) => this.ocr(png), boxes: (png: Buffer) => this.boxes(png) };
  }

  /** An AdbExec that answers like `adb` talking to this TV. Unknown commands fail with code 1. */
  adbExec(): AdbExec {
    const codeFor = Object.fromEntries(Object.entries(KEYCODES).map(([k, v]) => [v, k as AllowedKey]));
    return async (args) => {
      const out = (stdout: string, code = 0) => ({ stdout, stderr: "", code });
      if (args[0] === "connect") return out(`already connected to ${args[1]}`);
      if (args[0] === "devices") return out(`List of devices attached\n${this.serial}\tdevice\n`);
      if (args[0] !== "-s" || args[1] !== this.serial || args[2] !== "shell") return out("", 1);
      const sh = args.slice(3).map(unquote);
      const cmd = sh.join(" ");
      if (sh[0] === "input" && sh[1] === "keyevent") {
        const k = codeFor[sh[2]];
        if (!k) return out("", 1);
        await this.press(k);
        return out("");
      }
      if (sh[0] === "am" && sh[1] === "start" && sh.includes("android.intent.action.VIEW")) {
        const uri = sh[sh.indexOf("-d") + 1];
        const pkg = sh.at(-1)!;
        const r = this.view(uri, pkg);
        if (!r.ok) return out(`Starting: Intent { act=android.intent.action.VIEW dat=${uri} pkg=${pkg} }\nError: Activity not started, unable to resolve Intent`);
        const warn = r.warm ? "Warning: Activity not started, intent has been delivered to currently running top-most instance.\n" : "";
        return out(`Starting: Intent { act=android.intent.action.VIEW dat=${uri} pkg=${pkg} }\n${warn}Status: ok\nLaunchState: ${r.warm ? "HOT" : "COLD"}\nTotalTime: 900`);
      }
      if (sh[0] === "am" && sh[1] === "start" && sh.includes("-n")) {
        const pkg = sh[sh.indexOf("-n") + 1].split("/")[0];
        return this.launch(pkg) ? out("Starting: Intent { cmp=" + pkg + " }\nStatus: ok") : out("Error: Activity class does not exist.");
      }
      if (sh[0] === "monkey") {
        const pkg = sh[sh.indexOf("-p") + 1];
        return this.launch(pkg) ? out("Events injected: 1") : out("No activities found to run, monkey aborted.");
      }
      if (sh[0] === "am" && sh[1] === "force-stop") {
        this.forceStop(sh[2]);
        return out("");
      }
      this.spend(this.costs.shellMs);
      if (cmd === "dumpsys activity activities") return out(this.dumpsysActivities());
      if (cmd === "dumpsys power") return out("mWakefulness=Awake\nDisplay Power: state=ON");
      if (cmd === "dumpsys media_session") return out(this.dumpsysMediaSession());
      if (sh[0] === "pidof") {
        const i = [...this.running.keys()].indexOf(sh[1]);
        return i >= 0 ? out(`${4000 + i * 37}\n`) : out("", 1);
      }
      if (sh[0] === "cmd" && sh[1] === "package" && sh[2] === "resolve-activity") {
        const m = this.models.get(sh.at(-1)!);
        return out(m ? `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\n${m.pkg}/${m.activity}` : "No activity found");
      }
      return out("", 1);
    };
  }

  private activityOf(a: AppInstance): string {
    return a.def.activity ?? a.model.activity;
  }

  /** The bits of `dumpsys activity activities` the server parses: the resumed activity, then every task. */
  dumpsysActivities(): string {
    const top = this.running.get(this.fg)!;
    const lines = [
      "ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)",
      "Display #0 (activities from top to bottom):",
    ];
    let t = 100;
    const order = [this.fg, ...[...this.running.keys()].filter((p) => p !== this.fg)];
    for (const pkg of order) {
      const a = this.running.get(pkg)!;
      t++;
      lines.push(`  * Task{${t.toString(16)}a #${t} type=standard A=10${t}:${pkg} U=0 visible=${pkg === this.fg} mode=fullscreen}`);
      lines.push(`    * Hist #0: ActivityRecord{${t}f u0 ${pkg}/${this.activityOf(a)} t${t}}`);
    }
    lines.push(`  ResumedActivity: ActivityRecord{${t}f u0 ${top.model.pkg}/${this.activityOf(top)} t101}`);
    lines.unshift(`  topResumedActivity=ActivityRecord{1f u0 ${top.model.pkg}/${this.activityOf(top)} t101}`);
    return lines.join("\n");
  }

  /** `dumpsys media_session`: one session per running app with a player; state 3 = playing, 2 = paused. */
  dumpsysMediaSession(): string {
    const out = ["MEDIA SESSION SERVICE (dumpsys media_session)", "", `Sessions Stack - have ${this.running.size - 1} sessions:`];
    for (const [pkg, a] of this.running) {
      if (pkg === LAUNCHER_PKG) continue;
      const playing = !!a.def.playback && this.fg === pkg;
      out.push(
        `  ${a.model.label} ${pkg}/MediaSession (userId=0)`,
        `    ownerPid=4000, ownerUid=10085, userId=0`,
        `    package=${pkg}`,
        `    active=${a.def.playback ? "true" : "false"}`,
        `    state=PlaybackState {state=${playing ? 3 : a.def.playback ? 2 : 1}, position=0, buffered position=0, speed=${playing ? "1.0" : "0.0"}, updated=0, actions=0, custom actions=[], active item id=-1, error=null}`,
      );
    }
    return out.join("\n");
  }
}

/** Undo shellQuote (single quotes, with '\'' for a quote inside). */
export function unquote(s: string): string {
  if (!s.startsWith("'")) return s;
  return s.slice(1, -1).replace(/'\\''/g, "'");
}
