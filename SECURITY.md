# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report privately through GitHub instead: on the repository page go to **Security → Report a vulnerability** (or use <https://github.com/jwizenfeld04/Sports-Remote/security/advisories/new>). Include:

- what an attacker can do, and from where (same Wi-Fi, tailnet, the internet through a proxy, the TV itself);
- the steps to reproduce it, with the version (`/healthz` or the image tag) and how it's deployed (Docker, bare metal, behind which proxy);
- any log lines involved, with secrets removed.

You should get a reply within a week. Once a fix is released, the advisory is published with credit to you unless you'd rather stay anonymous.

## Supported versions

This is a small hobby project, so only the latest release gets security fixes. The `edge` image (built from `main`) gets fixes first.

| Version | Supported |
|---|---|
| latest release (`:latest`, newest `v*` tag) | yes |
| `main` / `:edge` | yes, best effort |
| older releases | no. Please upgrade. |

## Threat model, in short

Sports Remote is meant to run **on your home network, next to your TV**. It isn't designed to face the open internet. If you want it reachable from outside, put it behind an authenticating proxy, or better, a VPN such as Tailscale (see [docs/hosting.md](docs/hosting.md)).

**What it protects:**

- Access to the app is gated by one of three modes:
  - a shared PIN;
  - named accounts (admin and member);
  - a trusted reverse proxy's identity header, honored only from `TRUSTED_PROXIES`.
- Sessions are server-side and can be revoked.
- Logins, launches and remote keys are rate-limited.
- Requests with an unknown `Host` header are refused (DNS-rebinding defense).
- State-changing requests must be same-origin JSON (CSRF defense).
- A CSP is sent, plus HSTS when the app is served over HTTPS.
- **The TV only receives allowlisted command shapes:** VIEW intents, app launches, allowlisted key events, status reads and screenshots. Every argument is quoted for the TV's shell, and there is no shell passthrough. A compromised browser session can change channels. It can't run arbitrary commands on the TV.
- Secrets are files with mode 0600: the Plex token and ESPN key in `DATA_DIR/secrets.json`, PIN and password hashes (scrypt) and session hashes in `DATA_DIR/auth.json`. They are never sent to the browser or written to logs.
- The saved Plex token is only ever sent to the Plex server it was saved for: pointing Plex at a different address needs the token typed again.
- Live-update streams are capped per address, and slow readers are dropped.

**What you have to trust, or protect yourself:**

- **ADB is powerful.** Once a TV approves this server's ADB key, anyone holding that key (`DATA_DIR/.android/adbkey`) has full ADB control of the TV. Treat the data directory as a secret: back it up privately and keep it out of git and shared volumes. On the TV, approve only computers you recognize. If the key leaks, use **Revoke USB debugging authorizations** in the TV's developer options.
- **ADB itself isn't encrypted on Fire TV** (plain `adb connect` on port 5555). Anyone on the same network segment who the TV has approved can control it; that is an Android design choice. Google TV's Wireless debugging (`adb pair`) is TLS. Put TVs and this server on a network you trust.
- **The Plex token is an admin token.** Plex has no scoped tokens, so the token the app stores can do anything on your Plex server. The app only uses it to list channels, read the guide, find the server and tune a channel. If you suspect it leaked, use **Sign out of all devices** in Plex to revoke it.
- **Proxy mode trusts headers.** If `TRUSTED_PROXIES` includes addresses that ordinary clients can use, anyone can claim to be any user. List only the proxy's address. Ranges wider than `/8` are refused, setup refuses a range that contains this machine's own LAN address, and the server warns at startup if one is configured.
- **The host.** Whoever controls the machine or container controls the app, its secrets and the TV. With host networking, the adb server listens on the host's `127.0.0.1:5037`, so any local user or process on that machine can drive the approved TVs.
- **Members see household details.** Signed-in members (not only admins) can see the TVs' addresses and models, the installed apps and the Plex address. Secrets are never shown.

**Out of scope:** what an approved household member does with the remote; denial of service from inside the LAN; and vulnerabilities in the TV's apps, Plex, or ESPN's APIs, which should be reported to those vendors.
