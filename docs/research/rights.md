# US sports TV rights: routing notes for Sports Remote (as of 2026-10-25)

The machine-readable version is `rights.json`, which sits next to this file. It has per-window `exclusive`, `streamingAlso`, `confidence` and `sources` fields, plus 178 ESPN labels that were actually observed. The raw ESPN API dumps are in `espn/` and the observed label list is in `espn_labels_observed.json`.

How this was made: web searches (sources are cited inline below), plus about 110 live ESPN scoreboard fetches on 2026-10-25 covering 2025-26 and 2026 dates and future 2026-27 schedule dates.

---

## The general routing rule (applies to every league)

Read `competitions[0].geoBroadcasts[]` for each game:

- **National label with no home or away label in the same event.** Treat it as a national exclusive. Route only to that network's app.
- **National label and a local label for the user's team.** The local outlet also has the game in-market. The national outlet has it elsewhere.
- **Out-of-market package labels.** These are `MLB.TV`, NHL `ESPN+` (on its own), `ESPN Unlmtd`, and `NBA League Pass` (which appears only in `broadcasts[]`). They are **not** national broadcasts. They are available only if the user is outside both teams' home territories, and never for national-exclusive games.

### Misleading `National` market types in the ESPN API

- **NFL `CBS` / `Fox` on Sunday afternoons** are marked `National`, but the games are **regional**. Only the local affiliate assigned to the user's DMA has the game. Everyone else needs Sunday Ticket.
- **MLB `Prime Video`** is marked `National`, but it is really **21 Yankees in-market games** (produced by YES).
- **MLB `MLB.TV`** is attached even to exclusive FOX Saturday games. Don't route those live.
- **NHL `ESPN+`** appears on nearly every game. It is the NHL Power Play out-of-market feed.
  - The combination `Disney+/ESPN+/Hulu` with no local feeds is a true ESPN+ exclusive.

### Other ESPN API quirks

- Games far in the future often lack their streaming or national labels until closer to the date.
- `ERADM` is radio. Ignore it.
- For NFL, `?dates=` returns the whole week. For the other leagues it uses the US-Eastern calendar date. Use `&limit=100`.

---

## NFL (2026 season)

| Window | Network / stream | Exclusive? | Conf. |
|---|---|---|---|
| Sunday 1:00 / 4:05 / 4:25 ET | CBS (Paramount+), FOX (FOX One) | **Regional** by DMA | high |
| Sunday Night Football (Wk 1–17), Wed 9/9 Kickoff, Thanksgiving night, Mexico City | NBC + Peacock | yes | high |
| Monday Night Football (Wk 1–17), plus two Week 18 Saturday games | ESPN / ABC / Disney+ (ESPN app) | yes | high |
| Thursday Night Football (Wk 2–17, 15 games), Black Friday DEN@PIT, Christmas Eve HOU@PHI | Prime Video | yes | high |
| Wk1 Melbourne SF–LAR, Thanksgiving Eve GB@LAR, Christmas Day GB@CHI and BUF@DEN | Netflix | yes | high |
| Christmas night LAR@SEA | FOX | yes | medium |
| Five international games, 9:30 ET (London ×3, Paris, Madrid) | NFL Network (owned by ESPN since 2026-01-31; in ESPN DTC) | yes | high |
| Saturday Jan 2, 2027 (one Week 17 game) | Peacock exclusive | yes | medium |
| Thanksgiving | CBS (CHI@DET), FOX (PHI@DAL), NBC (KC@BUF) | yes | high |
| YouTube | **No 2026 game confirmed.** It was rumored at up to 5 games (Sportico, April 2026); YouTube TV is only the Kickoff Weekend sponsor. | – | medium |
| Playoffs / Super Bowl LXI | Assignments still TBD in ESPN data. The Super Bowl is on ABC/ESPN by rotation (from memory). | – | low |

**Local coverage**

- There are no regional sports networks in the NFL. Local means over-the-air affiliates.
- Cable and streaming exclusives (ESPN, Prime, Netflix, NFL Network, Peacock) are also simulcast on an over-the-air station in each team's home market.
- NFL+ ($6.99 per month) streams local and primetime games on **phones and tablets only**. NFL+ Premium adds RedZone.

