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
# leave a binding behind that still compiles. The old directory therefore has to go
# — but it cannot simply be deleted first, because `deploy.sh` calls this while
# Playwright is starting, and Playwright imports `module_bindings` as it collects
# tests. Deleting in place leaves the directory missing for the several seconds
# `spacetime generate` takes, which reads as "Cannot find module ... imported from
# e2e/answer-key.spec.ts" in whichever stage loses the race.
#
# So: build the new tree beside the old one and swap at the end. The window where
# no directory exists shrinks from the length of a codegen run to the length of one
# `mv`.
STAGING="$OUT.new"
rm -rf "${REPO:?}/$STAGING" "${REPO:?}/$OUT.old"

run "cd server && spacetime generate --lang typescript --out-dir '../$STAGING' --module-path ."

if [ -d "${REPO:?}/$OUT" ]; then
  mv "${REPO:?}/$OUT" "${REPO:?}/$OUT.old"
fi
mv "${REPO:?}/$STAGING" "${REPO:?}/$OUT"
rm -rf "${REPO:?}/$OUT.old"

echo "Bindings regenerated in $OUT — review and commit."
