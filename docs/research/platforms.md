# Fire TV vs Google TV — streaming app control over ADB

As of 2026-10-25. Web research only (no device testing). Google Play listing ids checked via HTTP 200/404 on 2026-10-25; APKMirror pages for Fire TV builds. Machine-readable version: `platforms.json` (same folder).

## 1. Package names

| Service | Fire TV | Google TV / Android TV | Notes |
|---|---|---|---|
| YouTube TV | `com.amazon.firetv.youtube.tv` (high) | `com.google.android.youtube.tvunplugged` (high)<br>act: `com.google.android.apps.youtube.tvunplugged.activity.MainActivity` |  |
| Hulu / Hulu + Live TV | `com.hulu.plus` (high) | `com.hulu.livingroomplus` (high) |  |
| Sling TV | `com.sling` (medium) | `com.sling` (high)<br>act: `com.sling/.MainActivity` | APKMirror Fire TV listing icon is com.sling; not confirmed on device. |
| Fubo | `com.fubo.firetv.screen` (high)<br>act: `tv.fubo.mobile.presentation.onboarding.dispatch.controller.DispatchActivity` | `com.fubo.firetv.screen` (high)<br>act: `tv.fubo.mobile.presentation.onboarding.dispatch.controller.DispatchActivity` | Same 'firetv' package name on all Android platforms. |
| DIRECTV (Stream) | `com.att.tv` (medium)<br>act: `com.clientapp.MainActivity` | `com.att.tv` (high)<br>act: `com.clientapp.MainActivity` | Fire TV package assumed same as Android TV; not directly confirmed. DIRECTV Osprey box uses system package com.att.tv.openvideo with a different link format. |
| ESPN | `com.espn.gtv` (high) | `com.espn.score_center` (high)<br>act: `com.espn.startup.presentation.StartupActivity` | Same package as phone app; com.espn.gtv 404s on Google Play. |
| FOX One | `com.fox.foxone` (high) | `com.fox.foxone` (high) |  |
| FOX Sports | `com.foxsports.android` (low) | `com.foxsports.android` (medium) | Speculative: same as Android package; FS1/FS2 streaming is now in FOX One. Play listing exists; TV form-factor support unclear. |
| Peacock | `com.peacock.peacockfiretv` (high)<br>act: `com.peacock.peacocktv.AmazonMainActivity` | `com.peacocktv.peacockandroid` (high)<br>act: `GoogleMainActivity (VIEW https://www.peacocktv.com/deeplink)` | NOTE: python-androidtv lists com.peacocktv.peacockandroid, which is the Google TV build. |
| Paramount+ | `com.cbs.ott` (high) | `com.cbs.ott` (high) |  |
| Prime Video | `com.amazon.firebat` (high)<br>act: `com.amazon.firebatcore.deeplink.DeepLinkRoutingActivity` | `com.amazon.amazonvideo.livingroom` (high) |  |
| Netflix | `com.netflix.ninja` (high) | `com.netflix.ninja` (high) |  |
| Apple TV | `com.apple.atve.amazon.appletv` (high) | `com.apple.atve.androidtv.appletv` (high) | Sony sets: com.apple.atve.sony.appletv. (python-androidtv's 'com.apple.atve.android.appletv' looks stale/typo.) |
| HBO Max | `com.hbo.hbonow` (high) | `com.wbd.stream` (high) | com.hbo.hbonow 404s on Google Play; native-apps uses com.hbo.hbonow as the alternate (Fire TV) package. |
| NBA (League Pass) | `com.nbaimd.gametime.nba2011.amazon` (high) | `com.nbaimd.gametime.nba2011` (medium) | Play listing exists; Android TV build may share id — confirm with pm list packages. |
| NFL (NFL+ / NFL Network) | `com.gotv.nflgamecenter.us.lite` (high) | `com.gotv.nflgamecenter.us.lite` (high) |  |
| NFL Sunday Ticket (YouTube) | `com.amazon.firetv.youtube.tv / com.amazon.firetv.youtube` (medium) | `com.google.android.youtube.tvunplugged / com.google.android.youtube.tv` (medium) | No separate app; delivered inside YouTube TV or YouTube Primetime Channels. |
| MLB | `com.bamnetworks.mobile.android.gameday.atbat` (high) | `com.bamnetworks.mobile.android.gameday.atbat` (medium) | Same id on Play; TV build assumed to share it. |
| NHL | `com.nhl.gc1112.free` (high) | `com.nhl.gc1112.free` (high) | com.nhl.tv is a separate VOD/highlights app. |
| Gotham Sports (MSG/YES) | `com.gothamsports.gotham.tv` (low) | `com.gothamsports.gotham.tv` (high) | Speculative: assume same as Android TV build. Mobile: com.gothamsports.gotham.mobile. |
| NESN 360 | `com.nesn.nesnplayer` (medium) | `com.nesn.nesnplayer` (high) | A second Play listing com.nesn.androidtv also exists (titled NESN 360). |
| Plex | `com.plexapp.android` (high) | `com.plexapp.android` (high)<br>act: `com.plexapp.plex.activities.SplashActivity` |  |
| Channels (DVR client) | `com.getchannels.dvr.app` (medium) | `com.getchannels.dvr.app` (high) | Legacy 'Channels for HDHomeRun': com.getchannels.app. |
| Tablo | `com.nuvyyo.TabloFAST` (low) | `com.nuvyyo.TabloFAST` (high) | Speculative for Fire TV. |
| HDHomeRun | `com.silicondust.view` (medium) | `com.silicondust.view` (high) | Assumed same as Play id. |
| Philo | `com.philo.philo.amazon` (low) | `com.philo.philo.google` (high) | Speculative naming; confirm with pm list packages \| grep philo. |
| YouTube | `com.amazon.firetv.youtube` (high) | `com.google.android.youtube.tv` (high) |  |
| Disney+ (absorbing Hulu in 2026) | `com.disney.disneyplus` (high) | `com.disney.disneyplus` (high) |  |

**Differs by platform:** YouTube TV, Hulu, ESPN (`com.espn.gtv` vs `com.espn.score_center`), Peacock (`com.peacock.peacockfiretv` vs `com.peacocktv.peacockandroid`), Prime Video, Apple TV, HBO Max (`com.hbo.hbonow` vs `com.wbd.stream`), NBA (`.amazon` suffix), YouTube. Same on both: Fubo (`com.fubo.firetv.screen` everywhere), Sling, Paramount+, Netflix, Fox One, MLB, NHL, NFL, Plex, Channels.

## 2. Deep links

Status: **V** = documented in a source (forum report, community code, or Sports Remote's own Fire TV testing); **S** = speculative / inferred.

### YouTube TV
- **V** `https://tv.youtube.com/watch/<videoId>` — open a live channel/stream by its watch id (ids scraped from tv.youtube.com/live) (googletv/firetv) — Most-used YTTV link in ADBTuner; reported 'deep links just work, are fast'. Some HA users saw devices ignore it. Sources: [1](https://github.com/nuken/Android-ADB-Bridge), [2](https://community.home-assistant.io/t/youtubetv-channel-with-adb-channel-codes/284593), [3](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822)
- **V** `https://tv.youtube.com/live` — open Live guide (firetv) Sources: existing Sports Remote code (verified on Fire OS 7 / Fire TV Stick 4K Max)
- **V** `youtubetv://search?query=<q>` — search (firetv) — Not confirmed on the Google TV build. Sources: existing Sports Remote code (verified on Fire OS 7 / Fire TV Stick 4K Max)
- **V** `https://tv.youtube.com` — open app (HA guide) (googletv) Sources: [1](https://community.home-assistant.io/t/android-tv-remote-app-links-deep-linking-guide/567921)
- _Note:_ Warm deep links are ignored while the app sits on the Live TV tab; ADBTuner users send KEYCODE_SEARCH (84) after each tune so the next deep link is accepted (tune time ~20s -> ~5s). YTTV 4.x on Android TV moved from Cobalt to 'Chrobalt' (forum report).

### Hulu / Hulu + Live TV
- **V** `https://www.hulu.com/watch/<channel-uuid>` — tune a Hulu Live channel (ESPN/ESPN2/SEC... uuids posted) (googletv) — Who's Watching profile picker can block; pre-tune keypress used. Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822?page=160)
- **V** `https://www.hulu.com/network/<slug>` — network page (seen in ADBTuner logs) (googletv) Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/3256)
- **S** `https://www.hulu.com/live` — live guide (firetv/googletv)
- _Note:_ Disney said the standalone Hulu app is being folded into Disney+ during 2026 (incl. Hulu + Live TV). As of 2026-10-25 both Hulu Play listings still resolve, but plan for Disney+ (com.disney.disneyplus) taking over. Sources: https://www.wlox.com/2025/12/30/hulu-app-shut-down-2026-content-be-fully-integrated-with-disney , https://au.variety.com/2025/digital/news/hulu-app-phased-out-disney-plus-fully-integrating-26214

### Sling TV
- **V** `https://watch.sling.com/1/channel/<channelGuid>/watch` — tune a live channel (guid from web grid-guide URL) (googletv) — One user: 'Deeplinks DO INDEED WORK'; earlier posts said only program (asset) links exist, which expire. Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/2207), [2](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/2200)
- **V** `slingtv://watch.sling.com/...` — scheme variant (from dumpsys intent filters: scheme slingtv, hosts sling.com / slingtv.app.link) (googletv) Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/2200)

### Fubo
- **V** `https://link.fubo.tv/al1?v=1&a=play&t=channel&channel_id=<id>` — play a channel (URL-encode the query when passing via ADBTuner) (googletv/firetv) — Opens stream but often stuck on 'who is watching'. Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/561)
- **V** `https://www.fubo.tv/watch?channelId=<id>` — web watch URL (googletv) — Reported NOT reaching playback. Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/561)
- **S** `fubotv://<...station...>` — custom scheme accepted by DispatchActivity (googletv/firetv) — Scheme confirmed via APK inspection; exact path not captured. Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822?page=24)

