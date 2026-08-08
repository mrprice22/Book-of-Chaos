# Backlog — Autopilot Work Queue

**Current release: v0.2 "Earned Completion"** — scope in [v0.2-scope.md](./v0.2-scope.md).
M0–M8 shipped as v0.1 (tag `v0.1.0`) and are kept below as history; the live work starts
at M9.

This file is the autopilot's task queue and its memory between sessions. It is the
**single source of truth for what to do next**.

## Rules

- Work tasks **strictly top to bottom**. Do not skip ahead.
- Exactly one task may be `[~]` (in progress) at a time.
- A task is only `[x]` when its acceptance criteria are met **and** `./scripts/verify.sh` exits 0.
- Check the box in the same commit as the work.
- Do not add features that are not in [v0.2-scope.md](./v0.2-scope.md). If a task seems to
  require one, that is a signal to stop and write to [blocked.md](./blocked.md).

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (see `blocked.md`)

---

## M0 — Toolchain bootstrap

The host is Bazzite (immutable OS) with no Rust, Node, or SpacetimeDB. All builds run
inside a `distrobox` container so the host stays clean.

- [x] **M0.1** Write `Containerfile` defining the dev image (Fedora base + build deps)
- [x] **M0.2** `./scripts/dev.sh setup` creates the `boc-dev` container and installs rustup, Node LTS, and the SpacetimeDB CLI, and is idempotent on re-run
- [x] **M0.3** `./scripts/dev.sh run <cmd>` executes a command inside the container and forwards the exit code
- [x] **M0.4** `./scripts/verify.sh` runs green against the empty repo (every stage SKIPs cleanly)

**Acceptance:** on a machine with only `podman` + `distrobox`, a clean clone reaches a
working `cargo --version`, `node --version`, and `spacetime --version` via one command.

---

## M1 — Server module skeleton

