import { useEffect } from "react";
import type { AllowedKey, LaunchResult } from "../../lib/types";
import { richText } from "../format";
import { Button, Icon } from "./ui";

export function MiniRemote({ onKey, full = false }: { onKey: (k: AllowedKey) => void; full?: boolean }) {
  const b = (k: AllowedKey, label: string, cls = "") => (
    <button type="button" className={`remote-btn ${cls}`} aria-label={label} onClick={() => onKey(k)} data-testid={`remote-${k.toLowerCase()}`}>
      {label.length <= 2 ? label : <span>{label}</span>}
    </button>
  );
  return (
    <div className="remote" aria-label="TV remote">
      <div className="dpad">
        {b("UP", "▲", "up")}
        {b("LEFT", "◀", "left")}
        {b("SELECT", "OK", "ok")}
        {b("RIGHT", "▶", "right")}
        {b("DOWN", "▼", "down")}
      </div>
      <div className="remote-row">
        {b("BACK", "Back")}
        {b("HOME", "Home")}
        {b("PLAY_PAUSE", "Play/Pause")}
      </div>
      {full && (
        <>
          <div className="remote-row">
            {b("REWIND", "⏪", "wide")}
            {b("FAST_FORWARD", "⏩", "wide")}
          </div>
          <div className="remote-row">
            {b("VOLUME_DOWN", "Vol −")}
            {b("MUTE", "Mute")}
            {b("VOLUME_UP", "Vol +")}
          </div>
          <div className="remote-row">{b("SLEEP", "Turn TV off", "power")}</div>
        </>
      )}
    </div>
  );
}

interface Props {
  pending: boolean;
  progress?: string | null; // current step of a slow launch ("Finding the channel...")
  result: LaunchResult | null;
  onKey: (k: AllowedKey) => void;
  onRetry: () => void;
  onDismiss: () => void;
}

export function ResultPanel({ pending, progress, result, onKey, onRetry, onDismiss }: Props) {
  // Successful game/channel launches auto-hide; everything else stays until dismissed.
  useEffect(() => {
    if (!result || result.persistent) return;
    const t = setTimeout(onDismiss, result.outcome === "game" ? 4000 : 6000);
    return () => clearTimeout(t);
  }, [result, onDismiss]);

  if (pending) {
    return (
      <div className="toast" role="status" aria-live="polite" data-testid="launch-toast">
        <span className="spinner" aria-hidden /> {progress ?? "Sending to TV..."}
      </div>
    );
  }
  if (!result) return null;
  if (!result.persistent) {
    return (
      <div className="toast ok" role="status" aria-live="polite" data-testid="launch-toast" onClick={onDismiss}>
        <span className="toast-icon"><Icon name="check" size={18} /></span>
        <span><strong>{result.title}</strong> <span>{richText(result.message)}</span></span>
      </div>
    );
  }
  const failed = result.outcome === "failed" || result.outcome === "unverified";
  return (
    <div className={`result-panel${failed ? " failed" : ""}`} role="status" aria-live="polite" data-testid="launch-toast">
      <div className="result-text">
        <span className="toast-icon"><Icon name={failed ? "alert" : "tv"} size={18} /></span>
        <strong>{result.title}</strong>
        <p>{richText(result.message)}</p>
      </div>
      {result.outcome !== "failed" && <MiniRemote onKey={onKey} />}
      <div className="result-actions">
        {failed && <Button icon="refresh" onClick={onRetry}>Retry</Button>}
        <Button variant="primary" onClick={onDismiss} data-testid="result-done">Done</Button>
      </div>
    </div>
  );
}
