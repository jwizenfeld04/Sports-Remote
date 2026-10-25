import { describe, expect, it } from "vitest";
import { cardColors, contrast, distance, parseHex, readable } from "../web/teamColors";
import type { TeamRef } from "../lib/types";
import { allGames } from "./helpers";

const team = (color?: string, alternateColor?: string): TeamRef => ({ id: "1", abbr: "X", name: "X", city: "", displayName: "X", color, alternateColor });
const ratio = (bg: string, ink: string) => contrast(parseHex(bg)!, parseHex(ink)!);

describe("team colors", () => {
  it("every fixture matchup has AA text contrast on both halves", () => {
    for (const g of allGames()) {
      const c = cardColors(g.away, g.home);
      expect(ratio(c.away, c.awayInk), `${g.id} away`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.home, c.homeInk), `${g.id} home`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses dark ink on light colors and white ink on dark ones", () => {
    expect(readable(parseHex("#ffd100")!).ink).toBe("#0b0d12");
    expect(readable(parseHex("#003594")!).ink).toBe("#ffffff");
  });

  it("darkens or lightens mid-tones that pass with neither ink", () => {
    const r = readable(parseHex("#e31837")!); // Chiefs red: ~4.6:1 with white, under the 5:1 target
    expect(ratio(r.bg, r.ink)).toBeGreaterThanOrEqual(5);
    expect(distance(parseHex(r.bg)!, parseHex("#e31837")!)).toBeLessThan(80); // still recognizably red
  });

  it("lifts pure black off the page background", () => {
    expect(readable(parseHex("#000000")!).bg).not.toBe("#000000");
  });

  it("separates two teams with nearly the same color (Bills at Rams, both royal blue)", () => {
    const c = cardColors(team("#00338d", "#d50a0a"), team("#003594", "#ffd100"));
    expect(distance(parseHex(c.away)!, parseHex(c.home)!)).toBeGreaterThanOrEqual(120);
    expect(ratio(c.home, c.homeInk)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps both primaries when they're already distinct", () => {
    const c = cardColors(team("#0080c6"), team("#002a5c"));
    expect(c.home).toBe("#002a5c");
  });

  it("missing colors fall back to neutral and still render two distinct halves", () => {
    const c = cardColors(team(undefined), team("nonsense"));
    expect(c.away).toMatch(/^#[0-9a-f]{6}$/);
    expect(distance(parseHex(c.away)!, parseHex(c.home)!)).toBeGreaterThan(40);
    expect(ratio(c.home, c.homeInk)).toBeGreaterThanOrEqual(4.5);
  });
});