- [x] **M1.1** `server/` SpacetimeDB Rust module: `Cargo.toml`, `src/lib.rs`, compiles to wasm32
- [x] **M1.2** Tables `users`, `books`, `chapters`, `knowledge_blocks`, `chapter_deps`, `reader_progress` with the v0.1 column set (include nullable `locale`)
- [x] **M1.3** `spacetime publish` to a local standalone instance succeeds
- [x] **M1.4** `verify.sh` gains: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`

**Acceptance:** module publishes locally and `verify.sh` enforces Rust quality gates.

---

## M2 — Domain reducers

- [x] **M2.1** `claim_username` — unique, immutable, rejects re-claim and duplicates
- [x] **M2.2** `create_book` / `update_book` / `publish_book` — caller becomes Owner; non-owners rejected
- [x] **M2.3** `create_chapter` / `update_chapter` / `reorder_chapters`
- [x] **M2.4** `create_block` / `update_block` / `delete_block` — HTML body sanitized server-side
- [x] **M2.5** `set_chapter_deps` — rejects self-reference, missing chapters, and cycles
- [x] **M2.6** Unit tests for every rejection path above

**Acceptance:** every reducer has at least one happy-path and one rejection test. Authorization
is tested, not assumed.

---

## M3 — Unlock engine

The core of the product. Keep it a pure function over a graph snapshot so it is trivially
testable, then call it from reducers.

- [x] **M3.1** `unlock::chapter_state(graph, progress, chapter_id) -> ChapterState`
- [x] **M3.2** `unlock::detect_cycle(graph) -> Option<Vec<ChapterId>>`
- [x] **M3.3** `complete_block` reducer — idempotent, writes `reader_progress`, recomputes affected chapter states
- [x] **M3.4** Table-driven tests: linear chain, diamond, disconnected islands, optional chapters, pinned chapters, self-cycle, 3-node cycle, empty graph

**Acceptance:** unlock logic has no SpacetimeDB dependency in its signature and is covered
by table-driven tests including every degenerate graph shape listed above.

---

## M4 — Client scaffold

- [x] **M4.1** `client/` Vite + React + TypeScript, strict mode on
- [x] **M4.2** SpacetimeDB TS SDK wired; `spacetime generate` bindings committed under `client/src/module_bindings/`
- [x] **M4.3** Connect on load, persist identity token in localStorage, reconnect cleanly
- [x] **M4.4** `i18n/en-US.ts` + `t()` helper; ESLint rule or test forbidding bare string literals in JSX
- [x] **M4.5** `verify.sh` gains: `tsc --noEmit`, `eslint`, `vitest run`, `vite build`

**Acceptance:** client builds, connects to the local module, and shows the connected identity.

---

## M5 — Reader experience

- [x] **M5.1** Book landing page: title, description, chapter count, estimated read time
- [x] **M5.2** Chapter view: ordered blocks, sanitized HTML render, "Mark as complete"
- [x] **M5.3** Live subscription — completing a block updates state without a reload
- [x] **M5.4** Blocked chapters are visibly locked and unreachable by direct URL

**Acceptance:** two browser tabs on the same identity stay in sync with no reload.

---

## M6 — Knowledge map

- [x] **M6.1** Build Mermaid graph source from the chapter dependency graph
- [x] **M6.2** Render with the four v0.1 node states plus optional/pinned badges
- [x] **M6.3** Clickable nodes navigate to the chapter
- [x] **M6.4** Re-render on subscription update (node state changes live)

**Acceptance:** map is the primary navigation surface and reflects progress in real time.

---

## M7 — Author experience

- [x] **M7.1** Create book / chapter / block forms
- [x] **M7.2** Chapter prerequisite multi-select; cycle rejection surfaced as a readable error
- [x] **M7.3** Publish toggle (`Draft` → `Published`)
- [x] **M7.4** Author-only routes hidden and server-side rejected for non-owners

**Acceptance:** the demo book can be built end to end through the UI, with no SQL and no CLI.

---

## M8 — Deploy & test

- [x] **M8.1** `scripts/seed.ts` — demo book, 5+ chapters, branching graph (diamond + an optional side branch)
- [x] **M8.2** `scripts/deploy.sh local` — module published + client served, one command
- [x] **M8.3** Playwright smoke test covering the Definition of Done demo path
- [x] **M8.4** `.github/workflows/ci.yml` green on `main`
- [x] **M8.5** `docs/testing-runbook.md` — human walkthrough, under 10 minutes
- [x] **M8.6** Tag `v0.1.0`

**Acceptance:** every item in the [Definition of Done](./mvp-scope.md#definition-of-done-for-v01) passes.

---

## M9 — Close the v0.1 debt

The three parking-lot entries, folded in. M9.1 is the one that matters: it closes a hole
in the safety net that every later milestone's autonomy rests on.

- [x] **M9.1** `auth-reject` verify stage — a TS harness over the real SDK asserting all
      **nine** owner-gated reducers are refused for a non-owner identity, run against the
      live instance `e2e-smoke` already starts. Add the stage to `verify.sh` in the same
      commit. (The "six author writes" this task was drafted with came from M7.4's
      throwaway harness; the module actually has nine owner-gated reducers, and covering
      six of them would have left three doors the gate does not watch.)
- [x] **M9.2** Bump `actions/checkout` and `actions/cache`; confirm from the run log that
      the Node 20 deprecation warning is actually gone, not just relocated.
      **Confirmed by run #11** on `9e11846`: zero annotations, where run #10 on `13ff0e0`
      carried the deprecation warning as an annotation. Bumped to `checkout@v7` and `cache@v6`,
      not the `@v5` this task was drafted with: v5 was current when the parking-lot note
      was written and is now two majors stale (checkout is at v7.0.1, cache at v6.1.0).
      Both current majors declare `using: node24`, and they are the only actions in the
      workflow, so no action targets Node 20 any more. That is read from each action's
      `action.yml`, which is evidence but not the run log the criterion asks for — the
      box gets ticked when a run on this commit shows the warning gone. Note the run will
      be slow: the toolchain cache key hashes `ci.yml`, so bumping the actions
      invalidates it and the toolchain reinstalls from scratch.
- [x] **M9.3** Install binaryen, pinned through `scripts/toolchain-versions.sh` so local
      and CI cannot drift; `spacetime publish` stops warning about `wasm-opt`.
      Installed in `scripts/install-toolchain.sh` **only**, not in both places as drafted:
      upstream ships static Linux tarballs, so one pinned install path serves the Fedora
      container and the Ubuntu runner alike. Putting it in the `Containerfile` too would
      have recreated the divergence the task was written to avoid, since CI never builds
      that image. Confirmed by output: `spacetime build` now says "Optimising module with
      wasm-opt..." where it used to say it could not find one

- [x] **M9.4** Stop CI caching the standalone database. Added after run #10 failed on a
      **docs-only** commit whose parent passed, with the same
      `webServer was not able to start` signature as the historic `c954181` failure.
      Cause: `~/.local/share/spacetime` holds both `bin/` (toolchain) and `data/` (the
      database), so the cache carried a database into the next run while the identity
      owning it — `~/.config/spacetime`, never cached — was regenerated. Publishing then
      failed `403 Forbidden ... not authorized ... update database`. Reproduced locally by
      moving the config aside, and the fix confirmed by moving config *and* data aside;
      cache path narrowed to `~/.local/share/spacetime/bin`

- [x] **M9.5** Pin the SpacetimeDB CLI. `install-toolchain.sh` installs from
      `releases/latest/download` while `server/Cargo.toml` pins the crate to `2.8.*`, so
      two runs of one commit can install different CLI versions. Add
      `SPACETIMEDB_VERSION` to `toolchain-versions.sh`, set `SPACETIME_DOWNLOAD_ROOT`,
      and guard on the reported version rather than on the CLI merely running
- [x] **M9.6** Move the database out of `$HOME`. `~/.local/share/spacetime` mixes the
      toolchain with the standalone database, so the cache path list has to stay exactly
      right forever. `deploy.sh` passes `--data-dir` under gitignored `.devhome/`, which
      CI never caches — the state becomes structurally uncacheable rather than
      conditionally excluded
- [x] **M9.7** `preflight` verify stage — assert every pinned tool runs **and reports its
      pinned version**, so an environment fault fails at stage 1 naming the tool instead
      of at stage 12 as a symptom. Generalises "verify capability, not presence"
- [x] **M9.8** Cold/warm cache matrix in CI. The restore path is exercised only when
      nobody is watching: every run that changes `ci.yml` misses the cache, so #9 and #11
      were green on a miss and #10 was red on a hit. A cache is correct only if the result
      is identical with and without it — test that property on every push

**Acceptance:** deleting a `rules::require_owner(...)` call from any author reducer turns
the gate red. A cache hit and a cache miss produce the same verdict, and that is checked
rather than assumed. Verify by actually deleting one, watching it fail, and restoring it — an
authorization test that has never been seen to fail is not evidence.

---

## M10 — Quiz block: server

- [x] **M10.1** `BlockType::Quiz`; `quiz_questions`, `quiz_options`, `quiz_config`
      (pass threshold) tables. The correct-answer column lives in a **non-public** table.
      **Test that a real client subscription cannot reach it** — if it can, stop and
      escalate per [v0.2-scope.md](./v0.2-scope.md#the-answer-key-must-not-reach-the-browser).
      Four tables, not the three drafted: correctness went into a fourth,
      `quiz_answer_key`, rather than a column on `quiz_options`, because the reader
      must be able to read option *text* and so `quiz_options` has to stay public.
      Correctness is the presence of a row, not a boolean, so the private table holds
      only the correct option ids. New `answer-key` verify stage; watched failing with
      `public` added before being trusted
- [x] **M10.2** `set_quiz` reducer — owner-only; validates ≥1 question, ≥2 options per
      question, ≥1 correct option per question, threshold in `1..=100`; question and
      option text sanitized server-side on write. Also strengthen
      `client/e2e/answer-key.spec.ts`: it currently proves the key table is
      unnameable from a client, which is a schema property and all that can be
      proven while no reducer can write a row. Once `set_quiz` can, author a quiz
      through it and assert the client still sees zero correct answers — the
      row-level half of the same claim
- [x] **M10.3** `submit_quiz` reducer — grades server-side, writes a `quiz_attempts` row,
      and completes the block only when score ≥ threshold. Refuses submission for a
      Blocked chapter, exactly as `complete_block` does.
      **Close the hole M10.1 opened first, before writing `submit_quiz`.**
      `complete_block` checks only the chapter's unlock state and never looks at
      `block_type`, so since M10.1 a client can complete a `Quiz` block by calling it
      directly and never answering anything. That is the exact thing this release
      exists to prevent — [v0.2-scope.md](./v0.2-scope.md#in-scope) says a `Quiz`
      block completes *only* on a passing attempt, never via "Mark as complete" — and
      nothing currently tests it. It wants a `rules` check refusing a Quiz block, a
      rejection test beside the existing `can_complete_block` ones, and a case in
      `auth-reject.spec.ts` or its own harness so a live client is seen being
      refused. Adding `submit_quiz` without this leaves two doors and gates one.
      Also decide what a `Quiz` block with **no quiz configured** does: `create_block`
      and `update_block` both happily produce one, so `submit_quiz` will meet it.
      **Decided:** refused — `"This quiz has not been written yet."` — and
      `complete_block` still refuses it as a quiz, so an unwritten quiz is not a
      way back to "Mark as complete". The safe reading of "no questions" is "not
      ready", never "you passed". Both doors are watched by the new `quiz-gate`
      verify stage, a reader-side twin of `auth-reject`: nine live-client cases,
      each refusal with a positive control. Watched failing before being trusted —
      forcing `complete_block`'s quiz argument to `false` turns exactly the two
      "refused for a quiz block" cases red, and dropping `grade.passed` from the
      completion condition turns the two failing-attempt cases red, while every
      control stays green. Also folded in: `set_quiz` was the **tenth**
      owner-gated reducer and `auth-reject` did not cover it, so M9.1's guarantee
      had a door in it. It does now
- [x] **M10.4** Table-driven grading tests: all correct, all wrong, exactly at threshold,
      one mark below, multi-answer with a subset selected, unknown option id, submission
      to a block that is not a Quiz, and resubmission after an earlier pass.
      Nine submission shapes in one table, read twice — once for the score and
      verdict, once for the per-question breakdown, because a grader can get a
      score right by counting one question wrong and another right in
      compensation. Five malformed shapes in a second table, each asserting the
      message names the actual problem. Two of the listed cases are not
      properties of the pure function and live in the `quiz-gate` stage instead:
      "not a Quiz block" and "resubmission after a pass" are both facts about the
      reducer, and testing them against the grader would have tested nothing.
      The matrix was watched failing: dropping the length half of the
      set-equality check turns four shapes red by name, including the one an
      empty selection exposes — `all()` over nothing is vacuously true

**Acceptance:** grading is a pure function over a submission and an answer key, testable
without a running database — same rule the unlock engine follows. `#[ignore]` on any of
these is not an option.

