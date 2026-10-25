# Testing navigators

Navigators (`server/youtubeTv.ts`, `server/plexGuide.ts`, `server/primeVideo.ts`) drive an app with remote keys and
read the screen with OCR. On a real TV they are slow to try, hard to repeat, and the bad cases (a dropped key, a
misread word, a popup) are rare. `test/sim/` is a TV simulator that reproduces those cases on demand, in
milliseconds, from a seed.

```
test/sim/
  tv.ts            SimTv: clock, apps, keys, intents, perturbations, OCR output, AdbExec fake
  frame.ts         word boxes, scaling to the screenshot size, OCR misreads, fake PNGs
  apps/            app models: youtubeTv.ts, plex.ts, prime.ts
  index.ts         fixtures (teams, Plex locals) and ready-made TVs
  harness.ts       run one navigator against one TV and judge it against the truth
  launch.ts        enterApp() + a navigator, the way the driver will use them
  trace.ts         a readable event log for a failing seed
  report.ts        success-rate table (npx tsx test/sim/report.ts 60)
  *.test.ts        simulator, navigators matrix, properties, entry, driver end to end
```

## How the simulator works

**Time.** A `SimClock` only moves when someone sleeps or pays for an action: a key press (150 ms), a
screenshot + OCR (700 ms), an intent (400 ms warm, 1.5 s cold start), any other shell command (120 ms). The
navigators take `sleep` and `now` as dependencies, so a 70-second launch runs in a few milliseconds and timeouts
behave exactly as on a TV.

**Apps are screen state machines.** An `AppModel` has a fresh state (`vars()`), a `start(uri)` for a cold start, an
`intent(uri)` for a link delivered to the running app, and named screens. A screen has:

- `draw(app)`: the words on it, each with a box in a 1920×1080 reference frame;
- `keys`: handlers for UP/DOWN/LEFT/RIGHT/SELECT/BACK/SEARCH... (a missing BACK goes back one screen, or out to the
  launcher from the first one; other missing keys do nothing);
- `after: { ms, to }`: a timed transition (loading screens), resolved at its due time even inside one long sleep;
- `playback`: video is on (the media session says playing; DRM apps give black screenshots);
- `dropsKeys`: keys sent while it's up are lost (still loading);
- `activity`: what `dumpsys activity` reports.

Screens call `app.go(screen)` (forward; BACK returns), `app.replace(screen)`, `app.back()`, `app.reset(screen)`, and
`app.mark(kind, data)` to record something tests check later. Models mark `"watch"` with the content id whenever a
Watch now / Watch Live / tune actually happens; that's how the properties know what started.

**The TV** (`SimTv`) runs the apps: one in front, others running in the background, a launcher. `view(uri, pkg)`
cold-starts the app or delivers the link warm. Warm delivery depends on the app's `warmIntent` mode, which a test
can override per package:

| mode | meaning |
|---|---|
| `"handled"` | the running app navigates to the link |
| `"ignored"` | the app comes to the front on whatever it was showing |
| `{ from: [...] }` | handled only from these screens |
| `{ except: [...] }` | handled except on these screens (YouTube TV: its Live tab and playback) |

A modal popup also makes warm links do nothing until it's dismissed. `forceStop(pkg)` kills the process (state is
lost); `HOME` puts the launcher in front and keeps the app running.

**Screenshots.** `capture()` returns a fake PNG (real signature and IHDR size, plus a frame id); `ocr(png)` and
`boxes(png)` return that frame's text or words, scaled to the TV's `resolution` (3840×2160 for a 4K Google TV), so
the navigators' fractional cuts (Plex header = top 44%, Prime panel = right 40%) are exercised at every size.

**Perturbations** (`SimOptions.perturb`, all seeded):

