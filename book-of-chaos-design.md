# Book of Chaos — Product Design Document

**Version:** 0.1.0 (Pre-Alpha Draft)  
**Status:** Internal Design Reference  
**Last Updated:** April 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Core Concepts & Terminology](#2-core-concepts--terminology)
3. [User Identity & Authentication](#3-user-identity--authentication)
4. [Roles & Permissions](#4-roles--permissions)
5. [Book Structure](#5-book-structure)
6. [Knowledge Blocks](#6-knowledge-blocks)
7. [Knowledge Map & Dependency Visualization](#7-knowledge-map--dependency-visualization)
8. [Reading Plans & Progress Tracking](#8-reading-plans--progress-tracking)
9. [Authoring & Contribution Tools](#9-authoring--contribution-tools)
10. [Version Control & Release Cycle](#10-version-control--release-cycle)
11. [Comments, Ratings & Reviews](#11-comments-ratings--reviews)
12. [Styling & Formatting](#12-styling--formatting)
13. [Internationalization Scaffolding](#13-internationalization-scaffolding)
14. [Data Architecture (SpacetimeDB)](#14-data-architecture-spacetimedb)
15. [Future Considerations](#15-future-considerations)

---

## 1. Project Overview

**Book of Chaos** is a virtual, interactive knowledge publishing engine built on SpacetimeDB. It gives authors a structured environment for organizing and publishing knowledge while giving readers a flexible, non-linear way to explore that knowledge, track their progress, and navigate dependencies between concepts.

Rather than presenting content as a fixed sequence of pages, Book of Chaos represents a book as a **dependency graph** — a living knowledge map where some content is immediately accessible, some is unlocked through prior reading, and readers can chart their own path toward any goal they choose.

### Design Goals

- Authors can model real knowledge dependencies without forcing a single rigid reading order on readers
- Readers have agency: they can explore freely, or generate an optimized learning plan toward a specific goal
- Progress is visual, spatial, and motivating — the knowledge map replaces the table of contents as the primary navigation surface
- Content is versioned, staged, and tested before reaching readers
- The platform is collaborative: multiple contributors, peer grading, and community feedback are first-class features

### Technology Foundation

- **SpacetimeDB** for real-time state sync, reducer-based atomic operations, event sourcing, and row-level access control
- All user interactions (reads, completions, ratings, quiz submissions) are events stored and replayable for analytics

---

## 2. Core Concepts & Terminology

| Term | Definition |
|---|---|
| **Book** | The top-level unit of content. A book contains chapters, has a single Owner, and is versioned. |
| **Chapter** | A named grouping of knowledge blocks within a book. May have dependencies on other chapters. |
| **Knowledge Block** | The atomic unit of content. A rich HTML block containing text, media, or interactive elements. |
| **Dependency** | A relationship declaring that one chapter or block must be completed before another becomes available. |
| **Knowledge Map** | An interactive Mermaid-rendered graph visualizing chapters/blocks as nodes with dependency edges. |
| **Reading Plan** | A personal calendar-based schedule generated per reader mapping available content to target dates. |
| **Critical Path** | The minimum prerequisite chain between a reader's current state and a selected locked target block. |
| **Version** | A named snapshot of a book's state created at each publish event. |
| **Staged Content** | Unpublished changes visible only to Testers and Contributors on that book. |
| **Tag** | An author-defined label applied to knowledge blocks for categorization, filtering, and visual styling. |

---

## 3. User Identity & Authentication

### Account Creation

- Email-based registration with mandatory email verification before account activation
- OAuth provider hooks (Google, GitHub) stubbed for future use; not active in v1
- At signup, users must accept the **User Agreement**, which includes:
  - Confirmation that the user is **18 years of age or older**
  - Agreement version number recorded per user account
  - Re-prompt required on material policy changes; users cannot use the platform until re-accepted
- **Username** is unique across the platform, set once at account creation, and **permanently immutable**
- **Display Name** is a separate, editable field with no uniqueness constraint

### Profile

- Optional profile picture: upload from device, server-side resized and optimized; default avatar auto-generated from username initials
- Optional bio (free text)
- Public profile page showing: username, display name, optional bio, badges earned, and a user-controlled visibility toggle for in-progress and completed books
- Reading streak counter (days with at least one block completed)
- Contribution history visible on author/contributor profiles

### Account Management

- Email change requires re-verification of new address
- Password reset via email link
- Notification preferences (in-platform and email, independently toggleable)
- Theme preference: light / dark / system

---

## 4. Roles & Permissions

### Platform-Level Roles

| Role | Description |
|---|---|
| **Reader** | Default role for all authenticated users. Can read published content, track progress, comment, rate, and review. |
| **Author** | Any user can create a book and become its Owner/Author. No special platform-level grant required. |
| **Platform Admin** | Elevated platform role. Can execute book ownership transfers. |

### Per-Book Roles

Each book has its own roster of assigned roles, managed by the book Owner.

| Role | Assigned By | Capabilities |
|---|---|---|
| **Owner** | Set at creation; transferred via Admin | Publish, roll back versions, manage contributor/tester roster, delete book, configure all book settings. Exactly one Owner per book at all times. |
| **Contributor** | Owner | Create and edit blocks in assigned chapters; cannot publish. Can leave internal authoring comments. |
| **Tester** | Owner | View and interact with staged (unpublished) content; leave internal feedback on staged blocks before they go live. |
| **Reader** | All authenticated users (default) | Access all fully published content. |

### Ownership Transfer

Ownership transfer is a **two-phase process** — it is never instant.

1. A **Platform Admin** initiates a transfer, specifying the current Owner and the proposed new Owner.
2. The proposed new Owner receives an in-platform notification and email with an **Accept** or **Decline** action.
3. If the proposed Owner **accepts**, the transfer finalizes immediately:
   - The new Owner gains full Owner-level access
   - The previous Owner is automatically downgraded to **Contributor** on that book (preserving their access without authority), unless the new Owner explicitly removes them
   - A transfer log entry is written: previous owner, new owner, executing Admin, timestamp, and optional reason note
   - Both parties and the executing Admin receive a confirmation notification
4. If the proposed Owner **declines**, or if **7 days pass without a response**, the transfer **expires and is cancelled** with no change to ownership.
5. Ownership transfer is irreversible by the previous Owner — only a Platform Admin can initiate another transfer.
6. Transfer does not reset version history, reader progress, reviews, or any other book data.

---

## 5. Book Structure

### Books

- A book has: title, description, cover image, banner image, Owner, version history, and publication status
- Books can be in one of these states: `Draft`, `Published`, `Archived`
- Archived books are hidden from discovery but remain accessible via direct link for existing readers
- Authors can duplicate a book as a starting template for a new one

### Parts (Optional)

- An optional higher-level grouping above chapters, for large books that benefit from a two-tier hierarchy (e.g., Part I, Part II)

### Chapters

- Chapters have: title, description, optional thumbnail image, visibility state (`Draft`, `Staged`, `Published`, `Archived`), and a **Block Order Mode**
- Chapter-level dependency: authors can declare that a chapter requires completion of one or more other chapters before it becomes available to readers
- **Free Roam Mode** (per book): author can globally disable dependency enforcement, allowing readers to access any chapter in any order
- Authors can mark chapters as **Optional** (not required for overall book completion) or **Required**
- **Pinned Chapters**: always accessible regardless of dependency state (e.g., Glossary, Appendix, Reference Material)
- Estimated read time auto-calculated from word count and embedded media duration, displayed per chapter and aggregated per book

#### Block Order Mode (per chapter)

- `Fixed` (default): blocks appear in author-defined sequence
- `Randomized`: blocks that are currently **available and unread** for the given reader are shuffled; completed blocks remain in place; locked blocks do not enter the shuffle pool until prerequisites are met
  - **Stable Shuffle** toggle: randomize once per reader on first chapter visit and keep that order permanently (useful for removing sequence bias while maintaining consistency)
  - **Randomized** chapters display a shuffle indicator icon on their knowledge map node
  - Quiz and Assignment blocks always appear after their associated Reading blocks are complete, regardless of shuffle order — this constraint is enforced automatically

---

## 6. Knowledge Blocks

### Block Types

| Type | Description |
|---|---|
| `Reading` | Primary content block: text, media, links |
| `Quiz` | Auto-graded assessment |
| `Assignment` | Submission-based task with configurable grading |
| `Reflection` | Prompted free-write; private or author-visible |
| `Resource Link` | Curated external reference |
| `Milestone` | Meta-block; completes when a defined set of prior blocks are all complete |

### Block Content

Knowledge blocks are rich HTML blocks supporting:

- Paragraphs, headings, inline formatting (bold, italic, underline, strikethrough)
- Ordered and unordered lists
- Code snippets with syntax highlighting
- Blockquotes and callout/alert boxes
- Tables
- Embedded images (upload or URL)
- Embedded video (YouTube, Vimeo, direct upload)
- Iframes for external tools
- Hyperlinks to external sites

### Block Metadata

Each block carries: title, type, tags (multi-tag), estimated read time (author-set or auto-calculated), difficulty rating (author-set), last updated timestamp, and a stable external ID (for use with bulk import/idempotent re-import).

### Completion Mechanisms

| Block Type | Completion Method |
|---|---|
| `Reading` | "Mark as Complete" button at the bottom, OR auto-complete after configurable scroll threshold |
| `Quiz` | Pass score threshold (author-configured); retake policy configurable; immediate feedback on submission |
| `Assignment` | On submission; grading modes: `Ungraded`, `Auto-graded` (rubric-based), `Peer-graded` (N reviewers randomly assigned from reader cohort), `Author-graded` |
| `Reflection` | On submission; author configures whether content is private to reader or visible to author/contributors |
| `Resource Link` | "Mark as Complete" button |
| `Milestone` | Automatically triggered when all defined prerequisite blocks are complete |

### Block Prerequisites

- Each block can declare its own prerequisite set independent of chapter-level dependencies
- Prerequisites can reference blocks within the same chapter or across other chapters
- Prerequisite chains are resolved and validated at publish time to prevent circular dependencies

### Block Reuse

- Blocks can be referenced across multiple chapters
- Completion state is shared — completing a block in one context marks it complete everywhere it appears

### Bulk Import

Authors can load knowledge blocks in bulk via CSV or JSON:

**CSV columns:** `chapter_id`, `block_type`, `title`, `body_html`, `tags`, `prerequisites`, `completion_type`, `quiz_json`

**JSON:** Supports full nested structure with embedded quiz definitions and assignment rubrics.

- Import validation report surfaces all errors before committing
- Idempotent re-import: blocks are matched by stable external ID and updated rather than duplicated

---

## 7. Knowledge Map & Dependency Visualization

The Knowledge Map is the primary navigation surface for readers, replacing the traditional table of contents. It is rendered as an interactive graph using **Mermaid syntax**, with node and edge states updated in real time via SpacetimeDB subscriptions.

### Node States

| State | Visual Indicator | Description |
|---|---|---|
| Blocked | 🔒 Dimmed, lock icon | Prerequisites not yet met |
| Available | 🟡 Yellow outline | Prerequisites met; not started |
| In Progress | 🔵 Blue fill | At least one block completed |
| Complete | ✅ Green fill | All required blocks completed |
| Optional | ⭐ Star badge | Marked optional by author |

### Edge Styles

- **Hard dependency**: solid directed edge (prerequisite strictly required)
- **Soft suggestion**: dashed directed edge (recommended order, not enforced)

### Map Features

- Toggleable granularity: view at chapter level or expand to individual block level
- Clickable nodes navigate directly to that chapter or block
- Filter map by tag/category: shows/hides nodes with visual consistency matching the tag color scheme
- **Critical path highlight**: highlights the minimum prerequisite chain from reader's current position to book completion or to a selected locked target block
- Mini-map thumbnail persistent in reader sidebar for large books
- Export map as static PNG or SVG for sharing
- **Shuffle indicator icon** on chapter nodes using Randomized block order mode

### Author View

Authors see a separate authoring-mode map showing Draft, Staged, and Archived nodes alongside Published nodes. Internal authoring comments and staging state are visible; reader-facing annotations are not.

### Tag-Driven Node Styling

- Each tag has an author-assigned **color** and optional **node shape** (rounded rectangle, hexagon, circle)
- Blocks with multiple tags: author defines tag priority order; highest-priority tag's style renders as the primary node style, with a secondary color accent indicating additional tags
- Tag styles are reflected consistently across: knowledge map nodes, chapter/block list views (colored badge pills), reader sidebar filter panel, and block headers in the reading view (subtle left border or header band in tag color)
- One tag may be designated the **Category tag** — its color drives the legend grouping on the knowledge map
- Tag style changes apply to staged/preview immediately and go live on next publish

---

## 8. Reading Plans & Progress Tracking

### Scheduling Philosophy

No content is ever locked by date. All scheduling features are reader-side guidance only — they influence suggestions and reminders but never gate access to content.

### Reading Plan

Each reader has a personal Reading Plan: a calendar-based schedule mapping available/unlocked content to target dates.

- Authors set optional **suggested target dates** per block or chapter, which seed the default plan for new readers
- The plan respects prerequisite ordering: dependent blocks are never scheduled before their prerequisites
- Estimated read times (per block) drive how content is distributed across the plan calendar

### "Update Reading Plan" Button

When a reader falls behind their plan, the Update Reading Plan action reschedules all remaining unfinished content forward from today's date, **preserving relative gaps** between dependent blocks. Example: if Block B was planned 3 days after Block A in the original plan, that 3-day gap is maintained in the rescheduled version.

### Learning Aggression Rate

Reader-configured target of X minutes per week of reading time. The system uses block estimated read times to distribute content across the plan at the chosen pace.

- Front-loads critical path items; fills remaining weekly capacity with available optional/parallel content
- Displayed as a friendly label alongside the raw value:
  - *Relaxed (30 min/week)*
  - *Steady (1 hr/week)*
  - *Intensive (3 hrs/week)*
  - Custom (user-specified)
- Adjusting aggression rate at any time triggers automatic plan recalculation with gap-preserving reschedule logic

### Critical Path to Target

A reader can select any locked (not-yet-available) knowledge block as a personal learning goal. The system computes the **minimum prerequisite chain** required to reach it via SpacetimeDB graph traversal.

1. The critical path is highlighted on the knowledge map before the reader commits
2. Reader can choose to: merge the critical path into their existing plan, or replace their current plan with a path-focused plan
3. The generated plan is scoped to the prerequisite chain only, distributed according to the reader's aggression rate

### Reminders

On-platform notifications and optional email reminders triggered by the reading plan:

- "You have N blocks planned for today"
- "You are N days behind your plan for [Chapter Name]"
- "Next suggested block: [Block Title]"

### "Next Up" Widget

A persistent surface in the reader UI showing the next 1–3 suggested blocks based on the current plan date, with a quick-launch button directly into the content.

### Reading Streak

Days with at least one block completed. Displayed on the user's profile.

---

## 9. Authoring & Contribution Tools

### Authoring UI

- Rich block editor with live preview
- Drag-and-drop block reordering within chapters; chapter reordering within books
- Block dependency editor: visual selector for assigning prerequisites to a block
- Inline authoring comments (internal, never visible to readers) for collaboration between Owner and Contributors

### Contributor Workflow

- Contributors can create and edit blocks in chapters the Owner has assigned to them
- Owner reviews and approves or rejects contributor changes before they are staged or published
- Tester role users can interact with staged content and submit internal feedback before a version goes live

### Analytics Dashboard (per book, Owner/Contributor view)

- Reader counts, completion rates per chapter and block, drop-off points
- Quiz pass rates and average attempt counts
- Average ratings per block, comment volume over time
- Block-level heatmap: where readers spend the most and least time
- Completion funnel visualization

### Bulk Import

See [Section 6 — Bulk Import](#block-reuse) for CSV/JSON template specification.

---

## 10. Version Control & Release Cycle

### Version Snapshots

Every Publish action creates a named version snapshot using either semver-style (`1.0.0`, `1.1.0`) or author-named labels (`"Spring 2025 Edition"`).

### Diff View

Authors can compare any two versions side by side:

- Added blocks: green
- Removed blocks: red
- Modified blocks: yellow
- Unchanged blocks: gray

### Staged Content

All changes live in a staged state before publishing. Staged content is visible only to users the Owner has assigned as **Tester** on that book. Testers can leave internal feedback on staged content before it goes live.

### Version Rollback

Authors can roll back to any prior published version at any time.

### Reader Version Upgrades

When a new version is published, readers currently working through the book receive an in-platform notification. They can choose when to upgrade their reading session to the new version. If the new version modifies or removes blocks the reader has already completed, a warning is shown before they confirm the upgrade.

### Version Changelog

Author-written release notes are attached to each published version and visible to readers.

### Review Version Capture

Book reviews automatically record the version at time of submission (see Section 11).

---

## 11. Comments, Ratings & Reviews

### Block-Level Comments

- Threaded comments per block
- Upvote on individual comments
- Readers can edit or delete their own comments within a configurable author-set window (default: 24 hours)
- Authors and Contributors can hide or delete any comment; reported comments are flagged for platform moderation review
- Comment search within a book

### Block-Level Ratings

- Thumbs up / thumbs down per block (simple sentiment, not numeric score)

### Author Controls (per book and per block)

| Setting | Options |
|---|---|
| Comments enabled | On / Off |
| Ratings enabled | On / Off |
| Complete before commenting | On (comment form hidden until block is complete) / Off |
| Complete before rating | On / Off |

Block-level settings override book-level defaults.

### Comment Notifications

- Authors/Contributors notified of new comments on their blocks
- Readers notified of replies to their own comments

### Book-Level Reviews

Readers can submit one public review per book (editable after submission).

Each review **automatically captures at submission time:**

- Book version at time of review
- Total chapters and knowledge blocks published at that snapshot
- Percentage of available content the reviewer had completed at time of submission
- Reader's cumulative reading duration (first block started → review submitted)

**Review fields:** star rating (1–5), headline, body text.

**Review features:**

- Paginated and sortable: most recent, most helpful, highest/lowest rated
- Helpfulness voting by other readers ("Was this review helpful?")
- Owner can post one public response per review
- Owner can flag a review for platform moderation (cannot unilaterally delete)
- Reviews feed visible on book discovery/landing page

---

## 12. Styling & Formatting

### Book-Wide Theme

- Font family, font size scale, primary and accent colors, background color, line spacing, maximum content width
- Predefined theme presets as starting points: `Academic`, `Technical Docs`, `Narrative`, `Minimal`
- Dark mode respects system preference; reader can override manually
- Custom CSS injection at the book level (author-controlled, sandboxed) for advanced needs

### Tag-Based Style Overrides

Authors assign each tag:

- A **color** (reflected on knowledge map nodes, block headers, badge pills, sidebar filters)
- An optional **node shape** for knowledge map rendering (rounded rectangle, hexagon, circle)
- Multi-tag priority order determines which tag's style wins for map node rendering; secondary tags appear as color accents

One tag may be designated the **Category tag**, whose color drives the knowledge map legend.

### Per-Category Style Overrides

Blocks carrying a given category tag inherit a distinct visual style (e.g., all "Warning" blocks: red left border, yellow background). Authors configure these styles in the tag editor.

### Per-Block Style Overrides

Individual blocks can override book-wide and category styles for one-off formatting needs.

### Block Layout Variants

- `Full-width`
- `Two-column`
- `Sidebar-note`
- `Centered-narrow`

### Book Imagery

- Cover image and banner image per book
- Thumbnail image per chapter

---

## 13. Internationalization Scaffolding

Multi-language support is **not included in v1**, but the architecture is designed to accommodate it without structural changes.

- All user-facing strings are extracted to a locale key/value store from day one — no hardcoded UI copy
- Database schema includes a nullable `locale` field on books, chapters, and blocks — unpopulated in v1, reserved for multilingual content in future releases
- Content negotiation headers are plumbed through the API layer, returning a single locale (`en-US`) in v1
- All dates, numbers, and currency values are routed through locale-aware formatters (defaulting to `en-US`) so they are trivially replaceable
- CSS uses logical properties throughout (`margin-inline-start` rather than `margin-left`) to support RTL layouts without stylesheet rewrites in a future release

---

## 14. Data Architecture (SpacetimeDB)

### Core Design Patterns

- **Real-time sync** of reader progress across devices via SpacetimeDB table subscriptions
- **Server-side reducers** for all atomic operations: completing blocks, submitting quizzes, publishing versions, posting comments, transferring ownership
- **Optimistic UI updates** with server-side conflict resolution for concurrent readers
- **Event sourcing** for all user interactions (reads, completions, ratings, submissions), enabling analytics replay and audit trails
- **Row-level security** enforced via SpacetimeDB identity model:
  - Readers see only published content
  - Testers see staged + published content for their assigned books
  - Contributors see draft + staged + published content for their assigned chapters
  - Owners see all states for their books

### Key Tables (Conceptual)

| Table | Purpose |
|---|---|
| `users` | Account records, username, display name, email, profile picture, agreement version |
| `books` | Book metadata, owner identity, publication status, current version reference |
| `chapters` | Chapter metadata, book reference, dependency declarations, block order mode |
| `knowledge_blocks` | Block content, type, tags, prerequisites, completion config, external ID |
| `block_tags` | Tag definitions per book: name, color, shape, priority, category flag |
| `reader_progress` | Per-reader, per-block completion state and timestamps |
| `reading_plans` | Per-reader scheduled plan: block references, target dates, aggression rate |
| `versions` | Version snapshots: semver/name, diff references, changelog, publish timestamp |
| `comments` | Block-level comments, parent references for threading, visibility state |
| `ratings` | Per-reader, per-block thumbs up/down |
| `reviews` | Per-reader, per-book review with captured version stats |
| `ownership_transfers` | Pending transfer records: from, to, initiating admin, expiry timestamp, status |
| `book_roles` | Per-book role assignments: user, book, role (`contributor`, `tester`) |

### Offline Support

- Offline reading mode: local state captured in browser storage for active reading sessions
- Sync-on-reconnect resolves local state against SpacetimeDB with last-write-wins conflict policy per block completion event

---

## 15. Future Considerations

The following items are out of scope for v1 but are explicitly called out for forward compatibility:

- **Multi-language content**: Locale field stubbed in schema; formatter infrastructure in place; full translation workflow deferred
- **OAuth providers**: Google and GitHub hooks stubbed in auth layer; activation deferred
- **Mobile apps**: Architecture is API-first; mobile client development deferred
- **Advanced peer grading workflows**: Peer grading is supported in v1 at a basic level (N random reviewers); rubric standardization, appeals, and weighted scoring are future work
- **Marketplace / discovery**: Book discovery and search across the platform is deferred; v1 assumes books are accessed via direct link or invitation
- **API access for authors**: Programmatic book management via REST/GraphQL API is deferred; v1 is UI-only for authoring

---

*Book of Chaos — Internal Design Document. All features subject to revision prior to implementation.*
