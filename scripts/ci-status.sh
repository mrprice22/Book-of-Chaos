#!/usr/bin/env bash
# What did CI actually do with what is actually pushed?
#
#   ./scripts/ci-status.sh            the pushed tip of main
#   ./scripts/ci-status.sh <sha|ref>  a specific commit
#
# Exit codes, because this is meant to be read by a script as well as a human:
#   0  a run completed successfully for that commit
#   1  a run completed and did not succeed
#   2  no run yet, still in progress, or the answer could not be obtained
#
# Exit 2 is deliberately not "assume fine". This repo has three recorded incidents
# of a stale claim being repeated as fact (see docs/blocked.md), and "I could not
# check" reported as green is exactly how that happens.
#
# No credentials: the Actions REST API is public for a public repo. Note that job
# *logs* are not — they answer `403 Must have admin rights to Repository` without a
# token — so the per-step conclusion below is the strongest evidence available here.
# Do not go looking for the log body again; it is not reachable anonymously.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[1;31m'; GREEN=$'\033[1;32m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GREEN=''; DIM=''; OFF=''
fi

for tool in git curl jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ci-status: $tool not found"; exit 2; }
done

# --- Which repository ---------------------------------------------------------
# Both remote forms have to work: `git@github.com:owner/repo.git` and
# `https://github.com/owner/repo.git`.
origin_url="$(git remote get-url origin 2>/dev/null)" || {
  echo "ci-status: no 'origin' remote"; exit 2; }
slug="$(printf '%s' "$origin_url" \
  | sed -E 's#^git@[^:]+:##; s#^https?://[^/]+/##; s#\.git$##')"
case "$slug" in
  */*) ;;
  *) echo "ci-status: cannot read owner/repo from '$origin_url'"; exit 2 ;;
esac

# --- Which commit -------------------------------------------------------------
# Default to what the server has, not to `HEAD` or `origin/main`. Local refs say
# what this machine believes; only ls-remote says what was actually pushed, and the
# gap between those two is the whole reason this script exists.
if [ $# -gt 0 ]; then
  sha="$(git rev-parse "$1" 2>/dev/null)" || { echo "ci-status: unknown ref '$1'"; exit 2; }
  source_of_sha="argument"
else
  sha="$(git ls-remote origin main 2>/dev/null | awk 'NR==1{print $1}')"
  if [ -z "$sha" ]; then
    echo "ci-status: could not reach origin — no verdict obtained"
    exit 2
  fi
  source_of_sha="origin/main"
fi

printf 'commit  %s %s(%s)%s\n' "$sha" "$DIM" "$source_of_sha" "$OFF"

# --- What the run said --------------------------------------------------------
api="https://api.github.com/repos/$slug"
runs="$(curl -sf "$api/actions/runs?head_sha=$sha&per_page=1" 2>/dev/null)" || {
  echo "ci-status: could not reach the GitHub API — no verdict obtained"; exit 2; }

count="$(printf '%s' "$runs" | jq -r '.total_count // 0')"
if [ "$count" = "0" ]; then
  printf '%sno run%s for that commit — it may not have been pushed, or CI has not started\n' \
    "$DIM" "$OFF"
  exit 2
fi

read -r number status conclusion jobs_url created < <(
  printf '%s' "$runs" | jq -r '
    .workflow_runs[0]
    | [(.run_number|tostring), .status, (.conclusion // "pending"), .jobs_url, .created_at]
    | @tsv' | tr '\t' ' '
)

printf 'run     #%s  %s  %s  %s%s%s\n' \
  "$number" "$status" "$conclusion" "$DIM" "$created" "$OFF"

# --- What each job said -------------------------------------------------------
# Printed per job because the cold/warm cache matrix is the point of M9.8: a cache
# is correct only if the verdict is the same with and without it, so "one job
# passed" is not the property being claimed.
jobs="$(curl -sf "$jobs_url" 2>/dev/null)" || jobs=''
if [ -n "$jobs" ]; then
  printf '%s' "$jobs" | jq -r '
    .jobs[]
    | "  " + .name + " -> " + (.conclusion // .status)
      + ( [ .steps[]? | select(.name == "Verify") | (.conclusion // .status) ]
          | if length > 0 then "   (Verify: " + .[0] + ")" else "" end )'
fi

if [ "$status" != "completed" ]; then
  printf '%srun is still %s — no final verdict yet%s\n' "$DIM" "$status" "$OFF"
  exit 2
fi

if [ "$conclusion" = "success" ]; then
  printf '%sCI GREEN%s   run #%s on %s\n' "$GREEN" "$OFF" "$number" "${sha:0:7}"
  exit 0
fi

printf '%sCI %s%s  run #%s on %s — https://github.com/%s/actions/runs/%s\n' \
  "$RED" "$(printf '%s' "$conclusion" | tr '[:lower:]' '[:upper:]')" "$OFF" \
  "$number" "${sha:0:7}" "$slug" \
  "$(printf '%s' "$runs" | jq -r '.workflow_runs[0].id')"
exit 1
