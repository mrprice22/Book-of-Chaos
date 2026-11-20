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
  the current scope contract ([v0.2-scope.md](./v0.2-scope.md)) does not settle it
- A task appears to require something the current scope contract explicitly defers
- The same stage of `verify.sh` has failed three times with genuinely different fixes attempted
- An upstream dependency is broken, unavailable, or has no working version

## What does NOT count as blocked

- A test is failing and the fix is legible → fix it
- An implementation choice with an obvious default → take the default, note it in the commit
- A design-doc feature is ambiguous but out of MVP scope → it is deferred, move on

---

## Open

### M15.3 — the write gate leaves M15.2's carry-over with nothing to carry, and no way to test it
**Date:** 2026-11-20
**Tried:** M15.3 is landing in pieces, each with the gate green. Done:
the client calls a token signed in only with `email_verified` (`d696797`); the book
tables are private behind `visible_*` views, with an owner-set `anonymous_access`
setting (`896f526`); `grade_quiz` grades an anonymous reader's quiz and records nothing,
and their progress lives in browser storage, labelled as losable (piece 4). What is left
is the write gate itself: every writing reducer refuses a caller who is not signed in.
**Blocker:** the gate makes M15.2's carry-over (`begin_link`, `complete_link`) carry only
*legacy* rows, the ones an anonymous identity wrote before the gate existed. From the
gate on, no anonymous identity can write a username, a book, progress or a quiz attempt.
So `identity-link.spec.ts` can no longer set up its happy path, which is how it proves
that every identity-keyed row moves. Its refusal tests still work. Taking out a passing
happy-path test, or adding a seam that lets anonymous callers write, is not mine to
choose.
**Options:**
1. **Keep the carry-over for legacy rows, and drop its happy-path test** (the refusals
   stay). `begin_link` is then the one writing reducer an anonymous caller may call. It
   writes only a private offer, and only for an identity that already holds rows. The
   move itself was verified live on 2026-11-20 and its code does not change. The cost
   is that the code that moves real data is no longer exercised by the gate.
2. **Retire the carry-over.** Delete `begin_link`, `complete_link`, `link_requests`,
   the client's carry-over call and the `identity-link` happy path. Any anonymous rows
   already on Maincloud stay with their anonymous identity. Signed-in readers can read
   them, and nobody can edit them. Recommended **if** Maincloud holds no anonymous
   books or progress you want kept. Only you can check that, with
   `spacetime sql` as the database owner.
3. **Keep it tested with a legacy fixture.** The stage publishes the last pre-gate
   module to a scratch database, writes anonymous rows with it, publishes the current
   module over it, then carries the rows over. That is the real production path, but it
   is new machinery: an old wasm built from a pinned commit, and a second database.
   That is roughly a task of its own.
**Needs:** which option. With 1 or 2 the gate lands in one more commit: the rejection test
per reducer, the smoke test's author signing in through the mock issuer, and the author
screen asking an anonymous visitor to sign in. One more thing to know either way: the
hosted demo book is owned by the old anonymous seed identity, so after the next publish
anonymous visitors will not see it, and nothing can open it to them: only its owner may
set `anonymous_access`, and a signed-in seed (`BOC_SEED_TOKEN`) is not its owner. Signed-in
readers still see it. Replacing it means a new demo book, which is not part of M15.3.

## Resolved

### M14.2 — "the sign-in provider is a vendor and an account, and only you can pick and enable it" (opened 2026-11-19)
**Resolved:** 2026-11-19, by the human: SpacetimeAuth, enabled on `book-of-chaos-83i7y`, with
the redirect URIs added and client ID **`client_0350We80wbokeNK7YI9r5X`** (public by design).

Checked from here rather than taken on trust:

- `https://auth.spacetimedb.com/oidc/.well-known/openid-configuration` reports issuer
  `https://auth.spacetimedb.com/oidc`, JWKS at `/oidc/jwks`, RS256. That is the shape the
  M14.2 spike's mock issuer had.
- An authorization request with this client ID and a valid PKCE challenge goes through
  (303 to `/interactions/…`) for both `https://book-of-chaos.com/` and
  `http://localhost:5173/`. An unregistered redirect URI is refused with 400, and so is a
  made-up client ID. So the client exists and both URIs are registered.
- The login page that follows offers **email magic link** and an **anonymous** option, and
  nothing else (no GitHub). The anonymous option is the one to watch: see
  [0002](./decisions/0002-durable-sign-in.md#spacetimeauths-own-anonymous-login).

### M13.1 — "the hosted SpacetimeDB target needs an account only you can create" (opened 2026-08-08)
**Resolved:** 2026-08-08, by the account being created and the CLI being logged in.

**Maincloud**, database name **`book-of-chaos-83i7y`** — the suffix exists because
Maincloud names are platform-wide and the bare `book-of-chaos` was not available to us.
Verified from the dev container rather than taken on trust:

- `spacetime login show` → logged in as identity `c2009cd4922e…`
- `spacetime list` → `book-of-chaos-83i7y`, owner identity `c2006a7f4c69…`
- The token landed in `.devhome/`, which `.gitignore:2` covers. Nothing to commit.

**Logging in breaks the local database, and this is not hypothetical — it happened here.**
`spacetime login` switches the CLI to the web identity for *every* server, `local`
included. The existing local `book-of-chaos` was owned by the previous anonymous
identity, so immediately after login every local publish failed:

    403 Forbidden: c2009cd4922e… is not authorized to perform action
    on database c20021bc8152…: update database

`deploy.sh local --clear` does **not** rescue this. `--delete-data=always` needs
`reset database`, which fails the same ownership check — so the escape hatch is locked
behind the thing it is meant to escape. The fix is to move `.devhome/spacetime-data`
aside and republish; the local database is disposable scratch and `npm run seed` refills
it. The orphaned dir was preserved rather than deleted.

Expect this once per machine, on the first login. It is the same failure shape that cost
two sessions before, and the reason `deploy.sh` keeps its data dir out of `$HOME`.

Still undecided, and deliberately not treated as blocking: **where the client is served
from** (M13.3). That is a separate provider and a separate account. It is a decision, not
an obstacle — M13.2 only needs the module target, which now exists.

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
