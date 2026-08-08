#!/usr/bin/env bash
# Is the toolchain the one this repo pins?
#
# Run as the first stage of verify.sh, so an environment fault fails at stage 1 naming
# the tool, instead of at stage 12 as a symptom. That is not hypothetical: a cached
# SpacetimeDB that could not run once surfaced as "SpacetimeDB exited during startup",
# and a cached database owned by a different identity surfaced as "webServer was not
# able to start" — both four or more stages from their cause.
#
# Every check runs the tool and reads the version it reports. `command -v` is not
# enough and has already been the bug twice: it was satisfied by a launcher whose
# binaries were missing. Presence is not capability.
#
# A mismatch is a FAIL, never a warning. A toolchain that is merely close is how a
# green CI run and a green local run stop meaning the same thing.
set -uo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/toolchain-versions.sh"

PROBLEMS=()

# check <tool> <expected> <command...>
#   Runs the command, compares its output to <expected>, records a failure otherwise.
#   Records "not runnable" separately from "wrong version": the fixes differ.
check() {
  local tool="$1" expected="$2"; shift 2
  local actual
  if ! actual="$("$@" 2>/dev/null)"; then
    PROBLEMS+=("$tool: not runnable (expected $expected) — is it installed?")
    return
  fi
  if [ -z "$actual" ]; then
    PROBLEMS+=("$tool: ran but reported no version (expected $expected)")
    return
  fi
  if [ "$actual" != "$expected" ]; then
    PROBLEMS+=("$tool: pinned $expected, found $actual")
  fi
}

rustc_version()     { rustc --version | awk '{print $2}'; }
# Only the major is pinned, so only the major is compared — see NODE_MAJOR.
node_major()        { node --version | sed 's/^v\([0-9]*\).*/\1/'; }
spacetime_version() { spacetime --version | sed -n 's/.*tool version \([0-9.]*\);.*/\1/p'; }
wasm_opt_version()  { wasm-opt --version | awk '{print $3}'; }

check "rustc"     "$RUST_TOOLCHAIN"      rustc_version
check "node"      "$NODE_MAJOR"          node_major
check "spacetime" "$SPACETIMEDB_VERSION" spacetime_version
check "wasm-opt"  "$BINARYEN_VERSION"    wasm_opt_version

if [ ${#PROBLEMS[@]} -eq 0 ]; then
  exit 0
fi

printf 'toolchain does not match scripts/toolchain-versions.sh:\n' >&2
printf '  - %s\n' "${PROBLEMS[@]}" >&2
printf '\nfix: ./scripts/dev.sh setup   (CI: bash scripts/install-toolchain.sh)\n' >&2
exit 1
