# How coverage works

Sports Remote answers two questions for every game: **can this household watch it**, and **which app on which TV opens it**. Both come from the same data: the game's TV listing from ESPN, the household's area and local teams, and the services they pay for.

The rights research behind these rules, with sources, is in [`research/rights.md`](research/rights.md) (leagues), [`research/services.md`](research/services.md) (what each service carries) and [`research/platforms.md`](research/platforms.md) (apps and deep links on Fire TV and Google TV).

## 1. What a game needs (`lib/availability.ts`)

ESPN lists each game's broadcasts as labels ("CBS", "ESPN+", "SNY", "NBCS Philadelphia", "MLB.TV" …). `classifyLabel()` in `lib/catalog/networks.ts` turns each label into one of:

- a **national network** (ABC, ESPN, TNT, Prime Video, Peacock …),
- an **out-of-market package** (NBA League Pass, MLB.TV, NHL Power Play on ESPN+, NFL Sunday Ticket), or
- a **local outlet** (a regional sports network, a team app, or an over-the-air station), together with the team it belongs to.

Then the game's needs are worked out. Any one need is enough:

| Situation | What it needs |
|---|---|
| A national label and no home/away label | That network only: a **national exclusive**. Packages never carry it. |
| A home/away label for a team you've marked local | That team's local outlet, or any service you said carries their local games. |
| An NBA/MLB/NHL game with local outlets, no local team playing | The league's out-of-market package. |
| A local team on a local outlet | Not the package: packages black out your local teams. |
| NFL, Sunday afternoon, CBS or FOX | Your local station if a local team plays or the guide shows it's airing this game. Otherwise Sunday Ticket. With no guide, both count as **probably**. |
| No listing yet | Nothing: shown as "No TV listing yet". |

League-specific notes:
- In the NHL, ESPN's "ESPN+" next to local labels is the **NHL Power Play** package. On its own, ESPN+ is an exclusive.
- In MLB, "Prime Video" means the Yankees' in-market stream, which is a local outlet. "MLB.TV" means the out-of-market package.
- Radio labels (ERADM and the like) are ignored.
- Retired regional network names that older listings still use count as an unnamed regional network: the blackout and out-of-market rules still apply.

## 2. What the household has (`lib/entitlements.ts`)

Each service in `lib/catalog/subscriptions.ts` lists what it grants:

- **Grants:** `espn`, `cbs@nfl` (Paramount+ Essential carries CBS's NFL games only), `outlet:sny`, `nba_league_pass` …
- **Tiers and add-ons:** ESPN Select vs Unlimited, Peacock + NBC Sports Philadelphia, the in-market MLB.TV add-on …
- **Maybe-grants** for channel lineups that vary or aren't confirmed. These make a game **probably** watchable, not certain.
- **TV Everywhere unlocks:** signing in to ESPN with YouTube TV gives ESPN Unlimited inside the ESPN app. This only counts once you tick that you've signed in.

A household can also say how they watch a local team ("we watch the Mets on our antenna"). That counts for that team's local games even when the outlet table says otherwise. The exception is an antenna, which only ever gets over-the-air stations.

## 3. Which app opens it (`lib/resolve.ts`)

Each grant plays in one or more apps (`lib/catalog/apps.ts`). Each app has packages per platform (Fire TV and Google TV names often differ) and routes, ranked from best to worst:

| Level | Meaning |
|---|---|
| `game` | Opens straight into the game: an ESPN airing link, or a screen-reading search in YouTube TV or Prime Video |
| `channel` | Opens a channel: Paramount+ live TV, or Plex tuning your local station |
| `app` | Opens the app's home screen. The phone shows the steps to finish, plus a remote. |

Each level counts as **confirmed** only on the platforms where it's been checked on a real TV (`verified`). Unconfirmed levels rank one lower.

Routes are ranked in this order:
1. Apps installed on the TV first (known once the TV is connected).
2. Certain before probably.
3. The household's own order for that network (Settings → Services).
4. The better confirmed level.

A confirmed route two levels better (a game link vs. an app home screen) jumps ahead of the household's order.

The server repeats this ranking for every launch. The phone may only pick one of the routes the server produced.

## 4. The coverage score (`lib/coverage.ts`)

The setup wizard and the Coverage page measure a household against a set of games:

- **This week:** the real schedule for leagues that have games listed. Leagues that are off, or barely listed yet, use a typical week.
- **Typical week:** a sample week per league built from the 2026 rights, always including your local teams (`sampleWeek()`).

For each game: **yes** (a certain route), **probably** (only probably routes), or **no**. The page then shows:
- the overall score,
- the score per league and per favorite team,
- the gaps, grouped by what's missing ("MSG: 13 games"), with the services that would fill each gap and their prices.

While you tick services, `gainFrom()` shows how many more games each unticked service would add.

## Keeping it current

TV rights change every season. Each catalog file names its sources in `lib/catalog/sources.json`. When a deal changes, do three things:
1. Update the subscription's grants or the outlet table.
2. Add a label to `test/fixtures/espn-labels.json` if ESPN starts using a new one.
3. Run `npm test`. The golden label test fails until every label still classifies the way you expect.
