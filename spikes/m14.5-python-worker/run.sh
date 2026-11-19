#!/usr/bin/env bash
# Reproduce the M14.5 spike. Run it inside the dev container:
#
#   ./scripts/dev.sh run spikes/m14.5-python-worker/run.sh
#
# A scratch SpacetimeDB on port 3100 with a throwaway data dir. The Python worker runs
# as four separate processes: first run, second run, a run after the *database
# server* restarts on the same data dir, and a run with the token file deleted (the
# control: without the token, it must be a different identity). Exit 0 means every
# probe passed.
#
# The record of what this showed is docs/decisions/0005-python-worker.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=3100
HTTP="http://127.0.0.1:$PORT"
DB=m14-python-worker
WORK="$(mktemp -d)"
TOKEN="$WORK/worker.token"

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

start_stdb() {
  spacetime start --listen-addr "127.0.0.1:$PORT" --data-dir "$WORK/data" >>"$WORK/stdb.log" 2>&1 &
  for _ in $(seq 1 60); do curl -sf "$HTTP/v1/ping" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "$HTTP/v1/ping" >/dev/null || { tail -30 "$WORK/stdb.log" >&2; exit 2; }
}

log "starting a scratch SpacetimeDB on $PORT"
start_stdb
log "publishing the spike module"
(cd "$HERE/module" && spacetime publish -s "$HTTP" --yes "$DB" >/dev/null 2>&1)

failures=0
check() { # label, expected, actual
  if [ "$2" = "$3" ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  (wanted $2, got $3)"; failures=$((failures + 1)); fi
}
worker() { python3 -I "$HERE/worker.py" "$HTTP" "$DB" "$TOKEN" "$1"; }

log "run 1: no token yet"
R1="$(worker run-1)"
echo "      $R1"
log "run 2: a new process, the saved token"
R2="$(worker run-2)"
log "restarting the database server on the same data dir"
fuser -k -TERM "$PORT/tcp" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do curl -sf "$HTTP/v1/ping" >/dev/null 2>&1 || break; sleep 1; done
start_stdb
log "run 3: a new process after the server restart"
R3="$(worker run-3)"
log "run 4 (control): the token file deleted"
rm -f "$TOKEN"
R4="$(worker run-4)"

ID1="$(jq -r .server_recorded_identity <<<"$R1")"
check "run 1 minted a token" true "$(jq -r .minted_token <<<"$R1")"
check "the token file is owner-only" 600 "$(stat -c %a "$TOKEN")"
check "run 2 reused it" false "$(jq -r .minted_token <<<"$R2")"
check "run 2 is the same identity, as the server recorded it" "$ID1" "$(jq -r .server_recorded_identity <<<"$R2")"
check "run 3, after a server restart, is the same identity" "$ID1" "$(jq -r .server_recorded_identity <<<"$R3")"
check "the token's own claim agrees with the server" "${ID1#0x}" "$(jq -r .token_claims.hex_identity <<<"$R1")"
check "control: without the token it is a new identity" true \
  "$([ "$(jq -r .server_recorded_identity <<<"$R4")" != "$ID1" ] && echo true || echo false)"
check "a refused reducer reaches the worker as HTTP 530" 530 "$(jq -r .refuse.status <<<"$R1")"
check "...with the reducer's own message" "Workers must be authorized by the work's owner." \
  "$(jq -r .refuse.message <<<"$R1")"
echo "      token claims: $(jq -c .token_claims <<<"$R1")"

if [ "$failures" -eq 0 ]; then
  echo "SPIKE: every probe passed"
else
  echo "SPIKE: $failures probe(s) failed"
  exit 1
fi
