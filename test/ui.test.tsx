// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../web/App";
import type { Boot } from "../web/api";
import type { LaunchResult } from "../lib/types";
import { allGames, settings, uiBoot } from "./helpers";

const boot = (): Boot => uiBoot() as Boot;

const appOnly: LaunchResult = {
  requestId: "r", ok: true, level: "app", verified: true, outcome: "app", title: "Opened Fox One",
  message: "Go to **Live**, then choose **FOX**. Use the remote below to finish.", persistent: true, attempts: [], service: "fox_one",
};

let calls: { url: string; body: unknown }[] = [];
function mockFetch(launchResult: LaunchResult) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url === "/api/launch") return new Response(JSON.stringify(launchResult), { status: 200 });
    if (url === "/api/key") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url === "/api/settings") return new Response(JSON.stringify(body), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T21:00:00Z"));
  history.replaceState(null, "", "/");
  mockFetch(appOnly);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("has Live and Upcoming sections and no separate favorites section", () => {
    render(<App initial={boot()} />);
    expect(screen.queryByTestId("favorites-strip")).toBeNull();
    expect(screen.queryByRole("heading", { name: /your teams/i })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Live 3", "Upcoming 14"]);
    expect(screen.getAllByTestId("game-card-nfl-401")).toHaveLength(1); // each game shows once
  });

  it("favorite-team games lead the Live section (starred); Upcoming stays chronological", () => {
    render(<App initial={{ ...boot(), settings: settings({ favorites: ["mlb:PHI", "nhl:NYR"] }) }} />);
    const live = screen.getByRole("region", { name: /^Live/ });
    const liveIds = within(live).getAllByTestId(/^game-card-/).map((e) => e.dataset.testid);
    expect(liveIds).toEqual(["game-card-mlb-504", "game-card-nfl-401", "game-card-nba-701"]);
    expect(within(within(live).getByTestId("game-card-mlb-504")).getByLabelText("Favorite")).toBeTruthy();
    const upcoming = screen.getByRole("region", { name: /^Upcoming/ });
    const ids = within(upcoming).getAllByTestId(/^game-card-/).map((e) => e.dataset.testid);
    expect(ids[0]).toBe("game-card-nfl-402"); // earliest start, not the favorite Rangers game
    expect(ids.indexOf("game-card-nhl-604")).toBeGreaterThan(ids.indexOf("game-card-nhl-602"));
  });

  it("cards show the service and launch quality, or why it isn't covered", () => {
    render(<App initial={boot()} />);
    const giants = screen.getAllByTestId("game-card-nfl-402")[0];
    expect(giants.textContent).toContain("Plex · Local channel");
    const mets = screen.getAllByTestId("game-card-mlb-502")[0];
    expect(mets.textContent).toContain("SNY isn't on your services. MLB.TV blacks out your local teams.");
  });

  it("search narrows the grid and writes the URL", async () => {
    render(<App initial={boot()} />);
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "kings espn" } });
    await act(async () => {});
    expect(screen.getAllByTestId(/^game-card-/).map((e) => e.dataset.testid)).toEqual(["game-card-nhl-604"]);
    expect(location.search).toBe("?q=kings+espn");
  });

  it("filters: live only, and a clear button for the filter that hid everything", async () => {
    render(<App initial={boot()} />);
    fireEvent.click(screen.getByTestId("filters-toggle"));
    fireEvent.click(screen.getByTestId("filter-status-upcoming"));
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: /^Upcoming/ })).toBeNull();
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "rangers" } });
    await act(async () => {});
    expect(screen.getByTestId("empty-state").textContent).toContain("Clear Status");
    fireEvent.click(screen.getByText("Clear Status"));
    await act(async () => {});
    expect(screen.getAllByTestId(/^game-card-nhl-60[24]/).length).toBe(2);
  });

  it("open a game, switch service, send: the app-only panel shows steps and a working remote", async () => {
    render(<App initial={boot()} />);
    fireEvent.click(within(screen.getAllByTestId("game-card-nfl-402")[0]).getAllByRole("button")[0]);
    expect(screen.getByTestId("launch-route-reason").textContent).toBe("Plex: Your local team: on your local station · with Antenna (over the air). Opens channel");
    fireEvent.click(screen.getByTestId("service-select"));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Watch on" })).getByRole("option", { name: /Fox One/ }));
    expect(screen.getByTestId("launch-route-reason").textContent).toContain("Fox One");
    await act(async () => {
      fireEvent.click(screen.getByTestId("send-to-tv"));
    });
    expect(calls.find((c) => c.url === "/api/launch")?.body).toMatchObject({ gameId: "nfl:402", tv: "living-room", route: { service: "fox_one", network: "fox" } });
    const panel = screen.getByTestId("launch-toast");
    expect(panel.textContent).toContain("Opened Fox One");
    expect(within(panel).getByText("Live").tagName).toBe("STRONG");
    await act(async () => {
      fireEvent.click(screen.getByTestId("remote-select"));
    });
    expect(calls.at(-1)).toEqual({ url: "/api/key", body: { key: "SELECT", tv: "living-room" } });
    fireEvent.click(screen.getByTestId("result-done"));
    expect(screen.queryByTestId("launch-toast")).toBeNull();
  });

  it("starring a team saves favorites", async () => {
    render(<App initial={boot()} />);
    fireEvent.click(within(screen.getAllByTestId("game-card-nhl-602")[0]).getAllByRole("button")[0]);
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("launch-sheet")).getByRole("button", { name: /Rangers/ }));
    });
    const saved = calls.find((c) => c.url === "/api/settings")?.body as { favorites: string[] };
    expect(saved.favorites).toContain("nhl:NYR");
  });

  it("not-covered games have no send button", () => {
    render(<App initial={boot()} />);
    fireEvent.click(within(screen.getAllByTestId("game-card-mlb-502")[0]).getAllByRole("button")[0]);
    expect(screen.queryByTestId("send-to-tv")).toBeNull();
  });

  it("cards use team colors as the background, with logos and a readable ink", () => {
    render(<App initial={boot()} />);
    const card = screen.getAllByTestId("game-card-nfl-401")[0];
    expect(card.style.getPropertyValue("--away")).toMatch(/^#[0-9a-f]{6}$/);
    expect(card.style.getPropertyValue("--home")).toMatch(/^#[0-9a-f]{6}$/);
    expect(card.style.getPropertyValue("--away-ink")).toMatch(/^#(ffffff|0b0d12)$/);
    const imgs = card.querySelectorAll("img");
    expect([...imgs].map((i) => i.getAttribute("src"))).toEqual([
      "https://a.espncdn.com/i/teamlogos/nfl/500/lac.png",
      "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
    ]);
    fireEvent.error(imgs[0]); // standard art missing: fall back to the URL ESPN gave
    expect(card.querySelectorAll("img")[0].getAttribute("src")).toBe("https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lac.png");
    fireEvent.error(card.querySelectorAll("img")[0]);
    expect(within(card).getByTestId("logo-fallback").textContent).toBe("LAC");
  });

  it("live cards show a LIVE pill with the game clock, big scores and a Watch on TV call to action", () => {
    render(<App initial={boot()} />);
    const card = screen.getAllByTestId("game-card-nfl-401")[0];
    expect(within(card).getByTestId("live-pill").textContent).toBe("LiveQ4 3:12");
    expect(card.querySelector(".side-away .score")?.textContent).toBe("17");
    expect(card.querySelector(".side-home .score")?.textContent).toBe("20");
    expect(card.textContent).toContain("Watch on TV");
    expect(within(card).getByRole("button").getAttribute("aria-label")).toBe(
      "Los Angeles Chargers at Kansas City Chiefs, live, Q4 3:12, LAC 17, KC 20, watch on YouTube TV (NFL Sunday Ticket)",
    );
  });

  it("says ESPN is failing instead of showing a blank list (the empty-list bug)", () => {
    render(<App initial={{ ...boot(), games: [], stale: true, feedError: "mlb 20261012: HTTP 400 (+26 more)" }} />);
    const err = screen.getByTestId("feed-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("Can't load games from ESPN");
    expect(err.textContent).toContain("HTTP 400");
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("says when ESPN has no games at all, and shows skeletons before the first poll", () => {
    render(<App initial={{ ...boot(), games: [], stale: false, feedError: null }} />);
    expect(screen.getByTestId("feed-empty").textContent).toContain("No games scheduled");
    cleanup();
    const { container } = render(<App initial={{ ...boot(), games: [], fetchedAt: null }} />);
    expect(container.querySelectorAll(".card-skeleton").length).toBeGreaterThan(0);
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
  });

  it("shows an offline banner when the device loses its connection", async () => {
    render(<App initial={boot()} />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("league chips in the top bar filter and are bookmarkable", async () => {
    render(<App initial={boot()} />);
    fireEvent.click(screen.getByTestId("filter-league-nhl"));
    await act(async () => {});
    expect(location.search).toBe("?league=nhl");
    const ids = [...document.querySelectorAll<HTMLElement>(".grid [data-testid^='game-card-']")].map((e) => e.dataset.testid!);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("game-card-nhl-"))).toBe(true);
  });

  it("the launch sheet keeps focus inside and closes on Escape, returning focus to the card", () => {
    render(<App initial={boot()} />);
    const btn = within(screen.getAllByTestId("game-card-nfl-402")[0]).getByRole("button");
    btn.focus();
    fireEvent.click(btn);
    expect(document.activeElement).toBe(screen.getByTestId("send-to-tv"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("launch-sheet")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("points to the setup link before first-run setup", async () => {
    render(<App initial={{ authed: false, auth: { mode: null, setupRequired: true } }} />);
    // The setup wizard opens on its sign-in step, which asks for the one-time link from the server log.
    expect(await screen.findByText(/Open the setup link/, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByText(/docker logs sports-remote/)).toBeTruthy();
    expect(screen.queryByLabelText("PIN")).toBeNull();
  });

  it("proxy mode sends people to their proxy", () => {
    render(<App initial={{ authed: false, auth: { mode: "proxy", setupRequired: false } }} />);
    expect(screen.getByText(/Sign in through your proxy/)).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("pin mode: number pad signs in, and an admin link switches to the password", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/auth/login") return new Response(JSON.stringify({ role: "member" }), { status: 200 });
      return new Response(JSON.stringify(boot()), { status: 200 });
    });
    calls = [];
    render(<App initial={{ authed: false, auth: { mode: "pin", setupRequired: false } }} />);
    for (const d of ["2", "4", "6", "8"]) fireEvent.click(screen.getByRole("button", { name: d }));
    expect((screen.getByLabelText("PIN") as HTMLInputElement).value).toBe("2468");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "8" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    });
    expect(calls[0]).toEqual({ url: "/api/auth/login", body: { pin: "2468" } });
    expect(calls[1].url).toBe("/api/bootstrap");
  });

  it("pin mode: admin password form, and a wrong password shows an error", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Wrong admin password." }), { status: 401 }));
    render(<App initial={{ authed: false, auth: { mode: "pin", setupRequired: false } }} />);
    fireEvent.click(screen.getByTestId("admin-link"));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope-nope" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/admin password didn't work/);
    fireEvent.click(screen.getByRole("button", { name: "Use the household PIN" }));
    expect(screen.getByLabelText("PIN")).toBeTruthy();
  });

  it("accounts mode asks for username and password", async () => {
    calls = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 429 });
    });
    render(<App initial={{ authed: false, auth: { mode: "accounts", setupRequired: false } }} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sam" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(calls[0]).toEqual({ url: "/api/auth/login", body: { username: "sam", password: "long-password" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Too many tries/);
  });
});
