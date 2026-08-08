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

*(none)*

## Resolved

### M8.4 — "one push needed to confirm the CI fix" (opened 2026-08-07)
**Resolved:** 2026-08-07, by the push and the run that followed it.

Run #6 on `2103045` — job `verify`, every step green including step 8, `./scripts/verify.sh`.
Duration 3m14s. The two runs before it, on `c954181` and `fe225ca`, both died at 2m33s
in the `e2e-smoke` stage; the difference is the `toolchain_is_local` fix in `dev.sh`.

CI is green on `main`, which was the last outstanding item in the
[Definition of Done](./mvp-scope.md#definition-of-done-for-v01). Nothing is blocked.

**Later correction (2026-08-08):** do not read the above as "CI has been green since".
That run was green, and the three after it were red. Run #6 installed the SpacetimeDB
CLI for real and then saved a toolchain cache containing `~/.local/bin/spacetime` but
not the `~/.local/share/spacetime` binaries it execs — so every later run restored a
`spacetime` that was on `PATH` and could not run, and `install-toolchain.sh`, which
guarded on `command -v`, declined to repair it. Fixed in `41d55fa` by guarding on
`spacetime --version` and caching both paths. Green again on `41d55fa`, verified from
the job log: 11 ran, 0 skipped.

Worth keeping because the shape recurs: a single green run is evidence about that run.
It is not a property of the branch, and here the green run was the thing that broke the
ones after it.

### M8.4 — "CI cannot be proven green without a push" (opened 2026-08-06)
**Resolved:** 2026-08-07, by checking rather than repeating.

The entry rested on "no commit has left this machine, so no workflow has ever been
triggered." `git ls-remote` shows `origin/main` at `fe225ca` — every commit through the
escalation itself had already been pushed. The GitHub Actions REST API is public for
this repo, so runs and their failure annotations are readable from here with no
credentials and no `gh`.

What the runs actually showed: green on `64c3246` (M2.2), `a773f6d` (M2.6) and
`237b9e3` (M3.4); **failed** on `c954181`, the commit that added the escalation saying
CI had never run. The failure was the `verify` job's `Verify` step, after 2m38s —
annotation `Process from config.webServer was not able to start. Exit code: 1`, i.e.
the `e2e-smoke` stage.

Cause: `scripts/deploy.sh` is Playwright's `webServer`, and it routes every command
through `scripts/dev.sh run`. `dev.sh` decided where to run by testing `in_container`
alone, and a GitHub runner is a VM rather than a container — so it took the host branch
and died on `require_host_tools` with "podman not found on host". `verify.sh` and
`generate-bindings.sh` each carried their own `in_container || $CI` test and were
therefore fine; `deploy.sh` had no such test, which is exactly why the e2e stage was
the only one that failed. Fixed by moving the decision into `dev.sh` itself as
`toolchain_is_local`, so there is one definition instead of three copies and one gap.

The lesson is the one the autopilot skill already states: a limitation written down in
an earlier session is a note that was true once, not evidence. This one was never true.
