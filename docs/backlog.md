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

Ideas encountered while building that are out of scope. **Append here instead of building
them.** The three v0.1 entries that used to live here became M9.

- **Chapter state is computed twice — once in Rust, once in TypeScript.** M3.3 derives
  chapter state on read rather than materialising it, so the map computes the same four
  states client-side. Revisit only if the two ever disagree. Note that M12 adds a second
  instance of this shape for block state, which strengthens the case for revisiting it —
  and would double the cost of getting it wrong.

- **Durable identity is the strongest candidate for v0.3.** Once v0.2 is at a public URL,
  progress still lives in one browser's localStorage with no recovery path. Deferred here
  only because it needs mail infrastructure, not because it is unimportant.
