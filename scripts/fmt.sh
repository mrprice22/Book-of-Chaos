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

[ -f server/Cargo.toml ]    && run "cd server && cargo fmt --all"
[ -f client/package.json ]  && run "cd client && npx prettier --write 'src/**/*.{ts,tsx,css}' --log-level warn"

exit 0
