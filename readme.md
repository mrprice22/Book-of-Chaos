# 📖 Book of Chaos

> A virtual, interactive knowledge publishing engine where authors define the map and readers chart their own path.

Book of Chaos replaces the traditional table of contents with a **live dependency graph** — a knowledge map where content unlocks progressively, readers can generate optimized learning plans toward any goal, and authors have full control over structure, styling, versioning, and community feedback.

Built on [SpacetimeDB](https://spacetimedb.com) for real-time state sync across all readers and devices.

---

## 📄 Documentation

- [Design Document](./book-of-chaos-design.md) — Full product design reference including data architecture, role model, and system behavior

---

## ✨ Planned Features

### 🏗️ Core Architecture
- Real-time reader progress sync across devices via SpacetimeDB subscriptions
- Server-side reducers for all atomic operations (block completion, quiz submission, publishing, ownership transfers)
- Optimistic UI updates with server-side conflict resolution
- Event sourcing for all user interactions, enabling analytics replay and audit trails
- Row-level access control: readers see published content, testers see staged, contributors see drafts
- Offline reading mode with sync-on-reconnect

---

### 👤 User Identity & Profiles
- Email-based authentication with verification; OAuth hooks (Google, GitHub) stubbed for future use
- Unique username — set once at account creation, permanently immutable
- Separate editable display name
- Optional profile picture with server-side resize/optimization; initials-based default avatar
- Optional bio and public profile page
- User-controlled visibility toggle for in-progress and completed books on public profile
- Reading streak tracking (days with at least one block completed)
- Badges and contribution history displayed on profile
- Account settings: email change (re-verification required), password reset, notification preferences, theme preference
- 18+ user agreement enforced at signup; agreement version tracked per user; re-prompt on material policy changes

---

### 🔐 Roles & Permissions

#### Platform Roles
- **Reader** — default for all authenticated users
- **Author** — any user who creates a book; becomes that book's Owner
- **Platform Admin** — can initiate book ownership transfers

#### Per-Book Roles
- **Owner** — publish, roll back, manage roster, configure all settings; exactly one per book
- **Contributor** — create/edit blocks in assigned chapters; cannot publish
- **Tester** — view and interact with staged content; submit internal pre-release feedback

#### Ownership Transfer
- Initiated by a Platform Admin only
- Two-phase process: proposed → pending acceptance by the receiving user
- Receiving user must accept within **7 days** or the transfer expires and is cancelled with no change
- On acceptance: previous Owner auto-downgraded to Contributor; full transfer log written; all parties notified
- Irreversible by previous Owner; only a Platform Admin can initiate another transfer

---

### 📚 Book & Chapter Structure
- Books contain optional Parts → Chapters → Knowledge Blocks
- Chapter-level dependency declarations (require completion of other chapters before unlocking)
- Free Roam Mode (per book): disable all dependency enforcement for fully open exploration
- Optional vs. Required chapter designation (for overall book completion tracking)
- Pinned chapters always accessible regardless of dependency state (e.g., Glossary, Appendix)
- Estimated read time auto-calculated per chapter and book (word count + media duration)
- Chapter visibility states: `Draft`, `Staged`, `Published`, `Archived`
- Book duplication as starting template for new books
- Book archiving (hidden from discovery; accessible via direct link for existing readers)

#### Block Order Mode (per chapter)
- `Fixed` — author-defined sequence (default)
- `Randomized` — shuffle available/unread blocks per reader per session
  - Stable Shuffle toggle: randomize once per reader and preserve that order permanently
  - Quiz/Assignment blocks always follow their associated Reading blocks regardless of shuffle
  - Shuffle indicator displayed on knowledge map chapter node

---

### 🧱 Knowledge Blocks

#### Block Types
- `Reading` — primary rich content block
- `Quiz` — auto-graded assessment
- `Assignment` — submission-based task (Ungraded / Auto-graded / Peer-graded / Author-graded)
- `Reflection` — prompted free-write; private or author-visible
- `Resource Link` — curated external reference
- `Milestone` — auto-completes when a defined set of prerequisite blocks are all complete

#### Block Content Support
- Paragraphs, headings, inline formatting, ordered/unordered lists
- Code snippets with syntax highlighting
- Blockquotes and callout/alert boxes
- Tables
- Embedded images (upload or URL)
- Embedded video (YouTube, Vimeo, direct upload)
- Iframes for external tools
- Hyperlinks to external sites

#### Completion Mechanisms
- Reading: "Mark as Complete" button or auto-complete after configurable scroll threshold
- Quiz: configurable pass threshold; configurable retake policy; immediate feedback
- Assignment: on submission; peer grading assigns N random reviewers from reader cohort
- Reflection: on submission
- Milestone: automatically triggered by prerequisite set completion

#### Block Features
- Per-block prerequisite declarations (within or across chapters)
- Block reuse across chapters with shared completion state
- Multi-tag support with author-defined tag taxonomy
- Author-set difficulty rating and estimated read time per block
- Stable external ID per block for idempotent bulk import/re-import

#### Bulk Import
- CSV template: `chapter_id`, `block_type`, `title`, `body_html`, `tags`, `prerequisites`, `completion_type`, `quiz_json`
- JSON template: full nested structure with embedded quiz definitions and assignment rubrics
- Pre-commit validation report surfaces all errors before import executes
- Idempotent re-import: matches by external ID and updates rather than duplicates

---

### 🗺️ Knowledge Map

- Interactive Mermaid-rendered dependency graph replaces the traditional table of contents
- Real-time node state updates via SpacetimeDB subscriptions
- Node states: 🔒 Blocked / 🟡 Available / 🔵 In Progress / ✅ Complete / ⭐ Optional
- Edge styles: solid (hard dependency) / dashed (soft suggestion)
- Toggleable granularity: chapter-level view or expanded block-level view
- Clickable nodes navigate directly to that chapter or block
- Filter map by tag: shows/hides nodes with visual consistency matching tag color scheme
- Critical path highlight: minimum prerequisite chain from current position to completion or selected target
- Mini-map thumbnail persistent in reader sidebar
- Export map as PNG or SVG
- Author view: shows Draft, Staged, and Archived nodes alongside Published nodes
- Shuffle indicator icon on Randomized-mode chapter nodes

#### Tag-Driven Node Styling
- Each tag has an author-assigned color and optional node shape (rounded rectangle, hexagon, circle)
- Multi-tag priority order determines primary style; secondary tags shown as color accents
- One tag may be designated the Category tag — drives knowledge map legend grouping
- Tag styles reflected consistently on: map nodes, block header accents, badge pills, sidebar filter panel

---

### 📅 Reading Plans & Progress

- No content locking by date — all scheduling is reader-side guidance only
- Author-set suggested target dates per block/chapter seed the default plan for new readers
- Personal, editable reading plan maps available content to calendar dates per reader
- **Update Reading Plan** — reschedules remaining content from today, preserving relative gaps between dependent blocks
- **Learning Aggression Rate** — reader-set minutes/week target; system distributes content accordingly
  - Friendly labels: Relaxed / Steady / Intensive / Custom
  - Adjusting rate triggers automatic plan recalculation
- **Critical Path to Target** — select any locked block as a goal; system computes minimum prerequisite chain via graph traversal
  - Critical path highlighted on knowledge map before reader commits
  - Reader can merge into existing plan or replace current plan
- **"Next Up" widget** — persistent surface showing next 1–3 suggested blocks with quick-launch button
- Reminders: in-platform and optional email notifications triggered by the reading plan schedule

---

### ✍️ Authoring & Contribution Tools
- Rich block editor with live preview
- Drag-and-drop block reordering within chapters; chapter reordering within books
- Visual dependency editor for assigning block prerequisites
- Inline internal authoring comments (never visible to readers)
- Contributor chapter assignment and change approval workflow
- Author analytics dashboard: reader counts, completion rates, drop-off points, quiz pass rates, average ratings, comment volume
- Block-level heatmap: time spent per block, completion funnel visualization

---

### 🔖 Version Control & Release Cycle
- Every Publish creates a named version snapshot (semver-style or author-named label)
- Diff view between any two versions: added (green), removed (red), modified (yellow), unchanged (gray)
- Staged changes visible only to assigned Testers before going live
- Testers submit internal feedback on staged content
- Version rollback to any prior published version
- Reader in-app notification on new published version; reader controls when to upgrade their session
- Upgrade warning shown if new version modifies or removes already-completed blocks
- Author-written release notes attached to each published version

---

### 💬 Comments & Ratings

#### Block-Level Comments
- Threaded comments per block with upvoting on individual comments
- Readers can edit or delete their own comments within a configurable window (default: 24 hours)
- Authors/Contributors can hide or delete any comment
- Reported comments flagged for platform moderation review
- Comment search within a book
- Notifications: authors notified of new comments; readers notified of replies

#### Block-Level Ratings
- Thumbs up / thumbs down per block

#### Author Controls (per book, overridable per block)
- Comments: enabled / disabled
- Ratings: enabled / disabled
- "Complete before commenting" gate
- "Complete before rating" gate

---

### ⭐ Book Reviews
- One public review per reader per book (editable)
- Auto-captures at submission: book version, total published chapters/blocks at that snapshot, reader's completion percentage, cumulative reading duration
- Review fields: star rating (1–5), headline, body text
- Paginated and sortable: most recent, most helpful, highest/lowest rated
- Helpfulness voting by other readers
- Owner can post one public response per review
- Owner can flag a review for platform moderation (cannot unilaterally delete)
- Reviews feed visible on book discovery/landing page

---

### 🎨 Styling & Formatting
- Book-wide theme: font family, font size scale, primary/accent colors, background color, line spacing, max content width
- Predefined theme presets: `Academic`, `Technical Docs`, `Narrative`, `Minimal`
- Dark mode: respects system preference; reader can override
- Custom CSS injection at book level (author-controlled, sandboxed)
- Per-tag style overrides: color, node shape, block header accent
- Per-category style overrides inherited by all blocks carrying that tag
- Per-block style overrides for one-off formatting
- Block layout variants: Full-width, Two-column, Sidebar-note, Centered-narrow
- Cover image and banner image per book; thumbnail image per chapter

---

### 🌐 Internationalization Scaffolding (v1 Foundation, Not Yet Active)
- All UI strings extracted to locale key/value store from day one — no hardcoded copy
- Nullable `locale` field on books, chapters, and blocks reserved for future multilingual content
- Content negotiation headers plumbed through API layer (returns `en-US` in v1)
- All dates, numbers, and currency routed through locale-aware formatters
- CSS uses logical properties throughout for RTL layout readiness

---

## 🚧 Out of Scope for v1

| Feature | Notes |
|---|---|
| Multi-language content | Schema and formatter scaffolding in place; translation workflow deferred |
| OAuth login providers | Hooks stubbed in auth layer; activation deferred |
| Mobile apps | API-first architecture; mobile client deferred |
| Advanced peer grading | Basic peer grading in v1; rubric standardization, appeals, and weighted scoring deferred |
| Book discovery / marketplace | v1 assumes access via direct link or invitation |
| Author API access | Programmatic book management deferred; v1 is UI-only for authoring |

---

## 📋 Project Status

> **Pre-Alpha** — Feature design phase. No implementation has begun.

---

*Book of Chaos is a working title.*
