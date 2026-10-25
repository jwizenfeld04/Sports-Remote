# Sports Remote

A sports remote for your phone. It lists live and upcoming **NFL, NBA, MLB and NHL** games with your teams first, tells you which ones your services can show, and opens a game on your **Fire TV or Google TV** in the right app with one tap.

- **Knows your services.** Tell it your area and what you pay for (YouTube TV, ESPN, Peacock, Prime Video, an antenna, a regional sports network …). Every game card then says where it's on, or why you can't watch it: blacked out, a national exclusive, or a channel you don't have.
- **Coverage at a glance.** The setup wizard and the Coverage page show how many games you can watch per league and per team, what you're missing, and what each service would add before you buy it.
- **Opens the game, not just the app.** When an app supports a game link (ESPN), it opens the game. For apps without one (YouTube TV, Prime Video, Plex), it can drive the app with the remote, reading the TV screen, and only presses play when the screen names the right teams. If the game can't be reached, it opens the app and shows the steps, with a remote on your phone.
- **Switches without restarting.** Changing games inside YouTube TV, Plex or Prime Video happens in the running app, and asking for the game that's already on leaves it alone.
- **Several TVs, several people.** Add every TV in the house. Sign in with a household PIN, separate accounts (admins and members), or your own sign-in proxy (Tailscale Serve, Authelia, Authentik, Cloudflare Access).
- **Runs at home.** One small server on your home network (a Raspberry Pi, mini PC or NAS). No cloud account, nothing leaves your network except fetching the ESPN schedule.

> **Status: 0.2 (pre-release).** Fire TV has been used daily. On Google TV, pairing, discovery and app detection are implemented and tested against recorded device output, but the deep links haven't all been confirmed on real Google TV hardware yet. See [Known limits](#known-limits).

## Quick start (Docker)

You need an always-on Linux machine on the same network as the TV (amd64 or 64-bit ARM).

```sh
mkdir -p ~/sports-remote/data && cd ~/sports-remote
curl -fsSLO https://raw.githubusercontent.com/jwizenfeld04/Sports-Remote/main/deploy/docker-compose.yml
docker compose up -d
docker compose logs | grep setup_required     # open the one-time setup link it prints
```

The setup link walks you through:

1. **Sign-in.** Choose a household PIN, accounts, or a sign-in proxy.
2. **Your area.** Your metro area sets your local channels, local teams and blackouts.
3. **Your teams.** Favorites go first in the list.
4. **Your services.** Tick what you have. Coverage updates live and shows what each service would add.
5. **Local teams.** How you watch your local teams' games: an RSN, a team app or an antenna.
6. **Your TVs.**
   - **Fire TV:** turn on ADB debugging and press Connect, then accept the prompt on the TV.
   - **Google TV:** turn on Wireless debugging and enter the six-digit pairing code.
7. **Extras.** Optional: Plex Live TV for antenna households, and an ESPN key for direct game links.

Other ways to run it (bare metal with systemd, Raspberry Pi, Unraid/CasaOS) and HTTPS or remote access (Tailscale Serve, Caddy, Nginx Proxy Manager, Traefik) are covered in **[docs/hosting.md](docs/hosting.md)**.

## How it works

```
phone / tablet ──HTTPS or LAN──▶ Sports Remote server ──ADB (Wi-Fi)──▶ Fire TV / Google TV
                                   ├─ ESPN scoreboard: games and TV listings
                                   ├─ your household: area, local teams, services   → who can show each game
                                   ├─ app catalog: packages and links per platform  → which app, how far it can get
                                   ├─ Plex Live TV (optional): which game your local station is airing
                                   └─ tesseract OCR (optional): reads the TV screen to drive apps with the remote
```

When you tap a game, the server works out which of your services carry it in your area (rules in **[docs/coverage.md](docs/coverage.md)**). It ranks the apps that can play it on that TV, then sends allowlisted ADB commands to open it. Every card shows how far a tap gets:

| Label | Meaning |
|---|---|
| **Game** | Opens straight into the game |
| **Channel** | Opens the right channel (for example, your local CBS in Paramount+) |
| **In the guide** / **Local channel** | Your antenna or Plex has it on the local station |
| **App** | Opens the app; your phone shows the steps and a remote |
| **probably** | Likely on your services, but not certain: a lineup that varies, or a Sunday NFL game the local station may not air |

## Supported TVs and apps

**TVs:**
- Amazon Fire TV (Fire OS 6+).
- Google TV and Android TV 11+, through wireless debugging. Older Android TVs with network ADB work like a Fire TV.

**Services in the catalog** (coverage is worked out for all of them):

| Kind | Services |
|---|---|
| Live TV | YouTube TV, Hulu + Live TV, Fubo, Sling, DIRECTV Stream, Xfinity, Philo |
| Streaming | ESPN (Select / Unlimited), Fox One, Peacock, Paramount+, Prime Video, HBO Max, Apple TV, Netflix, Disney+ |
| League packages | NFL Sunday Ticket, NFL+, NBA League Pass, MLB.TV, NHL Power Play (in ESPN) |
| Regional | DAZN, Gotham Sports (MSG + YES), SNY, NESN 360, Marquee, CHSN+, Monumental+, Space City, Altitude+, Spectrum SportsNet+, SportsNet Pittsburgh, Detroit SportsNet, MASN, BravesVision, team apps |
| Antenna | Over the air, through Plex, Channels, Tablo or HDHomeRun |