**Out of market: NFL Sunday Ticket on YouTube**

- Available as a YouTube TV add-on or standalone through Primetime Channels.
- Price: about $378 with YouTube TV or $480 standalone; about $240 promo for new customers; about $109 for students.
- It covers out-of-market Sunday CBS/FOX games only. It excludes the user's local CBS/FOX games and all primetime and exclusive games.
- "Local" is based on the location YouTube detects (DMA).

Sources: [NFL 2026 schedule release](https://media.nfl.com/football-information/2026/news/2026-nfl-schedule-announced), [ESPN closes NFL Network acquisition](https://www.thewrap.com/industry-news/deals-ma/espn-nfl-network-acquisition-closes/), [NFL Network (Wikipedia)](https://en.wikipedia.org/wiki/NFL_Network), [Sunday Ticket 2026 pricing](https://9to5google.com/2026/09/10/youtube-nfl-sunday-ticket-2026-details/), [Xfinity Sunday Ticket exclusions](https://www.xfinity.com/support/articles/nfl-sunday-ticket-youtube), [Sportico YouTube report](https://www.sportico.com/leagues/football/2026/youtube-nfl-exclusive-streaming-games-schedule-report-cost-1234890383/), [NFL+ guide](https://nflplayoffpass.com/nfl-plus/).

## NBA (2026-27): year 2 of the 11-year ESPN/NBC/Amazon deal

**TNT has no live games.** It still produces Inside the NBA, which now airs on ESPN/ABC. NBA TV is now **run by the league itself**.

| Package | Days / events | Exclusive? |
|---|---|---|
| ESPN | Wednesday doubleheaders, some Fridays; Western Conference Finals and Finals in 2027 | Mostly. A local feed is occasionally listed. |
| ABC | Saturday primetime, Sunday afternoons, Christmas (5 games, ABC/ESPN simulcast), Finals | Mostly |
| NBC + Peacock | Opening night (10/20), Tuesday "Coast 2 Coast" doubleheaders, Sunday Night Basketball from Jan 24, 2027, All-Star | Mostly. A local feed is sometimes listed. |
| Peacock Monday (simulcast on NBCSN) | Monday exclusives ("On the Bench" format) | Yes |
| Prime Video | Friday doubleheaders, Thursdays (from January), Saturday afternoons (from February), NBA Cup knockouts, Play-In (exclusive), playoffs, 2027 Eastern Conference Finals | Mostly. In 2025-26 some games carried regional local feeds. |
| NBA TV | A few games per week | **No.** The local outlet airs the game in-market. |
| Playoffs | ESPN/ABC, NBC/Peacock, Prime | Yes. RSNs are banned from playoff games. |

**Local coverage: big upheaval**

- The **Hawks** stream in-market on **Prime Video**.
- The Pistons moved to The Spot (Scripps) plus DAZN.
- The NBC Sports regionals (Boston, Bay Area, California, Philadelphia) are sold as Peacock add-ons.
- The full team table is in the JSON. Its source is the [SMW 2026-27 NBA local guide](https://www.sportsmediawatch.com/2026/10/smw-faq-nba-broadcasts-2026-27/).

**Out of market: NBA League Pass (NBA App; also a Prime Video Channel)**

- Price: about $16.99 per month or $109.99 per season; Premium about $24.99 / $159.99.
- Live blackouts: the user's local teams, plus **every national game** in the US.
- Location is determined from IP address and ZIP code.
- Replays: national games the next morning, local games after about 72 hours.

Sources: [NBA.com NBC/Peacock 2026-27](https://www.nba.com/news/every-nba-game-on-nbc-and-peacock-in-2026-27), [NBA.com Prime 2026-27](https://www.nba.com/news/every-nba-game-on-prime-video-in-2026-27), [Yahoo how-to-watch](https://sports.yahoo.com/nba/article/how-to-watch-the-2026-27-nba-season-tv-channels-where-to-stream-games-schedule-and-more-171144583.html), [CBS8 guide](https://www.cbs8.com/article/news/nation-world/nba-season-how-to-watch/507-c5c821f1-e3c4-4028-b854-567f1830995c), [NBA on television (Wikipedia)](https://en.wikipedia.org/wiki/NBA_on_television), [Hoops Rumors on DAZN](https://www.hoopsrumors.com/2026/07/dazn-expected-to-stream-local-broadcasts-for-at-least-seven-nba-teams-in-2026-27.html), [Front Office Sports on NBA TV](https://frontofficesports.com/article/tnt-will-no-longer-operate-nba-tv-nba-com-signaling-another-shift/), [Hawks on Prime (SVG)](https://www.sportsvideo.org/2026/10/21/atlanta-hawks-become-first-nba-team-to-stream-games-exclusively-on-prime-video/), [League Pass blackouts](https://www.nba-schedule.net/blog/watch-nba-games-2026-27-streaming-guide), [League Pass pricing](https://sportsepreneur.com/is-nba-league-pass-worth-it-tv-media-deal/), [NBCSN launch (SMW)](https://www.sportsmediawatch.com/2025/11/nbcsn-launch-monday-will-air-nba-mlb-more/).

## MLB (2026, World Series on FOX in progress)

New 3-year deals (2026–2028) are with NBCU, ESPN and Netflix. The FOX, TBS and Apple deals continue through 2028.

| Package | Content | Exclusive? |
|---|---|---|
| FOX | Saturday "Baseball Night in America" (about 23 games), All-Star Game, World Series, one LCS (2026: NLCS), Division Series | Yes |
| FS1 | Regular season (mostly Saturdays); postseason | Regular season: no. Postseason: yes. |
| TBS / truTV / HBO Max | Tuesday nights; 2026 ALDS and ALCS | Tuesday: no. Postseason: yes. |
| NBC / Peacock / NBCSN | Sunday Night Baseball (25 games), Sunday Leadoff (18 games; 17 Peacock/NBCSN-only), Opening Day primetime, Labor Day, July 5 "roadblock" (all 15 games), **entire Wild Card round** | Yes |
| ESPN / ABC | 30-game national package (weeknights, summer), Memorial Day, second-half opener | Yes |
| ESPN Unlimited (`ESPN Unlmtd`) | MLB.TV "game of the day" (150+ games) | No. Blacked out in-market. |
| Apple TV | Friday Night Baseball doubleheaders (confirmed in 2026 data from March through September) | Yes |
| Netflix | Opening Night (3/25, NYY@SF), Home Run Derby, Field of Dreams game | Yes |
| MLB Network | Showcase games | No |
| Prime Video | 21 Yankees games, **in-market only** | No (this is a local broadcast) |

**Local coverage**

MLB Local Media produces and distributes games for 14 clubs: ARI, CIN, CLE, COL, DET (on Detroit SportsNet), KC, MIA, MIL, MIN, SD, SEA, STL, TB and WSH. Their in-market streams are labeled like `Brewers.TV` and sold in the MLB app for about $20 per month or $100 per season. ESPN holds in-market streaming rights for several of these teams but is not expected to sell them in its app until 2027.

| Teams | Local outlet / in-market stream |
|---|---|
| Angels | `Angels.TV` / KCOP |
| Braves | BravesVision |
| Orioles | MASN |
| Red Sox | NESN / NESN 360 |
| Cubs | Marquee |
| White Sox | CHSN |
| Astros | SCHN |
| Dodgers | SportsNet LA |
| Mets | SNY |
| Yankees | YES / Gotham app (+ Prime Video) |
| Phillies, Giants, A's | NBC Sports regionals |
| Pirates | SportsNet Pittsburgh |
| Rangers | Rangers Sports Network |
| Blue Jays | Sportsnet |

**Out of market: MLB.TV, sold exclusively by ESPN from 2026**

- It is also still reachable in the MLB app.
- Blacked out: home-territory teams (county or ZIP territories, based on IP or device location), unless the user buys that team's in-market stream.
- Also blacked out, for everyone: all national exclusives and the postseason.

Sources: [MLB press release on new deals](https://www.mlb.com/press-release/press-release-mlb-forms-new-three-year-media-rights-agreements-with-espn-nbcuniversal-and-netflix), [CNBC](https://www.cnbc.com/2025/11/19/mlb-media-rights-deals-nbc-espn-netflix.html), [NBC Sports press release](https://www.nbcsports.com/pressbox/press-releases/major-league-baseball-returns-to-nbc-and-peacock-in-2026-with-three-year-media-rights-partnership-featuring-extensive-exclusivity), [ESPN press release](https://espnpressroom.com/press-release/espn-major-league-baseball-reach-innovative-new-agreement-featuring-significant-collection-of-national-and-local-rights/), [SVG on ESPN/MLB.TV](https://www.sportsvideo.org/2025/11/19/mlb-media-rights-shakeup-espn-mlb-strike-new-rights-deal-to-bring-30-national-games-to-linear-mlb-tv-exclusively-to-espn-app/), [Awful Announcing 2026 guide](https://awfulannouncing.com/mlb/tv-deals-2026-where-to-watch.html), [SMW 2026 MLB local guide](https://www.sportsmediawatch.com/2026/03/smw-faq-mlb-local-broadcasts-where-watch-breakdown/), [MLB 14 clubs announcement](https://www.mlb.com/news/mlb-announces-2026-broadcast-information-for-14-clubs), [SVG on MLB Local Media](https://www.sportsvideo.org/2026/02/11/a-changing-landscape-mlb-local-media-bring-detroit-tigers-los-angeles-angels-into-the-fold-espn-begins-distribution-of-mlb-tv/), [MLB blackout policy (Wikipedia)](https://en.wikipedia.org/wiki/Major_League_Baseball_blackout_policy), [MLB.TV blackouts explained](https://baseballontv.net/mlb-tv-blackouts-explained-2026/).

## NHL (2026-27): year 6 of 7 of the ESPN/TNT deals, through 2027-28

| Package | Content | Exclusive? |
|---|---|---|
| TNT / truTV / HBO Max | 72 games, mostly Wednesdays; Thanksgiving Showdown (11/27); Winter Classic (12/31, UTA vs COL); 2027 Stanley Cup Final | Yes |
| ESPN / ABC | Opening-night tripleheader 9/29, October Tuesdays, Frozen Frenzy 10/13, ABC Hockey Saturday from 1/16/27; 53 games total | Yes |
| ESPN+ / Disney+ / Hulu | About 47 streaming exclusives | Yes |
| NHL Network | Showcase games | No |

**Local coverage**

- **Prime Video** is the in-market streamer for ANA, CAR, CBJ, DAL, MIN, STL and SEA (label `Prime Video (Local)`).
- **Scripps** "The Spot" over-the-air stations: FLA, NSH, TB, UTA, VGK.
- MSG teams (NYR, NYI, NJ, BUF) stream through DAZN/MSG+.
- Kings: ABTV + DAZN.
- Red Wings: Detroit SportsNet (`DSN`), run by MLB Local Media.
- Capitals: Monumental.
- Flyers and Sharks: NBC Sports regionals.

**Out of market: NHL Power Play on ESPN+**

- Over 1,000 games.
- Blacked out: local teams and national TV games.
- ESPN+ exclusives are **not** blacked out.
- Medium confidence on the exact rules.

Sources: [TNT 2026-27 schedule](https://www.nhl.com/news/tnt-releases-schedule-of-72-nhl-regular-season-games-for-2026-27), [ESPN 2026-27 schedule](https://www.nhl.com/news/espn-announces-national-tv-schedule-for-2026-27-season), [Yahoo national schedule](https://sports.yahoo.com/articles/nhl-reveals-2026-27-national-013047084.html), [SMW 2026-27 NHL local guide](https://www.sportsmediawatch.com/2026/09/smw-faq-nhl-broadcasts-2026-27/), [LiveSportsOnTV](https://www.livesportsontv.com/news/how-to-watch-nhl-games), [Goal.com on ESPN+](https://www.goal.com/en-us/news/watch-live-stream-nhl-ice-hockey-espn-plus/blt0d8a5c05a3d23c6c).

---

## ESPN label → network cheat sheet (observed 2026-10-25)

**National**

| Label(s) | App / network |
|---|---|
| `ABC`, `ESPN` | ESPN app |
| `ESPN+` | ESPN app (NHL: out-of-market feed unless it's a true exclusive) |
| `ESPN Unlmtd` | ESPN app (MLB.TV game of the day) |
| `Disney+` | Disney+ |
| `Hulu` | Hulu |
| `CBS` | Paramount+ |
| `Fox`, `FS1` | FOX One |
| `NBC`, `Peacock`, `NBCSN` | Peacock |
| `Prime Video`, `Prime Video (Local)` | Prime Video |
| `Netflix` | Netflix |
| `Apple TV` | Apple TV |
| `NFL Net` | ESPN app (NFL Network is ESPN-owned) |
| `NBA TV`, `NBA League Pass` | NBA app |
| `MLB.TV`, `MLB Net` | MLB app (MLB.TV also in the ESPN app) |
| `NHL Net` | NHL Network |
| `TNT`, `truTV`, `TBS`, `HBO Max` | HBO Max |
| `ERADM` | Radio; ignore |

**Local, NBA**

- `DAZN *` → DAZN
- `Spectrum Sports Net(+)`, `MSG`, `YES`, `MNMT`, `CHSN`, `NBC Sports BO/BA/CA/Phil(+)` (Peacock add-on)
- Team apps and stations: `MavsTV`, `Jazz+`, `Suns Live`, `Thunder App`, `Bucks App`, `BlazerVision`, `ClipperVision`, `Pelicans.com`, `GCSEN`
- Over-the-air stations: `KFAA-TV`, `KJZZ-TV`, `KSBI`, `KTLA`, `KUNP 16`, `MyMi`, `Arizona's Family 3TV/CBS5`

**Local, MLB**

- MLB-distributed team streams: `*.TV` (e.g. `Brewers.TV`, `Padres.TV`, `Tigers.TV`, `Angels.TV`), `BravesVision`
- Over-the-air stations: `WPIX`, `WCIU-TV`, `KCOP`, `KMSP-TV`, `KNTV`, `KING 5`, `Gray Media`, `WXIX FOX19`, and others

**Local, NHL**

- Scripps: `Scripps Sports`, `The Spot - MTN`, `Utah 16`, `Mammoth+`
- Team networks: `CARNHL`, `CBJNHL`, `MINNHL`, `BN+` / `Blues App`, `DSN`, `ABTV`, `KHN` / `KONG`
- RSNs and their overflow channels: `MSG` / `MSG2` / `MSGSN` / `MSGB`, `MNMT` / `MNMT2`, `Altitude Sports` / `Altitude 2 Sports`, `NESN`, `NBC Sports Phil(+)` / `BA`
- Over-the-air stations: `KCOP`, `KTTV`, `Fox 11 Plus`, `KTVD-TV (My20)`
- `Delmarva Sports Network` appeared on a Red Wings away game. It looks like an ESPN data quirk.

---

## What changed recently, and what's uncertain

**Changes since about 2025:**

  - MLB teams moved to MLB Local Media in 2026.
  - NBA teams moved mostly to DAZN, over-the-air stations, or Prime (the Hawks).
  - NHL teams moved to Prime Video, Scripps, or team networks.
- **ESPN owns NFL Network** (closed 2026-01-31). NFL Network is in the ESPN app.
- **MLB 2026:**
  - Sunday Night Baseball and the Wild Card round moved to NBC/Peacock.
  - Netflix took Opening Night and the Home Run Derby.
  - ESPN now sells MLB.TV and has a 30-game midweek package.
  - Apple's Friday games are unchanged.
- **NBA:** TNT is out. NBCSN was relaunched in November 2025. NBA TV is league-run.

**Low or medium confidence:**

- **NFL 2026 YouTube games:** none found.
- **NFL 2026-27 playoff and Super Bowl network assignments:** not verified.
- **Exact NBA exclusivity per package:** the deals' fine print isn't public. Rely on the ESPN per-game `geoBroadcasts` rule above.
- **NBA TV's place in League Pass:** not verified.
- **Exact NHL Power Play blackout rules for NHL Network games:** not verified.
- **ESPN selling MLB Local Media in-market streams in its app:** expected in 2027.
- **The Rangers, Blue Jays and Nationals local entries** come from ESPN labels only.
- **ESPN label lag:** some 2026-27 NBA and NHL games may still show stale labels, and far-future games lack streaming labels.
