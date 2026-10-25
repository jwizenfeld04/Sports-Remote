import type { ReactNode } from "react";
import type { Game, LaunchLevel } from "../lib/types";

export const QUALITY_LABEL: Record<LaunchLevel, string> = {
  game: "Opens game",
  channel: "Opens channel",
  app: "Opens app",
};

export const LEAGUE_LABEL: Record<Game["league"], string> = { nfl: "NFL", nba: "NBA", mlb: "MLB", nhl: "NHL" };

export function startLabel(g: Game, now = new Date()): string {
  const d = new Date(g.startTime);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** "Today", "Tomorrow" or "Sun, Oct 18" (local time). */
export function dayLabel(g: Game, now = new Date()): string {
  const d = new Date(g.startTime);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** "8:20" and "PM" separately, for the big kickoff time on upcoming cards. */
export function timeParts(g: Game): { time: string; period: string } {
  const s = new Date(g.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const m = /^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/.exec(s);
  return m ? { time: m[1], period: m[2].replace(/[.\s]/g, "").toUpperCase() } : { time: s, period: "" };
}

export function statusLabel(g: Game): string {
  if (g.state === "pre") return startLabel(g);
  return g.detail || (g.state === "post" ? "Final" : "Live");
}

/** Render the light **bold** markup used in fallback messages. */
export function richText(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}

export const cardTestId = (g: Game) => `game-card-${g.id.replace(":", "-")}`;
