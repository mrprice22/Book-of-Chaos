#!/usr/bin/env bash
# Flag a commit range that changes the scope contract.
#
#   ./scripts/scope-guard.sh <base> <head>
#
# Always exits 0. This annotates rather than gates: moving the scope boundary is a
# legitimate act, and the point is that it be a *noticed* one. A failing check would
# only teach people to bypass it.
#
# The logic lives here rather than inline in ci.yml so that it can be run against a
# real commit range before it is pushed. It was previously eight lines of YAML inside
# a job that had never executed once — gated on `pull_request` in a repo that works
# directly on main — and the way that stayed invisible for fourteen runs is that
# nothing could exercise it locally. See docs/backlog.md.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

if [ $# -ne 2 ]; then
  echo "usage: $0 <base> <head>" >&2
  exit 0
fi

base="$1"
head="$2"
ZERO_SHA=0000000000000000000000000000000000000000

# The head has to be checked as well as the base. An unresolvable head makes the diff
# below fail, and a failed diff produces an empty file list, which reads as "no scope
# contract changed" — an affirmative all-clear from a guard that looked at nothing.
# That is the same silent inertness this script was extracted to end, arriving by a
# different door, so it is refused loudly instead.
if ! git cat-file -e "${head}^{commit}" 2>/dev/null; then
  echo "scope-guard: head '$head' is not a commit in this clone — NO comparison made" >&2
  exit 0
fi

# A push event reports `before` as the zero sha for a branch's first push, and as a
# commit this clone may not have after a force-push. Either way the previous commit
# is the honest comparison, and silently diffing against nothing would report "no
# scope change" for a push that changed everything.
if [ "$base" = "$ZERO_SHA" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  if git rev-parse --verify --quiet "${head}^" >/dev/null; then
    echo "scope-guard: base '$base' unusable, comparing against ${head}^"
    base="${head}^"
  else
    echo "scope-guard: no usable base for '$head' — nothing to compare"
    exit 0
  fi
fi

# Taken separately from the grep so that a failing diff is distinguishable from a diff
# that matched nothing. Piped straight into `grep ... || true`, the two are the same
# empty string.
if ! diff_out="$(git diff --name-only "$base" "$head" 2>&1)"; then
  echo "scope-guard: could not diff ${base}..${head} — NO comparison made" >&2
  printf '  %s\n' "$diff_out" >&2
  exit 0
fi

# Matches any scope contract, not one named release. Pinning this to mvp-scope.md
# meant it silently stopped guarding anything the moment v0.2-scope.md became
# authoritative.
changed="$(printf '%s\n' "$diff_out" \
  | grep -E '^docs/(mvp|v[0-9]+\.[0-9]+)-scope\.md$' || true)"

if [ -z "$changed" ]; then
  echo "scope-guard: no scope contract changed in ${base}..${head}"
  exit 0
fi

for file in $changed; do
  echo "::warning file=${file}::scope contract changed — confirm the boundary moved deliberately."
done
echo "scope-guard: scope contract changed in ${base}..${head}:"
printf '  %s\n' $changed
