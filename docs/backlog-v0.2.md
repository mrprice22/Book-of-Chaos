# v0.2 Backlog — DRAFT

**Not the live queue.** `docs/backlog.md` is. These sections get appended to it once
[v0.2-scope.md](./v0.2-scope.md) is approved — see its Activation section. Until then
autopilot will not, and should not, start any of this.

Same rules as the live backlog: strictly top to bottom, one `[~]` at a time, a task is
`[x]` only when its acceptance criteria are met **and** `./scripts/verify.sh` exits 0.

---

## M9 — Close the v0.1 debt

The three parking-lot entries, folded in. M9.1 is the one that matters: it closes a hole
in the safety net that every later milestone's autonomy rests on.

- [ ] **M9.1** `auth-reject` verify stage — a TS harness over the real SDK asserting all
      six author writes are refused for a non-owner identity, run against the live
      instance `e2e-smoke` already starts. Add the stage to `verify.sh` in the same commit
- [ ] **M9.2** Bump `actions/checkout` and `actions/cache` to `@v5`; confirm from the run
      log that the Node 20 deprecation warning is actually gone, not just relocated
- [ ] **M9.3** Install binaryen in **both** `Containerfile` and `scripts/install-toolchain.sh`,
      pinned through `scripts/toolchain-versions.sh` so local and CI cannot drift;
      `spacetime publish` stops warning about `wasm-opt`

**Acceptance:** deleting a `rules::require_owner(...)` call from any author reducer turns
the gate red. Verify by actually deleting one, watching it fail, and restoring it — an
authorization test that has never been seen to fail is not evidence.

---

## M10 — Quiz block: server

- [ ] **M10.1** `BlockType::Quiz`; `quiz_questions`, `quiz_options`, `quiz_config`
      (pass threshold) tables. The correct-answer column lives in a **non-public** table.
      **Test that a real client subscription cannot reach it** — if it can, stop and
      escalate per [v0.2-scope.md](./v0.2-scope.md#the-answer-key-must-not-reach-the-browser)
- [ ] **M10.2** `set_quiz` reducer — owner-only; validates ≥1 question, ≥2 options per
      question, ≥1 correct option per question, threshold in `1..=100`; question and
      option text sanitized server-side on write
- [ ] **M10.3** `submit_quiz` reducer — grades server-side, writes a `quiz_attempts` row,
      and completes the block only when score ≥ threshold. Refuses submission for a
      Blocked chapter, exactly as `complete_block` does
- [ ] **M10.4** Table-driven grading tests: all correct, all wrong, exactly at threshold,
      one mark below, multi-answer with a subset selected, unknown option id, submission
      to a block that is not a Quiz, and resubmission after an earlier pass

**Acceptance:** grading is a pure function over a submission and an answer key, testable
without a running database — same rule the unlock engine follows. `#[ignore]` on any of
these is not an option.

---

## M11 — Quiz block: reader and author UI

- [ ] **M11.1** Reader quiz view — render questions, select answers, submit, see score and
      which questions were wrong. All strings through `t()`
- [ ] **M11.2** Failing shows the score and a retry; passing completes the block and the
      map node changes state live, with no reload
- [ ] **M11.3** Author quiz form — add/remove questions and options, mark correct answers,
      set the pass threshold. Server rejections surfaced as readable errors, the way M7.2
      surfaced cycle rejection
- [ ] **M11.4** Extend the Playwright smoke test to cover fail-then-pass: submit a wrong
      answer, assert still locked, submit a right one, assert unlocked

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

Carried over from `docs/backlog.md`, minus the three entries M9 absorbs. Anything new
that arrives mid-task goes here rather than into the code.

- **Chapter state is computed twice — once in Rust, once in TypeScript.** M3.3 derives
  chapter state on read rather than materialising it, so the map computes the same four
  states client-side. Revisit only if the two ever disagree. Note that M12 adds a second
  instance of this shape for block state, which strengthens the case for revisiting it —
  and would double the cost of getting it wrong.

- **Durable identity is the strongest candidate for v0.3.** Once v0.2 is at a public URL,
  progress still lives in one browser's localStorage with no recovery path. Deferred here
  only because it needs mail infrastructure, not because it is unimportant.
