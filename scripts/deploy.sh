#!/usr/bin/env bash
# Bring the whole thing up with one command.
#
#   ./scripts/deploy.sh local            SpacetimeDB + module + demo book + client
#   ./scripts/deploy.sh local --no-seed  skip the demo book
#   ./scripts/deploy.sh local --clear    wipe the database first
#
#   ./scripts/deploy.sh remote           publish the module to the hosted target
#   ./scripts/deploy.sh remote --seed    ...and seed the demo book (idempotent)
#
# `local` runs in the foreground: the client's dev server is the last thing started,
# and Ctrl-C tears down whatever this script started. A SpacetimeDB instance that was
# already running is left alone, because it is not ours to stop.
#
# `remote` starts nothing and serves nothing. It publishes the module to an existing
# hosted database and exits. The client is not its job — that is a static host, wired
# up separately (M13.3), and the two are deliberately decoupled so that redeploying
# the module does not imply redeploying the reader.
#
# The remote target and its database name come from the environment, never a
# hardcoded host:
#
#   SPACETIME_REMOTE_SERVER    spacetime server nickname   (default: maincloud)
#   SPACETIME_REMOTE_DB_NAME   database name               (default: book-of-chaos-83i7y)
#   SPACETIME_REMOTE_URI       websocket URI for seeding   (default: wss://maincloud.spacetimedb.com)
#
# The default name carries a suffix because Maincloud names are platform-wide and the
# bare `book-of-chaos` was taken. See the M13.1 entry in docs/blocked.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

DB_NAME="${SPACETIME_DB_NAME:-book-of-chaos}"
REMOTE_SERVER="${SPACETIME_REMOTE_SERVER:-maincloud}"
REMOTE_DB_NAME="${SPACETIME_REMOTE_DB_NAME:-book-of-chaos-83i7y}"
# Kept separate from REMOTE_SERVER rather than derived from it. The server nickname is
# a CLI-local alias and says nothing about the hostname — deriving one from the other
# happens to work for `maincloud` and silently produces a wrong URI for anything else.
REMOTE_URI="${SPACETIME_REMOTE_URI:-wss://maincloud.spacetimedb.com}"
STDB_PORT="${SPACETIME_PORT:-3000}"
STDB_HOST="http://localhost:$STDB_PORT"
CLIENT_PORT="${CLIENT_PORT:-5173}"
LOG_DIR="$REPO/.devhome/logs"
STDB_LOG="$LOG_DIR/spacetime.log"

# The database lives in the repo's gitignored .devhome, not under ~/.local/share.
#
# Not a tidiness preference. SpacetimeDB's default puts `data/` beside `bin/` in
# ~/.local/share/spacetime, and CI caches toolchain directories out of $HOME — so the
# cache picked up a *database* along with the toolchain, while the identity that owns
# it (~/.config/spacetime) was not cached. The next run restored someone else's
# database, minted a fresh identity, and publishing failed `403 Forbidden ... not
# authorized ... update database`, which surfaced four stages later as "webServer was
# not able to start". That cost two diagnoses across two sessions.
#
# Excluding the path from the cache list fixes that instance. Moving the state out of
# $HOME entirely fixes the class: nothing CI caches can reach it, so no future edit to
# a path list can put it back.
STDB_DATA_DIR="${SPACETIME_DATA_DIR:-$REPO/.devhome/spacetime-data}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# A startup failure has to explain itself on stderr, because pointing at a file only
# works for someone sitting at this machine. When this script is Playwright's
# webServer, all CI reports is "Process from config.webServer was not able to start.
# Exit code: 1" — the symptom and nothing else — and the job ends before anyone can
# open .devhome/logs/spacetime.log. That cost a diagnosis once already.
#
# 30 lines, not more: verify.sh prints only the last 40 of a failing stage, so a
# longer dump would push out the error that explains what was being attempted.
die_stdb() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  if [ -s "$STDB_LOG" ]; then
    printf '\n--- last 30 lines of %s ---\n' "${STDB_LOG#"$REPO"/}" >&2
    tail -30 "$STDB_LOG" >&2
  else
    printf '(%s is empty — SpacetimeDB produced no output at all)\n' \
      "${STDB_LOG#"$REPO"/}" >&2
  fi
  exit 1
}

TARGET="${1:-}"
case "$TARGET" in
  local | remote) shift ;;
  *) die "usage: $0 local [--no-seed] [--clear] | remote [--seed]" ;;
esac

SEED=1
CLEAR=0
REMOTE_SEED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-seed) [ "$TARGET" = local ] || die "--no-seed applies to local"; SEED=0 ;;
    --clear) [ "$TARGET" = local ] || die "--clear applies to local"; CLEAR=1 ;;
    --seed) [ "$TARGET" = remote ] || die "--seed applies to remote"; REMOTE_SEED=1 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

run() { "$REPO/scripts/dev.sh" run "$*"; }
run_quiet() { "$REPO/scripts/dev.sh" run "$*" >/dev/null 2>&1 || true; }

