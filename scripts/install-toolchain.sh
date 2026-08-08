#!/usr/bin/env bash
# Installs Rust, Node, and the SpacetimeDB CLI into $HOME.
#
# Runs INSIDE the dev container (or inside CI, where $HOME is the runner's home).
# Idempotent: safe to re-run after a version bump in scripts/dev.sh.
set -euo pipefail

# shellcheck source=./toolchain-versions.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/toolchain-versions.sh"

log() { printf '\033[1;34m  ->\033[0m %s\n' "$*" >&2; }

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.nvm/versions/node/current/bin:$PATH"

# --- Rust -------------------------------------------------------------------
if ! command -v rustup >/dev/null 2>&1; then
  log "installing rustup ($RUST_TOOLCHAIN)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain "$RUST_TOOLCHAIN" --profile minimal
fi
. "$HOME/.cargo/env"
rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --component rustfmt,clippy
rustup default "$RUST_TOOLCHAIN"
# SpacetimeDB modules compile to wasm.
rustup target add wasm32-unknown-unknown

# --- Node -------------------------------------------------------------------
# nvm rather than dnf: the pinned major must match CI exactly, and dnf's nodejs
# tracks whatever Fedora ships.
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "installing nvm"
  # The installer aborts if NVM_DIR is set but absent, and it git-clones into the
  # directory, so it must exist and be empty rather than merely be named.
  mkdir -p "$NVM_DIR"
  curl -sSf -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_MAJOR"
nvm alias default "$NODE_MAJOR"

# --- SpacetimeDB ------------------------------------------------------------
# Tested by running it, not by `command -v`. The installer writes a small launcher to
# ~/.local/bin/spacetime and the versioned binaries it execs to
# ~/.local/share/spacetime/bin/. Those are two directories, so anything that restores
# one without the other — a CI cache listing only ~/.local/bin, say — leaves a
# spacetime on PATH that cannot run. `command -v` is satisfied by the launcher alone,
# so the install was skipped and the break surfaced much later as "SpacetimeDB exited
# during startup", with the real error four stages away from its cause.
if ! spacetime --version >/dev/null 2>&1; then
  log "installing SpacetimeDB CLI"
  curl -sSf https://install.spacetimedb.com | sh -s -- --yes
fi

# --- binaryen / wasm-opt ----------------------------------------------------
# `spacetime publish` optimises the module with wasm-opt when it can find one, and
# ships an unoptimised wasm with a warning when it cannot.
#
# Installed from the upstream tarball for the same reason the SpacetimeDB CLI is:
# CI runs this script on a bare runner and never builds the Containerfile, so a dnf
# package would exist locally and not in CI. Two build environments producing
# differently-optimised artifacts is exactly what toolchain-versions.sh exists to
# stop.
#
# Guarded by running the binary, not by `command -v` — the lesson from the cached
# SpacetimeDB launcher above, and doubly relevant here because wasm-opt is a symlink
# into ~/.local/share/binaryen. Restoring one path without the other leaves a
# symlink that resolves to nothing.
BINARYEN_HOME="$HOME/.local/share/binaryen"
if [ "$(wasm-opt --version 2>/dev/null | awk '{print $3}')" != "$BINARYEN_VERSION" ]; then
  case "$(uname -m)" in
    x86_64)  binaryen_arch="x86_64" ;;
    aarch64) binaryen_arch="aarch64" ;;
    *)       binaryen_arch="" ;;
  esac

  if [ -z "$binaryen_arch" ]; then
    # Not fatal: an unoptimised module still runs. Loud, because the alternative is
    # wondering later why one machine's wasm is bigger than another's.
    log "no binaryen build for $(uname -m) — wasm-opt unavailable, modules ship unoptimised"
  else
    log "installing binaryen $BINARYEN_VERSION ($binaryen_arch)"
    binaryen_tar="binaryen-version_${BINARYEN_VERSION}-${binaryen_arch}-linux.tar.gz"
    binaryen_url="https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/${binaryen_tar}"
    binaryen_tmp="$(mktemp -d)"

    curl -sSfL -o "$binaryen_tmp/$binaryen_tar" "$binaryen_url"
    curl -sSfL -o "$binaryen_tmp/$binaryen_tar.sha256" "$binaryen_url.sha256"
    # Upstream publishes a checksum, so not checking it would be a choice.
    (cd "$binaryen_tmp" && sha256sum -c "$binaryen_tar.sha256" >/dev/null)

    rm -rf "$BINARYEN_HOME"
    mkdir -p "$BINARYEN_HOME" "$HOME/.local/bin"
    tar -xzf "$binaryen_tmp/$binaryen_tar" -C "$BINARYEN_HOME" --strip-components=1
    rm -rf "$binaryen_tmp"

    # Symlink rather than copy: wasm-opt resolves libbinaryen through an $ORIGIN
    # rpath, so it has to keep seeing ../lib next to its real location.
    ln -sf "$BINARYEN_HOME/bin/wasm-opt" "$HOME/.local/bin/wasm-opt"
  fi
fi

# --- Playwright browser dependencies ----------------------------------------
# The browser binary itself is installed by the client (`npx playwright install
# chromium`, cached in ~/.cache/ms-playwright). What cannot come from npm is the set
# of shared libraries chrome-headless-shell links against — without them it exits
# immediately with "libnspr4.so: cannot open shared object file".
#
# `playwright install --with-deps` only knows apt, so Fedora is handled by name here.
if command -v dnf >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
  log "installing browser runtime libraries (dnf)"
  sudo dnf -y install --setopt=install_weak_deps=False \
    nspr nss nss-util atk at-spi2-atk at-spi2-core cups-libs libdrm \
    libxkbcommon libXcomposite libXdamage libXfixes libXrandr libXext libXi \
    mesa-libgbm pango cairo alsa-lib libxshmfence >/dev/null
fi

# --- Shell wiring -----------------------------------------------------------
# Explicit env file rather than login-shell semantics. Sourcing ~/.bashrc from a
# non-interactive shell is unreliable (Ubuntu's early-returns when not interactive,
# and a fresh distrobox home may have no ~/.bash_profile at all), so every scripted
# entry point sources this file by name instead of hoping.
log "writing ~/.boc-env"
cat > "$HOME/.boc-env" <<'EOF'
# Generated by scripts/install-toolchain.sh — sourced by dev.sh, verify.sh, fmt.sh.
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
fi
EOF

# Convenience only, for `./scripts/dev.sh shell`.
MARKER='# >>> book-of-chaos toolchain >>>'
if ! grep -qF "$MARKER" "$HOME/.bashrc" 2>/dev/null; then
  log "wiring ~/.boc-env into ~/.bashrc"
  cat >> "$HOME/.bashrc" <<'EOF'

# >>> book-of-chaos toolchain >>>
[ -s "$HOME/.boc-env" ] && . "$HOME/.boc-env"
# <<< book-of-chaos toolchain <<<
EOF
fi

log "toolchain ready"
