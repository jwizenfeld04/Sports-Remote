import {
  forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";

// Small design-system primitives. Styling lives in styles.css under the matching class names.

export type IconName =
  | "search" | "sliders" | "gear" | "close" | "star" | "star-off" | "tv" | "play" | "offline" | "alert" | "refresh" | "check"
  | "chevrons" | "chevron-right" | "plus" | "remote" | "chart" | "back" | "wifi" | "lock" | "antenna" | "info";

const PATHS: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fill="currentColor" />,
  "star-off": <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />,
  tv: <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" /></>,
  play: <path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="none" />,
  offline: <><path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5a15 15 0 0 1 11.3 3.8M5 12.6a10 10 0 0 1 5.2-2.5M17.6 11.4A10 10 0 0 1 19 12.6M8.5 16.1a5 5 0 0 1 7 0" /><path d="M12 20h.01M3 3l18 18" /></>,
  alert: <><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  chevrons: <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  remote: <><rect x="7" y="2.5" width="10" height="19" rx="3" /><circle cx="12" cy="9" r="2" /><path d="M10 15h4M10 18h4" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  back: <path d="m14.5 6-6 6 6 6" />,
  wifi: <><path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0" /><path d="M12 20h.01" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  antenna: <><path d="M12 12v10M8 22h8" /><circle cx="12" cy="9" r="2" /><path d="M7.8 4.8a6 6 0 0 0 0 8.4M16.2 4.8a6 6 0 0 1 0 8.4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  );
}

type Variant = "primary" | "secondary" | "ghost";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  icon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", block, icon, className = "", children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={`btn btn-${variant}${block ? " btn-block" : ""} ${className}`.trim()} {...rest}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
});

export function IconButton({ icon, label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`.trim()} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Chip({ on, count, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean; count?: number | string }) {
  return (
    <button type="button" className={`chip${on ? " on" : ""} ${className}`.trim()} aria-pressed={on} {...rest}>
      {on && <Icon name="check" size={14} />}
      <span>{children}</span>
      {count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  );
}

export function Badge({ tone = "neutral", children, className = "" }: { tone?: "neutral" | "live" | "glass" | "accent" | "warn"; children: ReactNode; className?: string }) {
  return <span className={`badge badge-${tone} ${className}`.trim()}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden />;
}

export const SearchField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }>(function SearchField(
  { onClear, value, ...rest },
  ref,
) {
  return (
    <div className="search-field">
      <Icon name="search" size={18} />
      <input ref={ref} type="search" inputMode="search" autoComplete="off" spellCheck={false} value={value} {...rest} />
      {value ? (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={onClear}>
          <Icon name="close" size={16} />
        </button>
      ) : (
        <kbd className="search-kbd" aria-hidden>/</kbd>
      )}
    </div>
  );
});

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal sheet: bottom sheet on phones, centered dialog on larger screens. Escape closes, focus is kept inside and restored. */
export function Sheet({ labelledBy, onClose, children, testId, wide }: { labelledBy: string; onClose: () => void; children: ReactNode; testId?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const opener = useRef(typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));
  useEffect(() => {
    const prev = opener.current;
    if (ref.current && !ref.current.contains(document.activeElement)) {
      (ref.current.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (els.length === 0) return;
      const [first, last] = [els[0], els[els.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={`sheet${wide ? " sheet-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <div className="sheet-handle" aria-hidden />
        {children}
      </div>
    </div>
  );
}

// ESPN's ".../500/scoreboard/x.png" logos are tuned for dark backgrounds and some disappear on a light disc
// (Raiders) while others disappear on a dark one (Giants, Jets); the standard ".../500/x.png" art is made for
// light backgrounds, so the disc is light and that variant is tried first.
export function logoCandidates(logo: string | undefined): string[] {
  if (!logo) return [];
  const standard = logo.replace(/\/(\d+)\/scoreboard\//, "/$1/");
  return standard === logo ? [logo] : [standard, logo];
}

/** Team logo with an abbreviation badge when there's no logo or it fails to load. */
export function TeamLogo({ logo, abbr, size }: { logo?: string; abbr: string; size: number }) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [logo]);
  const src = logoCandidates(logo)[attempt];
  return (
    <span className="logo" style={{ width: size, height: size }}>
      {src ? (
        <img key={src} src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setAttempt((a) => a + 1)} />
      ) : (
        <span className="logo-fallback" data-testid="logo-fallback" style={{ fontSize: Math.round(size * (abbr.length > 2 ? 0.3 : 0.36)) }}>
          {abbr}
        </span>
      )}
    </span>
  );
}

