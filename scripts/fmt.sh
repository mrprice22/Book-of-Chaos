#!/usr/bin/env bash
# Format everything. Run before committing.
#
# Formatting is deliberately NOT a per-edit hook: each run enters the dev container,
# which is slow, and an async formatter rewriting a file mid-edit races with the next
# edit. Instead the autopilot runs this once before committing, and verify.sh enforces
# `--check` so an unformatted commit cannot pass the gate.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

BOOTSTRAP='[ -s "$HOME/.boc-env" ] && . "$HOME/.boc-env";'

run() {
  if [ -f /run/.containerenv ] || [ -f /.dockerenv ] || [ -n "${CI:-}" ]; then
    bash -c "$BOOTSTRAP cd '$REPO' && $*"
  else
    "$REPO/scripts/dev.sh" run "$*"
  fi
}

# `if`, not `test && run`: under `set -e` a bare failing && list aborts the script,
# so once server/ existed but client/ did not, this would have exited 1 without
# formatting anything further.
if [ -f server/Cargo.toml ]; then
  run "cd server && cargo fmt --all"
fi

if [ -f client/package.json ]; then
  run "cd client && npx prettier --write 'src/**/*.{ts,tsx,css}' --log-level warn"
  # scripts/*.ts run on the client's toolchain but live outside it; prettier is
  # invoked from client/ because that is where the config and the binary are.
  if compgen -G "scripts/*.ts" >/dev/null; then
    run "cd client && npx prettier --write '../scripts/*.ts' --log-level warn"
  fi
fi

exit 0