# --- Remote --------------------------------------------------------------------
#
# Returns before any of the local-server machinery below, because none of it
# applies: nothing is started, so nothing needs tearing down, and the EXIT trap is
# deliberately not installed yet.
if [ "$TARGET" = remote ]; then
  # `--yes` is required and is not a convenience. Publishing to a non-local server
  # prompts for confirmation on a TTY, and this script is also run from CI and from
  # background shells where there is no TTY to answer it — there the prompt does not
  # hang, it reads EOF and aborts with "Publish aborted by user", which reads like a
  # decision somebody made rather than a missing flag.
  #
  # Note what `--yes` here does *not* cover: it is not `--delete-data`, so an
  # existing hosted database keeps its rows. There is intentionally no remote
  # equivalent of `--clear`. Wiping a database that readers are using is not a thing
  # this script should make easy; do it deliberately with the CLI.
  log "publishing module to $REMOTE_SERVER as $REMOTE_DB_NAME"
  run "cd server && spacetime publish -s '$REMOTE_SERVER' --yes '$REMOTE_DB_NAME'"

  if [ "$REMOTE_SEED" = 1 ]; then
    # The seed is idempotent by early-return: it looks for the demo book by title and
    # does nothing if it is already there. It connects anonymously, so it does not own
    # a book a previous run created and could not edit one if it wanted to.
    log "seeding the demo book on $REMOTE_DB_NAME (idempotent)"
    run "cd client && SPACETIME_URI='$REMOTE_URI' SPACETIME_DB_NAME='$REMOTE_DB_NAME' npm run --silent seed"
  fi

  log "published. The client is deployed separately — see docs/testing-runbook.md."
  exit 0
fi

stdb_up() { curl -sf "$STDB_HOST/v1/ping" >/dev/null 2>&1; }

STARTED_STDB=0
STARTED_CLIENT=0

# Teardown has to go through the container, by pattern.
#
# Killing the local `dev.sh run` pid is not enough: it is a shell that fronts
# `distrobox enter` -> `podman exec`, and neither forwards a signal to the process on
# the far side. The first attempt at this left SpacetimeDB and Vite both running after
# the script had exited, which is worse than not cleaning up at all — the next run
# finds port 3000 busy and quietly reuses a server it did not start.
#
# Both servers are identified by the port they hold, not by a command pattern.
# distrobox shares the host PID namespace, so `pkill -f vite` inside the container
# also matches the shell running the pkill and every wrapper above it — including this
# script. `pkill -x` cannot help either: process names are truncated to 15 characters,
# so "spacetimedb-standalone" never matches. The port is unambiguous.
cleanup() {
  if [ "$STARTED_CLIENT" = 1 ]; then
    log "stopping the client"
    run_quiet "fuser -k -TERM $CLIENT_PORT/tcp"
  fi
  if [ "$STARTED_STDB" = 1 ]; then
    log "stopping SpacetimeDB"
    run_quiet "fuser -k -TERM $STDB_PORT/tcp"
  fi
}
trap cleanup EXIT
# Ctrl-C on a foreground dev command is how you stop it, not a failure.
#
# This relies on the signal reaching the whole foreground process group, which is what
# a terminal Ctrl-C does. Signalling only this pid would not work: bash defers trap
# handlers until the current foreground command returns, and that command is the
# client's dev server, which never returns on its own.
trap 'exit 0' INT TERM

# --- SpacetimeDB -------------------------------------------------------------
if stdb_up; then
  log "SpacetimeDB already running at $STDB_HOST — leaving it alone"
else
  mkdir -p "$LOG_DIR" "$STDB_DATA_DIR"
  log "starting SpacetimeDB (log: ${STDB_LOG#"$REPO"/}, data: ${STDB_DATA_DIR#"$REPO"/})"
  run "spacetime start --listen-addr 0.0.0.0:$STDB_PORT --data-dir '$STDB_DATA_DIR'" >"$STDB_LOG" 2>&1 &
  STDB_PID=$!
  STARTED_STDB=1

  for _ in $(seq 1 60); do
    stdb_up && break
    # A dead child means the server failed to start; the log says why.
    kill -0 "$STDB_PID" 2>/dev/null || die_stdb "SpacetimeDB exited during startup"
    sleep 1
  done
  stdb_up || die_stdb "SpacetimeDB did not come up within 60s"
fi

# --- Module ------------------------------------------------------------------
PUBLISH_FLAGS="--server local --yes"
# `--yes` with no value means "all", which covers the DESTROY confirmation that
# --delete-data=always would otherwise stop on.
[ "$CLEAR" = 1 ] && PUBLISH_FLAGS="$PUBLISH_FLAGS --delete-data=always"

log "publishing module as $DB_NAME"
run "cd server && spacetime publish $PUBLISH_FLAGS $DB_NAME"

# Bindings are committed, but a schema change with stale bindings produces a client
# that type-checks against a module that no longer exists. Regenerating here keeps
# the running pair consistent; `git status` afterwards is the diff to commit.
log "regenerating client bindings"
"$REPO/scripts/generate-bindings.sh" >/dev/null

# --- Demo content ------------------------------------------------------------
if [ "$SEED" = 1 ]; then
  log "seeding the demo book (idempotent)"
  run "cd client && npm run --silent seed"
fi

# --- Client ------------------------------------------------------------------
log "client on http://localhost:$CLIENT_PORT — Ctrl-C to stop everything"
STARTED_CLIENT=1
run "cd client && npm run --silent dev -- --port $CLIENT_PORT --strictPort"
