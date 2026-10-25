import { Icon } from "./ui";

export interface KeyNotice {
  state: "pending" | "ok" | "failed";
  text: string;
}

export function keyFailure(status: number, error?: string): string {
  if (status === 429 || error === "busy") return "TV is busy, try again in a moment";
  if (status === 401 || status === 403) return "Signed out, reload and log in again";
  if (error === "timeout") return "The TV didn't answer in time";
  if (error === "device_offline" || status === 502) return "Couldn't reach the Fire TV";
  return "That button didn't go through";
}

export function KeyToast({ notice }: { notice: KeyNotice }) {
  return (
    <div className={`toast${notice.state === "ok" ? " ok" : notice.state === "failed" ? " fail" : ""}`} role="status" aria-live="polite" data-testid="key-toast">
      {notice.state === "pending" ? (
        <span className="spinner" aria-hidden />
      ) : (
        <span className="toast-icon"><Icon name={notice.state === "ok" ? "check" : "alert"} size={18} /></span>
      )}
      <strong>{notice.text}</strong>
    </div>
  );
}
