#!/usr/bin/env bash
# THE quality gate. One command, one verdict.
#
# Everything funnels through this script: the Claude Code Stop hook, CI, and you.
# There is deliberately no second way to ask "is the build green?" — if a check
# matters, it belongs here, and if it is here, nothing merges without it.
#
#   ./scripts/verify.sh          run every applicable stage
#   ./scripts/verify.sh --list   show stages and whether they would run
#
# Stage semantics:
#   RUN  — the stage applies and must pass
#   SKIP — the code it checks does not exist yet (expected during early milestones)
#   FAIL — the stage applies and did not pass
#
# A stage whose source exists but whose toolchain is missing is a FAIL, not a SKIP.
# Silently skipping real checks is how a green build starts lying.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Colour only for a human at a terminal. Hook output and CI logs get plain text, so
# `grep FAIL` works on them without fighting escape sequences.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[1;31m'; GREEN=$'\033[1;32m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GREEN=''; DIM=''; OFF=''
fi
LIST_ONLY=0
[ "${1:-}" = "--list" ] && LIST_ONLY=1

FAILED=(); RAN=0; SKIPPED=0

in_container() { [ -f /run/.containerenv ] || [ -f /.dockerenv ]; }

BOOTSTRAP='[ -s "$HOME/.boc-env" ] && . "$HOME/.boc-env";'

# Toolchain reachable? Either we are inside the dev container, or CI installed it
# directly, or the container exists on the host and dev.sh can enter it.
toolchain_ready() {
  if in_container || [ -n "${CI:-}" ]; then
    bash -c "$BOOTSTRAP command -v cargo >/dev/null 2>&1"
  else
    podman container exists boc-dev 2>/dev/null
  fi
}

# Execute inside whichever environment owns the toolchain.
tc() {
  if in_container || [ -n "${CI:-}" ]; then
    bash -c "$BOOTSTRAP cd '$REPO' && $*"
  else
    "$REPO/scripts/dev.sh" run "$*"
  fi
}

# stage <name> <guard-path> <command...>
#   guard-path missing        -> SKIP
#   guard-path present, no toolchain -> FAIL (loudly)
stage() {
  local name="$1" guard="$2"; shift 2
  local cmd="$*"

  if [ ! -e "$REPO/$guard" ]; then
    printf '%s  SKIP%s  %-22s %s(%s not present yet)%s\n' "$DIM" "$OFF" "$name" "$DIM" "$guard" "$OFF"
    SKIPPED=$((SKIPPED + 1)); return 0
  fi

  if [ "$LIST_ONLY" = 1 ]; then
    printf '   RUN   %-22s %s%s%s\n' "$name" "$DIM" "$cmd" "$OFF"; return 0
  fi

  if ! toolchain_ready; then
    printf '%s  FAIL%s  %-22s toolchain unavailable — run ./scripts/dev.sh setup\n' "$RED" "$OFF" "$name"
    FAILED+=("$name (no toolchain)"); return 0
  fi

  printf '   ....  %-22s\r' "$name"
  local out status
  out="$(tc "$cmd" 2>&1)"; status=$?
  RAN=$((RAN + 1))

  if [ $status -eq 0 ]; then
    printf '%s  PASS%s  %-22s\n' "$GREEN" "$OFF" "$name"
  else
    printf '%s  FAIL%s  %-22s\n' "$RED" "$OFF" "$name"
    printf '%s\n' "$out" | tail -40 | sed 's/^/         /'
    FAILED+=("$name")
  fi
}

# --- Stages that need no toolchain -----------------------------------------
if [ "$LIST_ONLY" = 0 ]; then
  syntax_bad=()
  while IFS= read -r f; do
    bash -n "$f" 2>/dev/null || syntax_bad+=("$f")
  done < <(find "$REPO/scripts" -name '*.sh' -type f 2>/dev/null)
  if [ ${#syntax_bad[@]} -eq 0 ]; then
    printf '%s  PASS%s  %-22s\n' "$GREEN" "$OFF" "shell-syntax"
  else
    printf '%s  FAIL%s  %-22s %s\n' "$RED" "$OFF" "shell-syntax" "${syntax_bad[*]}"
    FAILED+=("shell-syntax")
  fi
  RAN=$((RAN + 1))
fi

# --- Toolchain --------------------------------------------------------------
# First, so that "the environment is wrong" is reported as itself rather than as
# whichever later stage happens to trip over it. Guarded on the pins file, which
# always exists, so this stage can never SKIP.
stage "preflight"    "scripts/toolchain-versions.sh" "bash scripts/preflight.sh"

# --- Server (SpacetimeDB Rust module) --------------------------------------
stage "rust-fmt"     "server/Cargo.toml" "cd server && cargo fmt --all -- --check"
stage "rust-clippy"  "server/Cargo.toml" "cd server && cargo clippy --all-targets -- -D warnings"
stage "rust-test"    "server/Cargo.toml" "cd server && cargo test --all"
stage "rust-wasm"    "server/Cargo.toml" "cd server && cargo build --release --target wasm32-unknown-unknown"

# --- Client (Vite + React + TS) --------------------------------------------
stage "ts-typecheck"  "client/package.json" "cd client && npx tsc --noEmit"
stage "ts-lint"       "client/package.json" "cd client && npm run --silent lint"
stage "ts-test"       "client/package.json" "cd client && npm run --silent test -- --run"
stage "client-build"  "client/package.json" "cd client && npm run --silent build"

# --- Repo scripts written in TypeScript -------------------------------------
# scripts/seed.ts imports the generated bindings, so it is checked with the client's
# toolchain. ESLint cannot reach it (flat config refuses files outside its base path),
# so tsc is the gate here — which is what catches a binding that changed shape.
stage "seed-typecheck" "scripts/seed.ts" "cd client && npx tsc --noEmit -p tsconfig.seed.json"

# --- End to end -------------------------------------------------------------
# Two Playwright projects, two stages, so "authorization is broken" never arrives
# wearing a label that says "smoke". Each invocation brings the stack up itself
# (~25s); sharing one would mean one stage's failure could mask the other's.
stage "e2e-smoke"     "client/e2e/smoke.spec.ts" \
  "cd client && npm run --silent test:e2e -- --project=chromium"

# The only check that would notice a `rules::require_owner` call being deleted.
stage "auth-reject"   "client/e2e/auth-reject.spec.ts" \
  "cd client && npm run --silent test:e2e -- --project=auth-reject"

# The only check that would notice `public` being added to the quiz answer key —
# the one change that would quietly reduce v0.2 to v0.1 with extra steps.
stage "answer-key"    "client/e2e/answer-key.spec.ts" \
  "cd client && npm run --silent test:e2e -- --project=answer-key"

# --- Verdict ----------------------------------------------------------------
[ "$LIST_ONLY" = 1 ] && exit 0

echo
if [ ${#FAILED[@]} -eq 0 ]; then
  printf '%sVERIFY GREEN%s  %d ran, %d skipped\n' "$GREEN" "$OFF" "$RAN" "$SKIPPED"
  [ "$SKIPPED" -gt 0 ] && printf '%s(skips are expected until the matching milestone lands)%s\n' "$DIM" "$OFF"
  exit 0
fi

printf '%sVERIFY RED%s    %d failed: %s\n' "$RED" "$OFF" "${#FAILED[@]}" "${FAILED[*]}"
exit 1
