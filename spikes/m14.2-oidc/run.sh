#!/usr/bin/env bash
# Reproduce the M14.2 spike end to end. Run it inside the dev container:
#
#   ./scripts/dev.sh run spikes/m14.2-oidc/run.sh                 the real module
#   ./scripts/dev.sh run 'TRUST_ANY=1 spikes/m14.2-oidc/run.sh'   the negative control
#
# It starts its own SpacetimeDB on port 3100 with a throwaway data dir, and two mock
# OIDC issuers: the trusted one on 3200, and on 3201 a second, perfectly valid issuer
# that the module has not chosen to trust. Exit 0 means every probe passed; under
# TRUST_ANY=1 the untrusted-issuer probes are expected to FAIL.
#
# The record of what this showed is docs/decisions/0002-durable-sign-in.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PORT=3100
HTTP="http://127.0.0.1:$PORT"
DB=oidc-spike
TRUSTED="http://127.0.0.1:3200"
UNTRUSTED="http://127.0.0.1:3201"
AUD=boc-spike
WORK="$(mktemp -d)"
FEATURES=""
[ "${TRUST_ANY:-0}" = 1 ] && FEATURES="--features trust_any"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }

cleanup() {
  fuser -k -TERM "$PORT/tcp" 3200/tcp 3201/tcp >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

for p in "$PORT" 3200 3201; do
  if curl -s -o /dev/null "http://127.0.0.1:$p/" 2>/dev/null; then
    echo "port $p is already in use; stop whatever holds it first" >&2
    exit 2
  fi
done

log "starting a scratch SpacetimeDB on $PORT and mock issuers on 3200, 3201"
spacetime start --listen-addr "127.0.0.1:$PORT" --data-dir "$WORK/data" >"$WORK/stdb.log" 2>&1 &
node "$HERE/issuer.mjs" 3200 >"$WORK/issuer-3200.log" 2>&1 &
node "$HERE/issuer.mjs" 3201 >"$WORK/issuer-3201.log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "$HTTP/v1/ping" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "$HTTP/v1/ping" >/dev/null || { tail -30 "$WORK/stdb.log" >&2; exit 2; }

log "publishing the spike module"
# `spacetime publish` has no feature flag, so the wasm is built here and handed over.
(cd "$HERE/module" && cargo build --quiet --release --target wasm32-unknown-unknown $FEATURES)
spacetime publish --server "$HTTP" --yes --delete-data=always \
  --bin-path "$HERE/module/target/wasm32-unknown-unknown/release/m14_2_oidc_spike.wasm" "$DB" >/dev/null 2>&1

failures=0
check() { # label, expected, actual
  if [ "$2" = "$3" ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  (wanted $2, got $3)"; failures=$((failures + 1)); fi
}
differ() { # label, a, b
  if [ "$2" != "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1  (both $2)"; failures=$((failures + 1)); fi
}
mint() { curl -sf "$1/mint?sub=$2&aud=${3:-$AUD}${4:-}"; }
anon() { curl -sf -X POST "$HTTP/v1/identity" | jq -r .token; }
# Prints the HTTP status, plus the module's message when it refused.
call() {
  local out code
  out="$(curl -s -w '\n%{http_code}' -X POST "$HTTP/v1/database/$DB/call/$2" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3")"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  [ "$body" = "$out" ] && body=""
  if [ -n "$body" ]; then printf '%s %s' "$code" "${body:0:160}"; else printf '%s' "$code"; fi
}
# SpacetimeDB answers a reducer that returned Err with HTTP 530, and a token it will
# not accept with 401. The two are kept apart: a 530 means the module said no.
REFUSED=530
sql() { curl -s -X POST "$HTTP/v1/database/$DB/sql" -H "Authorization: Bearer $1" -d "$2" | jq -r "$3"; }
# The identity and verdict whoami recorded under a label.
seen() { sql "$ANY" "SELECT * FROM seen WHERE label = '$1'" ".[0].rows[0] | $2"; }
ANY="$(anon)"

log "identity probes"
call "$(mint "$TRUSTED" alice)" whoami '["alice-1"]' >/dev/null
# A second token for the same person, minted fresh: what a browser with cleared
# storage gets when it signs in again. Nothing is carried over from the first.
call "$(mint "$TRUSTED" alice)" whoami '["alice-2"]' >/dev/null
call "$(mint "$TRUSTED" bob)" whoami '["bob"]' >/dev/null
call "$(mint "$UNTRUSTED" alice)" whoami '["alice-untrusted"]' >/dev/null
call "$(mint "$TRUSTED" alice other-client)" whoami '["alice-wrong-aud"]' >/dev/null
call "$ANY" whoami '["anonymous"]' >/dev/null

ALICE="$(seen alice-1 '.[2][0]')"
check "the same sub on a fresh token is the same identity" "$ALICE" "$(seen alice-2 '.[2][0]')"
differ "a different sub is a different identity" "$ALICE" "$(seen bob '.[2][0]')"
differ "the same sub at another issuer is a different identity" "$ALICE" "$(seen alice-untrusted '.[2][0]')"
check "the module sees the trusted caller as signed in" "true" "$(seen alice-1 '.[7]')"
check "the server accepts a valid token from an issuer nobody chose" "true" "$(seen alice-untrusted '.[3]')"
check "...so the module must refuse it itself, and does" "false" "$(seen alice-untrusted '.[7]')"
check "a token for another client id is not signed in" "false" "$(seen alice-wrong-aud '.[7]')"
echo "      the anonymous token's issuer is: $(seen anonymous '.[4]')"
check "a token signed by a key outside the JWKS is refused by the server" "401" \
  "$(call "$(mint "$TRUSTED" alice "$AUD" '&forge=1')" whoami '["forged"]' | cut -c1-3)"
# Two expiries: one inside the leeway a JWT validator commonly allows, and one well
# outside it, so a pass cannot be an accident of where the boundary sits.
echo "      a token expired 30s ago gets: $(call "$(mint "$TRUSTED" alice "$AUD" '&exp=-30')" whoami '["expired-30s"]' | cut -c1-3)"
check "a token expired 10 minutes ago is refused by the server" "401" \
  "$(call "$(mint "$TRUSTED" alice "$AUD" '&exp=-600')" whoami '["expired"]' | cut -c1-3)"

log "browser path: a WebSocket opened with the ID token"
rm -rf "$HERE/.bindings"
(cd "$HERE/module" && spacetime generate --lang typescript --out-dir ../.bindings --module-path . >/dev/null 2>&1)
ln -sfn "$REPO/client/node_modules" "$HERE/node_modules"
ws() { (cd "$HERE" && SPIKE_URI="ws://127.0.0.1:$PORT" SPIKE_DB="$DB" ./node_modules/.bin/tsx ws.ts "$1" 2>/dev/null | tail -1); }
check "the WebSocket identity for alice matches the HTTP one" "${ALICE#0x}" "$(ws "$(mint "$TRUSTED" alice)")"
check "the WebSocket refuses a forged token" "refused" "$(ws "$(mint "$TRUSTED" alice "$AUD" '&forge=1')" | cut -c1-7)"

log "carry-over probes: an anonymous user's username moves to the signed-in identity"
OLD="$(anon)"
STRANGER="$(anon)"
NEW="$(mint "$TRUSTED" carol)"
call "$OLD" claim_username '["ada"]' >/dev/null
check "a signed-in caller cannot begin a link" "$REFUSED" "$(call "$NEW" begin_link '[]' | cut -c1-3)"
check "an identity with no username cannot begin a link" "$REFUSED" "$(call "$STRANGER" begin_link '[]' | cut -c1-3)"
check "the owner of the username begins a link" "200" "$(call "$OLD" begin_link '[]')"
CODE="$(sql "$OLD" 'SELECT * FROM my_link_code' '.[0].rows[0][0] // ""')"
differ "the old identity can read its link code" "" "$CODE"
check "nobody else can read it" "" "$(sql "$STRANGER" 'SELECT * FROM my_link_code' '.[0].rows[0][0] // ""')"
check "an anonymous caller cannot complete a link" "$REFUSED" "$(call "$STRANGER" complete_link "[\"$CODE\"]" | cut -c1-3)"
check "an untrusted issuer's caller cannot complete a link" "$REFUSED" \
  "$(call "$(mint "$UNTRUSTED" carol)" complete_link "[\"$CODE\"]" | cut -c1-3)"
check "a wrong code is refused" "$REFUSED" "$(call "$NEW" complete_link '["0000"]' | cut -c1-3)"
check "the signed-in identity completes the link" "200" "$(call "$NEW" complete_link "[\"$CODE\"]")"
CAROL="$(sql "$ANY" "SELECT * FROM users WHERE username = 'ada'" '.[0].rows[0][0][0]')"
call "$NEW" whoami '["carol"]' >/dev/null
check "the username now belongs to the signed-in identity" "$(seen carol '.[2][0]')" "$CAROL"
call "$OLD" whoami '["old"]' >/dev/null
check "the anonymous identity no longer has a users row" "0" \
  "$(sql "$ANY" 'SELECT * FROM users' "[.[0].rows[] | select(.[0][0] == \"$(seen old '.[2][0]')\")] | length")"
check "the same code cannot be used twice" "$REFUSED" "$(call "$(mint "$TRUSTED" dave)" complete_link "[\"$CODE\"]" | cut -c1-3)"
check "carol, signed in again on a fresh token, is still ada" "ada" \
  "$(sql "$(mint "$TRUSTED" carol)" "SELECT * FROM users WHERE username = 'ada'" '.[0].rows[0][1]')"

if [ "$failures" -eq 0 ]; then
  echo "SPIKE: every probe passed"
else
  echo "SPIKE: $failures probe(s) failed"
  exit 1
fi