/** iOS/macOS segmented control: a radio group with a sliding thumb. Arrow keys move the selection. */
export function Segmented<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string;
  value: T | null;
  options: { value: T; label: string; testId?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const n = options.length;
    const j = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    onChange(options[j].value);
    refs.current[j]?.focus();
  };
  return (
    <div
      className={`segmented${idx < 0 ? " no-selection" : ""} ${className}`.trim()}
      role="radiogroup"
      aria-label={label}
      style={{ "--n": options.length, "--i": Math.max(idx, 0) } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={i === idx}
          tabIndex={i === Math.max(idx, 0) ? 0 : -1}
          className="segment"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
          data-testid={o.testId}
        >
          <span data-text={o.label}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A grouped-list row with an iOS/macOS toggle switch. The whole row is the control. */
export function SwitchRow({ checked, onChange, label, detail, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; detail?: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="row row-switch" onClick={() => onChange(!checked)} data-testid={testId}>
      <span className="row-text">
        <span className="row-label">{label}</span>
        {detail && <span className="row-detail">{detail}</span>}
      </span>
      <span className="switch" aria-hidden><span className="switch-knob" /></span>
    </button>
  );
}

export interface MenuOption<T> { value: T; label: string; detail?: string }

const LAYER = "data-sr-layer";

/**
 * macOS-style pop-up button: shows the current value and opens a translucent listbox with a checkmark on the
 * selected item. Arrow keys, Home/End, Enter/Space, Escape and type-ahead; focus returns to the button.
 * The list is portaled to <body> so translucent/transformed ancestors can't clip it, and it flips up when
 * there's more room above.
 */
export function PopUpButton<T extends string | number>({ label, value, options, onChange, testId, variant = "inline", placeholder }: {
  label: string;
  value: T;
  options: MenuOption<T>[];
  onChange: (v: T) => void;
  testId?: string;
  variant?: "inline" | "field";
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected];

  const show = (i: number) => {
    setActive(Math.max(0, Math.min(options.length - 1, i)));
    setPos(null);
    setOpen(true);
  };
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  const choose = (i: number) => {
    if (options[i].value !== value) onChange(options[i].value);
    close(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!btn.current || !list.current) return;
      const r = btn.current.getBoundingClientRect();
      const m = 8, gap = 6;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(Math.max(list.current.scrollWidth, r.width), vw - 2 * m);
      const h = list.current.scrollHeight;
      const below = vh - r.bottom - gap - m, above = r.top - gap - m;
      const up = h > below && above > below;
      const left = Math.min(Math.max(variant === "field" ? r.left : r.right - w, m), vw - w - m);
      setPos({ left, width: w, maxHeight: Math.max(96, up ? above : below), ...(up ? { bottom: vh - r.top + gap } : { top: r.bottom + gap }) });
    };
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close, variant]);

  useEffect(() => {
    if (open && pos) (list.current?.children[active] as HTMLElement | undefined)?.focus({ preventScroll: false });
  }, [open, pos, active]);

  const onListKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation(); // keep Escape/"/" from reaching the sheet, popover or page shortcuts
    const n = options.length;
    const move: Record<string, number> = { ArrowDown: Math.min(n - 1, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: n - 1, PageDown: n - 1, PageUp: 0 };
    if (e.key in move) {
      e.preventDefault();
      setActive(move[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close(true);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = typed.current;
      const now = Date.now();
      t.text = (now - t.at > 700 ? "" : t.text) + e.key.toLowerCase();
      t.at = now;
      const start = t.text.length === 1 ? active + 1 : active;
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (options[i].label.toLowerCase().startsWith(t.text)) {
          setActive(i);
          break;
        }
      }
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`popup popup-${variant}${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? placeholder ?? ""}`}
        onClick={() => (open ? close(false) : show(selected))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show(selected < 0 ? 0 : selected);
          }
        }}
        data-testid={testId}
      >
        <span className="popup-value">
          <span className="popup-label">{current?.label ?? placeholder}</span>
          {variant === "field" && current?.detail && <span className="popup-detail">{current.detail}</span>}
        </span>
        <span className="popup-chevrons"><Icon name="chevrons" size={variant === "field" ? 16 : 14} /></span>
      </button>
      {open && createPortal(
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={`menu${pos?.bottom !== undefined ? " up" : ""}`}
          style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
          onKeyDown={onListKey}
          {...{ [LAYER]: "" }}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              role="option"
              aria-selected={i === selected}
              tabIndex={i === active ? 0 : -1}
              className={`menu-item${i === active ? " active" : ""}`}
              onClick={() => choose(i)}
              onMouseMove={() => i !== active && setActive(i)}
            >
              <span className="menu-check" aria-hidden>{i === selected && <Icon name="check" size={14} />}</span>
              <span className="menu-text">
                <span>{o.label}</span>
                {o.detail && <span className="menu-detail">{o.detail}</span>}
              </span>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

/**
 * Non-modal macOS-style popover anchored under a toolbar button, with an arrow pointing at it.
 * Escape closes and refocuses the anchor; a click outside (but not inside a pop-up menu it opened) closes it.
 */
export function Popover({ anchor, onClose, label, id, children, width = 380, testId }: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  id?: string;
  children: ReactNode;
  width?: number;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; arrow: number; maxHeight: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const m = 8, vw = window.innerWidth;
      const w = Math.min(width, vw - 2 * m);
      const center = r.left + r.width / 2;
      const left = Math.min(Math.max(center - w + 36, m), vw - w - m);
      const top = r.bottom + 10;
      setPos({ left, top, width: w, arrow: Math.min(Math.max(center - left, 22), w - 22), maxHeight: window.innerHeight - top - m });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, width]);

  useEffect(() => {
    const prev = anchor.current;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeRef.current();
      prev?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || prev?.contains(t) || t.closest?.(`[${LAYER}]`)) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [anchor]);

  return (
    <div
      ref={ref}
      id={id}
      className="popover"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={pos ? ({ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, "--arrow-x": `${pos.arrow}px` } as CSSProperties) : { visibility: "hidden" }}
      data-testid={testId}
    >
      <span className="popover-arrow" aria-hidden />
      <div className="popover-scroll">{children}</div>
    </div>
  );
}
