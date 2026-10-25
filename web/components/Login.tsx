import { useState, type ReactNode } from "react";
import { api, type Boot } from "../api";
import { Button } from "./ui";

type Auth = Boot["auth"];

function Card({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  const inner = (
    <>
      <img className="brand-mark lg" src="/icon.svg" alt="" width={56} height={56} />
      <h1>Sports Remote</h1>
      {children}
    </>
  );
  return (
    <main className="login">
      {onSubmit ? <form onSubmit={onSubmit} className="login-card">{inner}</form> : <div className="login-card">{inner}</div>}
    </main>
  );
}

/** Message for a failed sign-in. */
function failure(status: number, wrong: string): string {
  if (status === 429) return "Too many tries. Wait a minute.";
  if (status === 401) return wrong;
  return "Couldn't sign in. Check the connection and try again.";
}

/** Shared submit logic: calls the API, reports errors, and signs in on success. */
function useSignIn(onDone: () => void, wrong: string) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (body: Parameters<typeof api.login>[0]) => {
    setBusy(true);
    setError(null);
    const r = await api.login(body).catch(() => ({ status: 0 }));
    setBusy(false);
    if (r.status === 200) onDone();
    else setError(failure(r.status, wrong));
    return r.status === 200;
  };
  return { error, busy, run, setError };
}

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Household PIN: a number pad (with keyboard input too), and a link to the admin password form. */
function PinLogin({ onDone, onAdmin }: { onDone: () => void; onAdmin: () => void }) {
  const [pin, setPin] = useState("");
  const { error, busy, run } = useSignIn(onDone, "That PIN didn't work.");
  const press = (d: string) => setPin((p) => (p.length < 12 ? p + d : p));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return;
    if (!(await run({ pin }))) setPin("");
  };
  return (
    <Card onSubmit={submit}>
      <p className="muted">Enter the household PIN to control the TV from this device.</p>
      <label className="field">
        <span>PIN</span>
        <input
          type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="current-password" maxLength={12}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} autoFocus data-testid="pin"
        />
      </label>
      <div className="pin-pad" role="group" aria-label="Number pad">
        {PAD.map((d) => <Button key={d} onClick={() => press(d)} disabled={busy}>{d}</Button>)}
        <span aria-hidden />
        <Button onClick={() => press("0")} disabled={busy}>0</Button>
        <Button variant="ghost" onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy || !pin} aria-label="Delete">⌫</Button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || pin.length < 4}>Unlock</button>
      <button type="button" className="text-btn login-alt" onClick={onAdmin} data-testid="admin-link">Sign in as admin</button>
    </Card>
  );
}

/** Password form: the admin password in pin mode, or username + password in accounts mode. */
function PasswordLogin({ onDone, withUsername, onBack }: { onDone: () => void; withUsername: boolean; onBack?: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { error, busy, run } = useSignIn(onDone, withUsername ? "Wrong username or password." : "That admin password didn't work.");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(withUsername ? { username, password } : { password })) return;
    setPassword("");
  };
  return (
    <Card onSubmit={submit}>
      <p className="muted">{withUsername ? "Sign in to control the TV from this device." : "Enter the admin password to change settings."}</p>
      {withUsername && (
        <label className="field">
          <span>Username</span>
          <input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus data-testid="username" />
        </label>
      )}
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!withUsername} data-testid="password" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password || (withUsername && !username)}>Sign in</button>
      {onBack && <button type="button" className="text-btn login-alt" onClick={onBack}>Use the household PIN</button>}
    </Card>
  );
}

export function Login({ auth, onDone }: { auth?: Auth; onDone: () => void }) {
  const [admin, setAdmin] = useState(false);
  if (!auth) {
    return (
      <Card>
        <p className="muted">Couldn't reach the server.</p>
        <Button variant="primary" block onClick={() => location.reload()}>Try again</Button>
      </Card>
    );
  }
  if (auth.setupRequired || auth.mode === null) {
    return (
      <Card>
        <p className="muted">Sports Remote isn't set up yet. Open the setup link printed in the server's log (it starts with <code>/setup?token=</code>).</p>
      </Card>
    );
  }
  if (auth.mode === "proxy") {
    return (
      <Card>
        <p className="muted">Sign in through your proxy. This server only lets in people your sign-in proxy (such as Tailscale, Authelia or Cloudflare Access) has identified and allowed.</p>
        <Button variant="primary" block onClick={() => location.reload()}>Try again</Button>
      </Card>
    );
  }
  if (auth.mode === "accounts") return <PasswordLogin onDone={onDone} withUsername />;
  return admin
    ? <PasswordLogin onDone={onDone} withUsername={false} onBack={() => setAdmin(false)} />
    : <PinLogin onDone={onDone} onAdmin={() => setAdmin(true)} />;
}
