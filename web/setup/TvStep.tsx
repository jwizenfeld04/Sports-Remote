import { useState } from "react";
import type { OwnedSubscription, Tv } from "../../lib/profile";
import { SUBSCRIPTION_BY_ID } from "../../lib/catalog/subscriptions";
import { PLATFORM_LABEL, type Platform } from "../../lib/catalog/apps";
import { APP_RECORD } from "../catalog";
import { api, type TvView } from "../api";
import { Button, Icon, Segmented } from "../components/ui";

// Add the TVs this server controls. Three kinds of device, each with its own steps:
//  - Fire TV: ADB debugging, connect on 5555, accept the prompt on the TV.
//  - Google TV: newer models pair with a code (Wireless debugging); older ones connect directly like a Fire TV.
//  - Other Android TV boxes (NVIDIA Shield, Mi Box, onn.): Network/USB debugging, connect directly.
// Detailed per-device steps: docs/tv-setup.md.

type Kind = "firetv" | "googletv" | "androidtv";
type Method = "pair" | "direct";

const GUIDE_URL = "https://github.com/jwizenfeld04/Sports-Remote/blob/main/docs/tv-setup.md";

const STEPS: Record<Kind, Partial<Record<Method, string[]>>> = {
  firetv: {
    direct: [
      "On the Fire TV: Settings → My Fire TV (or Device) → About. Highlight the device name (“Your TV” on a Fire TV smart TV) and press the center button 7 times, until it says you're a developer.",
      "Press Back, open Developer options and turn on ADB debugging.",
      "Find the TV's IP address under My Fire TV → About → Network, and enter it below.",
      "Press Connect. The TV asks “Allow USB debugging?”: tick “Always allow from this computer” and choose OK.",
    ],
  },
  googletv: {
    pair: [
      "On the TV: Settings → System → About. Select “Android TV OS build” 7 times, until it says you're a developer.",
      "Back in Settings → System → Developer options, turn on Wireless debugging.",
      "Open Wireless debugging → Pair device with pairing code, and leave that screen up.",
      "Enter the IP address, the port and the six-digit code shown under “Pair device”.",
    ],
    direct: [
      "On the TV: Settings → System → About. Select “Android TV OS build” 7 times, until it says you're a developer.",
      "Back in Settings → System → Developer options, turn on USB debugging (no Wireless debugging option on older models).",
      "Find the IP address under Settings → Network & Internet → your network, and enter it below.",
      "Press Connect. The TV asks to allow debugging: tick “Always allow from this computer” and choose OK.",
    ],
  },
  androidtv: {
    direct: [
      "Settings → Device Preferences → About. Select Build 7 times, until it says you're a developer.",
      "Back in Device Preferences → Developer options, turn on Network debugging (on some boxes it's USB debugging; turn on both if you see both).",
      "Find the IP address under Settings → Network & Internet, and enter it below. The port is 5555 unless the debugging screen shows another.",
      "Press Connect. The TV asks to allow debugging: tick “Always allow from this computer” and choose OK.",
    ],
  },
};

const KIND_PLATFORM: Record<Kind, Platform> = { firetv: "firetv", googletv: "googletv", androidtv: "googletv" };

interface Props {
  adbMissing?: boolean;
  tvs: Tv[];
  status: TvView[];
  subscriptions: OwnedSubscription[];
  onChanged: () => void;
}

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; text: string } | { kind: "found"; host: string; port: number; platform: Platform | null; name: string; model: string; apps: string[] };

