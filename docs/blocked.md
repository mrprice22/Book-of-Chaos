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

### M8.4 — one push needed to confirm the CI fix
**Date:** 2026-08-07
**Tried:** The previous entry under this task claimed CI had never run and could not
be observed. Both halves were wrong — see Resolved below. CI has run five times on
`main`; the run for `c954181` failed, the cause was diagnosable from here, and the fix
is committed. The local gate is green: 11 ran, 0 skipped.
**Blocker:** `git push` is human-gated, so the fix has not reached GitHub and the run
that would prove it green has not been triggered. "Green on `main`" remains a claim
about GitHub, not about this machine.
**Needs:** `git push`. The run's outcome is then readable from here without
credentials — `https://api.github.com/repos/mrprice22/Book-of-Chaos/actions/runs?branch=main`
and the `check-runs/<job id>/annotations` endpoint carry the failing step and its
error, which is how the last failure was diagnosed. No decision is required; if it is
green, M8.4 ticks and only M8.6 remains.

**M8.6 (tag `v0.1.0`) is held behind this**, not independently blocked: the Definition
of Done requires CI green, and tagging a release before its release build has passed
would be the wrong order. It is also an outward-facing act that belongs to a human,
like the push.

## Resolved

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