---

## M11 — Quiz block: reader and author UI

- [x] **M11.1** Reader quiz view — render questions, select answers, submit, see score and
      which questions were wrong. All strings through `t()`.
      Note the starting point: `ChapterView` does not branch on `blockType` at all, so
      a `Quiz` block currently renders as its body HTML with a "Mark as complete"
      button under it. The button must be gone for a Quiz block, not merely
      ineffective — M10.3 makes the server refuse it, and a control the server always
      rejects is a bug the reader gets to discover. `is_multi_answer` on the question
      decides radio group versus checkbox group; it is the only fact about the answer
      key the client is given, and it exists for exactly this. A Quiz block whose
      quiz has not been configured yet needs a defined rendering too — see M10.3.
      **"Which questions were wrong" has no server surface yet.** `submit_quiz`
      grades per question — `rules::Grade::results` — but M10.3 stored only the
      verdict: `quiz_attempts` holds the score and pass/fail and nothing about the
      selections, deliberately, so a public table cannot become an oblique copy of
      the answer key. Per-question feedback therefore needs a table this task adds,
      and it is worth thinking about *what* it stores: "question 3 was correct",
      accumulated across unlimited retakes, is the key for a single-answer question
      after a couple of attempts. That is inherent to giving feedback at all, not a
      reason to skip it — but it should be a decision rather than a side effect.
      **Decided:** a sixth quiz table, `quiz_attempt_results`, public, one row per
      question per attempt holding `is_correct` and nothing else. It stores the
      verdict on a *question*, never the selections, so to any other reader the
      rows are unreadable — "correct" names no option unless you know what was
      ticked. To the reader who ticked it, it is exactly the slow channel the task
      describes, and that is accepted rather than overlooked: the same information
      leaks through the score alone on a one-question quiz, so the alternative is
      withholding the feedback the scope promised. Where a cap on it would live is
      retake policy, which v0.2 defers. Results are deleted with their attempt.
      Two consequences worth naming: a question the attempt never graded — one the
      author added afterwards — is shown as neither right nor wrong rather than
      wrong, and the client therefore submits every question including the blank
      ones, so a skipped question comes back with a verdict instead of silence.
      The reader surface is `QuizBlock`, fed by the pure `quizModel`; the gate
      watches the new rows through `quiz-gate`, whose half-right case now asserts
      *which* question was wrong by name rather than counting — a 50% score says
      the same thing whichever way round it is. Watched failing before being
      trusted: writing no result rows turns that case red on the breakdown while
      the score assertion beside it stays green
