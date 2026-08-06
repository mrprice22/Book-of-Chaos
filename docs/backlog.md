# v0.1 Backlog — Autopilot Work Queue

This file is the autopilot's task queue and its memory between sessions. It is the
**single source of truth for what to do next**.

## Rules

- Work tasks **strictly top to bottom**. Do not skip ahead.
- Exactly one task may be `[~]` (in progress) at a time.
- A task is only `[x]` when its acceptance criteria are met **and** `./scripts/verify.sh` exits 0.
- Check the box in the same commit as the work.
- Do not add features that are not in [mvp-scope.md](./mvp-scope.md). If a task seems to
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
- [~] **M8.4** `.github/workflows/ci.yml` green on `main`
- [x] **M8.5** `docs/testing-runbook.md` — human walkthrough, under 10 minutes
- [ ] **M8.6** Tag `v0.1.0`

**Acceptance:** every item in the [Definition of Done](./mvp-scope.md#definition-of-done-for-v01) passes.

---

## Post-MVP parking lot

Ideas encountered while building that are out of scope. **Append here instead of building them.**

- **Reducer wiring is not covered by *automated* tests.** Every rule in
  `rules.rs` is tested directly, and every mutating reducer is verified by
  inspection to call one before it mutates — but nothing in `verify.sh` would
  catch someone *deleting* a `rules::require_owner(...)` line, because
  SpacetimeDB reducers need a running database to invoke. M7.4 confirmed all six
  author writes are refused for a non-owner against a live instance, via a
  throwaway TS harness over the real SDK (2026-08-06); that harness is the right
  shape for a permanent stage, but it cannot join the gate until CI can bring up
  a database. The Playwright smoke test (M8.3) will cover the happy paths.

- **Chapter state will be computed twice — once in Rust, once in TypeScript.**
  M3.3 derives chapter state from `reader_progress` on read rather than
  materialising it into a table, so the map (M6) has to compute the same four
  states client-side from the subscription. The alternative — a
  `(reader, chapter) -> state` table maintained by the reducer — needs rows for
  chapters the reader has never touched, and needs every reader's rows
  recomputed whenever an author edits a dependency. That is a cache-invalidation
  problem in exchange for removing a ~20-line function. The server stays
  authoritative: `complete_block` refuses a Blocked chapter, so the TS copy is
  UX, per the trust-boundary rule in CLAUDE.md. Worth revisiting only if the two
  ever disagree.

- **wasm-opt / binaryen not installed.** `spacetime publish` warns "Could not find
  wasm-opt to optimise the module" and ships an unoptimised wasm. Harmless for the
  demo. Awkward to fix consistently: binaryen is a `dnf` package (Containerfile,
  container only) while CI installs toolchains via `scripts/install-toolchain.sh` on
  a plain runner, so a naive fix makes local and CI diverge — exactly what
  `toolchain-versions.sh` was introduced to prevent.
