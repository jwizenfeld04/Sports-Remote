import { useState } from "react";
import type { OwnedSubscription, Tv } from "../../lib/profile";
import { SUBSCRIPTION_BY_ID } from "../../lib/catalog/subscriptions";
import { PLATFORM_LABEL, type Platform } from "../../lib/catalog/apps";
import { APP_RECORD } from "../catalog";
import { api, type TvView } from "../api";
import { Button, Icon, Segmented } from "../components/ui";

// Add the TVs this server controls. Fire TV: turn on ADB debugging, connect, accept the prompt on the TV.
// Google TV / Android TV 11+: turn on wireless debugging and pair with the six-digit code the TV shows.

const STEPS: Record<Platform, string[]> = {
  firetv: [
    "On the Fire TV: Settings → My Fire TV → About. Select the device name 7 times until it says you're a developer.",
    "Back in My Fire TV → Developer options: turn on ADB debugging.",
    "Settings → My Fire TV → About → Network shows the TV's IP address. Enter it below.",
    "When you press Connect, the TV asks to allow USB debugging: tick “Always allow from this computer” and choose Allow.",
  ],
  googletv: [
    "On the TV: Settings → System → About. Select “Android TV OS build” 7 times until it says you're a developer.",
    "Settings → System → Developer options: turn on Wireless debugging (or Network debugging on older models).",
    "Open Wireless debugging → Pair device with pairing code. Leave that screen up.",
    "Enter the IP address and port and the six-digit code it shows.",
  ],
};

interface Props {
  adbMissing?: boolean;
  tvs: Tv[];
  status: TvView[];
  subscriptions: OwnedSubscription[];
  onChanged: () => void;
}

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; text: string } | { kind: "found"; host: string; port: number; platform: Platform | null; name: string; model: string; apps: string[] };

