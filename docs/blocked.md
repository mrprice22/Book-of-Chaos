# Blocked — Autopilot Escalations

The autopilot writes here **instead of guessing** when it hits something only a human can
decide. Anything in this file is waiting on you.

Every entry must name the task, what was tried, and the specific decision needed. "It
didn't work" is not an entry.

## Template

```
### <task id> — <one-line summary>
**Date:** YYYY-MM-DD
**Tried:** what was attempted, and what happened
**Blocker:** the specific thing that cannot be resolved without a human
**Options:** the candidate paths, with a recommendation
**Needs:** the exact decision or credential required
```

## What counts as blocked

- A credential, account, or paid service is required (hosting, domain, API key)
- Two reasonable implementations differ in a way the user would care about, and
  [mvp-scope.md](./mvp-scope.md) does not settle it
- A task appears to require something [mvp-scope.md](./mvp-scope.md) explicitly defers
- The same stage of `verify.sh` has failed three times with genuinely different fixes attempted
- An upstream dependency is broken, unavailable, or has no working version

## What does NOT count as blocked

- A test is failing and the fix is legible → fix it
- An implementation choice with an obvious default → take the default, note it in the commit
- A design-doc feature is ambiguous but out of MVP scope → it is deferred, move on

---

## Open

### M8.4 — CI cannot be proven green without a push
**Date:** 2026-08-06
**Tried:** The workflow is written and its YAML parses; its step list is
checkout → cache toolchain → `scripts/install-toolchain.sh` → cache build artifacts →
`npm ci` → `playwright install --with-deps chromium` → `./scripts/verify.sh`. Locally
that same gate is green: 11 stages ran, 0 skipped, including the Playwright suite
against a real stack. What cannot be done here is observe an actual run.
**Blocker:** `git push` is deliberately human-gated (CLAUDE.md, and the autopilot
skill repeats it). No commit has left this machine, so no workflow has ever been
triggered, and "green on `main`" is a claim about GitHub that I cannot make.
**Options:**
1. *(recommended)* Push `main` and watch the run. If it is green, tick M8.4 and the
   autopilot can finish with M8.6.
2. Push to a branch and open a PR first — the same `verify` job runs on
   `pull_request`, and the `scope-guard` job only runs there, so this also exercises
   a path nothing has tested.
3. Install `act` and run the workflow locally. Cheaper than a push, but it proves
   less: `act` differs from the hosted runner exactly where the risk lives here — the
   apt-based Playwright dependency install and the cold toolchain install.
**Needs:** Someone to run `git push` and report the run's outcome. If it fails, the
log is enough for the autopilot to fix it and continue.

Two specific things that could plausibly fail on a first CI run, none of which can be
checked from here:

- `install-toolchain.sh` now runs `sudo dnf` when `dnf` is present. On the ubuntu
  runner it is not, so the block is skipped and `playwright install --with-deps`
  covers the libraries instead — but that split has only ever executed on the Fedora
  side.
- The e2e stage starts the full stack from inside the runner via
  `scripts/deploy.sh local`, which builds the wasm module and publishes it. The job
  timeout is 30 minutes and a cold Rust build is the long pole.

**M8.6 (tag `v0.1.0`) is held behind this**, not independently blocked: the Definition
of Done requires CI green, and tagging a release before its release build has ever
run would be the wrong order. It is also an outward-facing act that belongs to a
human, like the push.

## Resolved

*(none)*
