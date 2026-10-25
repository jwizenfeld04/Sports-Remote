// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../web/App";
import type { Boot } from "../web/api";
import { PopUpButton, Segmented } from "../web/components/ui";
import { allGames, settings, uiBoot } from "./helpers";

const boot = (): Boot => uiBoot() as Boot;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T21:00:00Z"));
  history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => new Response(init?.body ? String(init.body) : "{}", { status: 200 }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FRUITS = [
  { value: "apple", label: "Apple" }, { value: "banana", label: "Banana" }, { value: "blueberry", label: "Blueberry" },
  { value: "cherry", label: "Cherry" }, { value: "date", label: "Date" },
];

function Picker({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("banana");
  return (
    <>
      <button type="button">outside</button>
      <PopUpButton label="Fruit" value={v} options={FRUITS} onChange={(x) => { setV(x); onChange?.(x); }} testId="fruit" />
    </>
  );
}

const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
const focused = () => document.activeElement as HTMLElement;

describe("PopUpButton (custom pop-up menu)", () => {
  it("is a button that shows the value, with listbox ARIA", () => {
    render(<Picker />);
    const btn = screen.getByTestId("fruit");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toContain("Banana");
    expect(btn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Fruit" });
    expect(btn.getAttribute("aria-controls")).toBe(list.id);
    const selected = within(list).getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected.map((o) => o.textContent)).toEqual(["Banana"]);
    expect(selected[0].querySelector("svg")).toBeTruthy(); // checkmark
    expect(focused()).toBe(selected[0]); // focus starts on the current value
  });

  it("arrow keys, Home/End and Enter pick a value; focus returns to the button", () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const btn = screen.getByTestId("fruit");
    key(btn, "ArrowDown");
    expect(screen.getByRole("listbox")).toBeTruthy();
    key(focused(), "ArrowDown");
    expect(focused().textContent).toBe("Blueberry");
    key(focused(), "End");
    expect(focused().textContent).toBe("Date");
    key(focused(), "ArrowDown"); // no wrap
    expect(focused().textContent).toBe("Date");
    key(focused(), "Home");
    expect(focused().textContent).toBe("Apple");
    key(focused(), "ArrowUp");
    expect(focused().textContent).toBe("Apple");
    key(focused(), "ArrowDown");
    key(focused(), "ArrowDown");
    key(focused(), "Enter");
    expect(onChange).toHaveBeenCalledWith("blueberry");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(focused()).toBe(btn);
    expect(btn.textContent).toContain("Blueberry");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("Space selects; Escape and Tab close without changing; picking the same value doesn't fire", () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const btn = screen.getByTestId("fruit");
    fireEvent.click(btn);
    key(focused(), "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(focused()).toBe(btn);
    key(btn, "ArrowUp");
    key(focused(), "Tab");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(focused()).toBe(btn);
    fireEvent.click(btn);
    key(focused(), " ");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(btn);
    key(focused(), "ArrowUp");
    key(focused(), " ");
    expect(onChange).toHaveBeenCalledWith("apple");
  });

  it("type-ahead jumps to the matching item", () => {
    render(<Picker />);
    fireEvent.click(screen.getByTestId("fruit"));
    const typeAt = (k: string, ms: number) => {
      vi.setSystemTime(new Date(Date.parse("2026-10-18T21:00:00Z") + ms));
      key(focused(), k);
    };
    typeAt("c", 1000);
    expect(focused().textContent).toBe("Cherry");
    typeAt("b", 3000); // a pause starts a new search
    expect(focused().textContent).toBe("Banana");
    typeAt("l", 3100); // "bl"
    expect(focused().textContent).toBe("Blueberry");
  });

  it("clicking an option picks it; clicking outside closes", () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.click(screen.getByTestId("fruit"));
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByTestId("fruit"));
    fireEvent.click(screen.getByRole("option", { name: "Date" }));
    expect(onChange).toHaveBeenCalledWith("date");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("Segmented control", () => {
  function Seg() {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return <Segmented label="Pick" value={v} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
  }
  it("is a radio group with roving focus; arrows, Home/End move the selection", () => {
    render(<Seg />);
    const group = screen.getByRole("radiogroup", { name: "Pick" });
    const radios = within(group).getAllByRole("radio");
    const checked = () => radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);
    expect(checked()).toEqual(["A"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    key(radios[0], "ArrowRight");
    expect(checked()).toEqual(["B"]);
    expect(focused()).toBe(radios[1]);
    expect(group.style.getPropertyValue("--i")).toBe("1"); // the thumb slides to segment 1
    key(radios[1], "End");
    expect(checked()).toEqual(["C"]);
    key(radios[2], "ArrowRight"); // wraps like iOS
    expect(checked()).toEqual(["A"]);
    key(radios[0], "ArrowLeft");
    expect(checked()).toEqual(["C"]);
    key(radios[2], "Home");
    expect(checked()).toEqual(["A"]);
    fireEvent.click(radios[1]);
    expect(checked()).toEqual(["B"]);
  });

  it("league and view segments filter the games and write the URL", async () => {
    render(<App initial={boot()} />);
    const league = screen.getByRole("radiogroup", { name: "League" });
    expect(within(league).getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(league).getByRole("radio", { name: "MLB" }));
    await act(async () => {});
    expect(location.search).toBe("?league=mlb");
    const view = screen.getByRole("radiogroup", { name: "Show" });
    fireEvent.click(within(view).getByRole("radio", { name: "Live" }));
    await act(async () => {});
    expect(location.search).toBe("?league=mlb&status=live");
    expect(screen.getAllByTestId(/^game-card-/).map((e) => e.dataset.testid)).toEqual(["game-card-mlb-504"]);
    fireEvent.click(within(view).getByRole("radio", { name: "Today" }));
    await act(async () => {});
    expect(location.search).toBe("?league=mlb&time=today");
    fireEvent.click(within(view).getByRole("radio", { name: "Upcoming" }));
    await act(async () => {});
    expect(location.search).toBe("?league=mlb&status=upcoming");
    fireEvent.click(within(view).getByRole("radio", { name: "All" }));
    fireEvent.click(within(league).getByRole("radio", { name: "All" }));
    await act(async () => {});
    expect(location.search).toBe("");
  });

  it("a multi-league URL selects no league segment and shows a removable token", async () => {
    history.replaceState(null, "", "/?league=nfl,nhl");
    render(<App initial={boot()} />);
    const league = screen.getByRole("radiogroup", { name: "League" });
    expect(within(league).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toEqual([]);
    fireEvent.click(screen.getByTestId("token-leagues"));
    await act(async () => {});
    expect(location.search).toBe("");
  });
});

describe("Filters popover", () => {
  const open = () => fireEvent.click(screen.getByTestId("filters-toggle"));
  const pick = (testId: string, option: RegExp | string) => {
    fireEvent.click(screen.getByTestId(testId));
    fireEvent.click(within(screen.getByTestId(`${testId}-menu`)).getByRole("option", { name: option }));
  };

  it("opens as a dialog anchored to the toolbar button; Escape closes it and refocuses the button", () => {
    render(<App initial={boot()} />);
    const btn = screen.getByTestId("filters-toggle");
    btn.focus();
    open();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const pop = screen.getByRole("dialog", { name: "Filters" });
    expect(btn.getAttribute("aria-controls")).toBe(pop.id);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(focused()).toBe(btn);
  });

  it("closes on an outside click, but not when picking from one of its menus", () => {
    render(<App initial={boot()} />);
    open();
    fireEvent.click(screen.getByTestId("filter-time"));
    const option = within(screen.getByTestId("filter-time-menu")).getByRole("option", { name: /Tonight/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeTruthy();
    // Escape inside the menu closes only the menu.
    fireEvent.click(screen.getByTestId("filter-sort"));
    key(focused(), "Escape");
    expect(screen.queryByTestId("filter-sort-menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeTruthy();
    fireEvent.pointerDown(document.querySelector("main")!);
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
  });

  it("every filter still works and is bookmarkable", async () => {
    render(<App initial={boot()} />);
    open();
    const url = async () => {
      await act(async () => {});
      return Object.fromEntries(new URLSearchParams(location.search));
    };
    const sw = (id: string) => {
      const el = screen.getByTestId(id);
      expect(el.getAttribute("role")).toBe("switch");
      fireEvent.click(el);
      return el.getAttribute("aria-checked");
    };
    expect(sw("filter-status-final")).toBe("true");
    expect((await url()).status).toBe("live,upcoming,final");
    expect(screen.getByRole("heading", { name: /^Final/ })).toBeTruthy();
    sw("filter-status-final");
    expect(sw("filter-favorites")).toBe("true");
    expect(sw("filter-my-services")).toBe("true");
    expect(sw("filter-quality")).toBe("true");
    expect(sw("filter-close")).toBe("true");
    expect(await url()).toEqual({ fav: "1", mine: "1", quality: "1", close: "1" });
    sw("filter-favorites");
    sw("filter-my-services");
    sw("filter-quality");
    sw("filter-close");
    pick("filter-time", /Tonight/);
    pick("filter-service", "Plex");
    pick("filter-network", "FOX");
    pick("filter-sort", /Start time/);
    expect(await url()).toEqual({ time: "tonight", service: "plex", net: "fox", sort: "time" });
    expect(screen.getByTestId("filter-service").textContent).toContain("Plex");
    // Badge counts the filters the segments can't show (sort isn't a filter).
    expect(screen.getByTestId("filters-toggle").getAttribute("aria-label")).toBe("Filters (3 on)");
    fireEvent.click(screen.getByTestId("clear-filters"));
    expect(await url()).toEqual({});
    expect(screen.getByTestId("filters-toggle").getAttribute("aria-label")).toBe("Filters");
  });

  it("status switches drive the Live/Upcoming sections and the empty-state clear button", async () => {
    render(<App initial={boot()} />);
    open();
    fireEvent.click(screen.getByTestId("filter-status-live"));
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: /^Live/ })).toBeNull();
    // Upcoming-only is a segment preset, so it shows there, not as a token.
    expect(within(screen.getByRole("radiogroup", { name: "Show" })).getByRole("radio", { name: "Upcoming" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("filter-tokens")).toBeNull();
  });

  it("tokens appear only when filters are active and remove one filter each", async () => {
    render(<App initial={boot()} />);
    expect(screen.queryByTestId("filter-tokens")).toBeNull();
    open();
    fireEvent.click(screen.getByTestId("filter-favorites"));
    fireEvent.click(screen.getByTestId("filter-close"));
    await act(async () => {});
    const tokens = screen.getByTestId("filter-tokens");
    expect(within(tokens).getAllByRole("button").map((b) => b.textContent)).toEqual(["Favorite teams", "Close games", "Clear all"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Close games" }));
    await act(async () => {});
    expect(location.search).toBe("?fav=1");
    fireEvent.click(screen.getByTestId("tokens-clear"));
    await act(async () => {});
    expect(location.search).toBe("");
    expect(screen.queryByTestId("filter-tokens")).toBeNull();
  });

  it("saved views apply and save", async () => {
    vi.stubGlobal("prompt", () => "Hockey night");
    const s = settings({ presets: [{ name: "Sunday NFL", query: "league=nfl&time=today" }] });
    render(<App initial={{ ...boot(), settings: s }} />);
    open();
    fireEvent.click(screen.getByTestId("preset-sunday-nfl"));
    await act(async () => {});
    expect(location.search).toBe("?league=nfl&time=today");
    fireEvent.click(screen.getByTestId("save-preset"));
    await act(async () => {});
    expect(screen.getByTestId("preset-hockey-night")).toBeTruthy();
  });
});

describe("no native selects", () => {
  it("renders no <select> in the toolbar, popover, launch sheet or settings", () => {
    render(<App initial={boot()} />);
    fireEvent.click(screen.getByTestId("filters-toggle"));
    expect(document.querySelectorAll("select")).toHaveLength(0);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(screen.getAllByTestId("game-card-nfl-402")[0]).getByRole("button"));
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(screen.getByTestId("service-select").getAttribute("aria-haspopup")).toBe("listbox");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("settings-open"));
    expect(document.querySelectorAll("select, input[type=checkbox]")).toHaveLength(0);
    expect(screen.getByRole("switch", { name: /One-tap send/ })).toBeTruthy();
  });

  it("Escape in the Watch menu closes the menu, not the launch sheet", () => {
    render(<App initial={boot()} />);
    fireEvent.click(within(screen.getAllByTestId("game-card-nfl-402")[0]).getByRole("button"));
    const trigger = screen.getByTestId("service-select");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "Watch on" })).toBeTruthy();
    key(focused(), "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByTestId("launch-sheet")).toBeTruthy();
    expect(focused()).toBe(trigger);
  });
});

describe("remote sheet", () => {
  it("opens from the top bar and sends volume and power keys", async () => {
    const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/key")) keys.push(JSON.parse(String(init?.body)).key);
      return new Response("{}", { status: 200 });
    }));
    render(<App initial={boot()} />);
    fireEvent.click(screen.getByTestId("remote-open"));
    fireEvent.click(screen.getByTestId("remote-volume_up"));
    fireEvent.click(screen.getByTestId("remote-sleep"));
    // One request at a time (keeps presses in order), so SLEEP goes out once VOLUME_UP is answered.
    await waitFor(() => expect(keys).toEqual(["VOLUME_UP", "SLEEP"]));
    vi.unstubAllGlobals();
  });
});
