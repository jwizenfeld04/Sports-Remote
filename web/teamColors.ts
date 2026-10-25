import type { TeamRef } from "../lib/types";

// Team colors -> card colors with readable text (WCAG AA) and two halves that don't blur together.

type Rgb = [number, number, number];

export const NEUTRAL = "#2b3442";
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
export const INK_LIGHT = "#ffffff";
export const INK_DARK = "#0b0d12";
const MIN_CONTRAST = 5; // AA is 4.5; headroom for the soft sheen drawn over the card

export function parseHex(hex: string | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Perceptual-ish RGB distance ("redmean"), 0..~765. */
export function distance(a: Rgb, b: Rgb): number {
  const rm = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const ink = (hex: string): Rgb => parseHex(hex)!;

/** Pick white or near-black text, nudging the background until it reaches MIN_CONTRAST. */
export function readable(bg: Rgb): { bg: string; ink: string } {
  let c = bg;
  // Near-black reads as a hole in the dark page: lift it a little.
  if (luminance(c) < 0.008) c = mix(c, WHITE, 0.09);
  for (let i = 0; i < 20; i++) {
    const onWhite = contrast(c, WHITE);
    const onDark = contrast(c, ink(INK_DARK));
    if (onWhite >= MIN_CONTRAST) return { bg: toHex(c), ink: INK_LIGHT };
    if (onDark >= MIN_CONTRAST) return { bg: toHex(c), ink: INK_DARK };
    // Mid-tones: move toward whichever ink is already closer to passing.
    c = onWhite >= onDark ? mix(c, BLACK, 0.08) : mix(c, WHITE, 0.08);
  }
  return { bg: toHex(c), ink: contrast(c, WHITE) >= contrast(c, ink(INK_DARK)) ? INK_LIGHT : INK_DARK };
}

const SEPARATION = 120;

export interface CardColors {
  away: string;
  awayInk: string;
  home: string;
  homeInk: string;
}

/** Away color on one half, home on the other: switch the home side to a variant when the two are too close. */
export function cardColors(away: TeamRef, home: TeamRef): CardColors {
  const ra = readable(parseHex(away.color) ?? parseHex(NEUTRAL)!);
  const a = parseHex(ra.bg)!;
  const h = parseHex(home.color) ?? parseHex(NEUTRAL)!;
  const alt = parseHex(home.alternateColor);
  const candidates: Rgb[] = [h, ...(alt && luminance(alt) < 0.6 ? [alt] : []), mix(h, WHITE, 0.35), mix(h, BLACK, 0.55), ...(alt ? [alt] : []), mix(h, WHITE, 0.6)];
  let best = readable(h);
  let bestD = -1;
  for (const c of candidates) {
    const r = readable(c);
    const d = distance(a, parseHex(r.bg)!);
    if (d >= SEPARATION) {
      best = r;
      break;
    }
    if (d > bestD) [best, bestD] = [r, d];
  }
  return { away: ra.bg, awayInk: ra.ink, home: best.bg, homeInk: best.ink };
}
