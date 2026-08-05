#!/usr/bin/env bash
# SessionStart hook: orient a fresh session in one line each.
#
# Cheap by design — no container, no build. It answers "where was I?" so a new
# session does not have to re-derive it from the backlog.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKLOG="$REPO/docs/backlog.md"
BLOCKED="$REPO/docs/blocked.md"

lines=()

# Note: checkbox markers are escaped in every glob/regex below. Unescaped, `[ ]` is a
# one-character glob class, so `${line#- [ ] }` silently strips nothing.
strip_marker() { printf '%s' "${1#- \[?\] }"; }

if [ -f "$BACKLOG" ]; then
  # grep -c prints 0 and exits 1 when there are no matches, so `|| echo 0` would
  # append a second zero. `|| true` keeps the printed count and swallows the status.
  done_n=$(grep -cE '^- \[x\]' "$BACKLOG" 2>/dev/null || true)
  todo_n=$(grep -cE '^- \[ \]' "$BACKLOG" 2>/dev/null || true)
  in_progress=$(grep -m1 -E '^- \[~\]' "$BACKLOG" 2>/dev/null || true)
  next=$(grep -m1 -E '^- \[ \]' "$BACKLOG" 2>/dev/null || true)

  lines+=("Backlog: ${done_n:-0} done, ${todo_n:-0} remaining.")
  [ -n "$in_progress" ] && lines+=("IN PROGRESS: $(strip_marker "$in_progress")")
  [ -n "$next" ] && lines+=("NEXT: $(strip_marker "$next")")
fi

# Only entries under "## Open" count. A naive `grep '^### '` also matches the entry
# template, which lives inside a fenced code block earlier in the file.
if [ -f "$BLOCKED" ]; then
  open_count=$(awk '
    /^## Open/     { in_open = 1; next }
    /^## /         { in_open = 0 }
    in_open && /^### / { n++ }
    END            { print n + 0 }
  ' "$BLOCKED")
  [ "$open_count" -gt 0 ] && \
    lines+=("docs/blocked.md has $open_count open escalation(s) — read it before starting work.")
fi

if ! podman container exists boc-dev 2>/dev/null; then
  lines+=("Dev container 'boc-dev' is not created — run ./scripts/dev.sh setup first.")
fi

[ ${#lines[@]} -eq 0 ] && exit 0

ctx=$(printf '%s\n' "${lines[@]}")
jq -nc --arg c "$ctx" \
  '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}'
