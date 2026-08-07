---
name: autopilot
description: Drive the Book of Chaos MVP forward autonomously — pick the next backlog task, implement it with tests, run the verify gate, commit, repeat. Use when asked to "run autopilot", "keep building", "work the backlog", "continue the MVP", or when told to make progress without supervision.
---

# Autopilot

Move `docs/backlog.md` toward done with as little human input as possible, without
shipping anything broken or out of scope.

Bias hard toward **acting**. Do not ask which task to do next — the backlog answers that.
Do not ask whether an implementation choice is acceptable — take the obvious default and
note it in the commit message. Stop only for the specific situations listed in
`docs/blocked.md`.

## Loop

Repeat until the milestone is complete, you are blocked, or the user interrupts.

### 1. Orient

- Read `docs/blocked.md`. **Any open entry halts the loop** — report it and stop.
- Read `docs/backlog.md`. The task is the first `[~]`, or if there is none, the first `[ ]`.
- Read `docs/mvp-scope.md` if the task touches anything you might be tempted to expand.

### 2. Claim

Mark the task `[~]` in `docs/backlog.md`. Exactly one task may be `[~]` at a time.

### 3. Implement

- Smallest change that satisfies the task's acceptance criteria. Nothing speculative.
- Follow the conventions in `CLAUDE.md` — they are not suggestions.
- Write the tests in the same step, not afterward. A task with an acceptance criterion
  that mentions rejection, cycles, or authorization needs a test for the failure path,
  not just the happy path.
- If the task adds a new checkable surface (a new package, a new test runner), add its
  stage to `scripts/verify.sh` in the same commit.

### 4. Verify

```bash
./scripts/fmt.sh
./scripts/verify.sh
```

Green is the only acceptable outcome. If red:

- Fix the actual cause. Never weaken a check, delete a failing test, add `#[ignore]`,
  loosen a lint, or make a stage SKIP to get to green. That is the one unforgivable move
  here — the gate is the only thing standing between autonomy and a broken repo.
- Three genuinely different fix attempts on the same failure → escalate (step 7).

### 5. Sweep for claims this task just falsified

Finishing a task does not only add capability — it can make something already written
down untrue. Nobody is watching for that, so it is a step rather than a hope.

Run this whenever the task added a `verify.sh` stage, a script, a dependency, a
toolchain change, or any new capability — i.e. whenever the answer to "what can this
repo do now?" changed:

```bash
# The two sections that exist to hold claims about the future. Read them in full.
sed -n '/## Post-MVP parking lot/,$p' docs/backlog.md
sed -n '/## Open/,/## Resolved/p'     docs/blocked.md

# Quoted gate output — the one kind of staleness a machine can spot.
grep -rn 'ran,.*skipped' docs/ readme.md
```

Do not grep the whole repo for hedging words like "cannot" or "not yet". That was tried:
twelve hits, nearly all of them ordinary prose, which is how a step stops being run at
all. These two sections are where forward-looking claims actually live, and they are
short enough to read.

For each claim, ask: **is this still true after what I just did?** In particular —

- **The parking lot** is written in the future tense, so it ages worst. "X cannot be
  done until Y" is a note that was true once, not a fact.
- **A resolved blocker** moves to `## Resolved` with a line saying what resolved it. An
  open entry nobody needs any more halts the next session for nothing.
- **Quoted stage counts** — `docs/testing-runbook.md` names an exact
  `VERIFY GREEN  N ran, M skipped`. Adding a stage silently falsifies it.

Fix what you find. If the correction belongs to the task, it goes in the same commit;
if it is unrelated housekeeping, a separate `docs:` commit.

*This step exists because it was missed.* M7.4 recorded that an authorization harness
"cannot join the gate until CI can bring up a database". M8.3 made the gate start a
real database two tasks later, and the note sat there being wrong until a human asked
about it — after a summary that repeated the stale claim back to them as fact.

### 6. Land

- Tick the checkbox to `[x]` in `docs/backlog.md`.
- Commit everything for the task together:

```
M3.2: detect dependency cycles

<what changed and why, if not obvious from the diff>
<any default you chose that a reviewer might question>
```

- Do not push. `git push` is deliberately gated on a human.
- Return to step 1.

### 7. Escalate

When genuinely blocked, append an entry to `docs/blocked.md` using the template there,
leave the task as `[~]`, commit that, and stop with a short summary of what you need.

Escalate for: missing credentials or paid services; a real fork in the road that
`mvp-scope.md` does not settle; a task that appears to require deferred scope; three
failed fixes on one failure; a broken upstream dependency.

Do **not** escalate for: a legible test failure, an implementation choice with an obvious
default, or ambiguity in a deferred design-doc feature.

## Standing rules

**Scope.** `docs/mvp-scope.md` is authoritative and the design doc is not. Ideas that
arrive mid-task go in the parking lot at the bottom of `docs/backlog.md` — never into the
code.

**Order.** Work top to bottom. Later milestones assume earlier ones landed. If a task
seems to need something from a later milestone, that is usually a sign the current task
is being over-built.

**The gate.** `./scripts/verify.sh` is the definition of working. The Stop hook runs it
automatically and will wake you back up if it is red, so there is no way to quietly
leave a break behind — do not try to route around it.

**Host hygiene.** Never install onto the host OS. Toolchain changes go in
`Containerfile` or `scripts/install-toolchain.sh`, then `./scripts/dev.sh setup`.

**Honesty.** When reporting progress, state what actually passed. If a stage skipped,
say it skipped. A green summary over a skipped gate is a lie the human will act on.

**Repeating a claim is making it.** A limitation written down in an earlier session is
not evidence — it is a note that was true once. Before restating one in a report ("the
harness cannot run in CI", "X is not covered", "Y is impossible until Z"), check that it
is still true *today*. The human cannot tell a fresh finding from a stale quote, and
will act on both.

## Reporting

When you stop — milestone complete, blocked, or interrupted — report in this shape:

```
Completed: M3.1, M3.2, M3.3
Verify:    GREEN (7 ran, 3 skipped)
Next:      M3.4 — table-driven unlock tests
Blocked:   none
Corrected: <anything the sweep found, or "nothing">
```

`Corrected:` is not filler. It is the only place a human sees that something they were
previously told has changed.
