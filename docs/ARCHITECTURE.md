# Architecture

Sports Remote is a self-hosted web app. A phone or tablet shows live and upcoming NFL, NBA, MLB and NHL games. Tapping one opens it on a Fire TV or Google TV, in an app the household pays for, as close to the game as that app allows.

It has to run on the same network as the TV (it talks to the TV over ADB), so there is no cloud version.

```
phone / tablet --HTTPS or LAN--> server (Node, Fastify) --ADB--> Fire TV / Google TV
                                   |- ESPN scoreboards (games, broadcasters)
                                   |- catalog: networks, subscriptions, apps, teams
                                   |- household profile: services, market, TVs, preferences
                                   |- optional: Plex guide (local channels), ESPN Watch API
                                   '- optional: tesseract OCR (screen-reading launches)
```

The code is TypeScript. `lib/` is pure and also runs in the browser. `server/` is Fastify and talks to the TV. `web/` is the React UI. The server is built with esbuild to `dist/server/*.mjs` and runs on plain `node`.

## Layout

```
lib/
  espn.ts            parse ESPN scoreboards into Game objects
  catalog/           data: networks.ts, subscriptions.ts, apps.ts, teams.ts, localTeams.ts, sources.json
  availability.ts    game -> what it takes to watch it here (rules in docs/coverage.md)
  entitlements.ts    household subscriptions -> what they grant, and in which apps
  resolve.ts         game + household -> ranked launch routes, or why none
  coverage.ts        resolver over many games: shares, gaps, and the services that would fill them
  profile.ts         zod schemas for config.json (market, TVs, preferences...)
  filters.ts, search.ts, messages.ts, guideMatch.ts, types.ts   UI helpers and shared types
server/
  main.ts            startup: config, stores, poller, TVs, timers, shutdown
  app.ts             Fastify routes (/api/*), SSE at /api/events, static UI
  config.ts          bootstrap environment variables
  driver.ts          AndroidTvDriver: one TV, launches and key presses
  adb.ts             allowlisted adb command builders and parsers
  tv/                commands, detect, discovery, mdns, pairing, manager, keys
  navigation/        entry.ts (warm/cold entry), match.ts (name matching in OCR text)
  youtubeTv.ts, plexGuide.ts, primeVideo.ts   the three screen-reading navigators
  ocr.ts             tesseract wrapper
  plex.ts, espnWatch.ts, mlb.ts, nba.ts       outside lookups used by launches
  espnPoller.ts      polls ESPN, emits changes
  store/             config.json + secrets.json, migration of 0.1 installs
  auth/              sign-in modes, sessions, setup token, trusted proxies
web/                 React UI: App.tsx, components/ (cards, launch sheet, remote), setup/ (wizard, coverage)
test/                vitest unit + UI tests, test/sim TV simulator, Playwright e2e (test/e2e)
deploy/              compose file, systemd unit, installer (the Dockerfile is at the repo root)
```

## The model

