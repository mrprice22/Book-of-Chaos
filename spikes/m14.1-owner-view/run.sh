#!/usr/bin/env bash
# Reproduce the M14.1 spike end to end. Run it inside the dev container:
#
#   ./scripts/dev.sh run spikes/m14.1-owner-view/run.sh            the real view
#   ./scripts/dev.sh run 'LEAKY=1 spikes/m14.1-owner-view/run.sh'  the negative control
#
# It starts its own SpacetimeDB on port 3100 with a throwaway data dir, so it never
# touches the dev database or the ports verify.sh uses (3000, 5173). Exit 0 means every
# probe passed; under LEAKY=1 the stranger probes are expected to FAIL.
#
# The record of what this showed is docs/decisions/0001-owner-only-reads.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PORT=3100
HTTP="http://127.0.0.1:$PORT"
DB=m14-owner-view
WORK="$(mktemp -d)"
FEATURES=""
[ "${LEAKY:-0}" = 1 ] && FEATURES="--features leaky"

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

log "publishing the spike module${FEATURES:+ ($FEATURES)}"
# `spacetime publish` has no feature flag, so the wasm is built here and handed over.
(cd "$HERE/module" && cargo build --quiet --release --target wasm32-unknown-unknown $FEATURES)
spacetime publish --server "$HTTP" --yes --delete-data=always \
  --bin-path "$HERE/module/target/wasm32-unknown-unknown/release/m14_1_owner_view_spike.wasm" \
  "$DB" >/dev/null

# --- HTTP: one-off SQL, the way a worker or a curious stranger would ask ------
failures=0
check() { # label, expected, actual
  if [ "$2" = "$3" ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  (wanted $2, got $3)"; failures=$((failures + 1)); fi
}
mint() { curl -sf -X POST "$HTTP/v1/identity"; }
OWNER="$(mint)" WORKER="$(mint)" STRANGER="$(mint)"
tok() { jq -r .token <<<"$1"; }
hex() { jq -r .identity <<<"$1"; }
call() { curl -sf -o /dev/null -X POST "$HTTP/v1/database/$DB/call/$2" \
  -H "Authorization: Bearer $(tok "$1")" -H 'Content-Type: application/json' -d "$3"; }
# Prints the body column of every row, comma-joined, or the HTTP status on refusal.
sql() {
  local out code
  out="$(curl -s -w '\n%{http_code}' -X POST "$HTTP/v1/database/$DB/sql" -H "Authorization: Bearer $(tok "$1")" -d "$2")"
  code="${out##*$'\n'}"
  if [ "$code" = 200 ]; then jq -r '[.[0].rows[] | .[-1]] | sort | join(",")' <<<"${out%$'\n'*}"; else echo "refused $code"; fi
}

log "HTTP probes"
call "$STRANGER" put '["stranger S"]'
call "$OWNER" put '["owner A"]'
check "stranger: raw SELECT on the private table" "refused 400" "$(sql "$STRANGER" 'SELECT * FROM vault')"
check "stranger: raw SELECT on the private grant table" "refused 400" "$(sql "$STRANGER" 'SELECT * FROM vault_grant')"
check "owner reads their row through the view" "owner A" "$(sql "$OWNER" 'SELECT * FROM my_vault')"
check "ungranted worker reads nothing" "" "$(sql "$WORKER" 'SELECT * FROM my_vault')"
call "$OWNER" grant "[\"$(hex "$WORKER")\"]"
check "granted worker reads the owner's row" "owner A" "$(sql "$WORKER" 'SELECT * FROM my_vault')"
check "stranger reads only their own row" "stranger S" "$(sql "$STRANGER" 'SELECT * FROM my_vault')"
check "stranger cannot widen the view with WHERE" "" \
  "$(sql "$STRANGER" "SELECT * FROM my_vault WHERE owner = 0x$(hex "$OWNER")")"
call "$OWNER" revoke "[\"$(hex "$WORKER")\"]"
check "revoked worker reads nothing" "" "$(sql "$WORKER" 'SELECT * FROM my_vault')"

# The database's own owner is the identity that published it, i.e. the operator.
# Recorded as a fact about who can read, not as a pass/fail on the design.
log "the database owner's view of the private table"
spacetime sql --server "$HTTP" "$DB" 'SELECT body FROM vault' 2>/dev/null

# --- WebSocket: the subscription path a viewer's browser takes ---------------
log "subscription probes"
# A clean database, so the subscription probes start from no rows at all.
spacetime publish --server "$HTTP" --yes --delete-data=always \
  --bin-path "$HERE/module/target/wasm32-unknown-unknown/release/m14_1_owner_view_spike.wasm" \
  "$DB" >/dev/null
rm -rf "$HERE/.bindings"
(cd "$HERE/module" && spacetime generate --lang typescript --out-dir ../.bindings --module-path . >/dev/null 2>&1)
ln -sfn "$REPO/client/node_modules" "$HERE/node_modules"
sub=0
(cd "$HERE" && SPIKE_URI="ws://127.0.0.1:$PORT" SPIKE_DB="$DB" ./node_modules/.bin/tsx subscribe.ts) 2>&1 |
  grep -v 'Connecting to SpacetimeDB' || sub=$?

if [ "$failures" -eq 0 ] && [ "$sub" -eq 0 ]; then
  echo "SPIKE: every probe passed"
else
  echo "SPIKE: $failures HTTP probe(s) failed; subscription probes exit $sub"
  exit 1
fi
