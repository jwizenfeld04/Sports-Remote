import { useState } from "react";
import type { OwnedSubscription } from "../../lib/profile";
import { api, type HouseholdView } from "../api";
import { Button, Icon } from "../components/ui";

// Optional extras: Plex Live TV (for antenna households: it knows which game your local station is showing, and
// can tune it), and the ESPN Watch key (ESPN games open straight to the game instead of the app's home screen).

export function ExtrasStep({ household, subscriptions, onChanged }: { household: HouseholdView; subscriptions: OwnedSubscription[]; onChanged: () => void }) {
  const plex = household.integrations.plex;
  const [url, setUrl] = useState(plex?.url ?? "http://127.0.0.1:32400");
  const [token, setToken] = useState("");
  const [plexMsg, setPlexMsg] = useState<string | null>(null);
  const [channels, setChannels] = useState<{ callSign: string; network: string | null }[] | null>(null);
  const [map, setMap] = useState<Record<string, string>>(plex?.channelMap ?? {});
  const [espnKey, setEspnKey] = useState("");
  const [espnMsg, setEspnMsg] = useState<string | null>(null);
  const hasAntenna = subscriptions.some((s) => s.id === "antenna");
  const hasEspnApp = subscriptions.some((s) => ["espn", "youtube_tv", "hulu_live", "fubo", "directv", "sling"].includes(s.id));

  const savePlex = async () => {
    setPlexMsg("Checking Plex...");
    const r = await api.savePlex({ url, ...(token ? { token } : {}), ...(Object.keys(map).length ? { channelMap: map } : {}) });
    if (r.status !== 200 || !r.data.ok) return setPlexMsg(`Couldn't use Plex: ${r.data?.error ?? "check the address and token"}`);
    setChannels(r.data.channels ?? []);
    setPlexMsg(`✓ Connected: ${r.data.channels?.length ?? 0} channels.`);
    setToken("");
    onChanged();
  };

  return (
    <div className="extras-step">
      <section className={`extra-card${hasAntenna ? "" : " dim"}`}>
        <header><Icon name="antenna" /> <h3>Plex Live TV</h3>{plex && <span className="ok small">connected</span>}</header>
        <p className="small muted">
          If your antenna runs through Plex (with an HDHomeRun or similar tuner), the server can read the guide to tell which Sunday NFL game your local CBS or FOX station is showing, and tune Plex to the channel.
          {hasAntenna ? "" : " You haven't added an antenna, so you can skip this."}
        </p>
        <div className="form-grid">
          <label className="field"><span>Plex server URL</span><input value={url} onChange={(e) => setUrl(e.target.value.trim())} /></label>
          <label className="field">
            <span>Plex token {plex ? "(saved; leave blank to keep)" : ""}</span>
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="Plex token" />
          </label>
        </div>
        <details className="small">
          <summary>Finding your Plex token</summary>
          <p>In Plex Web, open any item → Get Info → View XML. Your token is the part of the address after <code>Token=</code>. It's your admin token and stays on this server (never sent to browsers or logs).</p>
        </details>
        {channels && (
          <div className="plex-map">
            <p className="small">Which channel is which network? Ones we recognized are filled in.</p>
            <div className="form-grid">
              {(["abc", "cbs", "fox", "nbc"] as const).map((n) => (
                <label key={n} className="field">
                  <span>{n.toUpperCase()}</span>
                  <select value={map[n] ?? channels.find((c) => c.network === n)?.callSign ?? ""} onChange={(e) => setMap({ ...map, [n]: e.target.value })}>
                    <option value="">(none)</option>
                    {channels.map((c) => <option key={c.callSign} value={c.callSign}>{c.callSign}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="row-actions">
          <Button onClick={savePlex} disabled={!url || (!token && !plex)}>{plex ? "Save" : "Connect Plex"}</Button>
          {plex && <Button variant="ghost" onClick={() => api.removePlex().then(onChanged)}>Disconnect</Button>}
        </div>
        {plexMsg && <p className="small" role="status">{plexMsg}</p>}
      </section>

      <section className={`extra-card${hasEspnApp ? "" : " dim"}`}>
        <header><Icon name="play" /> <h3>ESPN game links</h3>{household.integrations.espnWatch && <span className="ok small">on</span>}</header>
        <p className="small muted">
          With ESPN's Watch API client key, ESPN games open straight into the game. Without it they open the ESPN app with on-screen steps.
          It's ESPN's unofficial key (the one community DVR projects use); it isn't included with Sports Remote.
        </p>
        <div className="form-grid">
          <label className="field"><span>ESPN Watch API key</span><input type="password" autoComplete="off" value={espnKey} onChange={(e) => setEspnKey(e.target.value.trim())} /></label>
        </div>
        <div className="row-actions">
          <Button disabled={espnKey.length < 8} onClick={() => api.saveEspnKey(espnKey).then(() => (setEspnMsg("✓ Saved"), setEspnKey(""), onChanged()))}>Save key</Button>
          {household.integrations.espnWatch && <Button variant="ghost" onClick={() => api.saveEspnKey(null).then(onChanged)}>Remove</Button>}
        </div>
        {espnMsg && <p className="small">{espnMsg}</p>}
      </section>
    </div>
  );
}