| option | effect |
|---|---|
| `dropKeys: { p, at, only }` | lose presses with probability `p`, or at these press indices, optionally only some keys |
| `slowLoads: k` | every timed transition takes `k` times as long |
| `misread: p` | each word has probability `p` of one OCR confusion (o/0, l/1, e/c, rn/m, S/5, B/8...) |
| `blackFrames: p` | a screenshot comes back black |
| `readErrors: p` | a screenshot is cut short and OCR fails ("libpng error") |
| `popups: [...]` | "Are you still watching?" / "Who's watching?" (or any text) at a time, on a screen, or after N keys; covering the screen or not; swallowing keys until SELECT/BACK |

App models add the rest: blocked cards, cards that start a video, a games row below N other rows, profile pickers
that swallow the link, a Plex guide that lags the clock, a grid that ignores DOWN until a horizontal key, a guide
that keeps its cursor when reopened, a SELECT on a non-airing program that opens a Record menu, Prime tiles that
are upcoming (details) or live (Watch Live).

**Three ways in:**

```ts
const tv = youtubeTv({ search: ytSearch({ "Atlanta Falcons": { cards: [{ kind: "game", game: A }] } }), profilePicker: true },
  { seed: 7, perturb: { dropKeys: { p: 0.1 } }, resolution: { width: 3840, height: 2160 } });

// 1. navigator deps
const link = ytLink("Atlanta Falcons");
tv.view(link, YTTV_PKG);
await openGameViaSearch(tv.navDeps({ reopenUri: link, pkg: YTTV_PKG }), navTeams(A));   // also tv.plexDeps(), tv.primeDeps()

// 2. the real driver
new FireTvAdbDriver({ serial: tv.serial, exec: tv.adbExec(), screen: tv.driverScreen(), sleep: (ms) => tv.sleep(ms), now: tv.clock.now, ... });

// 3. directly
await tv.press("DOWN"); tv.view(uri, pkg); tv.forceStop(pkg); tv.current; tv.marks("watch"); trace(tv, { reads: true });
```

`tv.adbExec()` answers `connect`, `devices`, `input keyevent`, `am start -W -a VIEW` (with `Status: ok`,
`LaunchState: COLD|HOT` and the "delivered to currently running top-most instance" warning when warm), `am start -n`,
`monkey`, `am force-stop`, `cmd package resolve-activity`, `dumpsys activity activities` (resumed activity and a
task per running app), `dumpsys power`, `dumpsys media_session` and `pidof`. Anything else fails with code 1.

## The tests

- `simulator.test.ts`: the simulator itself (clock, drops, intents, popups, scaling, the adb fake).
- `navigators.test.ts`: every navigator, cold, under every perturbation over 20 fixed seeds with a minimum success
  count; resolutions (4K, 720p, ultrawide); negative cases (not on the service, only other games, a Record menu);
  look-alikes (NFL vs MLB Giants/Cardinals, NFL vs NHL Panthers/Jets, Rams vs Chargers).
- `properties.test.ts`: 150 random runs per navigator (random layouts with look-alike decoys, random perturbation
  mixes, random profile pickers). Invariants: nothing but the target is ever watched or tuned; Prime opens no
  other tile; "ok" means the target is playing (or every Watch press was lost); a target that isn't there is
  never "ok". `SIM_RUNS=1000 npx vitest run test/sim/properties.test.ts` for a deeper sweep. A failure prints the
  seed and the full trace.
- `entry.test.ts`: `planEntry` cases, then warm/cold/skip on the simulator: switching games in the same app,
  between apps, from the home screen, from the YouTube TV Live tab, with a popup, with an app that ignores warm
  links.
- `driver-e2e.test.ts`: `AndroidTvDriver.launch()` through the adb fake for all three navigators, including 4K.

To chase a failure: copy the seed and options into a one-off test, run it, and print `trace(tv, { reads: true })`:
every key (and whether it was dropped), screen change, intent, popup, mark and OCR read, with simulated times.

## Adding an app model

1. Read the navigator. Write down every screen it expects and the text it keys on (the regexes at the top of the
   file), the order of keys it sends, and the region cuts it uses (header, panel). The model has to produce exactly
   those, and nothing more convenient than a real TV would.
