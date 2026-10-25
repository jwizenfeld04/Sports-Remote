#!/usr/bin/env bash
# Install or upgrade Sports Remote as a systemd service on Debian, Ubuntu or Raspberry Pi OS.
#
#   git clone https://github.com/jwizenfeld04/Sports-Remote && cd sports-remote
#   sudo deploy/install.sh               # install, or upgrade in place (safe to rerun)
#   sudo deploy/install.sh --uninstall   # remove the service and code; keep settings and data
#   sudo deploy/install.sh --purge       # remove everything, including settings, data and the user
#
# Options:
#   --avahi        also announce the app on the LAN via Avahi (installs avahi-daemon)
#   --no-apt       don't install system packages (you've installed adb/tesseract yourself)
#   --yes          don't ask before --purge
#
# Layout:  code /opt/sports-remote (root-owned, read-only to the service)
#          data /var/lib/sports-remote (0700, owned by the sportsremote user; holds the ADB key)
#          env  /etc/sports-remote/env (bootstrap settings only; optional)
set -euo pipefail

APP=sports-remote
SVC_USER=sportsremote
PREFIX=/opt/$APP
DATA=/var/lib/$APP
ETC=/etc/$APP
UNIT=/etc/systemd/system/$APP.service
AVAHI_SVC=/etc/avahi/services/$APP.service
SRC="$(cd "$(dirname "$0")/.." && pwd)"

mode=install avahi=0 apt=1 yes=0
for a in "$@"; do
  case "$a" in
    --uninstall) mode=uninstall ;;
    --purge) mode=purge ;;
    --avahi) avahi=1 ;;
    --no-apt) apt=0 ;;
    --yes|-y) yes=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root: sudo $0 $*"
command -v systemctl >/dev/null || die "systemd is required (for Docker, see docs/hosting.md)"

# ---------------------------------------------------------------- uninstall / purge
if [ "$mode" != install ]; then
  say "stopping and removing the $APP service"
  systemctl disable --now "$APP" 2>/dev/null || true
  rm -f "$UNIT" "$AVAHI_SVC"
  systemctl daemon-reload
  systemctl reload avahi-daemon 2>/dev/null || true
  rm -rf "$PREFIX" "$PREFIX.new" "$PREFIX.old"
  if [ "$mode" = purge ]; then
    if [ "$yes" -ne 1 ]; then
      read -r -p "Delete $DATA (settings, secrets, ADB key) and $ETC? [y/N] " ok
      [ "${ok,,}" = y ] || { echo "kept $DATA and $ETC"; exit 0; }
    fi
    rm -rf "$DATA" "$ETC"
    id "$SVC_USER" >/dev/null 2>&1 && userdel "$SVC_USER" 2>/dev/null || true
    say "purged"
  else
    say "removed. Settings and data are kept in $DATA and $ETC (use --purge to delete them)"
  fi
  exit 0
fi

# ---------------------------------------------------------------- platform checks
# shellcheck disable=SC1091
[ -r /etc/os-release ] && . /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *" debian "*|*" ubuntu "*|*" raspbian "*) say "detected ${PRETTY_NAME:-$ID} ($(uname -m))" ;;
  *) warn "untested distribution '${PRETTY_NAME:-unknown}'. This script uses apt; pass --no-apt and install adb + tesseract-ocr yourself if needed." ;;
esac
grep -qs '"name": "sports-remote"' "$SRC/package.json" || die "run this from a sports-remote checkout ($SRC isn't one)"

if [ "$apt" -eq 1 ]; then
  command -v apt-get >/dev/null || die "apt-get not found; rerun with --no-apt after installing adb and tesseract-ocr"
  say "installing system packages (adb, tesseract-ocr, rsync)"
  pkgs=(adb tesseract-ocr tesseract-ocr-eng rsync ca-certificates)
  [ "$avahi" -eq 1 ] && pkgs+=(avahi-daemon)
  DEBIAN_FRONTEND=noninteractive apt-get update -y -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${pkgs[@]}"
fi

