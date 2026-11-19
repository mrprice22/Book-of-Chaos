#!/usr/bin/env bash
# Reproduce the M14.3 spike. Run it inside the dev container:
#
#   ./scripts/dev.sh run 'spikes/m14.3-size-limits/run.sh local'
#   ./scripts/dev.sh run 'spikes/m14.3-size-limits/run.sh maincloud'
#
# `local` starts a scratch SpacetimeDB on port 3100 with a throwaway data dir.
# `maincloud` publishes a throwaway database under the CLI's logged-in identity, with a
# random name, and deletes it on exit, whether the run passed or failed. Only run that
# with the account owner's go-ahead: it uses their Maincloud quota.
#
# The record of what this showed is docs/decisions/0003-size-limits.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TARGET="${1:?usage: run.sh local|maincloud}"
WORK="$(mktemp -d)"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }

case "$TARGET" in
  local)
    PORT=3100
    SERVER="http://127.0.0.1:$PORT"
    HTTP="$SERVER"
    WS="ws://127.0.0.1:$PORT"
    DB=m14-size-limits
    cleanup() {
      fuser -k -TERM "$PORT/tcp" >/dev/null 2>&1 || true
      rm -rf "$WORK"
    }
    trap cleanup EXIT
    if curl -sf "$HTTP/v1/ping" >/dev/null 2>&1; then
      echo "port $PORT is already in use; stop whatever holds it first" >&2
      exit 2
    fi
    log "starting a scratch SpacetimeDB on $PORT"
    spacetime start --listen-addr "127.0.0.1:$PORT" --data-dir "$WORK/data" >"$WORK/stdb.log" 2>&1 &
    for _ in $(seq 1 60); do curl -sf "$HTTP/v1/ping" >/dev/null 2>&1 && break; sleep 1; done
    curl -sf "$HTTP/v1/ping" >/dev/null || { tail -30 "$WORK/stdb.log" >&2; exit 2; }
    ;;
  maincloud)
    SERVER=maincloud
    HTTP=https://maincloud.spacetimedb.com
    WS=wss://maincloud.spacetimedb.com
    DB="boc-m14-3-limits-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    export CEILING_MIB=32
    cleanup() {
      log "deleting $DB from maincloud"
      spacetime delete -s maincloud --yes "$DB" >/dev/null 2>&1 ||
        echo "WARNING: could not delete $DB from maincloud; delete it by hand" >&2
      rm -rf "$WORK"
    }
    trap cleanup EXIT
    ;;
  *)
    echo "usage: run.sh local|maincloud" >&2
    exit 2
    ;;
esac

log "publishing the spike module to $TARGET as $DB"
(cd "$HERE/module" && spacetime publish -s "$SERVER" --yes "$DB" >/dev/null 2>&1)
rm -rf "$HERE/.bindings"
(cd "$HERE/module" && spacetime generate --lang typescript --out-dir ../.bindings --module-path . >/dev/null 2>&1)
ln -sfn "$REPO/client/node_modules" "$HERE/node_modules"

log "probing $HTTP"
(cd "$HERE" && ./node_modules/.bin/tsx probe.ts "$HTTP" "$WS" "$DB") 2>&1 | grep -v 'Connecting to SpacetimeDB'
