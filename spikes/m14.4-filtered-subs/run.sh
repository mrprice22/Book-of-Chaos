#!/usr/bin/env bash
# Reproduce the M14.4 spike. Run it inside the dev container:
#
#   ./scripts/dev.sh run spikes/m14.4-filtered-subs/run.sh
#
# It starts its own SpacetimeDB on port 3100 with a throwaway data dir, so it never
# touches the dev database or the ports verify.sh uses. Exit 0 means every probe passed.
#
# The record of what this showed is docs/decisions/0004-filtered-subscriptions.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PORT=3100
HTTP="http://127.0.0.1:$PORT"
DB=m14-filtered-subs
WORK="$(mktemp -d)"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
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

log "publishing the spike module"
(cd "$HERE/module" && spacetime publish -s "$HTTP" --yes "$DB" >/dev/null 2>&1)
rm -rf "$HERE/.bindings"
(cd "$HERE/module" && spacetime generate --lang typescript --out-dir ../.bindings --module-path . >/dev/null 2>&1)
ln -sfn "$REPO/client/node_modules" "$HERE/node_modules"

log "probing"
(cd "$HERE" && ./node_modules/.bin/tsx probe.ts "ws://127.0.0.1:$PORT" "$DB") 2>&1 | grep -v 'Connecting to SpacetimeDB'
