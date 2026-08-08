#!/usr/bin/env bash
# The toolchain pins. Single source of truth — sourced by dev.sh (local) and by
# install-toolchain.sh (which CI calls directly).
#
# These lived in two places until M1.1 and would have drifted the moment one was
# bumped: a green CI run and a green local run have to mean the same thing.
#
# Bumping a version here is the whole change; re-run ./scripts/dev.sh setup.

# 1.83 cannot build this project: spacetimedb 2.8's own manifest requires the
# edition2024 cargo feature, which stabilised in 1.85.
export RUST_TOOLCHAIN="${RUST_TOOLCHAIN:-1.97.1}"
export NODE_MAJOR="${NODE_MAJOR:-22}"

# The CLI that publishes the module, kept in step with the crate the module is built
# against — `spacetimedb = "2.8.*"` in server/Cargo.toml. Unpinned, the installer takes
# releases/latest, so two runs of the same commit could install different CLIs and only
# one of them need agree with the crate. A build should be a function of its inputs.
export SPACETIMEDB_VERSION="${SPACETIMEDB_VERSION:-2.8.0}"

# binaryen supplies wasm-opt, which `spacetime publish` uses to shrink the module.
# Pinned to an upstream release tarball rather than installed with dnf: dnf would put
# it in the Containerfile, where CI — a plain runner that never builds the image —
# could not see it, and local and CI would quietly optimise differently.
export BINARYEN_VERSION="${BINARYEN_VERSION:-131}"
