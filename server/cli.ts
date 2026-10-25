// Manual control from the server's shell, using the same driver and allowlist as the app.
//   npm run tv -- tvs
//   npm run tv -- status [--tv <id>]
//   npm run tv -- apps [--tv <id>]
//   npm run tv -- key HOME [--tv <id>]
//   npm run tv -- open espn [--tv <id>]
//   npm run tv -- launch youtube_tv --network cbs [--tv <id>]   (a pretend game, to try a route)
import { randomUUID } from "node:crypto";
import type { Game, NetworkId } from "../lib/types";
import { ALLOWED_KEYS } from "../lib/types";
import { APP_BY_ID, verifiedLevel } from "../lib/catalog/apps";
import { NETWORK_IDS } from "../lib/catalog/networks";
import { makeAdbExec, isAllowedKey } from "./adb";
import { ConfigStore } from "./store/config";
import { TvManager } from "./tv/manager";
import { PlexClient } from "./plex";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

const store = new ConfigStore(process.env.DATA_DIR ?? "/var/lib/sports-remote");
await store.load();
const c = store.get();
const s = store.getSecrets();
const plex = c.integrations.plex && s.plexToken ? new PlexClient({ url: c.integrations.plex.url, token: s.plexToken, channelMap: c.integrations.plex.channelMap }) : null;
const tvs = new TvManager({ exec: makeAdbExec(), shared: { plex } });
tvs.sync(c.tvs);
const picked = tvs.pick(flag("tv"), c.preferences.defaultTv);

if (cmd === "tvs") {
  console.log(c.tvs.length ? c.tvs.map((t) => `${t.id}\t${t.platform}\t${t.host}:${t.port}\t${t.name}`).join("\n") : "No TVs set up yet. Add one on the setup page.");
  process.exit(0);
}
if (!picked) {
  console.error("No TV set up yet (or no such --tv). Add one on the setup page.");
  process.exit(2);
}
const { driver, tv } = picked;

if (cmd === "status") {
  await driver.connect();
  console.log(JSON.stringify({ tv: tv.id, ...(await driver.status(plex ? "ok" : "unconfigured")) }, null, 2));
} else if (cmd === "apps") {
  console.log(JSON.stringify(await tvs.refreshApps(tv.id), null, 2));
} else if (cmd === "key") {
  if (!isAllowedKey(rest[0])) throw new Error(`key must be one of ${ALLOWED_KEYS.join(" ")}`);
  console.log(await driver.key(rest[0]));
} else if (cmd === "open") {
  console.log(await driver.openApp(rest[0] ?? ""));
} else if (cmd === "launch") {
  const app = APP_BY_ID.get(rest[0] ?? "");
  if (!app) throw new Error(`app must be one of ${[...APP_BY_ID.keys()].join(", ")}`);
  const network = (flag("network") ?? "espn") as NetworkId;
  if (!(NETWORK_IDS as readonly string[]).includes(network)) throw new Error(`network must be one of ${NETWORK_IDS.join(", ")}`);
  const team = (abbr: string, name: string) => ({ id: abbr, abbr, name, city: "", displayName: name });
  const game: Game = { id: "nfl:0", league: "nfl", startTime: new Date().toISOString(), state: "in", detail: "", home: team("HOME", "Home"), away: team("AWAY", "Away"), broadcasts: [] };
  const route = { service: app.id, network, level: verifiedLevel(app, network, tv.platform), certain: true, reason: "manual" };
  console.log(JSON.stringify(await driver.launch({ requestId: randomUUID(), game, route }), null, 2));
} else {
  console.log("usage: npm run tv -- tvs | status | apps | key <KEY> | open <app> | launch <app> [--network <id>]   [--tv <id>]");
}
