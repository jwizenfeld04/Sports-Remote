# Hosting Sports Remote

Sports Remote controls your TV over ADB, so it must run **on your home network**, on any always-on Linux machine. A Raspberry Pi 4 or 5, a mini PC, a NAS that runs Docker, or a home server all work.

- [What you need](#what-you-need)
- [Docker (recommended)](#docker-recommended)
  - [Raspberry Pi](#raspberry-pi)
  - [Unraid, CasaOS and other NAS UIs](#unraid-casaos-and-other-nas-uis)
- [Bare metal (systemd)](#bare-metal-systemd)
- [Bootstrap settings](#bootstrap-settings)
- [HTTPS and remote access](#https-and-remote-access)
  - [Tailscale Serve](#tailscale-serve)
  - [Reverse proxies](#reverse-proxies-caddy-nginx-nginx-proxy-manager-traefik)
- [Why there's no cloud version](#why-theres-no-cloud-version)
- [Backups, upgrades and troubleshooting](#backups-upgrades-and-troubleshooting)

## What you need

- A Linux host on the **same LAN as the TV**: `linux/amd64` or `linux/arm64` (64-bit Raspberry Pi OS).
- ADB debugging turned on on the TV. The [TV setup guide](tv-setup.md) has the steps for each device.
- A fixed address for the TV: a DHCP reservation on your router.
- Optional: Plex Media Server with a tuner (for local channels), and an ESPN Watch API key. Both are set in the app.

Resources are small: about 100 MB RAM when idle, and brief CPU spikes when OCR reads the TV screen.

## Docker (recommended)

Images are published to `ghcr.io/jwizenfeld04/sports-remote` for amd64 and arm64:

| Tag | What |
|---|---|
| `latest` | newest stable release |
| `0.2`, `0.2.1` … | a release line, or one exact release |
| `edge` | built from `main`; may break |

Images are signed with cosign (keyless) and carry an SBOM and build provenance:

```sh
cosign verify ghcr.io/jwizenfeld04/sports-remote:latest \
  --certificate-identity-regexp 'https://github.com/jwizenfeld04/Sports-Remote/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Compose

```sh
mkdir -p ~/sports-remote/data && cd ~/sports-remote
curl -fsSLO https://raw.githubusercontent.com/jwizenfeld04/Sports-Remote/main/deploy/docker-compose.yml
docker compose up -d
docker compose logs -f            # open the one-time setup link it prints
```

Create `./data` yourself before the first start. The container runs as **uid 1000**, so if Docker creates the folder it is owned by root and the app can't write to it. If your user isn't uid 1000, either run `sudo chown 1000:1000 data`, or set `user: "<your uid>:<your gid>"` in the compose file.

`./data` holds `config.json`, `secrets.json` and the ADB key (`.android/adbkey`) the TV approved. Keep it: if you lose it, every TV has to approve the server again. Keep it private too, since anyone with the key can control your TVs.

### Why host networking

The example uses `network_mode: host`, for two reasons:

1. **ADB to the TV.** The server makes outbound connections to the TV (`:5555` on Fire TV, and a changing port for Google TV Wireless debugging). Host networking avoids Docker NAT, so the TV's approval prompt shows this machine's real LAN address.
2. **mDNS discovery of Google TVs.** Google TV announces its Wireless-debugging connect port over mDNS (`_adb-tls-connect._tcp`), and the port changes after a reboot. When a Google TV is offline, the server browses mDNS for its new connect port and updates it automatically. Multicast doesn't cross Docker's default bridge network, so **automatic rediscovery only works with host networking**. Fire TV uses a fixed port and doesn't care.
   - The Debian/Ubuntu `adb` package has `adb pair`, but it's built without adb's own mDNS backend. `adb mdns services` finds nothing there, so the server watches for the announcement itself, and that needs the multicast traffic to reach it.

With host networking the app listens on the host directly at `PORT` (8787). To keep it off some interfaces, set `BIND` to one IP (for example `127.0.0.1` when only a local proxy should reach it).

**Bridge mode** works for Fire TV. On Google TV the server can't see the mDNS announcement, so when the port changes you type the new one into the **connect port** field on that TV in the setup TVs step and press **Reconnect**. The port is on the TV's Wireless debugging screen. Remove `network_mode: host`, uncomment `ports: ["8787:8787"]`, and keep `BIND=0.0.0.0`; that is the container's own interface, and the port mapping decides what the host exposes.

Docker Desktop on macOS and Windows has no real host networking. Run it on a Linux host instead.

### Raspberry Pi

- Use a **64-bit** OS: Raspberry Pi OS (64-bit), Ubuntu Server or DietPi. There's no 32-bit (armv7) image.
- A Pi 4 with 2 GB RAM is plenty. OCR-driven launches take about a second longer on a Pi 4 than on a mini PC.
- Install Docker with `curl -fsSL https://get.docker.com | sh`, add yourself to the `docker` group, then follow [Compose](#compose).
- Wired Ethernet makes ADB noticeably snappier than Wi-Fi.

### Unraid, CasaOS and other NAS UIs

- **Unraid:**
  1. Docker → Add Container.
  2. Set Repository to `ghcr.io/jwizenfeld04/sports-remote:latest` and Network Type to **Host**.
  3. Add a path mapping from `/mnt/user/appdata/sports-remote` to `/data`.
  4. Unraid's appdata belongs to `nobody:users` (99:100). Add `--user 99:100` under Extra Parameters, or `chown 1000:1000` the folder.
  5. Add any [bootstrap settings](#bootstrap-settings) you need as variables.
- **CasaOS / ZimaOS:** App Store → Custom Install → Import, and paste `deploy/docker-compose.yml`. Point the `/data` volume at `/DATA/AppData/sports-remote`. Keep host networking.
- **Synology / QNAP (Container Manager / Container Station):** create a project from the compose file. Choose host networking, and make sure the data folder is writable by uid 1000.
- **Portainer:** Stacks → Add stack → paste the compose file.

## Bare metal (systemd)

`deploy/install.sh` supports Debian 12+, Ubuntu 22.04+ and Raspberry Pi OS (64-bit). It needs Node 22+ installed system-wide. If Node is missing, the script tells you how to install it, for example from NodeSource.

```sh
git clone https://github.com/jwizenfeld04/Sports-Remote && cd Sports-Remote
sudo deploy/install.sh              # add --avahi to announce it on the LAN as an _http service
sudo journalctl -u sports-remote -n 30   # the one-time setup link
```

| What | Where |
|---|---|
| Code (root-owned, read-only to the service) | `/opt/sports-remote` |
| Data: config, secrets, ADB key (0700) | `/var/lib/sports-remote` |
| Bootstrap env (optional, 0600) | `/etc/sports-remote/env` |
| Unit | `/etc/systemd/system/sports-remote.service` |

The script:

- installs `adb`, `tesseract-ocr` and `rsync`;
- creates the `sportsremote` system user;
- builds in `/opt/sports-remote.new`, swaps it into place, and checks `/healthz`. If an upgrade doesn't come up healthy, it rolls back to the previous version.

It warns if your `adb` is older than 30. Google TV pairing needs adb 30+, while Fire TV works with older versions. Debian 12 ships adb 29; Debian 13 and Ubuntu 24.04 ship adb 34.

- **Upgrade:** `git pull && sudo deploy/install.sh`. It's safe to rerun, and it never overwrites `/etc/sports-remote/env` or the data.
- **Uninstall:** `sudo deploy/install.sh --uninstall` keeps your data. `--purge` deletes the data and the user too.
- **Logs:** `journalctl -u sports-remote -f`, one JSON object per line.

The unit is sandboxed: `ProtectSystem=strict`, no capabilities, private `/tmp` and devices, and write access only to the data directory. It can't bind ports below 1024; use a reverse proxy for port 443.

## Bootstrap settings

Environment variables only cover what's needed before the app starts. Everything else is set in the app.

| Variable | Default | What |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `BIND` | `0.0.0.0` | Listen address: `127.0.0.1` when only a local proxy or `tailscale serve` should reach it, or one LAN IP |
| `DATA_DIR` | `/data` (Docker), `/var/lib/sports-remote` (systemd) | Config, secrets, ADB key |
| `TRUSTED_PROXIES` | *(none)* | Proxy IPs/CIDRs whose `X-Forwarded-*` and identity headers are believed. The only name accepted is `loopback`. Ranges wider than /8 are refused, and the old `private` preset was removed. Setup also refuses a range that contains the server's own LAN address; list a LAN proxy by its single IP. |
| `ALLOWED_HOSTS` | *(none)* | Extra host names the app answers to (DNS-rebinding defense). Bare IPs, `localhost`, `*.local` and `*.ts.net` are always allowed. |
| `KEY_METHODS` | `evdev,cmd,input` | How remote presses reach the TV, fastest first. `evdev` (~10 ms) writes key events to the TV's input device; `cmd`/`input` use Android's tools (1–3 s per press on Fire TV). Each TV is checked and falls back. `oneshot` = one command per press. |
| `PUBLIC_URL` | *(none)* | How people reach the app, used to print the one-time setup link |
| `SESSION_DAYS` | `30` | Sign-ins last this many days since last use |

There is no timezone variable. Game times and "Today / Tonight / Tomorrow" follow the timezone chosen in the app's setup, in the **Your area** step. Logs are ISO timestamps in UTC. (`TZ` only changes the container's own clock, which the app doesn't use.)

Older installs configured everything through the environment. `FIRETV_HOST`, `PLEX_*` and `ESPN_WATCH_API_KEY` are imported on first start. Sign-in settings (`SESSION_SECRET`, `APP_PASSCODE`, `ALLOWED_TAILNET_USERS`) are not: the server prints a one-time setup link and you choose sign-in again. See the legacy block in `deploy/env.example`.

## HTTPS and remote access

Plain `http://<server-ip>:8787` on your Wi-Fi works fine. HTTPS adds two things:

- the browser can install the app to your home screen (a PWA);
- the app works away from home (over a VPN, ideally).

**Don't port-forward 8787 to the internet.** If you want the app outside your home, use Tailscale, or a proxy that authenticates users before they reach the app.

### Tailscale Serve

This is the simplest option: HTTPS with a real certificate, reachable only from your tailnet, and the app can sign people in by their Tailscale identity.

On the host (Tailscale installed there):

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8787    # any free port; 443 if nothing else uses it
```

Then set `BIND=127.0.0.1` and `TRUSTED_PROXIES=127.0.0.1`, and choose **proxy** access mode in the app's setup. Serve adds the `Tailscale-User-Login` header. The app trusts that header only from `TRUSTED_PROXIES`, and only Serve can connect from loopback.

The app is then at `https://<machine>.<tailnet>.ts.net`. To stop serving it: `tailscale serve --https=443 off`.

Without Tailscale on the host, use the sidecar example at the bottom of `deploy/docker-compose.yml`. It runs Tailscale in its own container, with its own tailnet name.

### Reverse proxies (Caddy, Nginx, Nginx Proxy Manager, Traefik)

Whichever proxy you use:

- **Set `TRUSTED_PROXIES`** to the proxy's address, as seen by the app. That's `127.0.0.1` if the proxy runs on the same host, or the proxy container's IP or Docker subnet (for example `172.18.0.0/16`) if it's in Docker. Without it, client IPs in logs and rate limits will all be the proxy's, and identity headers are ignored. Never include your whole LAN.
- **Set `ALLOWED_HOSTS`** to the name you serve it under, for example `games.example.com`.
- **Turn off response buffering** for `/api/events`. It's a Server-Sent Events stream for live scores and TV status, and a buffering proxy delays it.
- WebSockets aren't used.
- For **proxy access mode** with an SSO layer (Authelia, Authentik, oauth2-proxy, Cloudflare Access), make the proxy set `Remote-User` (or the header you configure in the app), and strip it from incoming client requests.

**Caddy**

```caddyfile
games.example.com {
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1          # stream SSE immediately
	}
}
```

**Nginx**

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name games.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_buffering off;          # SSE
        proxy_read_timeout 1h;        # long-lived event stream
    }
}
```

**Nginx Proxy Manager:**

1. Add a Proxy Host with scheme `http`, the forward host and port 8787.
2. Under SSL, choose your certificate and **Force SSL**.
3. Under Advanced, add `proxy_buffering off; proxy_read_timeout 1h;`.

The forward host depends on how the app runs:

- **Host networking:** use the host's LAN IP or the Docker bridge gateway (often `172.17.0.1`). Set `TRUSTED_PROXIES` to the NPM container's subnet.
- **Bridge mode on a shared network:** use the container name `sports-remote`.

**Traefik** (labels, with the app in bridge mode on Traefik's network)

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.sports-remote.rule=Host(`games.example.com`)
      - traefik.http.routers.sports-remote.entrypoints=websecure
      - traefik.http.routers.sports-remote.tls.certresolver=letsencrypt
      - traefik.http.services.sports-remote.loadbalancer.server.port=8787
    environment:
      TRUSTED_PROXIES: "172.18.0.0/16"     # Traefik's Docker network
      ALLOWED_HOSTS: "games.example.com"
```

Traefik streams SSE without extra settings. With host networking, point a file-provider service at `http://<host-ip>:8787` instead.

## Why there's no cloud version

- **ADB only works on the local network.** Fire TV's ADB and Google TV's Wireless debugging listen on the LAN. They should never be exposed to the internet, and a cloud server can't reach them.
- **mDNS** discovery of TVs is link-local.
- **Plex and HDHomeRun** guides and tuning are usually LAN-only too.
- **A hosted service would hold control of strangers' TVs** and their Plex admin tokens. Self-hosting keeps that power inside each home.

Remote access is still possible: the server stays at home, and you reach it over Tailscale or an authenticating proxy, as described above.

## Backups, upgrades and troubleshooting

- **Back up** the data directory (`./data` or `/var/lib/sports-remote`). It contains secrets, so store backups encrypted.
- **Upgrade:**
  - Docker: `docker compose pull && docker compose up -d`.
  - Bare metal: `git pull && sudo deploy/install.sh`.
  - Config files are migrated forward automatically. A file from a *newer* version stops the server with a clear message instead of being overwritten, so downgrading needs a backup.
- **Health:** `/healthz` answers only on loopback. The Docker image's `HEALTHCHECK` uses it, and you can check it yourself with `docker inspect --format '{{.State.Health.Status}}' sports-remote` or `curl -s http://127.0.0.1:8787/healthz` on the host.
- **Container tools:** `docker exec -it sports-remote adb devices` shows what the server's adb sees. `docker exec -it sports-remote node dist/server/cli.mjs status` gives the TV status.
- **The TV never shows the approval prompt:**
  - check that ADB debugging is on, and that the TV and server are on the same subnet;
  - make sure no other computer is holding the TV's single ADB connection (for example `adb disconnect` on your laptop);
  - with bridge networking, try host networking.
- **Google TV keeps going offline after reboots:** its Wireless-debugging port changed. With host networking the server finds the new port by itself within a short time. In bridge mode, open the setup TVs step, type the port from the TV's Wireless debugging screen into the TV's **connect port** field and press **Reconnect**.
- **Permission denied on /data:** the folder isn't writable by uid 1000. See [Compose](#compose).
