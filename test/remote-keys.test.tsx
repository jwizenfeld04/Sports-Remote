// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RemoteSheet } from "../web/components/RemoteSheet";
import { api } from "../web/api";
import type { AllowedKey } from "../lib/types";

// jsdom has no PointerEvent; testing-library falls back to a bare Event without button/isPrimary.
beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class PointerEventShim extends MouseEvent {
      isPrimary: boolean;
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
        this.pointerId = init.pointerId ?? 1;
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventShim, configurable: true });
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const down = (id: string) => fireEvent.pointerDown(screen.getByTestId(id), { button: 0, isPrimary: true, pointerId: 1 });
const up = (id: string) => fireEvent.pointerUp(screen.getByTestId(id), { button: 0, isPrimary: true, pointerId: 1 });

describe("remote sheet input", () => {
  it("sends on pointerdown (with a vibration) and doesn't send again on the click that follows", () => {
    const keys: AllowedKey[] = [];
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    render(<RemoteSheet onKey={(k) => keys.push(k)} onClose={() => {}} />);
    down("remote-select");
    expect(keys).toEqual(["SELECT"]);
    expect(vibrate).toHaveBeenCalled();
    up("remote-select");
    fireEvent.click(screen.getByTestId("remote-select"));
    expect(keys).toEqual(["SELECT"]);
  });

  it("keyboard / assistive clicks (no pointerdown) still send", () => {
    const keys: AllowedKey[] = [];
    render(<RemoteSheet onKey={(k) => keys.push(k)} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("remote-back"));
    fireEvent.click(screen.getByTestId("remote-back"));
    expect(keys).toEqual(["BACK", "BACK"]);
  });

  it("d-pad repeats while held and stops on release", () => {
    vi.useFakeTimers();
    const keys: AllowedKey[] = [];
    render(<RemoteSheet onKey={(k) => keys.push(k)} onClose={() => {}} />);
    down("remote-down");
    act(() => void vi.advanceTimersByTime(400 + 150 * 4));
    expect(keys.length).toBe(5);
    up("remote-down");
    act(() => void vi.advanceTimersByTime(2000));
    expect(keys.length).toBe(5);
    expect(new Set(keys)).toEqual(new Set(["DOWN"]));
  });

  it("buttons that shouldn't repeat don't, and Turn TV off only fires on a full click", () => {
    vi.useFakeTimers();
    const keys: AllowedKey[] = [];
    render(<RemoteSheet onKey={(k) => keys.push(k)} onClose={() => {}} />);
    down("remote-home");
    act(() => void vi.advanceTimersByTime(2000));
    up("remote-home");
    expect(keys).toEqual(["HOME"]);
    down("remote-sleep");
    expect(keys).toEqual(["HOME"]);
    fireEvent.click(screen.getByTestId("remote-sleep"));
    expect(keys).toEqual(["HOME", "SLEEP"]);
  });
});

describe("api.key queue", () => {
  it("keeps presses in order with one request in flight, and drops extras beyond the queue", async () => {
    const sent: string[] = [];
    const answers: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).key);
      return new Promise<Response>((res) => answers.push(() => res(new Response('{"ok":true}', { status: 200 }))));
    }));
    const results = (["UP", "DOWN", "LEFT", "RIGHT", "SELECT"] as AllowedKey[]).map((k) => api.key(k));
    expect(sent).toEqual(["UP"]); // the first goes out at once, the rest wait
    expect(await results[4]).toEqual({ status: 200, data: { ok: true, dropped: true } }); // 5th: queue (3) full
    for (let i = 0; i < 4; i++) {
      await vi.waitFor(() => expect(answers.length).toBe(i + 1));
      answers[i]();
      expect((await results[i]).data).toEqual({ ok: true });
    }
    expect(sent).toEqual(["UP", "DOWN", "LEFT", "RIGHT"]);
  });

  it("a failed request doesn't stall the queue", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (n++ === 0) throw new TypeError("network down");
      return new Response('{"ok":true}', { status: 200 });
    }));
    const a = api.key("UP");
    const b = api.key("DOWN");
    await expect(a).rejects.toThrow("network down");
    expect((await b).data).toEqual({ ok: true });
  });
});
