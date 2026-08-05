# MVP Scope — v0.1 "Walking Skeleton"

**Status:** authoritative scope contract for the autopilot. Nothing outside this document
gets built before v0.1 is deployed and testable.

The full [design document](../book-of-chaos-design.md) describes the destination. This
document describes the *first shippable slice* — the smallest build that proves the
product's central thesis:

> A dependency graph is a better table of contents than a list of pages.

Everything that does not serve that sentence is deferred.

---

## The one-sentence MVP

*One author creates a book with chapters that depend on each other; one reader sees a live
knowledge map, reads unlocked chapters, marks blocks complete, and watches nodes unlock in
real time across two browser tabs.*

If that demo works, v0.1 is done.

---

## In scope

### Identity
- SpacetimeDB native identity (anonymous connect + persisted identity token in localStorage)
- One-time `username` claim, unique, immutable
- Editable `display_name`

### Content model
- `Book` → `Chapter` → `KnowledgeBlock`
- Block types: `Reading` and `ResourceLink` only
- Block body: sanitized HTML subset (headings, paragraphs, lists, code, links, images)
- Chapter-level **hard** dependencies only
- Fixed block order only

### Unlock engine
- Chapter is `Available` when every prerequisite chapter is `Complete`
- Chapter is `Complete` when every non-optional block in it is complete
- Cycle detection rejected at write time, not publish time
- `Optional` and `Pinned` chapter flags (cheap, and they materially change the graph)

### Reader experience
- Knowledge map: Mermaid-rendered chapter graph, 4 node states (Blocked / Available / In Progress / Complete)
- Clickable nodes → chapter view
- Chapter view: ordered blocks, "Mark as complete" button
- Progress syncs live via SpacetimeDB subscription (verified with two tabs)

### Author experience
- Create book, chapter, block through plain forms — no rich editor, no drag-and-drop
- Declare chapter prerequisites via a multi-select
- `Publish` = flip book status `Draft` → `Published`. No snapshots, no diffing.

### Roles
- `Owner` (book creator) and `Reader` (everyone else). Nothing else.

---

## Explicitly deferred

Each of these is a real feature from the design doc, deliberately postponed. Deferring is
not cancelling — but the autopilot must not build them in v0.1.

| Deferred | Why it waits |
|---|---|
| Quiz, Assignment, Reflection, Milestone blocks | Each is a subsystem; `Reading` proves the loop |
| Email auth, verification, password reset | Requires mail infrastructure; native identity is enough to test |
| Versioning, snapshots, diff view, rollback | Meaningless before there is content worth versioning |
| Staged content, Testers, Contributors | Multi-role workflow with a single-user demo has nothing to show |
| Comments, ratings, reviews | Community layer; needs an audience first |
| Reading plans, aggression rate, critical path, "Next Up" | Scheduling on top of a graph that isn't proven yet |
| Tags, tag styling, themes, custom CSS | Pure presentation; blocks the demo on taste debates |
| Randomized / stable-shuffle block order | Complexity in the ordering layer for no MVP signal |
| Bulk CSV/JSON import | Author forms are enough to seed a demo book |
| Analytics dashboard, heatmaps | Requires readers you do not have yet |
| Ownership transfer | Two-phase workflow, zero MVP value |
| Offline mode, sync-on-reconnect | Hard distributed-systems work; needs the online path solid first |
| i18n scaffolding | See "Carried forward" — partially honored, cheaply |

## Carried forward from the design doc

Three design-doc commitments are cheap now and expensive to retrofit, so v0.1 honors them
even though the features they serve are deferred:

1. **No hardcoded UI copy.** All strings live in `client/src/i18n/en-US.ts` and are read
   through a `t()` helper. The lookup is a plain object — no i18n library in v0.1.
2. **Nullable `locale` column** on `books`, `chapters`, `knowledge_blocks`. Unpopulated.
3. **CSS logical properties** (`margin-inline-start`, not `margin-left`) throughout.

These cost minutes now and days later. Everything else defers.

---

## Definition of Done for v0.1

v0.1 ships when every one of these is true:

1. `./scripts/verify.sh` exits 0 from a clean clone
2. `./scripts/deploy.sh local` brings up SpacetimeDB + the client, reachable in a browser
3. The seed script creates a demo book with at least 5 chapters and a branching dependency graph
4. A reader can complete a block and see a map node change state **in a second browser tab, without reloading**
5. `docs/testing-runbook.md` walks a human through the demo in under 10 minutes
6. CI is green on `main`

Item 4 is the load-bearing one. It is the product.