- [x] **M11.2** Failing shows the score and a retry; passing completes the block and the
      map node changes state live, with no reload.
      The retry is the submit control relabelled rather than a second button:
      `Submit answers` → `Try again` after a failure, `Take it again` after a pass,
      because a pass is not undone by a later failure and the control should not
      imply it might. The live half needed no new machinery — `submit_quiz` writes
      the same `reader_progress` row `complete_block` does, so the map was already
      right — but "already right" is not evidence, so it now has a `BookMap` test
      that passes a Quiz block and watches the downstream node go blocked →
      available across a re-render with no refetch, and a `ChapterScreen` test that
      does the same for the block itself from an attempt row arriving. Also fixed
      on the way: a refused submission was reported as `block.completeFailed`
      — "Could not mark that complete" — which is the one sentence the reader must
      not read about a quiz. `ChapterView`'s `error` prop now carries which call
      was refused rather than a finished sentence, so the copy stays in the view.
      The `ChapterScreen` fake had to learn to tell the two reducers apart; it keys
      them by `accessorName`, with a control test on the names, because a wrong key
      would have made every reducer call throw rather than quietly pass
- [x] **M11.3** Author quiz form — add/remove questions and options, mark correct answers,
      set the pass threshold. Server rejections surfaced as readable errors, the way M7.2
      surfaced cycle rejection. `BlockForm`'s `TYPES` array is a hand-written
      `['Reading', 'ResourceLink']` that does not derive from `BlockType`, so adding
      `Quiz` to the enum did not add it to the form and did not break the build —
      it needs adding by hand, along with a `blockType.Quiz` string in
      `i18n/en-US.ts`. Every rejection `rules::validate_quiz` can produce names the
      offending question by its 1-based position; the form should keep that number
      meaningful rather than showing the message detached from the question.
      Done, and the `TYPES` array replaced rather than appended to: it is now a
      `Record<BlockType['tag'], MessageKey>`, so a missing variant is a type error
      instead of a dropdown that silently omits the block type the release is
      about. The number stays meaningful because each question is a `fieldset`
      whose legend is `Question {n}` with the same 1-based numbering the reducer
      counts by, and removing a question renumbers the rest — a test watches that,
      since a stale number is worse than none.
      **Decided: the form always writes a whole quiz and never pre-fills.**
      `set_quiz` replaces rather than patches, and the deeper reason is that the
      answer key is unreadable *from the author's client too* — it is a non-public
      table, and nothing about ownership changes that. A form seeded from the
      stored questions would look like an edit while silently dropping every
      correct-answer mark, so it starts blank and says so when there is a quiz to
      replace. No client-side validation either: `rules::validate_quiz` is the
      trust boundary, and a second copy of its rules in the browser is a thing to
      keep in sync. A blank threshold is sent as 0 and the server names it
