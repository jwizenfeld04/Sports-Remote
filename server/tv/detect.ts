// Work out what kind of TV this is and which catalog apps are on it, from `getprop` and `pm list packages`.

export type Platform = "firetv" | "googletv";

export interface DeviceProps {
  manufacturer: string;
  brand: string;
  model: string;
  device: string;
  sdk: number | null;
  characteristics: string;
  fireOsVersion: string | null;
}

/** `getprop` prints lines like `[ro.product.model]: [AFTKA]`. */
export function parseGetprop(out: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = /^\[([^\]]+)\]:\s*\[(.*)\]\s*$/.exec(line.trim());
    if (m) props[m[1]] = m[2];
  }
  return props;
}

export function deviceProps(props: Record<string, string>): DeviceProps {
  const sdk = Number(props["ro.build.version.sdk"]);
  return {
    manufacturer: props["ro.product.manufacturer"] ?? "",
    brand: props["ro.product.brand"] ?? "",
    model: props["ro.product.model"] ?? "",
    device: props["ro.product.device"] ?? "",
    sdk: Number.isFinite(sdk) && sdk > 0 ? sdk : null,
    characteristics: props["ro.build.characteristics"] ?? "",
    fireOsVersion: props["ro.build.version.fireos"] ?? null,
  };
}

/** One line per package: `package:com.espn.gtv`. */
export function parsePackages(out: string): Set<string> {
  const set = new Set<string>();
  for (const line of out.split("\n")) {
    const m = /^package:([A-Za-z0-9_.]+)\s*$/.exec(line.trim());
    if (m) set.add(m[1]);
  }
  return set;
}

const FIRE_LAUNCHERS = ["com.amazon.tv.launcher"];
const GOOGLE_TV_LAUNCHERS = ["com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "com.google.android.leanbacklauncher"];

/**
 * Fire OS reports manufacturer Amazon and a Fire OS version; Google TV and Android TV have Google's TV launchers.
 * null = not a TV we support (a phone, or an unknown Android box).
 */
export function detectPlatform(p: DeviceProps, packages: Set<string>): Platform | null {
  if (VEGA_MODELS.has(p.model)) return null; // Vega OS: not Android
  if (/amazon/i.test(p.manufacturer) || p.fireOsVersion || FIRE_LAUNCHERS.some((x) => packages.has(x))) return "firetv";
  if (GOOGLE_TV_LAUNCHERS.some((x) => packages.has(x))) return "googletv";
  if (/\btv\b/i.test(p.characteristics)) return "googletv"; // other Android TV builds behave the same over adb
  return null;
}

/** Fire TV models that run Vega OS instead of Android: no ADB, so they can't be controlled. */
export const VEGA_MODELS = new Set(["AFTCA002", "AFTCL001", "AFTCR001"]);

/** A friendly default name: "Fire TV Stick 4K Max", "Chromecast with Google TV", or the model code. */
export function friendlyModel(p: DeviceProps): string {
  const known: Record<string, string> = {
    // Amazon's model table: developer.amazon.com/docs/device-specs/identify-fire-tv-devices.html
    AFTKA: "Fire TV Stick 4K Max", AFTKRT: "Fire TV Stick 4K Max (2nd gen)", AFTKM: "Fire TV Stick 4K (2nd gen)",
    AFTMM: "Fire TV Stick 4K", AFTMA08C15: "Fire TV Stick 4K Plus", AFTSSS: "Fire TV Stick (3rd gen)", AFTSS: "Fire TV Stick Lite",
    AFTT: "Fire TV Stick (2nd gen)", AFTM: "Fire TV Stick", AFTA: "Fire TV Cube", AFTR: "Fire TV Cube (2nd gen)",
    AFTGAZL: "Fire TV Cube (3rd gen)", AFTN: "Fire TV (3rd gen)", AFTKA002: "Fire TV 2-Series", AFTKAUK002: "Fire TV 2-Series",
    AFTTI43: "Fire TV 4-Series", AFTTIFF43: "Fire TV Omni", AFTDCT31: "Fire TV smart TV",
    "Chromecast": "Chromecast with Google TV", "Google TV Streamer": "Google TV Streamer", "SHIELD Android TV": "NVIDIA Shield",
  };
  if (known[p.model]) return known[p.model];
  if (/^AFT/.test(p.model)) return `Fire TV (${p.model})`;
  return [p.brand && p.brand.toLowerCase() !== "google" ? cap(p.brand) : "", p.model].filter(Boolean).join(" ") || "Android TV";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface AppPackages {
  id: string;
  packages: Partial<Record<Platform, string[]>>;
}

/** Catalog apps installed on this TV, in catalog order. A platform's first listed package that's present wins. */
export function installedApps(apps: AppPackages[], platform: Platform, packages: Set<string>): { id: string; package: string }[] {
  const out: { id: string; package: string }[] = [];
  for (const a of apps) {
    const pkg = (a.packages[platform] ?? []).find((p) => packages.has(p));
    if (pkg) out.push({ id: a.id, package: pkg });
  }
  return out;
}
