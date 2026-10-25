import { join } from "node:path";
import { parseTrustedProxies } from "./auth/net";
import type { LegacyEnv } from "./store/migrate";
import type { Backend } from "./tv/keys";

// Bootstrap settings from the environment: only what's needed before the app can start. Everything else
// (services, market, TVs, Plex, users) is set up in the app and saved in DATA_DIR (server/store/config.ts).

export interface Config {
  port: number;
  bind: string; // listen address; 0.0.0.0 = every interface
  adbBin: string;
  /** How remote keys reach the TV, fastest first (KEY_METHODS). "oneshot" alone = the old `adb shell input keyevent`. */
  keyBackends: Backend[];
  trustedProxies: string[]; // CIDRs (or "loopback", "private") of reverse proxies we believe
  allowedHosts: string[];
  publicUrl: string | null; // how people reach the app, e.g. https://games.example.com (used in the setup link)
  sessionDays: number;
  dataDir: string;
  staticDir: string;
  /** v1 settings that the config store imports on first start (FIRETV_HOST, PLEX_*, ESPN key). */
  legacy: LegacyEnv;
  /** Old environment variables that are set but no longer used; main.ts warns about them. */
  ignored: string[];
}

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const UNUSED = ["SESSION_SECRET", "APP_PASSCODE", "ALLOWED_TAILNET_USERS", "LAN_BIND"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let trustedProxies: string[];
  try {
    trustedProxies = parseTrustedProxies(env.TRUSTED_PROXIES);
  } catch (e) {
    throw new Error(`TRUSTED_PROXIES: ${(e as Error).message}`);
  }
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a port number.");
  const sessionDays = Number(env.SESSION_DAYS ?? 30);
  if (!(sessionDays > 0 && sessionDays <= 400)) throw new Error("SESSION_DAYS must be between 1 and 400.");
  // Fastest first, over one persistent shell: "evdev" writes key events straight to the TV's input device (~10 ms, no
  // Java start per press), "cmd" is `cmd input` (Android 11+), "input" the classic tool. Each TV is probed; unusable ones
  // are skipped and a failed write falls back within the same batch.
  const methods = list(env.KEY_METHODS ?? "evdev,cmd,input");
  if (methods.some((m) => !["evdev", "cmd", "input", "oneshot"].includes(m))) throw new Error("KEY_METHODS: use evdev, cmd, input or oneshot.");
  const keyBackends = methods.includes("oneshot") ? [] : (methods as Backend[]);
  const publicUrl = env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, "") : null;
  if (publicUrl && !/^https?:\/\/[^/\s]+$/.test(publicUrl)) throw new Error("PUBLIC_URL must look like https://games.example.com");
  return {
    port,
    bind: env.BIND || "0.0.0.0",
    adbBin: env.ADB_BIN ?? "adb",
    keyBackends,
    trustedProxies,
    allowedHosts: list(env.ALLOWED_HOSTS),
    publicUrl,
    sessionDays,
    dataDir: env.DATA_DIR ?? "/var/lib/sports-remote",
    staticDir: env.STATIC_DIR ?? join(process.cwd(), "dist/web"),
    legacy: {
      FIRETV_HOST: env.FIRETV_HOST, PLEX_URL: env.PLEX_URL, PLEX_TOKEN: env.PLEX_TOKEN,
      PLEX_PLAYER_ID: env.PLEX_PLAYER_ID, ESPN_WATCH_API_KEY: env.ESPN_WATCH_API_KEY,
    },
    ignored: UNUSED.filter((k) => env[k]),
  };
}