NODE="$(command -v node || true)"
node_major() { "$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ -z "$NODE" ] || [ "$(node_major)" -lt 22 ]; then
  echo "error: Node.js 22 or newer is required (found: ${NODE:-none} $([ -n "$NODE" ] && "$NODE" -v 2>/dev/null))." >&2
  cat >&2 <<'EOF'
Install it system-wide, for example from NodeSource:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
(Raspberry Pi OS 64-bit works the same way; 32-bit armv7 isn't supported by Node 22 builds.)
Then rerun this script. A Node installed with nvm under your home directory won't work for a
system service; use the system package.
EOF
  exit 1
fi
NODE="$(readlink -f "$NODE")"
say "using node $("$NODE" -v) at $NODE"
NPM="$(dirname "$NODE")/npm"; [ -x "$NPM" ] || NPM="$(command -v npm || true)"
[ -n "$NPM" ] || die "npm not found next to node"

if command -v adb >/dev/null; then
  adb_ver="$(adb version 2>/dev/null | sed -n 's/^Version \([0-9]*\).*/\1/p' | head -1)"
  if [ -n "$adb_ver" ] && [ "$adb_ver" -lt 30 ]; then
    warn "adb $adb_ver is installed. Google TV pairing needs adb 30+; Fire TV works. (Debian 13 / Ubuntu 24.04 ship adb 34.)"
  fi
else
  warn "adb not found on PATH; the app can't reach a TV until it's installed"
fi
command -v tesseract >/dev/null || warn "tesseract not found: screen-reading launches will be skipped (others still work)"

# ---------------------------------------------------------------- user and directories
if ! id "$SVC_USER" >/dev/null 2>&1; then
  say "creating system user $SVC_USER"
  useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin --user-group "$SVC_USER"
fi
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$DATA"
install -d -m 0755 -o root -g root "$ETC"

# ---------------------------------------------------------------- build (staged, then swapped in)
STAGE="$PREFIX.new"
rm -rf "$STAGE"
install -d -o "$SVC_USER" -g "$SVC_USER" "$STAGE"
say "copying source to $STAGE"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude data \
  --exclude spike/results --exclude test-results --exclude playwright-report --exclude '.env*' --exclude '*.env' \
  "$SRC/" "$STAGE/"
chown -R "$SVC_USER:$SVC_USER" "$STAGE"
NPM_CACHE="$(mktemp -d)"; chown "$SVC_USER:$SVC_USER" "$NPM_CACHE"
trap 'rm -rf "$NPM_CACHE"' EXIT
say "installing dependencies and building (this takes a minute on a Raspberry Pi)"
runuser -u "$SVC_USER" -- env HOME="$NPM_CACHE" PATH="$(dirname "$NODE"):/usr/bin:/bin" npm_config_cache="$NPM_CACHE" \
  bash -c "cd '$STAGE' && '$NPM' ci --no-audit --no-fund && '$NPM' run build && '$NPM' prune --omit=dev --no-audit --no-fund" \
  || die "build failed; the running version (if any) was left untouched"
# The service must not be able to modify its own code.
chown -R root:root "$STAGE"
chmod -R go-w "$STAGE"

# ---------------------------------------------------------------- env, unit, swap, start
if [ ! -f "$ETC/env" ]; then
  install -m 0600 -o root -g root "$SRC/deploy/env.example" "$ETC/env"
  say "wrote $ETC/env (defaults are fine for most setups)"
fi
sed "s#/usr/bin/node#$NODE#" "$SRC/deploy/sports-remote.service" > "$UNIT.tmp"
chmod 0644 "$UNIT.tmp" && mv "$UNIT.tmp" "$UNIT"
if [ "$avahi" -eq 1 ] && [ -d /etc/avahi/services ]; then
  install -m 0644 "$SRC/deploy/sports-remote.avahi.xml" "$AVAHI_SVC"
  systemctl reload avahi-daemon 2>/dev/null || true
fi
systemctl daemon-reload

upgrading=0; [ -d "$PREFIX" ] && upgrading=1
rm -rf "$PREFIX.old"
[ "$upgrading" -eq 1 ] && mv "$PREFIX" "$PREFIX.old"
mv "$STAGE" "$PREFIX"
port="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$ETC/env" | tail -1)"; port="${port:-8787}"
healthy() { # /healthz answers loopback only, which is where this runs
  for _ in $(seq 1 20); do
    "$NODE" -e "fetch('http://127.0.0.1:$port/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null && return 0
    systemctl is-failed --quiet "$APP" && return 1
    sleep 1
  done
  return 1
}
systemctl enable "$APP" >/dev/null 2>&1
if ! systemctl restart "$APP" || ! healthy; then
  warn "service failed to start"
  if [ "$upgrading" -eq 1 ]; then
    warn "rolling back to the previous version"
    rm -rf "$PREFIX" && mv "$PREFIX.old" "$PREFIX" && systemctl restart "$APP" || true
  fi
  die "see: journalctl -u $APP -n 50"
fi
rm -rf "$PREFIX.old"

echo
say "Sports Remote is $([ "$upgrading" -eq 1 ] && echo upgraded || echo installed) and running."
cat <<EOF

Next:
  1. Open the one-time setup link printed in the log:  journalctl -u $APP -n 30
     (the app listens on port $port; bootstrap settings live in $ETC/env)
  2. When the server first connects to a Fire TV, accept "Allow USB debugging" on the TV
     and tick "Always allow from this computer".
  3. Optional HTTPS: put it behind a reverse proxy or Tailscale Serve (docs/hosting.md).

Upgrade later with: git pull && sudo deploy/install.sh
EOF
