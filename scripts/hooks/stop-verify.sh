#!/usr/bin/env bash
# Stop hook: refuse to end a turn on a red build.
#
# Runs the verify gate when Claude tries to stop. If the gate is red, exit 2 —
# asyncRewake wakes Claude back up with the failure output so it fixes the break
# instead of leaving it for the human. That single behaviour is most of what makes
# the autopilot autonomous.
#
# Guard rail: after MAX_REWAKES consecutive red stops, the loop gives up and reports
# to the human instead. An agent that cannot fix a break in three tries is not going
# to fix it on the fourth, and an uncapped loop burns tokens all night.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$REPO/.git/boc-autopilot"   # inside .git: never committed, never cleaned
COUNT_FILE="$STATE_DIR/rewake-count"
MAX_REWAKES=3

mkdir -p "$STATE_DIR"

# Nothing to verify before the gate itself exists.
[ -x "$REPO/scripts/verify.sh" ] || exit 0

output="$("$REPO/scripts/verify.sh" 2>&1)"
status=$?

if [ $status -eq 0 ]; then
  rm -f "$COUNT_FILE"
  exit 0
fi

count=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$COUNT_FILE"

if [ "$count" -gt "$MAX_REWAKES" ]; then
  rm -f "$COUNT_FILE"
  summary=$(printf '%s' "$output" | grep -E '^\s*(FAIL|VERIFY)' | tr '\n' ' ')
  printf '{"systemMessage":"Autopilot paused: verify.sh still red after %d attempts. %s Needs a human — see docs/blocked.md."}\n' \
    "$MAX_REWAKES" "$(printf '%s' "$summary" | sed 's/"/\\"/g')"
  exit 0
fi

printf 'verify.sh is RED (attempt %d of %d). Fix it before stopping.\n\n%s\n' \
  "$count" "$MAX_REWAKES" "$output"
exit 2
