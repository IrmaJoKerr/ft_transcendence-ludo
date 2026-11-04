#!/bin/sh
# Entrypoint for the dev-only image (compose profile `dev`, see Dockerfile.dev).
#
# `npm run dev` would fire `predev` itself, but this container is root over a host
# bind mount, so the copy that sync writes into src/__shared__ comes out owned by
# root on the host — and then the host user cannot delete it (`make clean`) or
# rewrite it (`make shared` starts with `rmSync` of the target). So the sync runs
# here, the copy is handed back to whoever owns the mount point (the host user by
# construction, no uid passed in), and Vite is started with the pre-script
# suppressed so a second sync cannot undo that. Best-effort: the dev server must
# start even if the chown is refused (e.g. an id-mapped mount).
#
# No --host/--port here: vite.config.ts already sets `host: true` and port 8080,
# which is the port compose publishes.
set -e

npm run predev

if [ -d src/__shared__ ]; then
  owner=$(stat -c '%u:%g' /app 2>/dev/null) || owner=''
  if [ -n "$owner" ]; then
    chown -R "$owner" src/__shared__ 2>/dev/null || true
  fi
fi

exec npm run dev --ignore-scripts
