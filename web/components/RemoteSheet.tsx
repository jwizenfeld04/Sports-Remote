import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import type { AllowedKey } from "../../lib/types";
import { ALLOWED_KEYS } from "../../lib/types";
import { MiniRemote } from "./ResultPanel";
import { IconButton, Sheet } from "./ui";

/** Keys that repeat while held, like a real remote. */
const REPEATABLE = new Set<AllowedKey>(["UP", "DOWN", "LEFT", "RIGHT", "VOLUME_UP", "VOLUME_DOWN"]);
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 150; // ~6.7/s: under the server's 8/s sustained rate
const REPEAT_MAX = 60; // stop even if we never hear the finger lift
/** A click this soon after the pointerdown that already sent the key is the same tap: swallow it. */
const SAME_TAP_MS = 1500;

function keyOf(target: EventTarget | null): { btn: HTMLElement; key: AllowedKey } | null {
  const btn = (target as Element | null)?.closest?.<HTMLElement>("button[data-testid^='remote-']");
  const key = btn?.dataset.testid?.slice("remote-".length).toUpperCase();
  return btn && key && (ALLOWED_KEYS as readonly string[]).includes(key) ? { btn, key: key as AllowedKey } : null;
}

/**
 * The TV remote on its own, so it's one tap away after a game is on (volume, pause, rewind, power off).
 * Keys go out on pointerdown (not on click, which waits for the finger to lift), with a short
 * vibration, and the d-pad and volume repeat while held. "Turn TV off" stays on click so a stray
 * touch can't switch the TV off. Keyboard activation still works through MiniRemote's onClick.
 */
export function RemoteSheet({ onKey, onClose }: { onKey: (k: AllowedKey) => void; onClose: () => void }) {
  const sentOnDown = useRef<{ btn: HTMLElement; at: number } | null>(null);
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>({});

  const stopRepeat = useCallback(() => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.every);
    timers.current = {};
  }, []);

  useEffect(() => {
    const stop = () => stopRepeat();
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      stopRepeat();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [stopRepeat]);

  const press = useCallback((k: AllowedKey) => {
    try {
      navigator.vibrate?.(8);
    } catch {
      /* not allowed here */
    }
    onKey(k);
  }, [onKey]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const hit = keyOf(e.target);
    if (!hit || hit.key === "SLEEP") return;
    stopRepeat();
    sentOnDown.current = { btn: hit.btn, at: Date.now() };
    press(hit.key);
    if (REPEATABLE.has(hit.key)) {
      let n = 0;
      timers.current.delay = setTimeout(() => {
        timers.current.every = setInterval(() => (++n > REPEAT_MAX ? stopRepeat() : press(hit.key)), REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    }
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const hit = keyOf(e.target);
    const down = sentOnDown.current;
    sentOnDown.current = null;
    if (hit && down && down.btn === hit.btn && Date.now() - down.at < SAME_TAP_MS) {
      e.stopPropagation(); // already sent on pointerdown
      e.preventDefault();
    }
  };

  return (
    <Sheet labelledBy="remote-title" onClose={onClose} testId="remote-sheet">
      <header className="sheet-head">
        <h2 id="remote-title" className="sheet-title">Remote</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      <div
        className="sheet-body remote-fast"
        onPointerDownCapture={onPointerDown}
        onPointerUpCapture={stopRepeat}
        onPointerCancelCapture={stopRepeat}
        onLostPointerCaptureCapture={stopRepeat}
        onClickCapture={onClick}
        onContextMenu={(e) => keyOf(e.target) && e.preventDefault()}
      >
        <MiniRemote onKey={press} full />
      </div>
    </Sheet>
  );
}
