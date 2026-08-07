#!/usr/bin/env bash
# Dev container control surface.
#
# The host is immutable, so every build tool lives in a distrobox container named
# `boc-dev` with its home directory inside the repo at .devhome/ (gitignored). That
# keeps the host home clean and makes `./scripts/dev.sh reset` a genuine reset.
#
#   ./scripts/dev.sh setup        build image + create container + install toolchains
#   ./scripts/dev.sh run <cmd...> run a command inside the container
#   ./scripts/dev.sh shell        interactive shell inside the container
#   ./scripts/dev.sh doctor       report toolchain versions
#   ./scripts/dev.sh reset        destroy the container and .devhome/
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=boc-dev
IMAGE=localhost/boc-dev:latest
DEVHOME="$REPO/.devhome"

# Toolchain pins live in one file shared with CI. Bumping a version is a one-line
# change there plus a `./scripts/dev.sh setup` re-run — no image rebuild.
# shellcheck source=./toolchain-versions.sh
. "$REPO/scripts/toolchain-versions.sh"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# True when this script is already executing inside the dev container, in which case
# every `run` must execute directly rather than recursing into distrobox.
in_container() { [ -f /run/.containerenv ] || [ -f /.dockerenv ]; }

# True when the toolchain is reachable without a container: inside the dev container,
# or on a CI runner where install-toolchain.sh put it straight into $HOME.
#
# CI belongs here rather than in each caller. A GitHub runner is a VM, not a container,
# so in_container is false there and `run` would fall through to require_host_tools and
# die with "podman not found on host". verify.sh and generate-bindings.sh each carried
# their own copy of this test; deploy.sh did not, which is why the e2e stage was the
# only thing that failed in CI — Playwright starts the stack via `deploy.sh local`.
toolchain_is_local() { in_container || [ -n "${CI:-}" ]; }

require_host_tools() {
  command -v podman >/dev/null 2>&1 || die "podman not found on host"
  command -v distrobox >/dev/null 2>&1 || die "distrobox not found on host"
}

container_exists() { podman container exists "$CONTAINER" 2>/dev/null; }

cmd_setup() {
  require_host_tools
  mkdir -p "$DEVHOME"

  log "building $IMAGE"
  podman build -t "$IMAGE" -f "$REPO/Containerfile" "$REPO"

  if container_exists; then
    log "container $CONTAINER already exists"
  else
    log "creating container $CONTAINER (home: $DEVHOME)"
    distrobox create \
      --name "$CONTAINER" \
      --image "$IMAGE" \
      --home "$DEVHOME" \
      --yes \
      --additional-flags "--volume $REPO:$REPO"
  fi

  log "installing toolchains (idempotent)"
  cmd_run "RUST_TOOLCHAIN=$RUST_TOOLCHAIN NODE_MAJOR=$NODE_MAJOR bash $REPO/scripts/install-toolchain.sh"

  log "setup complete"
  cmd_doctor
}

# Sourcing ~/.boc-env by name instead of relying on login-shell startup files: a
# fresh distrobox home has no ~/.bash_profile, so `bash -lc` would not pick up PATH.
BOOTSTRAP='[ -s "$HOME/.boc-env" ] && . "$HOME/.boc-env";'

cmd_run() {
  [ $# -gt 0 ] || die "run needs a command"
  if toolchain_is_local; then
    bash -c "$BOOTSTRAP cd '$REPO' && $*"
  else
    require_host_tools
    container_exists || die "container $CONTAINER missing — run: ./scripts/dev.sh setup"
    distrobox enter --name "$CONTAINER" -- bash -c "$BOOTSTRAP cd '$REPO' && $*"
  fi
}

cmd_shell() {
  require_host_tools
  container_exists || die "container $CONTAINER missing — run: ./scripts/dev.sh setup"
  distrobox enter --name "$CONTAINER"
}

cmd_doctor() {
  cmd_run 'for t in rustc cargo node npm spacetime; do
             printf "%-10s " "$t"
             command -v "$t" >/dev/null 2>&1 && "$t" --version 2>&1 | head -1 || echo "MISSING"
           done'
}

cmd_reset() {
  require_host_tools
  log "destroying container $CONTAINER and $DEVHOME"
  distrobox rm --force "$CONTAINER" 2>/dev/null || true
  rm -rf "$DEVHOME"
}

case "${1:-}" in
  setup)  shift; cmd_setup "$@" ;;
  run)    shift; cmd_run "$@" ;;
  shell)  shift; cmd_shell "$@" ;;
  doctor) shift; cmd_doctor "$@" ;;
  reset)  shift; cmd_reset "$@" ;;
  *) die "usage: $0 {setup|run <cmd>|shell|doctor|reset}" ;;
esac
