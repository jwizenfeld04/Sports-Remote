# syntax=docker/dockerfile:1.7
#
# Sports Remote container image (linux/amd64, linux/arm64).
#
# Base: Debian 13 "trixie" slim rather than bookworm. Bookworm ships adb 29.0.6, which has no
# `adb pair`, and Google TV / Android TV 11+ can only be paired with Wireless debugging (`adb pair`).
# Trixie ships adb 34 and tesseract 5.5.
#
#   docker build -t sports-remote .
#   docker run --network host -v ./data:/data sports-remote
#
# The base image is spelled out in each FROM (not an ARG) so Dependabot can keep it current.

# ---- build: UI (vite) + server (esbuild). Output is plain JS, so this stage runs on the build
# machine's own architecture even for cross-arch builds (no QEMU for the slow part).
FROM --platform=$BUILDPLATFORM node:26-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- prod-deps: runtime node_modules only, installed for the target architecture.
FROM node:26-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime
FROM node:26-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Sports Remote" \
      org.opencontainers.image.description="Tap a live game on your phone; it opens on your Fire TV or Google TV in the right app." \
      org.opencontainers.image.source="https://github.com/jwizenfeld04/Sports-Remote" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

# adb talks to the TV; tesseract reads the TV screen for navigator launches (optional at runtime,
# but small enough to always ship); tini reaps adb's forked server and forwards signals.
RUN apt-get update \
 && apt-get install -y --no-install-recommends adb tesseract-ocr tesseract-ocr-eng tini \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* \
 # The app runs with plain `node`; drop the package managers (smaller, less attack surface).
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# The node image already has a uid/gid 1000 user ("node"); rename it so the uid matches a typical
# host user and bind-mounted ./data stays writable without chown.
RUN groupmod -n sportsremote node \
 && usermod -l sportsremote -d /data -s /usr/sbin/nologin node \
 && rm -rf /home/node \
 && mkdir -p /data && chown 1000:1000 /data && chmod 700 /data

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY package.json ./

# HOME=/data keeps the ADB key (/data/.android/adbkey) on the volume, so the TV's
# "Allow USB debugging" approval survives container upgrades.
ENV NODE_ENV=production \
    HOME=/data \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist/web \
    PORT=8787

USER sportsremote
VOLUME /data
EXPOSE 8787

# /healthz only answers loopback; the healthcheck runs inside the container, so it qualifies.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server/main.mjs"]
