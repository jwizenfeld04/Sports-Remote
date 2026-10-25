import { useEffect, useState } from "react";
import { Button } from "../components/ui";

// First run: the server printed a one-time link (/setup?token=...) to its log. That link, and only that link,
// can create the first admin and choose how people sign in.

type Mode = "pin" | "accounts" | "proxy";
const PRESETS: { id: string; label: string; header: string }[] = [
  { id: "tailscale", label: "Tailscale Serve", header: "Tailscale-User-Login" },
  { id: "authelia", label: "Authelia", header: "Remote-User" },
  { id: "authentik", label: "Authentik", header: "Remote-User" },
  { id: "cloudflare", label: "Cloudflare Access", header: "Cf-Access-Authenticated-User-Email" },
];

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  return { status: res.status, data: await res.json().catch(() => ({})) as Record<string, unknown> };
}

export function AccessStep({ onDone }: { onDone: () => void }) {
  const token = typeof location !== "undefined" ? new URLSearchParams(location.search).get("token") ?? "" : "";
  const [valid, setValid] = useState<boolean | null>(token ? null : false);
  const [mode, setMode] = useState<Mode>("pin");
  const [pin, setPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState("tailscale");
  const [admins, setAdmins] = useState("");
  const [members, setMembers] = useState("");
  const [anyone, setAnyone] = useState(false);
  const [proxies, setProxies] = useState("loopback");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) post("/api/setup/auth/check", { token }).then((r) => setValid(!!r.data.valid), () => setValid(false));
  }, [token]);

  if (valid === false) {
    return (
      <div className="access-step">
        <h2>Open the setup link</h2>
        <p>For safety, only the one-time link the server printed when it started can set it up. Find it in the server's log:</p>
        <pre className="code">docker logs sports-remote | grep setup_required{"\n"}# or{"\n"}journalctl -u sports-remote | grep setup_required</pre>
        <p className="muted small">The link works once and expires after 24 hours. If yours expired, opening it printed a new one in the log.</p>
      </div>
    );
  }
  if (valid === null) return <p role="status"><span className="spinner" aria-hidden /> Checking the setup link...</p>;

  const list = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body =
      mode === "pin" ? { token, mode, pin, adminPassword }
        : mode === "accounts" ? { token, mode, username, password }
          : { token, mode, preset, admins: list(admins), members: list(members), allowAnyAuthenticated: anyone, trustedProxies: list(proxies) };
    if (mode === "pin" && !/^\d{4,12}$/.test(pin)) return setError("The PIN is 4 to 12 digits. 6 or more is much harder to guess.");
    if ((mode === "pin" ? adminPassword : password).length < 8 && mode !== "proxy") return setError("Use at least 8 characters for the password.");
    if (mode === "proxy" && list(admins).length === 0) return setError("Add at least one admin identity (the login your proxy sends).");
    setBusy(true);
    const r = await post("/api/setup/auth", body).catch(() => ({ status: 0, data: {} as Record<string, unknown> }));
    setBusy(false);
    if (r.status >= 200 && r.status < 300) return onDone();
    setError(String(r.data.error ?? "Couldn't save. Try again."));
  };

  return (
    <form className="access-step" onSubmit={submit}>
      <h2>Who can use it?</h2>
      <div className="mode-cards" role="radiogroup" aria-label="Sign-in mode">
        {([
          ["pin", "Household PIN", "Everyone at home types a PIN. A separate admin password protects setup. Simplest."],
          ["accounts", "Accounts", "Each person signs in. Admins change services and TVs; members just watch and use the remote."],
          ["proxy", "Sign-in proxy", "Tailscale Serve, Authelia, Authentik or Cloudflare Access signs people in and tells the app who they are."],
        ] as [Mode, string, string][]).map(([m, title, text]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`mode-card${mode === m ? " on" : ""}`} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
            <strong>{title}</strong>
            <span className="small muted">{text}</span>
          </button>
        ))}
      </div>

      {mode === "pin" && (
        <div className="form-grid">
          <label className="field"><span>Household PIN</span><input inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="6+ digits" data-testid="setup-pin" /></label>
          <label className="field"><span>Admin password</span><input type="password" autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} data-testid="setup-admin-password" /></label>
        </div>
      )}
      {mode === "accounts" && (
        <div className="form-grid">
          <label className="field"><span>Your username</span><input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label className="field"><span>Password</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <p className="muted small">You'll be the first admin. Add the rest of the household later in Settings.</p>
        </div>
      )}
      {mode === "proxy" && (
        <div className="form-grid">
          <label className="field">
            <span>Proxy</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.header})</option>)}</select>
          </label>
          <label className="field"><span>Proxy addresses to trust</span><input value={proxies} onChange={(e) => setProxies(e.target.value)} placeholder="loopback, 172.18.0.0/16" /></label>
          <label className="field"><span>Admins (one per line)</span><textarea value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder="you@example.com" /></label>
          <label className="field"><span>Members</span><textarea value={members} onChange={(e) => setMembers(e.target.value)} placeholder="partner@example.com" /></label>
          <label className="check small"><input type="checkbox" checked={anyone} onChange={(e) => setAnyone(e.target.checked)} /> Let anyone the proxy signs in be a member</label>
          <p className="muted small">Only requests from the trusted addresses may set the identity header; everyone else's is stripped. Never trust an address range ordinary devices on your Wi-Fi use.</p>
        </div>
      )}
      {error && <p className="warn small" role="alert">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy} data-testid="setup-access-save">{busy ? "Saving..." : "Continue"}</Button>
    </form>
  );
}
