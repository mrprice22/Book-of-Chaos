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