**How far a tap gets today** (confirmed on Fire TV unless noted):

| App | Best route |
|---|---|
| ESPN | Game link (needs the optional ESPN key) |
| YouTube TV | Game: searches and opens the game page by reading the screen (needs OCR) |
| Plex | Channel: tunes your local station in the guide (needs OCR and Plex) |
| Prime Video | Game, by search and screen reading (not yet confirmed) |
| Fox One | Channel |
| Paramount+ | Live TV link (not yet confirmed) |
| NBA, MLB | Game links (not yet confirmed) |
| Everything else | Opens the app, with steps on your phone |

Routes are only marked confirmed once they've worked on a real TV of that platform. Unconfirmed routes are still tried, but rank lower and say so when they land.

## Using it

- **Watch.** Tap a card and choose **Watch on TV**. To use a different app, pick it under **Watch on** before sending.
- **Remote.** The remote button opens a d-pad, OK, Back, Home, play/pause, volume, and turn-TV-off. Presses send the moment your finger lands, and holding repeats.
- **Coverage.** The chart button shows what you can watch, what you're missing, and why each game is or isn't watchable.
- **Several TVs.** Pick the TV in the top bar. Each phone remembers its choice.
- **Settings.** Favorites, the order of apps per network, saved views, and screen-reading launches on or off. Admins also change services, TVs and sign-in.

## Configuration

Almost everything is set in the app and saved in the data folder (`config.json`, `secrets.json` with mode 0600, and the ADB key). Environment variables only cover what's needed to start: `PORT`, `BIND`, `DATA_DIR`, `TRUSTED_PROXIES`, `ALLOWED_HOSTS`, `PUBLIC_URL`, `SESSION_DAYS` and `KEY_METHODS`. See [docs/hosting.md](docs/hosting.md#bootstrap-settings) and [`deploy/env.example`](deploy/env.example).

**Upgrading from 0.1:** `FIRETV_HOST`, `PLEX_*` and `ESPN_WATCH_API_KEY` are imported on first start. The household becomes New York with the services 0.1 assumed, so check them in Settings. The sign-in settings (`APP_PASSCODE`, `ALLOWED_TAILNET_USERS`, `SESSION_SECRET`) are **not** imported. The server prints a new one-time setup link, and you choose sign-in again.

## Development

Requires Node 22 or newer (24 recommended, see `.nvmrc`), and `adb` on the PATH to talk to a real TV.

```sh
npm ci
npm run dev:server        # API on :8787 (DATA_DIR=./data recommended)
npm run dev               # UI on :5173, proxied to the API
npm test                  # unit, server, UI and simulator tests (vitest)
npm run typecheck
npm run test:e2e          # Playwright against a fixture server and a fake adb
npm run tv -- tvs         # CLI: status, apps, key, open, launch against your TVs
```

The tests never touch a real TV:
- `test/fake-adb.mjs` stands in for the adb binary.
- `test/sim/` is a scriptable TV simulator. It models YouTube TV, Plex and Prime Video screens, with dropped keys, slow loads, OCR misreads and pop-ups, and the navigators run against it across seeded random runs.
- [docs/testing-navigators.md](docs/testing-navigators.md) explains the simulator and how warm switching is tested.

Layout:

```
lib/          shared logic: ESPN parsing, catalog (networks, services, apps, teams), availability, ranking, coverage
server/       Fastify app, auth, config store, ADB driver, TV setup (pairing, discovery), navigators, Plex/ESPN/NBA/MLB clients
web/          React UI: game list, launch sheet, remote, setup wizard, coverage page
test/         vitest suites, fixtures, TV simulator, Playwright specs
deploy/       docker-compose, systemd unit, install script, env example
docs/         architecture, hosting, coverage rules, navigator testing, rights research
```

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

- The server only runs a fixed set of ADB commands. Hosts, ports, keys, packages and link templates are validated, and nothing from a request reaches a shell.
- Sign-in happens on the server, with server-side sessions: scrypt-hashed PINs and passwords, httpOnly SameSite=Strict cookies, rate-limited logins, and a one-time setup token. Members can watch and use the remote. Only admins change services, TVs and sign-in.
- Identity headers are only trusted from addresses listed in `TRUSTED_PROXIES`.
- Host-header allowlist (against DNS rebinding), same-origin checks on every write, a strict CSP, no inline scripts.
- Secrets (the Plex token and ESPN key) stay on the server. They are never sent to browsers or written to logs.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Known limits

- **Google TV deep links** haven't all been confirmed on hardware. They're tried, ranked lower, and the result says when a link wasn't confirmed.
- **Screen-reading launches** (YouTube TV, Prime Video, Plex) need tesseract, take a few seconds, and depend on each app's layout. They're tested against a simulator, and can be turned off in Settings.
- **Remote keys** are written straight to the TV's input device (about 10 ms a press). If a TV doesn't allow that, they fall back to Android's `input` tool, which takes 1–3 s a press on a Fire TV. `KEY_METHODS` picks the order.
- **TV rights change.** The catalog reflects the 2026 seasons. Regional networks in particular change often; see [docs/coverage.md](docs/coverage.md#keeping-it-current).
- **The ESPN key** for direct game links is ESPN's unofficial Watch API key and isn't included.
- **NBA game IDs** for the NBA app's links come from nba.com's schedule feed, which some networks block. When it's blocked, the NBA app opens to its home screen.

## License

[MIT](LICENSE)