- [x] **M11.4** Extend the Playwright smoke test to cover fail-then-pass: submit a wrong
      answer, assert still locked, submit a right one, assert unlocked.
      The quiz went into **Foundations**, the root of the demo graph, so the whole
      book is now behind an earned unlock rather than a self-report — which also
      makes the existing two-tab test item 4 of the v0.2 Definition of Done
      verbatim: the watcher tab sees the map open because a quiz was *passed*.
      One single-answer and one multi-answer question, because a radio group and a
      checkbox group are different controls and only a browser proves both.
      A wrinkle worth recording: the seed is idempotent by book title, and
      `.devhome/spacetime-data` persists between runs by design (M9.6), so a
      developer's demo book predates the quiz. The seeder cannot repair it — it
      connects anonymously and gets a fresh identity every run, so it does not own
      the book a previous run created, and `create_block` answers "Only the owner
      of this book can change it." It therefore refuses with a message naming
      `./scripts/deploy.sh local --clear`, rather than letting the smoke test fail
      on a control that is not there. CI never meets this; it starts empty

**Acceptance:** a quiz can be authored and passed entirely through the UI, and the answer
key never appears in the page source or in any subscription the client holds.

---

## M12 — Block prerequisites

- [ ] **M12.1** `block_deps` table + `set_block_deps` reducer — rejects self-reference,
      missing blocks, cross-book references, and cycles, reusing `unlock::find_cycle`