export function TvStep({ adbMissing, tvs, status, subscriptions, onChanged }: Props) {
  const [platform, setPlatform] = useState<Platform>("firetv");
  const [host, setHost] = useState("");
  const [pairPort, setPairPort] = useState("");
  const [code, setCode] = useState("");
  const [connectPort, setConnectPort] = useState("");
  const [needPort, setNeedPort] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [name, setName] = useState("");
  const [found, setFound] = useState<{ mdns: { host: string; port: number; type: string }[]; adb5555: string[] } | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<Record<string, string>>({});
  const reconnect = async (t: Tv) => {
    const port = Number(ports[t.id]);
    if (!port) return;
    await api.connectTv(t.host, port);
    await api.updateTv(t.id, { port });
    setPorts((p) => ({ ...p, [t.id]: "" }));
    onChanged();
  };

  const wanted = [...new Set(subscriptions.flatMap((s) => SUBSCRIPTION_BY_ID.get(s.id)?.apps.slice(0, 1) ?? []))].filter((a) => APP_RECORD[a]?.packages);

  const discover = async () => {
    setPhase({ kind: "busy", text: "Looking for TVs on your network..." });
    const r = await api.discoverTvs().catch(() => null);
    setPhase({ kind: "idle" });
    if (r?.status === 200) setFound(r.data);
  };

  const identify = async (h: string, p: number) => {
    setPhase({ kind: "busy", text: "Reading what's installed..." });
    const id = await api.identifyTv(h, p);
    if (id.status !== 200) return setPhase({ kind: "error", text: "Connected, but couldn't read the TV. Try again." });
    if (!id.data.platform) return setPhase({ kind: "error", text: `That device (${id.data.model}) doesn't look like a Fire TV or Google TV.` });
    setName(id.data.name);
    setPhase({ kind: "found", host: h, port: p, ...id.data });
  };

  const connectFire = async () => {
    if (!host) return;
    setPhase({ kind: "busy", text: "Connecting... If the TV asks to allow USB debugging, tick “Always allow” and choose Allow." });
    const r = await api.connectTv(host, 5555, true);
    const state = r.data?.state;
    if (state === "connected") return identify(host, 5555);
    setPhase({
      kind: "error",
      text: state === "unauthorized" ? "The TV didn't allow this server yet. Choose Allow on the TV, then try again."
        : state === "refused" ? "The TV refused the connection: turn on ADB debugging in Developer options."
          : "Couldn't reach that address. Check the IP and that the TV is on.",
    });
  };

  const pairGoogle = async () => {
    if (needPort) {
      const p = Number(connectPort);
      setPhase({ kind: "busy", text: "Connecting..." });
      const r = await api.connectTv(host, p);
      return r.data?.state === "connected" ? identify(host, p) : setPhase({ kind: "error", text: "Couldn't connect on that port. Check the IP address & port on the Wireless debugging screen." });
    }
    setPhase({ kind: "busy", text: "Pairing..." });
    const r = await api.pairTv(host, Number(pairPort), code);
    if (r.status !== 200 || !r.data.ok) {
      const e = r.data?.error;
      return setPhase({ kind: "error", text: e === "wrong_code" ? "That code didn't work. Codes change each time: check the TV." : e === "adb_too_old" ? "This server's adb is too old to pair (needs 30+). Fire TV-style connections still work." : "Couldn't pair. Check the IP, port and code." });
    }
    if (!r.data.connectPort) {
      setNeedPort(true);
      return setPhase({ kind: "error", text: "Paired! Now enter the port shown under “IP address & port” on the Wireless debugging screen (not the pairing port)." });
    }
    if (r.data.state !== "connected") return setPhase({ kind: "error", text: "Paired, but couldn't connect. Try again." });
    return identify(host, r.data.connectPort);
  };

  const save = async () => {
    if (phase.kind !== "found" || !phase.platform) return;
    setPhase({ kind: "busy", text: "Saving..." });
    await api.addTv({ name: name || "TV", host: phase.host, port: phase.port, platform: phase.platform, model: phase.model, apps: phase.apps });
    setPhase({ kind: "idle" });
    setHost(""), setCode(""), setPairPort(""), setConnectPort(""), setNeedPort(false);
    onChanged();
  };

  const test = async (tvId: string, app: string) => {
    setTests((t) => ({ ...t, [`${tvId}:${app}`]: "…" }));
    const r = await api.testApp(tvId, app);
    setTests((t) => ({ ...t, [`${tvId}:${app}`]: r.data?.ok ? "✓ opened" : `✕ ${r.data?.error ?? "failed"}` }));
  };

  return (
    <div className="tv-step">
      {adbMissing && <p className="warn" role="alert">This server can't run adb, so it can't reach any TV. Install it (Debian/Ubuntu: <code>apt install adb</code>) or set ADB_BIN, then restart Sports Remote. The Docker image already includes it.</p>}
      {tvs.map((t) => {
        const st = status.find((s) => s.id === t.id);
        const apps = st?.apps ?? t.apps;
        const missing = wanted.filter((a) => !apps.includes(a));
        return (
          <article key={t.id} className="tv-card" data-testid={`tv-${t.id}`}>
            <header>
              <Icon name="tv" />
              <div>
                <strong>{t.name}</strong>
                <span className="muted small"> {PLATFORM_LABEL[t.platform]} · {t.host}:{t.port} · {st?.adb === "connected" ? "connected" : st?.adb === "unauthorized" ? "waiting for approval on the TV" : "offline"}</span>
              </div>
              <Button variant="ghost" onClick={() => api.refreshTvApps(t.id).then(onChanged)}>Recheck apps</Button>
              <Button variant="ghost" onClick={() => confirm(`Remove ${t.name}?`) && api.removeTv(t.id).then(onChanged)}>Remove</Button>
            </header>
            <div className="chips-wrap">
              {apps.filter((a) => APP_RECORD[a]).map((a) => (
                <button key={a} type="button" className="chip" onClick={() => test(t.id, a)} title="Open it on the TV">
                  {APP_RECORD[a].label} {tests[`${t.id}:${a}`] ?? ""}
                </button>
              ))}
            </div>
            {t.platform === "googletv" && st?.adb !== "connected" && (
              <div className="row-actions small">
                <span className="muted">Offline? Google TV changes its port after a restart. Sports Remote looks for it automatically; you can also enter the port from Wireless debugging → IP address &amp; port.</span>
                <label className="field"><span>Connect port</span><input inputMode="numeric" value={ports[t.id] ?? ""} onChange={(e) => setPorts({ ...ports, [t.id]: e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder={String(t.port)} /></label>
                <Button variant="ghost" disabled={!ports[t.id]} onClick={() => reconnect(t)}>Reconnect</Button>
              </div>
            )}
            {missing.length > 0 && <p className="warn small">Not on this TV: {missing.map((a) => APP_RECORD[a]?.label ?? a).join(", ")}. Install them from the TV's app store so those games can open.</p>}
          </article>
        );
      })}

      <section className="tv-add">
        <h3>{tvs.length ? "Add another TV" : "Add your TV"}</h3>
        <Segmented label="TV type" value={platform} onChange={(p) => (setPlatform(p), setPhase({ kind: "idle" }), setNeedPort(false))} options={[{ value: "firetv", label: "Fire TV" }, { value: "googletv", label: "Google TV / Android TV" }]} />
        <ol className="tv-steps small">{STEPS[platform].map((s) => <li key={s}>{s}</li>)}</ol>
        <div className="form-grid">
          <label className="field"><span>TV's IP address</span><input inputMode="decimal" value={host} onChange={(e) => setHost(e.target.value.trim())} placeholder="192.168.1.50" data-testid="tv-host" /></label>
          {platform === "googletv" && !needPort && (
            <>
              <label className="field"><span>Pairing port</span><input inputMode="numeric" value={pairPort} onChange={(e) => setPairPort(e.target.value.replace(/\D/g, ""))} placeholder="37115" /></label>
              <label className="field"><span>Pairing code</span><input inputMode="numeric" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" /></label>
            </>
          )}
          {platform === "googletv" && needPort && (
            <label className="field"><span>Connect port</span><input inputMode="numeric" value={connectPort} onChange={(e) => setConnectPort(e.target.value.replace(/\D/g, ""))} placeholder="41239" /></label>
          )}
        </div>
        <div className="row-actions">
          <Button variant="primary" disabled={phase.kind === "busy" || !host || (platform === "googletv" && !needPort && (code.length !== 6 || !pairPort))} onClick={() => (platform === "firetv" ? connectFire() : pairGoogle())} data-testid="tv-connect">
            {platform === "firetv" ? "Connect" : needPort ? "Connect" : "Pair"}
          </Button>
          <Button variant="ghost" icon="search" disabled={phase.kind === "busy"} onClick={discover}>Find TVs</Button>
        </div>
        {found && (
          <div className="chips-wrap">
            {[...new Set([...found.adb5555, ...found.mdns.map((m) => m.host)])].map((h) => (
              <button key={h} type="button" className="chip" onClick={() => setHost(h)}>{h}{found.mdns.some((m) => m.host === h) ? " (Google TV)" : ""}</button>
            ))}
            {found.adb5555.length + found.mdns.length === 0 && <span className="muted small">Nothing found. Make sure debugging is on, or type the IP.</span>}
          </div>
        )}
        {phase.kind === "busy" && <p className="small" role="status"><span className="spinner" aria-hidden /> {phase.text}</p>}
        {phase.kind === "error" && <p className="warn small" role="alert">{phase.text}</p>}
        {phase.kind === "found" && (
          <div className="tv-found">
            <p className="ok">✓ Found a {phase.platform ? PLATFORM_LABEL[phase.platform] : "TV"} ({phase.model}) with {phase.apps.length} supported apps.</p>
            <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
            <Button variant="primary" onClick={save} data-testid="tv-save">Save TV</Button>
          </div>
        )}
      </section>
    </div>
  );
}
