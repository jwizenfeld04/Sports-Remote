# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The Docker image runs on Node 26 (was 24). Installs without Docker still need Node 22 or newer, and CI now tests on both.

## [0.2.0] - 2026-10-25

The first public release. The 0.2 line turns a single-household tool into a general open-source app. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Added

- **Google TV / Android TV** support alongside Fire TV:
  - pairing over Wireless debugging (`adb pair`);
  - platform detection, and detection of installed apps;
  - several TVs per household.
- **Catalog model** in `lib/catalog/` with sources:
  - networks;
  - subscriptions, with tiers, add-ons, grants, the apps where they play, and TV Everywhere unlocks;
  - apps;
  - teams for NFL, NBA, MLB and NHL;
  - markets.
- **NBA** games, plus local-team handling (RSN, team app, antenna) per market.
- **Coverage report:** the share of games you can watch, the gaps, and the services that would add the most games. No prices: they change too often to keep right. Shown live in the setup wizard.
- **Access modes:** household PIN, named accounts (admin/member), or a trusted reverse-proxy header (Tailscale Serve, Authelia, Authentik, Cloudflare Access). The first admin is created from a one-time setup link printed in the log.
- **Settings in the app.** Configuration is versioned in `DATA_DIR/config.json` and `secrets.json` (0600), with migrations. Bad or newer-version files stop the server instead of being reset.
- **Docker image** for `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5), published to GHCR. It includes adb 34 and tesseract, runs as a non-root user, has a healthcheck, and comes with SBOM/provenance and a cosign signature. See `deploy/docker-compose.yml`.
- `docs/hosting.md`: Docker, Raspberry Pi, bare metal, Unraid/CasaOS, reverse proxies (Caddy, Nginx, NPM, Traefik), Tailscale Serve.
- Graceful shutdown on SIGTERM/SIGINT.
- **Warm switching** for screen-reading routes (YouTube TV, Plex, Prime Video): a running app switches games in place instead of being force-stopped, and the game that's already playing is left alone. It falls back to a clean restart when the switch doesn't reach the expected screen.
- **Faster remote:** one persistent adb shell per TV, batched presses, extras dropped when a key is held (no backlog), and presses sent on touch-down with hold-to-repeat. Keys are written straight to the TV's input device (~10 ms) instead of starting Android's Java `input` tool per press, with automatic fallback.
- **TV simulator** (`test/sim/`) with models of YouTube TV, Plex and Prime Video. Seeded property runs with dropped keys, slow loads, OCR misreads and pop-ups found and fixed 20 navigator bugs, including wrong-team matches (Wings/Kings, Giants across leagues) and pop-ups that swallowed every key.
- **Coverage page** and per-game "why can't I watch this" explanations.
- `docs/coverage.md`: the availability and ranking rules.
- CI: typecheck, unit/UI tests, Playwright e2e, `npm audit`, CodeQL, shellcheck, multi-arch image builds. Dependabot is enabled.
- `SECURITY.md`, `CONTRIBUTING.md`, issue templates (including an app/route report), and a PR template.

### Changed

- The server is compiled with esbuild to `dist/server/*.mjs` and runs on plain `node`; `tsx` is now a dev-only dependency. `npm run build` builds both the UI and the server.
- Environment variables are now bootstrap-only: `PORT`, `BIND`, `DATA_DIR`, `TRUSTED_PROXIES`, `ALLOWED_HOSTS`, `PUBLIC_URL`, `SESSION_DAYS`, `KEY_METHODS`.
- `deploy/install.sh` works on any Debian, Ubuntu or Raspberry Pi OS machine:
  - checks Node 22+ and the adb version;
  - stages the build and rolls back if the upgraded service fails its health check;
  - adds `--uninstall` and `--purge`.
- The systemd unit runs `node dist/server/main.mjs` directly, with tighter sandboxing.

### Deprecated

- `SESSION_SECRET`, `FIRETV_HOST`, `ALLOWED_TAILNET_USERS`, `LAN_BIND`, `APP_PASSCODE`, `PLEX_URL`, `PLEX_TOKEN`, `PLEX_PLAYER_ID` and `ESPN_WATCH_API_KEY` in the environment. They are imported into the data directory on first start and can then be removed.

## 0.1.0

- First version, for one household: Fire TV over ADB; NFL, MLB and NHL from ESPN; YouTube TV, Plex, Prime Video and other services; Tailscale or passcode access; systemd install.

[Unreleased]: https://github.com/jwizenfeld04/Sports-Remote/commits/main

[Unreleased]: https://github.com/jwizenfeld04/Sports-Remote/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jwizenfeld04/Sports-Remote/releases/tag/v0.2.0