- [ ] **M12.2** `unlock::block_state(graph, progress, block_id)` pure function; both
      `complete_block` and `submit_quiz` refuse a block with unmet prerequisites
- [ ] **M12.3** Client: prerequisite-locked blocks are visibly locked within an otherwise
      Available chapter, and their controls are not merely hidden
- [ ] **M12.4** Table-driven tests including the degenerate shapes M3.4 established:
      chain, diamond, self-cycle, multi-node cycle, cross-chapter edge, empty set

**Acceptance:** block-level and chapter-level gating compose without either one being able
to override the other, and the rejection paths are tested, not assumed.

---

## M13 — Hosted deployment

**This milestone will escalate on its first task.** It needs an account, and possibly a
domain and payment method, that autopilot cannot create. That is expected — M13.1 should
open a `blocked.md` entry naming the exact credentials required and stop, rather than
inventing infrastructure.

- [ ] **M13.1** Choose and provision the hosted SpacetimeDB target (Maincloud or
      self-hosted). Escalate for credentials
- [ ] **M13.2** `scripts/deploy.sh remote` publishes the module to that target; host and
      module name come from environment configuration, never a hardcoded `localhost`
- [ ] **M13.3** Client static build deployed and reachable at a public URL
- [ ] **M13.4** CI deploys on tag push; `docs/testing-runbook.md` gains a section a human
      can follow **without cloning the repo**

