#!/usr/bin/env bash
# Regenerate the client's SpacetimeDB TypeScript bindings from the server module.
#
# The output lands in client/src/module_bindings/ and is committed, so the client
# type-checks from a clean clone without a running database. Re-run this whenever a
# table or reducer signature changes, and commit the result with that change.
#
# Never hand-edit the output — see CLAUDE.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

OUT="client/src/module_bindings"

BOOTSTRAP='[ -s "$HOME/.boc-env" ] && . "$HOME/.boc-env";'
run() {
  if [ -f /run/.containerenv ] || [ -f /.dockerenv ] || [ -n "${CI:-}" ]; then
    bash -c "$BOOTSTRAP cd '$REPO' && $*"
  else
    "$REPO/scripts/dev.sh" run "$*"
  fi
}

# Stale files are not pruned by `spacetime generate`, so a renamed reducer would
# leave a binding behind that still compiles.
rm -rf "${REPO:?}/$OUT"

run "cd server && spacetime generate --lang typescript --out-dir '../$OUT' --module-path ."

echo "Bindings regenerated in $OUT — review and commit."