| Thing | What it is | Example |
|---|---|---|
| **Network** | Where a game airs, as ESPN labels it (`lib/catalog/networks.ts`) | `espn`, `nbc`, `peacock`, `prime`, `local` |
| **Grant** | The right to watch something | `espn`, `cbs@nfl` (that network, that league only), `outlet:sny` (a team's regional outlet), `nba_league_pass` (an out-of-market package) |
| **Subscription** | What people pay for: tiers and add-ons that grant things, and the apps where it plays (`subscriptions.ts`) | YouTube TV base + Sports Plus, ESPN Unlimited, NBA League Pass |
| **App** | What opens on the TV: package names per platform and the routes it can be opened with (`apps.ts`) | `espn`, `youtube_tv`, `prime_video`, `plex` |

Some subscriptions also unlock other apps through TV Everywhere. Signing in to the ESPN app with YouTube TV grants ESPN's content in the ESPN app, but only once the household says it has signed in (`tveSignIns`).

Carriage claims in the catalog cite their sources in `lib/catalog/sources.json`, keyed by subscription id.

**Household profile** (`config.json`, validated by `lib/profile.ts`):

- **Subscriptions:** which ones the household has, with tier and add-ons.
- **Market:** timezone, metro, local teams, and for each local team how its regional games are watched (a subscription, an antenna, or not at all). The timezone is chosen in the setup's **Your area** step, and the UI uses it for Today / Tonight / Tomorrow.
- **TVs:** id, name, host, port, platform (`firetv` or `googletv`), and the catalog apps found installed.
- **Integrations:** the Plex URL and channel map, and whether an ESPN Watch key is set.
- **Preferences:** favorites, service order per network, saved views, one-tap send, default TV.

## Resolving a game

`lib/resolve.ts` is pure. Given a game and the household, it returns ranked routes, or an explanation of why nothing covers the game.

1. **Needs.** `availability.ts` turns ESPN's broadcast labels into the entitlements that would let you watch: a network, a team's outlet, or an out-of-market package. The rules, including blackouts and NFL Sunday windows, are in [coverage.md](coverage.md).
2. **Matches.** `entitlements.ts` computes what the household's subscriptions grant. A need is met by a grant, or by the household's own answer for how it watches a local team.
3. **Routes.** Each match gives one route per app that plays it. A route records the app, the network, the best level the app can reach (`game` > `channel` > `app`), whether that level is confirmed on this platform, and whether the match is certain or only "probably".
4. **Ranking.** Installed apps first, then certain routes, then the household's order for that network. A confirmed route two levels better jumps ahead.
5. **Not covered.** The result says why, and which catalog subscriptions would cover the game.

The same code runs in the browser, so the card shows what the server will do. The server resolves again on `POST /api/launch` for the chosen TV, and the client may only pick one of the routes the server produced.

`lib/coverage.ts` runs the resolver over a sample of games (the next days from ESPN, or a synthetic typical week) to report what share you can watch, the gaps, and the services that would add the most games. The setup wizard and the coverage page use it.

## TVs

`server/tv/manager.ts` (`TvManager`) keeps one `AndroidTvDriver` per configured TV, each with its own status, installed apps and one-launch-at-a-time lock. A watchdog checks every TV every 15 seconds and pushes changes to the UI over SSE. TVs added or removed in setup start and stop here.

- **Commands are allowlisted.** `server/adb.ts` and `server/tv/commands.ts` build argv arrays for `execFile`, with no local shell. Every host, port, package and URI is validated, and keys come from a fixed list. There is no shell passthrough.
- **Pairing** (`tv/pairing.ts`):
  - **Fire TV:** `adb connect host:5555`, then the user approves the prompt on the TV.
  - **Google TV / Android TV 11+:** Wireless debugging. The user reads the pairing port and code off the TV, the server runs `adb pair`, then it connects to the separate connect port.
- **Finding the connect port.** A Google TV's connect port changes after a reboot. `tv/mdns.ts` browses `_adb-tls-connect._tcp` itself, because Debian's adb has no mDNS backend. When a Google TV is offline, the server looks up its new port and updates the saved TV. This needs host networking. In bridge mode, type the port into the TV's **connect port** field in the setup TVs step and press **Reconnect**.
- **Detection** (`tv/detect.ts`): the platform comes from `getprop`, and installed apps from `pm list packages` matched against the catalog.
- **Remote keys** (`tv/keys.ts`): one persistent `adb shell` per TV. Keys are written straight to the input device (`evdev`, about 10 ms), or sent with `cmd input` or `input`, whichever the TV supports (`KEY_METHODS`). Presses queue as a batch, and extras are dropped when a key is held.

## Launching

`AndroidTvDriver.launch()` (`server/driver.ts`) takes a game and a route and tries, in order:

1. **Deep links** for the route's app, best level first. A game or channel link is a VIEW intent, and the driver then waits for the app to be in front. Plex routes tune a channel through the Plex client instead.
2. **Navigator**, when the route has one and OCR is available. After the link opens, the driver moves with the remote while reading the screen, and presses Play only when the screen names this game.
   - `youtubeTv.ts` searches for the home team and opens the game card.
   - `plexGuide.ts` opens the Plex DVR guide and moves to the program that is on now.
   - `primeVideo.ts` searches Prime Video and opens the first game tile.
   - `navigation/entry.ts` decides how to get into the app. **Warm entry** sends the link without restarting an app that is already running, then checks the screen, and falls back to cold entry if the expected screen doesn't show. **Cold entry** force-stops and starts the app. If the same game was launched on this TV minutes ago and video is still playing, it does nothing.
   - `navigation/match.ts` matches team names in OCR text, with guards against look-alikes (Wings/Kings, Giants in two leagues).
3. **App launch**, the floor. It opens the app, and the result tells the person which steps to take on screen.

Link parameters (MLB game id, NBA game id, ESPN airing id, Plex DVR key) come from the server's own lookups (`mlb.ts`, `nba.ts`, `espnWatch.ts`, `plex.ts`). Each is checked against a regex in the catalog before it goes into a URI. If a lookup fails, that route is skipped.

Outcomes are `game`, `channel`, `app`, `profile_picker`, `unverified` or `failed`. A route that isn't confirmed on this platform says so in its result. Launches are rate-limited to 10 a minute per TV. Each launch logs a `launch_start` line, an `entry` line for navigators, and a final `"evt":"launch"` line with the attempts, steps and timings.

To try a route from the shell, use `npm run tv -- <tvs|status|apps|key|open|launch>` (`server/cli.ts`). Testing without a TV is covered in [CONTRIBUTING.md](../CONTRIBUTING.md) and [testing-navigators.md](testing-navigators.md).

## Access control

Choose one mode during setup (`server/auth/`):

| Mode | Who it's for |
|---|---|
| `pin` | A shared household PIN. Everyone who knows it is a member. A separate admin password guards setup. |
| `accounts` | Named users with passwords, each `admin` or `member`. |
| `proxy` | A reverse proxy authenticates and passes a user header (Tailscale Serve `Tailscale-User-Login`, Authelia/Authentik `Remote-User`, Cloudflare Access). Trusted only from `TRUSTED_PROXIES` addresses. |

Members launch games and use the remote. Admins also change services, TVs and users (`auth/permissions.ts`).

- Sessions are server-side, can be revoked, and slide for `SESSION_DAYS` since last use. The cookie holds a random id, and only its SHA-256 is stored.
- **First run:** the server logs a one-time setup link (`"evt":"setup_required"`). Only that link can create the first admin.
- `TRUSTED_PROXIES` accepts IPs, CIDRs and `loopback`. Ranges wider than /8 are refused, and setup refuses a range containing the server's own LAN address (`auth/net.ts`).
- Unknown `Host` headers are refused (DNS-rebinding defense). POSTs must be same-origin JSON.
- There is a CSP, and HSTS over HTTPS.
- Logins, launches, key presses and browser error reports are rate-limited.

## Data and configuration

- **Environment** holds bootstrap settings only (`server/config.ts`): `PORT`, `BIND`, `DATA_DIR`, `TRUSTED_PROXIES`, `ALLOWED_HOSTS`, `PUBLIC_URL`, `SESSION_DAYS`, `KEY_METHODS`. See [hosting.md](hosting.md). The server has no timezone or log-level setting. Logs are one JSON object per line with ISO UTC timestamps.
- **`DATA_DIR/config.json`:** the household profile, versioned, with migrations in `server/store/`.
- **`DATA_DIR/secrets.json`** (0600): the Plex token and the ESPN Watch key.
- **`DATA_DIR/auth.json`** (0600): the access mode, PIN and password scrypt hashes, users, proxy settings, and session hashes. It sits behind a small `AuthStore` interface in `server/auth/store.ts`.
- **`DATA_DIR/.android/`:** the ADB key the TVs approved.
- Writes are atomic and keep a `.bak`. Settings are never reset silently. An unreadable or newer-version file stops the server with a clear message, and the bad file is kept.
- Installs from before 0.2 that kept settings in the environment are imported on first start (`store/migrate.ts`). Sign-in settings are not imported.
