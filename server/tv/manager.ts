import type { TvStatus } from "../../lib/types";
import type { Tv } from "../../lib/profile";
import { APP_BY_ID, APPS, type Platform } from "../../lib/catalog/apps";
import { makeScreencap, type AdbExec } from "../adb";
import { AndroidTvDriver, type DriverOptions } from "../driver";
import type { Ocr, OcrBoxes } from "../ocr";
import { serialOf } from "./commands";
import { createKeySender, type Backend } from "./keys";
import { findConnectPort, identifyTv, type TvIdentity } from "./pairing";
import type { MdnsService } from "./discovery";

// Every TV in the household, each with its own driver (and so its own one-launch-at-a-time lock), status and
// installed apps. Follows config changes: TVs added or removed in setup start and stop here.

export type TvState = TvStatus & { id: string; name: string; platform: Platform };

export interface TvManagerOptions {
  exec: AdbExec;
  adbBin?: string;
  /** Fast key methods to try, in order (server/tv/keys.ts). Empty or unset: one-shot `input keyevent`. */
  keyBackends?: Backend[];
  ocr?: { ocr: Ocr; boxes: OcrBoxes } | null;
  shared: Omit<DriverOptions, "serial" | "exec" | "apps" | "platform" | "installed" | "screen">;
  log?: (e: Record<string, unknown>) => void;
  plexState?: () => TvStatus["plex"];
  /** A Google TV turned up on a new Wireless-debugging port (it changes after a reboot): save it. */
  onPortChange?: (tvId: string, port: number) => void;
  /** mDNS browse, injectable for tests. */
  browse?: () => Promise<MdnsService[]>;
}

interface Entry {
  tv: Tv;
  driver: AndroidTvDriver;
  status: TvState;
  installed: Record<string, string> | null; // app id -> package, from the last check
  lastState: string;
}

export class TvManager {
  private tvs = new Map<string, Entry>();
  onStatus?: (s: TvState) => void;

  constructor(private o: TvManagerOptions) {}

  /** Bring the set of drivers in line with the configured TVs. */
  sync(tvs: Tv[]): void {
    const want = new Set(tvs.map((t) => t.id));
    for (const [id, e] of this.tvs) if (!want.has(id)) (e.driver.close(), this.tvs.delete(id));
    for (const tv of tvs) {
      const cur = this.tvs.get(tv.id);
      if (cur && cur.tv.host === tv.host && cur.tv.port === tv.port && cur.tv.platform === tv.platform) {
        cur.tv = tv;
        cur.status = { ...cur.status, name: tv.name };
        continue;
      }
      cur?.driver.close(); // moved to a new address: drop the old key shell
      this.tvs.set(tv.id, this.makeEntry(tv));
    }
  }

  private makeEntry(tv: Tv): Entry {
    const serial = serialOf(tv.host, tv.port);
    const entry: Entry = {
      tv,
      installed: null,
      lastState: "",
      status: { id: tv.id, name: tv.name, platform: tv.platform, adb: "offline", screenOn: null, foreground: null, plex: this.o.plexState?.() ?? "unconfigured", latencyMs: null },
      driver: null as unknown as AndroidTvDriver,
    };
    // Inherit (not spread) the shared options so getters like `plex` stay live when settings change.
    const opts: DriverOptions = Object.assign(Object.create(this.o.shared), {
      serial,
      exec: this.o.exec,
      apps: () => APP_BY_ID,
      platform: () => entry.tv.platform,
      installed: () => entry.installed,
      keys: this.o.keyBackends?.length ? createKeySender({ serial, bin: this.o.adbBin, exec: this.o.exec, log: this.o.log, backends: this.o.keyBackends }) : null,
      screen: this.o.ocr ? { capture: makeScreencap(serial, this.o.adbBin), ocr: this.o.ocr.ocr, boxes: this.o.ocr.boxes } : null,
    });
    entry.driver = new AndroidTvDriver(opts);
    return entry;
  }

  close(): void {
    for (const e of this.tvs.values()) e.driver.close();
  }

  ids(): string[] {
    return [...this.tvs.keys()];
  }

  /** The TV to use: the one asked for (null if it's gone, never a different TV), else the default, else the first. */
  pick(id?: string | null, fallback?: string | null): { tv: Tv; driver: AndroidTvDriver } | null {
    if (id) {
      const e = this.tvs.get(id);
      return e ? { tv: e.tv, driver: e.driver } : null;
    }
    const e = (fallback && this.tvs.get(fallback)) || this.tvs.values().next().value;
    return e ? { tv: e.tv, driver: e.driver } : null;
  }

  statuses(): TvState[] {
    return [...this.tvs.values()].map((e) => e.status);
  }

  status(id: string): TvState | null {
    return this.tvs.get(id)?.status ?? null;
  }

  private checking: Promise<void> | null = null;
  private lastBrowse = new Map<string, number>();

  /** Check every TV: reconnect if needed, read its state, report changes. One check at a time. */
  watchdog(): Promise<void> {
    this.checking ??= this.check().finally(() => (this.checking = null));
    return this.checking;
  }

  /** An offline Google TV may have come back on a new port: look for it over mDNS (at most once a minute per TV). */
  private async rediscover(e: Entry): Promise<void> {
    if (e.tv.platform !== "googletv" || !this.o.onPortChange) return;
    const now = Date.now();
    if (now - (this.lastBrowse.get(e.tv.id) ?? 0) < 60_000) return;
    this.lastBrowse.set(e.tv.id, now);
    const port = await findConnectPort(this.o.exec, e.tv.host, this.o.browse).catch(() => null);
    if (port && port !== e.tv.port) {
      this.o.log?.({ evt: "tv_port_changed", tv: e.tv.id, from: e.tv.port, to: port });
      this.o.onPortChange(e.tv.id, port);
    }
  }

  private async check(): Promise<void> {
    await Promise.all([...this.tvs.values()].map(async (e) => {
      const plex = this.o.plexState?.() ?? "unconfigured";
      try {
        await e.driver.ensureConnected();
        const s = await e.driver.status(plex);
        e.status = { ...s, id: e.tv.id, name: e.tv.name, platform: e.tv.platform };
        // First time we see it connected: learn which apps are installed (package names differ by platform).
        if (s.adb === "connected" && !e.installed) await this.refreshApps(e.tv.id).catch(() => {});
      } catch (err) {
        e.status = { ...e.status, adb: "offline", screenOn: null, foreground: null, plex, latencyMs: null };
        this.o.log?.({ evt: "watchdog_error", tv: e.tv.id, error: (err as Error).message });
      }
      if (e.status.adb === "offline") await this.rediscover(e);
      const state = `${e.status.adb}/${e.status.screenOn}`;
      if (state !== e.lastState) this.o.log?.({ evt: "tv_state", tv: e.tv.id, adb: e.status.adb, screenOn: e.status.screenOn, foreground: e.status.foreground, latencyMs: e.status.latencyMs });
      e.lastState = state;
      this.onStatus?.(e.status);
    }));
  }

  /** Read the TV's platform and installed catalog apps. */
  async refreshApps(id: string): Promise<TvIdentity | null> {
    const e = this.tvs.get(id);
    if (!e) return null;
    const ident = await identifyTv(this.o.exec, e.tv.host, e.tv.port, APPS);
    e.installed = ident.packagesRead ? Object.fromEntries(ident.apps.map((a) => [a.id, a.package])) : null;
    return ident;
  }

  installedApps(id: string): string[] | null {
    const e = this.tvs.get(id);
    if (!e) return null;
    return e.installed ? Object.keys(e.installed) : e.tv.apps.length ? e.tv.apps : null;
  }
}