**Acceptance:** someone who has never cloned this repository can open a link, read the
demo book, fail a quiz, pass it, and watch a node unlock.

---

## Post-MVP parking lot

Ideas encountered while building that are out of scope. **Append here instead of building
them.** The three v0.1 entries that used to live here became M9.

- **Chapter state is computed twice — once in Rust, once in TypeScript.** M3.3 derives
  chapter state on read rather than materialising it, so the map computes the same four
  states client-side. Revisit only if the two ever disagree. Note that M12 adds a second
  instance of this shape for block state, which strengthens the case for revisiting it —
  and would double the cost of getting it wrong.

- **Cache keys are coarser than they need to be.** The toolchain key hashes the whole
  of `ci.yml`, so editing a comment there busts a ~200M cache and forces a full
  reinstall. Per-tool caches keyed by the pins in `toolchain-versions.sh` would be
  content-addressed properly. Deliberately not done alongside M9.8: changing cache
  *shape* in the same commit that first tests the restore path would confound the
  result of that test.

- **Node is pinned only to a major.** `nvm install 22` takes the newest 22.x, so two
  machines can differ within the pin. Lower severity than Rust, SpacetimeDB or binaryen,
  none of which publish a module — but it is the same hermeticity argument, so it should
  be closed rather than argued away.

- **The e2e harnesses leave junk books in the local database, forever.**
  `auth-reject` creates and *publishes* a control book on every run, `answer-key`
  creates a Draft one, and since M10.3 `quiz-gate` creates a third — three books
  per run now, into `.devhome/spacetime-data`, which persists
  between runs by design since M9.6. CI is unaffected (it starts empty), but a
  developer's local reader library fills up with "Authorization control
  1754…" over time, and the smoke test's assertions are one accumulated
  coincidence away from ambiguity: it matches on things like `6 chapters`, which is
  unique today only because the junk books are small. Cheapest fix is for each
  harness to delete what it created; the honest one is a documented reset.

- **Two `verify.sh` runs at once destroy each other, silently and confusingly.**
  The e2e stages start a real SpacetimeDB and a real vite on fixed ports, and share
  one cargo target directory. Overlap them and you get "SpacetimeDB already running
  — leaving it alone", "Blocking waiting for file lock on package cache", a
  truncated wasm ("failed to parse WebAssembly module: unexpected end-of-file"),
  `ERR_CONNECTION_REFUSED` on 5173, and "Gave up waiting for the seeded book" — none
  of which name the actual cause. This is easy to trigger without meaning to,
  because the Stop hook runs the gate on its own schedule as well. A `flock` on a
  lockfile at the top of `verify.sh`, either waiting or refusing with a clear
  message, would turn a confusing half-hour into one line of output. Cost one
  session most of an afternoon chasing failures that were not in the code.

- **`scope-guard` fires now, but its *warning* path has never run in CI.** Run #15 on
  `112864b` reported `scope-guard -> success` rather than `skipped`, which closes the
  question this entry was opened to answer: the job executes on push. What that run
  diffed contained no scope contract, so what has been observed in CI is the silent
  path. The warning path is covered locally only. Nothing to do — the next commit that
  touches a `docs/*-scope.md` will produce the annotation or reveal that it does not;
  check the run when it happens, and delete this entry either way.

- **Nothing still checks `ci.yml` before it is pushed.** Moving the scope-guard logic
  into a script narrowed this — that shell is now covered by the `shell-syntax` stage
  and runnable by hand — but the YAML around it is not. The `if:` condition that made
  the job inert for fourteen runs is exactly the class of fault a parse-and-assert
  stage would catch, and it remains uncaught. Supersedes the earlier note above,
  which asked for the same thing with a weaker argument.

- **Durable identity is the strongest candidate for v0.3.** Once v0.2 is at a public URL,
  progress still lives in one browser's localStorage with no recovery path. Deferred here
  only because it needs mail infrastructure, not because it is unimportant.