### DIRECTV (Stream)
- **V** `dtvnow://deeplink.directvnow.com/play/channel/<CALLSIGN>/<channelId>` — tune live channel (googletv) Sources: [1](https://community.home-assistant.io/t/directv-stream-android-tv/822536)
- **V** `https://deeplink.directvnow.com/tune/live/channel/<NAME>/<RESOURCE>` — tune live channel (https form) (googletv) Sources: [1](https://community.getchannels.com/t/adbtuner-create-channels-custom-config-and-cdvr-custom-channels-for-directv/45217/10)

### ESPN
- **V** `sportscenter://x-callback-url/showWatchStream?playID=<airingUuid>` — play a specific airing/event (firetv/googletv) — Verified on Fire TV by Sports Remote. FruitDeepLinks generates this for ADBTuner; Google TV handling via StartupActivity reported 'where supported'. Sources: existing Sports Remote code (verified on Fire OS 7 / Fire TV Stick 4K Max), [2](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py), [3](https://community.getchannels.com/t/fruitdeeplinks-universal-sports-aggregator-for-channels-dvr/45197?page=9)
- **S** `sportscenter://x-callback-url/showWatchStream?playChannel=espn1` — play linear channel (espn1, espn2...) (firetv/googletv) — Apple TV punch-out form; Android support untested. Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)
- **S** `https://www.espn.com/watch/player/_/id/<uuid>` — web/https form of the same airing (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### FOX One
- **V** `foxone://channel/<FS1|FS2|BTN|FOXD>` — open live channel (firetv) — Google TV untested; the hdmi-encoder-native-apps FOX One config navigates with D-pad instead of deep links, so Google TV deep-link support is uncertain. Sources: existing Sports Remote code (verified on Fire OS 7 / Fire TV Stick 4K Max), [2](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### FOX Sports
- **S** `fsapp://live/FS1?eventId=<id>` — open live FS1 event (Apple TV punch-out) (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### Peacock
- **V** `https://www.peacocktv.com/deeplink?deeplinkData={"pvid":"<pvid>","type":"PROGRAMME","action":"PLAY"}` — autoplay a programme/event (URL-encode deeplinkData) (googletv) — Live types: LINEAR_CHANNEL / VOD_CHANNEL (serviceKey starting 'VC'). Sources: [1](https://community.getchannels.com/t/peacock-deep-links/45139), [2](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822?page=92)
- **V** `am start -n com.peacock.peacockfiretv/com.peacock.peacocktv.AmazonMainActivity -d '<https url>'` — explicit-activity launch on Fire TV (firetv) — Manifest review says Fire TV build has no usable public deep link; FruitDeepLinks config with explicit activity reportedly works. Conflicting — test. Sources: [1](https://community.getchannels.com/t/fruitdeeplinks-universal-sports-aggregator-for-channels-dvr/45197?page=9)
- **S** `https://www.peacocktv.com/watch/playback/event/<id>` — event playback (web form) (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### Paramount+
- **V** `https://www.paramountplus.com/live-tv/stream/<slug>/<uuid>/` — live stream / sports event (pplus:// on Apple TV) (googletv/firetv) — Needs a DPAD_CENTER (Select) to reach live feed per FruitDeepLinks; uuid may be per-program. Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py), [2](https://community.getchannels.com/t/fruitdeeplinks-universal-sports-aggregator-for-channels-dvr/45197?page=9), [3](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822?page=107)
- **S** `pplus://www.paramountplus.com/live-tv/stream/<slug>/<uuid>/` — scheme form (Apple TV punch-out) (firetv/googletv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### Prime Video
- **V** `https://app.primevideo.com/detail?gti=<amzn1.dv.gti...>` — open a title/live event detail page (firetv/googletv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py), [2](https://github.com/kineticman/FruitDeepLinks/blob/main/docs/HTTP_DEEPLINKS.md)
- **V** `aiv://aiv/detail?gti=<gti>&action=watch&type=live&broadcast=<gti>` — watch live broadcast (scheme form) (firetv) — FruitDeepLinks default 'scheme' format for Fire TV/Android ADB lanes. Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py), [2](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/fruit_export_adb_lanes.py)
- **V** `https://app.primevideo.com/search?phrase=<q>` — search (firetv) Sources: existing Sports Remote code (verified on Fire OS 7 / Fire TV Stick 4K Max)
- _Note:_ Profile picker may appear. Warning from FruitDeepLinks thread: blind 3x DPAD_CENTER sequences can accidentally subscribe to a premium channel.

### Netflix
- **V** `https://www.netflix.com/title/<id>?source=30` — open a title (source=30 required or it resumes last watched) (googletv) Sources: [1](https://www.home-assistant.io/integrations/androidtv_remote/)
- **S** `https://www.netflix.com/watch/<id>?source=30` — play directly (googletv/firetv)
- **V** `netflix://` — open app (googletv) Sources: [1](https://www.home-assistant.io/integrations/androidtv_remote/)

### Apple TV
- **S** `https://tv.apple.com/...` — open content (MLS/Friday Night Baseball are web/https playables in FruitDeepLinks) (googletv/firetv) Sources: [1](https://community.getchannels.com/t/fruitdeeplinks-universal-sports-aggregator-for-channels-dvr/45197)

### HBO Max
- **V** `https://play.hbomax.com/channel/watch/<uuid>/<uuid>` — tune HBO linear channel (googletv/firetv) Sources: [1](https://github.com/babsonnexus/hdmi-encoder-native-apps/blob/main/adbtuner_native/stations/3100_app_hbomax_stations.json)
- **V** `https://play.hbomax.com/video/watch-sport/<eventId>` — play a live sports event (googletv/firetv) — Converted from Apple punch-out play.hbomax.com/sport/<id>; may need 'Watch Live' press. Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)
- **S** `https://play.max.com/...` — older Max-era host (googletv) Sources: [1](https://community.home-assistant.io/t/android-tv-remote-app-links-deep-linking-guide/567921)

### NBA (League Pass)
- **V** `gametime://game/<gameId e.g. 0022500409>` — open game event page (firetv) — Strip Apple query params. Needs extra key presses to reach live video. Sources: [1](https://community.getchannels.com/t/fruitdeeplinks-universal-sports-aggregator-for-channels-dvr/45197?page=9), [2](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)
- **S** `https://www.nba.com/game/<gameId>` — web form (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### NFL (NFL+ / NFL Network)
- **S** `nflctv://livestream/<uuid>` — NFL+ livestream (Apple TV punch-out) (firetv/googletv) — No stable public event URL found; native-apps uses D-pad navigation instead. Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### NFL Sunday Ticket (YouTube)
- **S** `https://tv.youtube.com/watch/<videoId>` — open game stream in YouTube TV (googletv/firetv)

### MLB
- **V** `mlbatbat://mlbtv?date=<yyyy-mm-dd>&gamepk=<pk>` — open MLB.TV game (firetv) Sources: existing Sports Remote code (verified on Fire OS 7 / Fire TV Stick 4K Max), [2](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)
- **S** `https://www.mlb.com/tv/g<gamepk>` — web form (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/deeplink_converter.py)

### Gotham Sports (MSG/YES)
- **S** `https://gothamsports.com/watch/<contentId>` — event playable URL (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/gotham_integration.py)

### NESN 360
- **V** `com.nesn.nesnplayer://play/<programmeId>` — play programme (googletv/firetv) — From FruitDeepLinks' NESN ingester; not independently tested. Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/ingest_nesn.py)
- **S** `https://watch.nesn.com/<programmeId>` — web form (googletv/firetv) Sources: [1](https://github.com/kineticman/FruitDeepLinks/blob/main/bin/ingest_nesn.py)

### Plex
- **V** `plex://` — open app (googletv) Sources: [1](https://www.home-assistant.io/integrations/androidtv_remote/)
- **V** `plex://server://<machineId>/com.plexapp.plugins.library/library/metadata/<ratingKey> (+ --ez android.intent.extra.START_PLAYBACK true)` — play a library item (googletv/firetv) — Works for movies/episodes; Live TV channel tuning via intent reported NOT working (spins). Sources: [1](https://forums.plex.tv/t/android-intents/755047)
- **S** `plex://preplay/?metadataKey=<key>&metadataType=<n>&server=<id>` — preplay screen (googletv) — Documented for iOS. Sources: [1](https://forums.plex.tv/t/deep-links/205583)

### Channels (DVR client)
- _Note:_ No documented channels:// deep link found.

### Philo
- **S** `https://www.philo.com/player/... (copied from web player)` — tune channel; needs 'Jump to live' press (googletv) — Philo reported working well in ADBTuner but exact URL not captured. Sources: [1](https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822/1218)

### YouTube
- **V** `https://www.youtube.com/watch?v=<id>` — play a video/livestream (googletv/firetv) Sources: [1](https://www.home-assistant.io/integrations/androidtv_remote/)
- **V** `vnd.youtube://<id> / vnd.youtube.launch://` — scheme forms (googletv) Sources: [1](https://www.home-assistant.io/integrations/androidtv_remote/)

### Disney+ (absorbing Hulu in 2026)
- **V** `https://www.disneyplus.com` — open app (googletv) Sources: [1](https://www.home-assistant.io/integrations/androidtv_remote/)

## 3. Enabling ADB

### Fire TV
- **enable**: Settings > My Fire TV (Smart TVs: Device & Software) > About > press the first item/device name repeatedly until 'You are now a developer' (Developer Options hidden since 2023). Then Developer Options > ADB debugging ON.
- **port**: 5555 (Amazon docs: 5555-5585 range). Plain `adb connect <ip>:5555`, no pairing code; first connect shows 'Allow USB debugging?' RSA prompt (tick Always allow).
- **persistence**: Survives reboot on Fire OS 6/7/8 (port stays 5555).
- **vegaOS**: Fire TV Stick 4K Select (2025) and future Amazon sticks run Vega OS (not Android): no ADB/APK; only a developer-mode 'VDA' shell for registered devs. Sports Remote cannot drive these.
- Sources: https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html, https://www.aftvnews.com/how-to-find-show-unhide-reveal-developer-options-on-an-amazon-fire-tv-stick-fire-tv-cube-or-fire-tv-smart-tv/, https://www.aftvnews.com/tag/sideload/, https://developer.amazon.com/docs/vega/0.24/developer-mode.html

### Google TV / Android TV
- **enable**: Settings > System > About > click 'Android TV OS build' ~7x; then System > Developer options > USB debugging (and Wireless debugging where present).
- **legacy**: Android TV <=12 (and Ethernet-connected devices per allaboutchromecast): USB debugging alone makes adbd listen on TCP 5555; `adb connect ip:5555` + RSA prompt. Nvidia Shield has an explicit 'Network debugging' toggle (5555).
- **android13plus**: Google docs: wireless debugging for TV requires Android 13+ (API 33). Pairing: Developer options > Wireless debugging > Pair device with pairing code -> `adb pair ip:<pairPort> <6-digit code>`, then `adb connect ip:<connectPort>` (different, random port shown on Wireless debugging screen).
- **android14Gotcha**: Chromecast with Google TV (Android 14 update) and Google TV Streamer: wireless debugging is turned off on reboot/sleep and the connect port is randomized. Workaround: after pairing+connect, run `adb tcpip 5555` to get fixed 5555 until next reboot; or apps like mouldybread/adb-auto-enable (self-grants WRITE_SECURE_SETTINGS, sets adb_wifi_enabled=1 at boot, discovers port via mDNS and issues tcpip:5555). HA users: 'no workaround that survives a reboot' without such helper.
- **Per device:**
  - Chromecast with Google TV: Android 12 -> 5555 worked; Android 14 -> pairing + random port, resets on reboot
  - Google TV Streamer: Android 14; Wireless debugging needed on Wi-Fi; Ethernet + USB debugging reported to listen on 5555 (allaboutchromecast) — unverified
  - onn 4K / onn 4K Pro: Google TV, Android 12/14 depending on model; same rules by OS version (medium confidence)
  - Nvidia Shield: Android 11; 'Network debugging' toggle, fixed 5555, persists
  - Sony/TCL/Hisense Google TV sets: Follow OS version rules; many on Android 12 (5555) or 14 (pairing). Low confidence, not individually verified.
- Sources: https://allaboutchromecast.com/using-adb-on-google-tv-streamer/, https://community.home-assistant.io/t/android-debug-bridge-on-chromecast-wgtv-4k-after-android-14-update/864037, https://github.com/mouldybread/adb-auto-enable, https://developer.android.com/tools/adb, https://forums.nextpvr.com/showthread.php?pid=589588, https://github.com/nuken/Android-ADB-Bridge

## Discovery

- **ADB mDNS:** `_adb-tls-connect._tcp`, `_adb-tls-pairing._tcp`, `_adb._tcp`. Defined in AOSP adb (ADB_SERVICE_TLS / ADB_SERVICE_PAIR / ADB_SERVICE_TCP). _adb-tls-* only advertised while Wireless debugging is on (Android 11+ phones / 13+ TV). `adb mdns services` lists them; `adb mdns check`. _adb._tcp is rarely advertised by TVs.
- **Fire TV:** _amzn-wplay._tcp (Amazon Whisperplay; TXT/name contains 'amzn.dmgr:'); SSDP/DIAL: ST urn:dial-multiscreen-org:service:dial:1 (Fire TV supports DIAL for YouTube/Netflix casting). Neither tells you ADB is enabled — probe TCP 5555 after discovery. Multicast doesn't cross VLANs. (DIAL is speculative (general knowledge, not re-verified).)
- **Google TV:** _googlecast._tcp (Cast receiver; TXT fn= friendly name, md= model); _androidtvremote2._tcp (Android TV Remote Service v2; not on Fire TV); _adb-tls-connect._tcp when wireless debugging on.
- **Fallback:** Scan LAN for open TCP 5555 (Fire TV, legacy Android TV) and match vendor via `getprop ro.product.manufacturer/model` after connect.

## 4. Limitations

- **screencap:** Windows with FLAG_SECURE capture as black; DRM (Widevine L1 secure video path) video planes are black while UI overlays (menus, guide, profile pickers) usually still capture. So OCR works on menus/guides/pickers but not on the video itself. Expect black/blank capture during playback for HBO Max, Netflix, Prime Video, Disney+/Hulu, Peacock, Paramount+; some (HBO Max) set FLAG_SECURE on browse screens too. Not verified per-app on Fire TV vs Google TV — test each. Confidence: medium (mechanism well known; per-app/per-platform details not sourced). Alternative: `uiautomator dump` gives text/bounds for native-view apps (fast, no OCR) but returns little for Cobalt/web-rendered apps (YouTube, YouTube TV) — speculative; ADBTuner's 'who's watching' clearing uses on-screen text matching.
- **input keyevent latency:** Each `adb shell input keyevent` spawns an app_process JVM (~150-400 ms on sticks; general knowledge). Batch keys: `input keyevent K1 K2 K3` in one shell, or keep one persistent `adb shell` and write lines. ADBTuner/native configs use 1-5 s sleeps between D-pad steps because app UIs lag.
- **Warm deep links (switching games without force-stop):**
  - _mechanics_: `am start -a VIEW -d <uri> <pkg>` adds FLAG_ACTIVITY_NEW_TASK; if the app's task exists and the target activity is singleTask/singleTop, Android delivers the intent to onNewIntent (no cold start). `am start -W` prints LaunchState (COLD/WARM/HOT) or 'Warning: Activity not started, intent has been delivered to currently running top-most instance' — use it to detect warm delivery. Whether the app then navigates is app-specific.
  - _youtubeTV_: Works warm, but only when not on the Live TV tab: send KEYCODE_SEARCH (84) first (ADBTuner 'keep alive' trick, ~20s -> ~5s tunes).
  - _primeVideo_: Fire TV routes through DeepLinkRoutingActivity; warm deep links generally open the new detail page but profile picker can appear (forum). Unverified for live auto-play.
  - _espn_: No source on warm behaviour; community configs (hdmi-encoder-native-apps, FruitDeepLinks) always force-stop ESPN first. Speculative.
  - _plex_: plex:// intents with START_PLAYBACK reportedly work while running; live TV not deep-linkable.
  - _general_: ADBTuner 'Compatibility Mode' = MEDIA_STOP + am force-stop + 2s + am start -W, and force-stop after; used for apps that ignore warm links (Fubo, Hulu, Peacock, DirecTV quirks). Recommendation for Sports Remote: try warm first (MEDIA_STOP/BACK, then am start -W), verify via dumpsys/screencap within N seconds, fall back to force-stop+cold start.
- **Profile pickers:** Hulu, HBO Max, Fubo, Prime, Peacock, YouTube TV (Fire TV) frequently show 'Who's watching' after cold start — another argument for warm switching.
- **Launch by id:** HA notes a Google Play change broke launching many apps by package id via the Android TV Remote protocol (not ADB). `monkey -p <pkg> -c android.intent.category.LEANBACK_LAUNCHER 1` still works over ADB.

## 5. Key codes

| Key | Code |
|---|---|
| `KEYCODE_HOME` | 3 |
| `KEYCODE_BACK` | 4 |
| `KEYCODE_DPAD_UP` | 19 |
| `KEYCODE_DPAD_DOWN` | 20 |
| `KEYCODE_DPAD_LEFT` | 21 |
| `KEYCODE_DPAD_RIGHT` | 22 |
| `KEYCODE_DPAD_CENTER` | 23 |
| `KEYCODE_POWER` | 26 |
| `KEYCODE_ENTER` | 66 |
| `KEYCODE_MENU` | 82 |
| `KEYCODE_SEARCH` | 84 |
| `KEYCODE_MEDIA_PLAY_PAUSE` | 85 |
| `KEYCODE_MEDIA_STOP` | 86 |
| `KEYCODE_MEDIA_PLAY` | 126 |
| `KEYCODE_MEDIA_PAUSE` | 127 |
| `KEYCODE_INFO` | 165 |
| `KEYCODE_CHANNEL_UP` | 166 |
| `KEYCODE_CHANNEL_DOWN` | 167 |
| `KEYCODE_GUIDE` | 172 |
| `KEYCODE_DVR` | 173 |
| `KEYCODE_CAPTIONS` | 175 |
| `KEYCODE_SETTINGS` | 176 |
| `KEYCODE_TV_POWER` | 177 |
| `KEYCODE_TV_INPUT` | 178 |
| `KEYCODE_SLEEP` | 223 |
| `KEYCODE_WAKEUP` | 224 |
| `KEYCODE_LAST_CHANNEL` | 229 |
| `KEYCODE_TV_INPUT_HDMI_1` | 243 |
| `KEYCODE_TV_INPUT_HDMI_2` | 244 |
| `KEYCODE_TV_INPUT_HDMI_3` | 245 |
| `KEYCODE_TV_INPUT_HDMI_4` | 246 |
| `KEYCODE_ALL_APPS` | 284 |

- **HDMI/TV_INPUT:** Only act on devices with a TV Input Framework tuner/HDMI HAL (Google TV/Fire TV *smart TVs*). On sticks/boxes they are ignored; use HDMI-CEC from the TV side or the TV's own app instead.
- **WAKEUP/SLEEP:** 224/223 are idempotent (unlike POWER 26) — preferred. ADBTuner sends WAKEUP then waits ~3 s. CEC may also power the TV on.
- **SETTINGS:** Google TV: opens quick settings panel; Fire TV: behaviour varies by Fire OS (low confidence).
- **GUIDE:** Fire TV: opens Live guide on Fire OS 7+ remotes with guide button (low confidence); Google TV: opens Live tab/guide only if a live provider is integrated (low confidence).
- **SEARCH(84):** Useful as a 'reset to search tab' in YouTube TV before warm deep links.
- **Detection:** `dumpsys power | grep -E 'mWakefulness|Display Power'` and `dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity'` (key name differs by Android version: mResumedActivity on 9-10, topResumedActivity on 11+; Fire OS 7=Android 9, Fire OS 8=Android 11).

## Low-confidence items to verify on hardware first

- Fire TV packages for Gotham, Tablo, Philo (`com.philo.philo.amazon` is a guess), HDHomeRun, Fox Sports, DirecTV.
- Whether `foxone://channel/...` works on Google TV (community config uses D-pad navigation instead).
- Peacock on Fire TV: manifest review says no deep link; another config says explicit-activity launch works.
- NBA Android TV package (may differ from phone `com.nbaimd.gametime.nba2011`).
- Hulu app retirement into Disney+ during 2026 — still listed on Play today.
- Per-app screencap black-frame behaviour; warm-intent behaviour for ESPN/Prime/Fox One.
- KEYCODE_GUIDE / KEYCODE_SETTINGS behaviour per platform.

## Key sources

- python-androidtv constants: https://github.com/JeffLIrion/python-androidtv/blob/master/androidtv/constants.py
- ADBTuner thread (Channels community): https://community.getchannels.com/t/adbtuner-a-channel-tuning-application-for-networked-google-tv-android-tv-devices/36822
- FruitDeepLinks (deep-link converter + ADB lanes): https://github.com/kineticman/FruitDeepLinks
- hdmi-encoder-native-apps (ADBTuner configs w/ packages): https://github.com/babsonnexus/hdmi-encoder-native-apps
- Peacock deep links: https://community.getchannels.com/t/peacock-deep-links/45139
- Home Assistant Android TV Remote docs: https://www.home-assistant.io/integrations/androidtv_remote/
- Android 14 CCwGTV ADB thread: https://community.home-assistant.io/t/android-debug-bridge-on-chromecast-wgtv-4k-after-android-14-update/864037
- Google Play listings (checked 2026-10-25) and APKMirror Fire TV listings, as linked per row.
