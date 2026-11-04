#!/bin/sh
# Builds the SPA and publishes it into /export (the shared spa_dist volume
# nginx serves from), then watches src/ and republishes on every change
# instead of exiting. Keeps the container alive so it behaves/logs like a
# normal long-running service instead of a one-shot job.
set -e

# Build outside the bind-mounted /app entirely (see vite.config.ts): a
# Docker Desktop for Mac VirtioFS bug intermittently fails "Unknown system
# error -35" (ENOLCK) reading files under the bind mount. Confirmed by direct
# testing: it's not tied to any one method (fs.copyFileSync, `cp`, `tar`, even
# plain `cat` all hit it some of the time): it's genuinely non-deterministic,
# so the real fix is retrying, not avoiding a specific syscall. /tmp is the
# container's own filesystem, not bind-mounted, so it's unaffected; only the
# final copy into /export (a real Docker volume, also not bind-mounted) needs
# to happen at all.
export BUILD_OUT_DIR=/tmp/dist-out
export BUILD_PUBLIC_DIR=/tmp/public-safe

# Retry a flaky command a few times with a short pause before giving up.
with_retry() {
  attempt=1
  max=5
  while [ "$attempt" -le "$max" ]; do
    if "$@"; then return 0; fi
    echo "   retry $attempt/$max failed: $*"
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

# Stage public/ into /tmp first (see comment above): copying straight from
# the bind mount happens here instead of inside Vite's own build, so a
# transient failure can be retried per-file instead of aborting the build.
stage_public() {
  rm -rf "$BUILD_PUBLIC_DIR"
  mkdir -p "$BUILD_PUBLIC_DIR"
  [ -d /app/public ] || return 0
  (cd /app/public && find . -type f) | while read -r f; do
    mkdir -p "$BUILD_PUBLIC_DIR/$(dirname "$f")"
    with_retry cat "/app/public/$f" > "$BUILD_PUBLIC_DIR/$f"
  done
}

# The tree arrives as a bind mount and this container is root, so everything the
# `prebuild` sync writes into /app/src/__shared__ lands owned by root on the host.
# The host user can then neither delete that directory (`make clean`) nor rewrite
# it (`make shared`, whose first act is `rmSync` of the target): the guard is to
# hand each freshly written copy back to whoever owns the mount point, which is
# the host user by construction, so no uid has to be passed in and nothing breaks
# on a machine whose uid isn't 1000. Best-effort: a build must not fail over it.
hand_back_copies() {
  [ -d /app/src/__shared__ ] || return 0
  owner=$(stat -c '%u:%g' /app 2>/dev/null) || return 0
  [ -n "$owner" ] || return 0
  chown -R "$owner" /app/src/__shared__ 2>/dev/null || return 0
}

publish() {
  with_retry stage_public
  # `publish` runs as the tested command of an `if`/`||` in every caller
  # (with_retry, and the watch loop's `... || echo`), which suppresses
  # `set -e` for the rest of this function on a failure deep inside it:
  # POSIX/dash don't propagate errexit out of a function once its result is
  # itself being tested. Without this explicit check, a failed `npm run
  # build` fell through to `rm -rf /export/*`, wiping the last good build
  # and leaving nginx with an empty document root (directory-listing-
  # forbidden / index.html redirect-loop errors) until the next good build.
  if ! npm run build; then
    hand_back_copies
    echo "❌ [$(date '+%H:%M:%S')] Build failed: keeping the last published build in place."
    return 1
  fi
  hand_back_copies
  rm -rf /export/*
  cp -a "$BUILD_OUT_DIR/." /export/
  echo "📦 [$(date '+%H:%M:%S')] SPA published to spa_dist"
}

# node_modules lives in an anonymous volume (see compose.yaml) so the bind
# mount doesn't shadow it, but that means it only reflects package.json as of
# whenever the volume was last populated. Installing on every start keeps it
# in sync with the current lockfile instead of silently going stale.
#
# Retried here too (not just in the watch loop below): a transient VirtioFS
# failure on the very first boot would otherwise crash the container
# immediately under `set -e`, and Docker's restart policy would just hit the
# same class of failure again on every restart.
with_retry npm install
with_retry publish

echo "👀 Watching /app/src and package.json for changes..."
# Deliberately NOT watching package-lock.json: npm install can rewrite it
# (e.g. to sync with package.json), which would re-trigger this same watch,
# re-running npm install before the first one finished: two installs racing
# against the same node_modules volume, which is exactly what corrupts it.
while inotifywait -qr -e modify,create,delete,move \
  /app/src /app/package.json; do
  echo "🔄 [$(date '+%H:%M:%S')] Change detected, rebuilding..."
  # `set -e` would otherwise kill this whole script (and the container) on a
  # single broken save, silently ending the watch loop until someone notices
  # and restarts it. Catch the failure so the next save gets a fresh attempt.
  (with_retry npm install && with_retry publish) || echo "❌ [$(date '+%H:%M:%S')] Build failed: fix the error and save again."
done
