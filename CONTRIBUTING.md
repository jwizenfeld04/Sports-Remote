# Contributing

Thanks for helping. The most useful contribution often isn't code at all. It's a **report of whether a deep link works on your TV**: use the "App / route report" issue template. Bug fixes, catalog entries and new navigators are all welcome too.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It explains the catalog → resolver → launcher model the code follows.

## Development setup

You need **Node 22+**; `.nvmrc` pins 24, the version CI and the Docker image use. A TV is optional for most work, because the tests use a fake `adb` and a simulator.

```sh
git clone https://github.com/jwizenfeld04/Sports-Remote && cd Sports-Remote
npm ci
npm run dev:server     # API on http://127.0.0.1:8787 (tsx watch; restarts on change)
npm run dev            # UI on http://localhost:5173 with /api proxied to the server
```

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over everything |
| `npm test` | Vitest: unit tests, UI tests (jsdom), and the TV simulator scenarios |
| `npm run test:e2e` | Playwright: the real server with fixture games and a fake adb, at phone, tablet and desktop sizes. Run `npx playwright install chromium` once, or set `PW_CHROMIUM=/path/to/chrome`. |
| `npm run build` | UI → `dist/web`, server → `dist/server/*.mjs` (esbuild) |
| `npm start` | Runs the built server, as production does |
| `docker build -t sports-remote .` | Builds the container image |

CI runs all of these on every pull request, plus `npm audit --omit=dev --audit-level=high`, CodeQL and shellcheck. Run `npm run typecheck && npm test` before pushing.

### Conventions

- TypeScript strict mode. ESM only. Dependencies are pinned to exact versions; add new ones only with a good reason, and prefer small packages with no native code (the image must build for arm64).
- `lib/` is pure and runs in the browser too, so it must not use Node APIs. Routing changes need tests in `test/resolve.test.ts`.
- Anything that reaches the TV goes through the allowlisted command builders in the TV layer, and every argument is quoted. Don't add a shell passthrough, even for debugging.
- Never log secrets (Plex token, ESPN key, passwords, cookies).
- Keep commits focused, and say *why* in the message.

## Testing navigators without a TV

Navigators drive an app by pressing keys and reading the screen with OCR. Two tools let you test them without a TV.

- **Fake adb** (`test/fake-adb.mjs`): a stand-in `adb` binary. Environment variables control what it reports (`FAKE_ADB_SERIAL`, `FAKE_ADB_FG` for the foreground app, and so on). The e2e server and the driver tests use it.
- **TV simulator** (`test/sim/`): models each app as a screen state machine, driven by OCR fixtures recorded from real TVs. Scenarios can add dropped keys, slow loads, "still watching?" popups and profile pickers. A navigator change should come with a simulator scenario that fails before the change and passes after it.

To check a route on your TV, run the real launch with a pretend game from the server's shell, using the same driver and allowlist as the app:

```sh
npm run tv -- tvs                                  # list the TVs set up in the app
npm run tv -- launch youtube_tv --network cbs      # in Docker: docker exec sports-remote node dist/server/cli.mjs launch youtube_tv --network cbs
```

The other commands are `status`, `apps`, `key <KEY>` and `open <app>`. App ids are in `lib/catalog/apps.ts` (`youtube_tv`, `prime_video`, `plex`, `espn`...). Attach the JSON that `launch` prints, and the `"evt":"launch"` line from the server log, to your PR or route report. Recording fixtures from a real TV is not built yet; see [docs/testing-navigators.md](docs/testing-navigators.md).

## Adding a service or app to the catalog

The catalog is plain data in `lib/catalog/`:

- networks;
- subscriptions, with tiers, add-ons, the grants they give, and the apps where they play;
- apps, with per-platform packages and deep links;
- teams and markets.

1. **Cite sources.** Every entry needs URLs in `lib/catalog/sources.json` (keyed by subscription id) for each fact: the provider's channel-lineup page for what a tier carries, the league's or broadcaster's announcement for a rights deal, and the store listing or a `pm list packages` capture for a package name. Unsourced carriage claims won't be merged. They decide what people get told they can watch.
2. **Packages per platform.** Fire TV and Google TV builds often use different package names. List the ones you verified and leave out the ones you didn't.
3. **Deep links start out unverified.** Add the link pattern with `verified: false` (or the equivalent level field). It should only be promoted to `game`/`channel` level after a route report from a real device. Parameters must be declared and regex-checked; the server rejects undeclared parameters and unsafe URIs at startup.
4. **Tests.** Add resolver cases to `test/resolve.test.ts` for the games the new entry should cover, and for one it shouldn't. If the app needs a navigator, add simulator fixtures.
5. Update `CHANGELOG.md` under **Unreleased**.

## Pull requests

- Open an issue first for big changes (new auth mode, new platform, storage format) so we can agree on the approach.
- Fill in the PR template, including how you tested and on which TV, if any.
- Changes to the stored config format need a migration and a test that upgrades an old file.
- By contributing, you agree your work is licensed under the project's [MIT license](LICENSE).

## Security issues

Please don't file those as issues. See [SECURITY.md](SECURITY.md).