2. Create `test/sim/apps/<app>.ts` exporting a config type and `<app>App(cfg): AppModel<Vars>`. Draw each screen
   with `line()`/`lines()` at realistic positions; put header/panel words inside the navigator's cuts and the rest
   outside. Use `dropsKeys` + `after` for every loading step, and `playback` (+ `secureVideo` for DRM apps).
3. Decide the warm behaviour (`warmIntent`) from what is known about the app; default to the pessimistic one.
4. `mark("watch", id)` exactly where the app would start the content, so the properties can judge it.
5. Add fixtures and a `new SimTv(...)` helper in `index.ts`, a `run<App>` in `harness.ts`, rows in
   `navigators.test.ts`, and a property in `properties.test.ts`.
6. When a real TV disagrees with the model (see recording below), fix the model first, then the navigator.

## Warm entry (`server/navigation/entry.ts`)

```ts
type NavigatorId = "youtube_tv_search" | "plex_guide" | "prime_search";

planEntry(ctx: EntryContext, obs: EntryObservation): EntryPlan            // pure
  // EntryContext   { navigator, pkg, service, gameId, tvId, now, last?, allowWarm?, recentMs?, readyTimeoutMs? }
  // EntryObservation { foreground, running, screenText, media }
  // EntryPlan      { kind: "skip", reason } | { kind: "warm", reason, screen, steps, retrySteps, readyTimeoutMs } | { kind: "cold", reason }
alreadyPlaying(ctx, obs): { skip: boolean; reason: string }
classifyScreen(nav, text, playing): "playback" | "popup" | "profile" | "ready" | "other" | "unreadable"
observe(deps, pkg): Promise<EntryObservation>
enterApp(deps: EntryDeps, req: EntryRequest): Promise<EntryResult>
  // EntryDeps    { shell(argv, timeoutMs?), read(), sleep(ms), now(), note? }
  // EntryRequest EntryContext minus now, plus { uri, label?, coldSettleMs? }
  // EntryResult  { strategy: "skip" | "warm" | "cold", linkOk, telemetry }
class LaunchHistory { record(r), last(tvId), forget(tvId) }
```

