# 0001 — Owner-only reads: a private table behind a `ViewContext` view

**Task:** M14.1 · **Date:** 2026-11-19 · **Status:** decided

## Question

Can a SpacetimeDB 2.8 view filter a private table by the caller's identity, so that a
work's owner and the workers they authorize read rows that a third identity provably
cannot? If not, the fallback was a payload the worker encrypts before upload.

## Answer

**Yes. The fallback is not needed.** Owner-only state (M18.3) is a private table, with no
`public` attribute, read only through a `#[view(public)]` function on `&ViewContext`.
That function returns the rows whose owner is `ctx.sender()`, plus the rows of every
owner who has granted `ctx.sender()`. The server holds the payload in plaintext. Nothing
is encrypted.

## Evidence

`spikes/m14.1-owner-view/` holds a module with exactly this shape. `vault` is private,
`vault_grant` is private, `my_vault` is the view, and `notice` is a public control. Its
`run.sh` is the reproduction:

```bash
./scripts/dev.sh run spikes/m14.1-owner-view/run.sh            # real view: exit 0
./scripts/dev.sh run 'LEAKY=1 spikes/m14.1-owner-view/run.sh'  # leaky view: exit 1
```

It runs its own SpacetimeDB 2.8.0 (CLI commit `07aab11f`, module crate pinned `=2.8.0` to
match `server/Cargo.lock`) on port 3100 with a throwaway data dir. It mints three
identities (owner, worker, stranger) and gives the stranger a row of its own, so "the view
returns nothing" can never pass for "the view works". Recorded run, 2026-11-19, real view:
**8 of 8 HTTP probes and 17 of 17 subscription probes passed.**

| Probe | HTTP SQL | WebSocket subscription |
|---|---|---|
| Raw `SELECT * FROM vault` / `vault_grant` by a non-owner | refused (400, "may be marked private") | refused |
| Generated bindings | n/a | expose `myVault` and `notice`, no `vault` |
| Owner reads own row through the view | ✓ | ✓ |
| Ungranted worker | nothing | nothing |
| Granted worker reads the owner's row | ✓ | ✓, **pushed live** on `grant`, no resubscribe |
| Owner writes a new row after the grant | — | ✓, reaches the worker live |
| Stranger | only its own row | only its own row, at every step |
| Stranger adds `WHERE owner = <owner>` to the view | nothing | — |
| After `revoke` | worker reads nothing | worker's rows **removed live** |

**Watched failing.** Under `LEAKY=1` the view returns every row whatever the caller. Then
all 15 caller-dependent probes go red (6 HTTP, 9 subscription). The four structural checks
stay green, as they should: the raw refusals, the bindings, and the control. So the probes
measure the view's filtering, not something next to it.

## Consequences

1. **The database owner reads everything.** The identity that published the module
   (today, this project's Maincloud login) can run `spacetime sql … 'SELECT * FROM vault'`
   and gets every row, the stranger's and the owner's alike. The run prints this. So
   "owner-only" means *no other client* can read it. The operator still can. That holds for
   every private table this repo has, `quiz_answer_key` included, and it is what the scope
   asks for. If a release ever needs to exclude the operator, that is the encryption
   design, and it is parked, not dropped.
2. **A view reaches rows only through an index.** The read-only table handle a view gets
   has no `iter()`: it offers `find` on unique columns and `filter` on btree indexes. Every
   column an owner-only view selects on must be indexed. For M18.3 that means the journal
   needs an index on its owning column, and `work_workers` needs one on the worker
   identity.
3. **Grants are live.** A view re-evaluates when a table it reads changes, including a
   table other than the one it returns rows from. Authorizing or revoking a worker
   (M16.3) takes effect on that worker's open subscription without a reconnect.
4. **A subscription may narrow a view with `WHERE`, never widen it.** That is how a
   client asks for one work's rows (M14.4).
5. **The proof belongs in the gate.** M18.4 is the e2e test of this shape against the real
   module, in the style of `answer-key.spec.ts`. This spike is the evidence for choosing
   the design, not a substitute for that test.

## Not measured

- **Maincloud.** Every probe ran against a local standalone 2.8.0. Maincloud runs the same
  engine, but no spike module was published there. The gate test M18.4 runs locally too, so
  nothing depends on the difference. The first hosted owner-only read is the time to look.
- **Cost.** A view is evaluated per subscribing identity. With three identities and a
  handful of rows that is nothing. At hundreds of viewers it is unmeasured.
- **Parameterized views.** `#[view]` accepts arguments, but the spike used none. The design
  above does not need them.