export function TvStep({ adbMissing, tvs, status, subscriptions, onChanged }: Props) {
  const [kind, setKind] = useState<Kind>("firetv");
  const [method, setMethod] = useState<Method>("direct");
  const [directPort, setDirectPort] = useState("5555");
  const platform = KIND_PLATFORM[kind];
  const pairing = kind === "googletv" && method === "pair";
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

  const connectDirect = async () => {
    if (!host) return;
    const port = kind === "androidtv" ? Number(directPort) || 5555 : 5555;
    setPhase({ kind: "busy", text: "Connecting... If the TV asks to allow debugging, tick “Always allow” and choose OK." });
    const r = await api.connectTv(host, port, true);
    const state = r.data?.state;
    if (state === "connected") return identify(host, port);
    const toggle = kind === "firetv" ? "ADB debugging" : kind === "googletv" ? "USB debugging" : "Network debugging";
    setPhase({
      kind: "error",
      text: state === "unauthorized" ? "The TV didn't allow this server yet. Choose OK on the TV's prompt, then try again."
        : state === "refused"
          ? `The TV refused the connection: check that ${toggle} is on in Developer options.${kind === "firetv" ? " (Fire TV Stick 4K Select, Stick HD 2026 and Stick 4K 3rd gen can't be used: they don't run Android.)" : kind === "googletv" ? " Newer Google TVs need “Pair with a code” instead." : ""}`
          : "Couldn't reach that address. Check the IP address and that the TV is on and on the same network.",
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
                <span className="muted">Offline? After a restart, a Google TV may turn Wireless debugging off and pick a new port. Turn it back on in Developer options; Sports Remote finds the new port by itself, or enter it from Wireless debugging → IP address &amp; port.</span>
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
        <Segmented label="TV type" value={kind} onChange={(k) => (setKind(k), setMethod(k === "googletv" ? "pair" : "direct"), setPhase({ kind: "idle" }), setNeedPort(false))} options={[{ value: "firetv", label: "Fire TV" }, { value: "googletv", label: "Google TV" }, { value: "androidtv", label: "Other Android TV" }]} />
        <p className="muted small tv-kinds">
          {kind === "firetv" ? "Fire TV Stick, Fire TV Cube, and smart TVs with Fire TV built in (Insignia, Toshiba, Hisense, Amazon Omni …)."
            : kind === "googletv" ? "Google TV Streamer, Chromecast with Google TV, and Google TV smart TVs (Sony, TCL, Hisense …)."
              : "NVIDIA Shield, Xiaomi Mi Box, onn. and other Android TV boxes and TVs."}
        </p>
        {kind === "googletv" && (
          <Segmented label="How to connect" value={method} onChange={(m) => (setMethod(m), setPhase({ kind: "idle" }), setNeedPort(false))} options={[{ value: "pair", label: "Pair with a code" }, { value: "direct", label: "Connect directly" }]} />
        )}
        {kind === "googletv" && <p className="muted small">{method === "pair" ? "For newer models with Wireless debugging in Developer options." : "For older models that only have USB debugging."}</p>}
        <ol className="tv-steps small">{(STEPS[kind][method] ?? []).map((s) => <li key={s}>{s}</li>)}</ol>
        {kind === "firetv" && <p className="muted small">Not supported: Fire TV Stick 4K Select, Fire TV Stick HD (2026) and Fire TV Stick 4K (3rd gen). They run Amazon's Vega OS instead of Android (About shows “OS 1.x”).</p>}
        <div className="form-grid">
          <label className="field"><span>TV's IP address</span><input inputMode="decimal" value={host} onChange={(e) => setHost(e.target.value.trim())} placeholder="192.168.1.50" data-testid="tv-host" /></label>
          {kind === "androidtv" && (
            <label className="field"><span>Port</span><input inputMode="numeric" value={directPort} onChange={(e) => setDirectPort(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="5555" /></label>
          )}
          {pairing && !needPort && (
            <>
              <label className="field"><span>Pairing port</span><input inputMode="numeric" value={pairPort} onChange={(e) => setPairPort(e.target.value.replace(/\D/g, ""))} placeholder="37115" /></label>
              <label className="field"><span>Pairing code</span><input inputMode="numeric" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" /></label>
            </>
          )}
          {pairing && needPort && (
            <label className="field"><span>Connect port</span><input inputMode="numeric" value={connectPort} onChange={(e) => setConnectPort(e.target.value.replace(/\D/g, ""))} placeholder="41239" /></label>
          )}
        </div>
        <div className="row-actions">
          <Button variant="primary" disabled={phase.kind === "busy" || !host || (pairing && !needPort && (code.length !== 6 || !pairPort))} onClick={() => (pairing ? pairGoogle() : connectDirect())} data-testid="tv-connect">
            {pairing && !needPort ? "Pair" : "Connect"}
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
        <p className="muted small tv-help">
          Roku, Apple TV, Samsung and LG TVs can't be used: they don't run Android, so there's no ADB. <a href={GUIDE_URL} target="_blank" rel="noreferrer">Step-by-step guide for each device</a>
        </p>
      </section>
    </div>
  );
}