Per-app warm steps (all followed by the link, then up to 10 s for the navigator's expected screen):

| app | in front, playing | in front, elsewhere | in the background |
|---|---|---|---|
| YouTube TV | SEARCH | SEARCH | link; if it's swallowed, SEARCH + link once more |
| Plex | BACK | — | link |
| Prime Video | — | — | link |

A "still watching?" popup gets SELECT first. A profile picker in front means cold for Plex and Prime (YouTube TV
picks the profile with SELECT, then SEARCH). If the expected screen doesn't show, `enterApp` falls back to cold by
itself and says why in `telemetry.fallback`.

### How the driver uses entry

`AndroidTvDriver.launch()` (`server/driver.ts`) calls `enterApp()` for every navigator route. The driver owns a `LaunchHistory`, records a launch when a navigator succeeds, logs the entry telemetry as an `"evt":"entry"` line, and skips the navigator when `strategy` is `"skip"`. `test/sim/launch.ts` does the same composition against the simulator.

Not built yet: storing per-TV warm success rates from the telemetry and passing `allowWarm: false` for a TV/app pair where warm keeps falling back.

## Recording fixtures from a real TV (not implemented yet: proposal)

> Nothing in this section exists. `sports-remote record` and `sports-remote test-route` are a design for future tools, not commands you can run. Today, use `npm run tv -- launch <app> --network <net>` (see `server/cli.ts`) and the `"evt":"launch"` log line.

The models are written from what the navigators expect plus a few real traces. Recording replaces guesswork with
captured screens.

### `sports-remote record` (proposed)

```
sports-remote record --tv living-room --app youtube_tv --link 'youtubetv://search?query=Atlanta%20Falcons' \
          --keys DOWN,DOWN,SELECT,BACK,RIGHT,SELECT --out test/fixtures/tv/yttv-falcons-2026-10-25.json [--cold] [--png]
```

Steps: optionally force-stop; send the link; then, after the link and after each key, wait for the screen to
settle (two identical OCR reads, or a timeout), and capture one step. Each step stores:

```jsonc
{
  "device": { "model": "AFTKA", "os": "Fire OS 8.1.1.1", "resolution": [1920, 1080], "app": "com.amazon.firetv.youtube.tv", "appVersion": "..." },
  "steps": [
    {
      "action": { "key": "DOWN" },                    // or { "link": "...", "cold": true }, or { "wait": 3000 }
      "msAfterAction": 1840,                          // until the screen settled
      "foreground": "com.amazon.firetv.youtube.tv/dev.cobalt.app.MainActivity",
      "media": [{ "pkg": "...", "active": true, "state": "playing" }],
      "am": { "launchState": "HOT", "deliveredToRunning": true },
      "words": [{ "text": "Upcoming", "left": 120, "top": 300, "width": 170, "height": 32 }],
      "black": false,
      "png": "yttv-falcons-2026-10-25/03.png"         // only with --png; screenshots can show account names
    }
  ]
}
```

Privacy: profile names and account emails show up in OCR; `sports-remote record` replaces the words of a profile picker with
placeholders unless `--keep-names`, and PNGs are opt-in.

Using fixtures: a `fixtureApp(json)` model replays the recorded steps as screens (each step's words; keys that
weren't recorded at that step make the model throw "unrecorded transition", so a test can't silently wander off
the recording). Tests assert the navigator reaches the same end state; app models get a "replays fixture X" test
so a model change that contradicts a real TV fails.

### `sports-remote test-route` (proposed)

```
sports-remote test-route --tv living-room --service youtube_tv --game nfl:401 [--entry warm|cold|auto] [--repeat 5] [--dry-run]
```

Runs the real launch (driver + entry + navigator) on a real TV and reports, per run: pass/fail, strategy
(skip/warm/cold and fallbacks), time to playback, the navigator's reason on failure, and the step log with OCR text.
`--dry-run` stops before any Watch/tune press (navigators already support `watch: false` / `play: false`). With
`--record` it also writes a fixture of the run. Results append to a per-TV JSON file that feeds the adaptive route
order.

## Open questions (need a real TV)

- **YouTube TV rows.** How many rows are on screen, and where does the focused row sit? With rows *below* the focus
  visible and a row between "Top picks" and the games row, "games row on screen and Top picks gone" is true too early
  (a known-limitation test pins this). Using word boxes (the games row title's top position) would settle it but
  needs `screen.boxes` for the YouTube TV route.
- **YouTube TV warm links.** Does the link land from every screen after SEARCH (game page, playback of a Sunday
  Ticket game, the Library)? After a warm search, does focus start on the search icon as on a cold start? On Google
  TV (`com.google.android.youtube.tvunplugged`), is SEARCH needed at all?
- **YouTube TV Watch now** on an *upcoming* game: does the page go away? The second Watch press after a lost one
  assumes it does when it starts playing.
- **Plex.** Does `plex://live-tv/dvr.guide/...` re-route a running app, from live TV and from the guide? Does BACK
  from live TV land on the guide, and with the cursor on the last channel? Does the header show the call sign (it
  makes adjacent rows easier to tell apart)? Can the guide scroll left of "now"?
- **Prime Video.** Does a warm search link reset focus to the keyboard's first key? Does the panel show cities
  ("San Francisco Giants") or only nicknames? With nickname-only tiles, NFL and MLB Giants/Cardinals can't be told
  apart (the properties leave those pairs out for Prime). Does the "Who's watching?" picker come back on a warm link?
- **Media sessions.** Which apps publish one on Fire OS and Google TV, and is the state reliable during DRM
  playback? (`alreadyPlaying` falls back to "black frame" when there is none.)
- **pidof** on every Fire OS version in use (toybox has it from Android 7).
- **Popups.** The real text and default button of "still watching" dialogs per app; whether SELECT ever means
  "exit" on one.
- **4K Google TVs.** Do screenshots come back at 3840×2160 while the UI is laid out at 1920×1080 (everything here is
  relative, so either works), and does tesseract read the 4K frames as well (it may need downscaling)?
