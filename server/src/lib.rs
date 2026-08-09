//! Book of Chaos — SpacetimeDB module.
//!
//! Content is a dependency graph, not a page sequence. This crate owns the graph,
//! the unlock rules, and the trust boundary: every reducer validates authorization
//! first, then inputs, then mutates. Client-side checks are UX, never security.
//!
//! Domain reducers arrive in M2 and the unlock engine in M3.

pub mod rules;
pub mod sanitize;
pub mod unlock;

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// v0.1 recognises no third state. `Archived` is in the design doc and deferred.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BookStatus {
    Draft,
    Published,
}

/// v0.2 adds `Quiz` — the block type that makes an unlock *earned* rather than
/// self-reported. `Assignment`, `Reflection` and `Milestone` remain deferred:
/// each is a submission or meta-block subsystem, and `Quiz` is the one that
/// closes v0.1's gap.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockType {
    Reading,
    ResourceLink,
    Quiz,
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/// A user row exists only once an identity has claimed a username. Anonymous
/// identities simply have no row here, which is what lets `username` carry a real
/// unique constraint instead of a placeholder value that every unclaimed identity
/// would collide on.
#[spacetimedb::table(accessor = users, public)]
pub struct User {
    #[primary_key]
    pub identity: Identity,
    /// Unique across the platform and immutable once claimed (M2.1).
    #[unique]
    pub username: String,
    /// Editable, no uniqueness constraint.
    pub display_name: String,
    pub created_at: Timestamp,
}

#[spacetimedb::table(accessor = books, public)]
pub struct Book {
    #[primary_key]
    #[auto_inc]
    pub book_id: u64,
    /// The creator. The only Owner — ownership transfer is deferred.
    #[index(btree)]
    pub owner: Identity,
    pub title: String,
    pub description: String,
    pub status: BookStatus,
    /// Unpopulated in v0.1. Carried forward from the design doc because a nullable
    /// column now is minutes and a backfill later is days.
    pub locale: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = chapters, public)]
pub struct Chapter {
    #[primary_key]
    #[auto_inc]
    pub chapter_id: u64,
    #[index(btree)]
    pub book_id: u64,
    pub title: String,
    pub description: String,
    /// Author-defined order within the book. Fixed ordering only in v0.1.
    pub position: u32,
    /// Optional chapters do not count toward book completion.
    pub is_optional: bool,
    /// Pinned chapters are reachable regardless of dependency state (glossary,
    /// appendix). Both flags are cheap and they materially change the graph.
    pub is_pinned: bool,
    pub locale: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = knowledge_blocks, public)]
pub struct KnowledgeBlock {
    #[primary_key]
    #[auto_inc]
    pub block_id: u64,
    #[index(btree)]
    pub chapter_id: u64,
    pub title: String,
    pub block_type: BlockType,
    /// Sanitized server-side on write (M2.4). Never trust the client's HTML.
    pub body_html: String,
    /// Target for a `ResourceLink`; `None` for a `Reading` block.
    pub url: Option<String>,
    pub position: u32,
    /// A chapter is Complete when every non-optional block in it is complete,
    /// so optionality lives on the block as well as the chapter.
    pub is_optional: bool,
    pub locale: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// One row per edge: `chapter_id` requires `depends_on_chapter_id` to be complete.
/// Chapter-level hard dependencies only — block-level prerequisites are deferred.
#[spacetimedb::table(accessor = chapter_deps, public)]
pub struct ChapterDep {
    #[primary_key]
    #[auto_inc]
    pub dep_id: u64,
    /// The dependent chapter — the one that stays Blocked.
    #[index(btree)]
    pub chapter_id: u64,
    /// The prerequisite chapter.
    #[index(btree)]
    pub depends_on_chapter_id: u64,
}

/// One row per edge: `block_id` requires `depends_on_block_id` to be complete.
///
/// The block-level twin of `ChapterDep`, and deliberately the same shape — the
/// same cycle search runs over both, so an edge is an edge. The difference is
/// scope: a chapter's prerequisites must be siblings in the same *chapter list*,
/// while a block's may sit in any chapter of the same book. That is the v0.2
/// scope's wording — "within its chapter or across chapters" — and it is why
/// `set_block_deps` gathers candidates book-wide rather than chapter-wide.
#[spacetimedb::table(accessor = block_deps, public)]
pub struct BlockDep {
    #[primary_key]
    #[auto_inc]
    pub dep_id: u64,
    /// The dependent block — the one that stays locked.
    #[index(btree)]
    pub block_id: u64,
    /// The prerequisite block.
    #[index(btree)]
    pub depends_on_block_id: u64,
}

/// One row per (reader, completed block). Absence means "not complete", so
/// `complete_block` is naturally idempotent (M3.3).
#[spacetimedb::table(accessor = reader_progress, public)]
pub struct ReaderProgress {
    #[primary_key]
    #[auto_inc]
    pub progress_id: u64,
    #[index(btree)]
    pub identity: Identity,
    #[index(btree)]
    pub block_id: u64,
    pub completed_at: Timestamp,
}

// ---------------------------------------------------------------------------
// Quiz tables
// ---------------------------------------------------------------------------
//
// Six tables, five of them public. SpacetimeDB pushes the rows of a public
// table to every subscribed client, so "which option is correct" cannot be a
// column on anything a reader can subscribe to — it would be a "Mark as
// complete" button with extra steps. The split below is the load-bearing
// architecture of v0.2:
//
//   quiz_config     public   — the pass threshold, which the reader is entitled to
//   quiz_questions  public   — prompt text, order, and how many answers to accept
//   quiz_options    public   — option text and order, and nothing about truth
//   quiz_attempts   public   — a reader's score and verdict, never their answers
//   quiz_attempt_results
//                   public   — which questions an attempt got right, never which
//                              options it picked
//   quiz_answer_key PRIVATE  — which options are correct. Reducer code only.
//
// `quiz_answer_key` carries no `public` attribute, so it is absent from the
// client schema entirely: `spacetime generate` emits no binding for it and a
// subscription naming it is refused by the server. That is asserted by
// `client/e2e/answer-key.spec.ts`, against a live database, rather than assumed.

/// Per-`Quiz`-block settings. One row per block, keyed by it, so a block either
/// has a quiz or does not — there is no "which config is current" question.
#[spacetimedb::table(accessor = quiz_config, public)]
pub struct QuizConfig {
    /// The `KnowledgeBlock` this quiz belongs to. Its `block_type` is `Quiz`.
    #[primary_key]
    pub block_id: u64,
    /// Percentage of questions that must be fully correct to pass, `1..=100`.
    /// Validated in `set_quiz` (M10.2).
    pub pass_threshold: u32,
}

#[spacetimedb::table(accessor = quiz_questions, public)]
pub struct QuizQuestion {
    #[primary_key]
    #[auto_inc]
    pub question_id: u64,
    #[index(btree)]
    pub block_id: u64,
    /// Sanitized server-side on write, exactly like `KnowledgeBlock::body_html`.
    pub prompt_html: String,
    /// Author-defined order within the quiz.
    pub position: u32,
    /// Whether more than one option is correct.
    ///
    /// This is the one fact about the answer key the reader is given, and it has
    /// to be: a radio group and a checkbox group are different controls, and the
    /// client cannot choose between them from private data. It reveals how many
    /// answers to select, never which — `set_quiz` keeps it consistent with the
    /// key rather than accepting it from the author.
    pub is_multi_answer: bool,
}

#[spacetimedb::table(accessor = quiz_options, public)]
pub struct QuizOption {
    #[primary_key]
    #[auto_inc]
    pub option_id: u64,
    #[index(btree)]
    pub question_id: u64,
    /// Sanitized server-side on write.
    pub text_html: String,
    pub position: u32,
}

/// One graded submission. Public, and per-reader like `ReaderProgress`.
///
/// It stores the verdict, not the submission: the score and whether it passed,
/// never which options were chosen. That keeps the table from becoming an oblique
/// copy of the answer key — rows saying "this selection scored 100%" would carry
/// exactly the fact `quiz_answer_key` exists to withhold, on a public table, for
/// every reader to read.
///
/// A row per attempt rather than a row per reader: retakes are unlimited in v0.2
/// and a passing attempt is not undone by a later failing one, so the history has
/// to survive. Attempt *policy* — caps, cooldowns, best-vs-last — is deferred, and
/// keeping every attempt is what leaves it implementable.
#[spacetimedb::table(accessor = quiz_attempts, public)]
pub struct QuizAttempt {
    #[primary_key]
    #[auto_inc]
    pub attempt_id: u64,
    #[index(btree)]
    pub identity: Identity,
    #[index(btree)]
    pub block_id: u64,
    /// Percentage of questions answered fully correctly, rounded down.
    pub score_percent: u32,
    /// `score_percent >= QuizConfig::pass_threshold`, decided server-side.
    pub passed: bool,
    pub submitted_at: Timestamp,
}

/// Per-question feedback for one attempt: which questions the reader got right.
///
/// Public, and the narrowest thing that can answer "which questions were wrong",
/// which the v0.2 scope lists as part of the feedback a reader gets on submission.
/// A reducer cannot return a value to its caller, so feedback has to be a row.
///
/// **What it deliberately does not store: the selections.** A row says "question 7
/// of attempt 12 was correct" and nothing about which options were ticked, for the
/// same reason `QuizAttempt` stores a verdict rather than a submission. To another
/// reader these rows are unreadable — they do not know what was selected, so
/// "correct" names no option.
///
/// To the reader who submitted it, though, this *is* a slow channel onto the answer
/// key: they know what they ticked, so a handful of retakes on a single-answer
/// question with three options will identify the right one. That is inherent to
/// telling anybody which questions they got wrong, under unlimited retakes — the
/// same information leaks through the score alone on a one-question quiz. It is
/// accepted rather than overlooked: the alternative is withholding the feedback the
/// release promised, and retake *policy*, which is where a cap on this would live,
/// is deferred. Nothing here widens it beyond the reader's own attempts.
#[spacetimedb::table(accessor = quiz_attempt_results, public)]
pub struct QuizAttemptResult {
    #[primary_key]
    #[auto_inc]
    pub result_id: u64,
    /// The `QuizAttempt` this belongs to. Results live and die with their attempt.
    #[index(btree)]
    pub attempt_id: u64,
    #[index(btree)]
    pub question_id: u64,
    pub is_correct: bool,
}

/// The answer key. **Not public** — this table has no `public` attribute and must
/// never gain one.
///
/// Correctness is the presence of a row rather than a boolean column, for the same
/// reason `ReaderProgress` works that way: there is no third state to represent,
/// and a missing row cannot be a stale `false`. It also means the private table
/// holds only the correct option ids, so even a future leak of its whole contents
/// is bounded by what it stores.
#[spacetimedb::table(accessor = quiz_answer_key)]
pub struct QuizAnswerKey {
    /// The correct option. One row per correct option, so a multi-answer question
    /// has several.
    #[primary_key]
    pub option_id: u64,
    /// Denormalised from `QuizOption` so grading can read a question's key without
    /// scanning every option in the book.
    #[index(btree)]
    pub question_id: u64,
}

// ---------------------------------------------------------------------------
// Lifecycle reducers
// ---------------------------------------------------------------------------

/// Runs once, when the module is first published.
#[spacetimedb::reducer(init)]
pub fn init(_ctx: &ReducerContext) {
    log::info!("book-of-chaos module initialised");
}

/// A client opened a connection. Identity is anonymous until `claim_username` (M2.1).
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    log::debug!("client connected: {}", ctx.sender());
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    log::debug!("client disconnected: {}", ctx.sender());
}

// ---------------------------------------------------------------------------
// Identity reducers
// ---------------------------------------------------------------------------

/// Claim a username for the calling identity. One-time and immutable.
///
/// A thin adapter: it reads the two facts the rule needs, delegates the decision,
/// and only then inserts. The `#[unique]` index on `username` is the real backstop
/// — the `username_taken` lookup is here so the caller gets a readable message
/// instead of a constraint violation.
#[spacetimedb::reducer]
pub fn claim_username(ctx: &ReducerContext, username: String) -> Result<(), String> {
    let caller = ctx.sender();
    let caller_has_username = ctx.db.users().identity().find(caller).is_some();
    let username_taken = ctx.db.users().username().find(&username).is_some();

    rules::can_claim_username(caller_has_username, username_taken, &username)?;

    ctx.db.users().insert(User {
        identity: caller,
        display_name: username.clone(),
        username,
        created_at: ctx.timestamp,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Book reducers
// ---------------------------------------------------------------------------

/// Create a book. The caller becomes its Owner — the only writing role in v0.1.
#[spacetimedb::reducer]
pub fn create_book(ctx: &ReducerContext, title: String, description: String) -> Result<(), String> {
    // The creator is the owner by definition, so the owner check is trivially
    // satisfied here; it is still routed through the same rule so that all four
    // book reducers share one code path.
    rules::can_write_book(true, &title, &description)?;

    ctx.db.books().insert(Book {
        book_id: 0, // assigned by #[auto_inc]
        owner: ctx.sender(),
        title: title.trim().to_string(),
        description,
        status: BookStatus::Draft,
        locale: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_book(
    ctx: &ReducerContext,
    book_id: u64,
    title: String,
    description: String,
) -> Result<(), String> {
    let book = find_book(ctx, book_id)?;
    rules::can_write_book(book.owner == ctx.sender(), &title, &description)?;

    ctx.db.books().book_id().update(Book {
        title: title.trim().to_string(),
        description,
        updated_at: ctx.timestamp,
        ..book
    });
    Ok(())
}

/// Flip `Draft` -> `Published`. No snapshots, no versioning — that is deferred.
///
/// Idempotent: publishing an already-published book succeeds and changes nothing,
/// so a double-click cannot produce an error the author has to reason about.
#[spacetimedb::reducer]
pub fn publish_book(ctx: &ReducerContext, book_id: u64) -> Result<(), String> {
    let book = find_book(ctx, book_id)?;
    rules::require_owner(book.owner == ctx.sender())?;

    if book.status == BookStatus::Published {
        return Ok(());
    }
    ctx.db.books().book_id().update(Book {
        status: BookStatus::Published,
        updated_at: ctx.timestamp,
        ..book
    });
    Ok(())
}

/// Shared lookup. The "not found" message is deliberately the same one a
/// non-owner would eventually see, so probing for book IDs reveals nothing.
fn find_book(ctx: &ReducerContext, book_id: u64) -> Result<Book, String> {
    ctx.db
        .books()
        .book_id()
        .find(book_id)
        .ok_or_else(|| "That book no longer exists.".to_string())
}

// ---------------------------------------------------------------------------
// Chapter reducers
// ---------------------------------------------------------------------------

/// Add a chapter to a book. Only the book's owner may do so.
///
/// The new chapter lands at the end of the book. Position is assigned by the
/// server rather than accepted from the client: the client cannot see other
/// authors' concurrent inserts, so any position it proposes is a guess, and
/// `reorder_chapters` is the supported way to move one.
#[spacetimedb::reducer]
pub fn create_chapter(
    ctx: &ReducerContext,
    book_id: u64,
    title: String,
    description: String,
    is_optional: bool,
    is_pinned: bool,
) -> Result<(), String> {
    let book = find_book(ctx, book_id)?;
    rules::can_write_chapter(book.owner == ctx.sender(), &title, &description)?;

    let positions: Vec<u32> = ctx
        .db
        .chapters()
        .book_id()
        .filter(book_id)
        .map(|c| c.position)
        .collect();

    ctx.db.chapters().insert(Chapter {
        chapter_id: 0, // assigned by #[auto_inc]
        book_id,
        title: title.trim().to_string(),
        description,
        position: rules::next_position(&positions),
        is_optional,
        is_pinned,
        locale: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    Ok(())
}

/// Edit a chapter's title, description and flags. Position is not editable here
/// — see `reorder_chapters`.
#[spacetimedb::reducer]
pub fn update_chapter(
    ctx: &ReducerContext,
    chapter_id: u64,
    title: String,
    description: String,
    is_optional: bool,
    is_pinned: bool,
) -> Result<(), String> {
    let chapter = find_chapter(ctx, chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;
    rules::can_write_chapter(book.owner == ctx.sender(), &title, &description)?;

    ctx.db.chapters().chapter_id().update(Chapter {
        title: title.trim().to_string(),
        description,
        is_optional,
        is_pinned,
        updated_at: ctx.timestamp,
        ..chapter
    });
    Ok(())
}

/// Renumber a book's chapters. `ordered_chapter_ids` must be exactly the book's
/// chapters, each once, in the desired order — see `rules::validate_chapter_order`
/// for why the whole ordering is required rather than a single move.
///
/// Validation runs over the entire list before any row is written, so a rejected
/// ordering leaves the book untouched instead of half-renumbered.
#[spacetimedb::reducer]
pub fn reorder_chapters(
    ctx: &ReducerContext,
    book_id: u64,
    ordered_chapter_ids: Vec<u64>,
) -> Result<(), String> {
    let book = find_book(ctx, book_id)?;
    rules::require_owner(book.owner == ctx.sender())?;

    let mut existing: Vec<Chapter> = ctx.db.chapters().book_id().filter(book_id).collect();
    let existing_ids: Vec<u64> = existing.iter().map(|c| c.chapter_id).collect();
    rules::validate_chapter_order(&existing_ids, &ordered_chapter_ids)?;

    for (position, chapter_id) in ordered_chapter_ids.iter().enumerate() {
        // Safe: validate_chapter_order proved every requested id is in `existing`.
        let index = existing
            .iter()
            .position(|c| c.chapter_id == *chapter_id)
            .expect("validated ordering referenced a missing chapter");
        let chapter = existing.swap_remove(index);
        ctx.db.chapters().chapter_id().update(Chapter {
            position: position as u32,
            updated_at: ctx.timestamp,
            ..chapter
        });
    }
    Ok(())
}

fn find_chapter(ctx: &ReducerContext, chapter_id: u64) -> Result<Chapter, String> {
    ctx.db
        .chapters()
        .chapter_id()
        .find(chapter_id)
        .ok_or_else(|| "That chapter no longer exists.".to_string())
}

/// Replace a chapter's prerequisites with `depends_on_chapter_ids`.
///
/// Wholesale replacement rather than add/remove: the author edits a multi-select
/// and submits the whole set, and a cycle is a property of the finished graph,
/// not of any one edge. Checking the complete proposed graph once is both
/// simpler and stricter than checking each edge as it arrives.
///
/// Cycles are rejected here, at write time, not at publish time — an author
/// should be told the moment they draw the loop, while they still remember what
/// they meant.
#[spacetimedb::reducer]
pub fn set_chapter_deps(
    ctx: &ReducerContext,
    chapter_id: u64,
    depends_on_chapter_ids: Vec<u64>,
) -> Result<(), String> {
    let chapter = find_chapter(ctx, chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;
    rules::require_owner(book.owner == ctx.sender())?;

    let sibling_ids: Vec<u64> = ctx
        .db
        .chapters()
        .book_id()
        .filter(chapter.book_id)
        .map(|c| c.chapter_id)
        .collect();

    // Every edge in the book except this chapter's own, which are being
    // replaced. Scoping to the book keeps the cycle search proportional to the
    // book rather than to the whole platform.
    let other_edges: Vec<rules::DepEdge> = sibling_ids
        .iter()
        .filter(|id| **id != chapter_id)
        .flat_map(|id| {
            ctx.db
                .chapter_deps()
                .chapter_id()
                .filter(*id)
                .map(|d| (d.chapter_id, d.depends_on_chapter_id))
        })
        .collect();

    rules::validate_chapter_deps(
        chapter_id,
        &depends_on_chapter_ids,
        &sibling_ids,
        &other_edges,
    )?;

    // Validation passed, so the replacement below cannot leave a partial graph.
    let stale: Vec<u64> = ctx
        .db
        .chapter_deps()
        .chapter_id()
        .filter(chapter_id)
        .map(|d| d.dep_id)
        .collect();
    for dep_id in stale {
        ctx.db.chapter_deps().dep_id().delete(dep_id);
    }
    for depends_on_chapter_id in depends_on_chapter_ids {
        ctx.db.chapter_deps().insert(ChapterDep {
            dep_id: 0, // assigned by #[auto_inc]
            chapter_id,
            depends_on_chapter_id,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Block reducers
// ---------------------------------------------------------------------------

/// Add a block to a chapter. Body HTML is sanitized here, on write — the stored
/// string is what every reader renders, so nothing downstream has to remember to
/// clean it again.
///
/// Position is server-assigned (append), for the same reason as `create_chapter`.
#[spacetimedb::reducer]
pub fn create_block(
    ctx: &ReducerContext,
    chapter_id: u64,
    title: String,
    block_type: BlockType,
    body_html: String,
    url: Option<String>,
    is_optional: bool,
) -> Result<(), String> {
    let chapter = find_chapter(ctx, chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;
    let is_resource_link = block_type == BlockType::ResourceLink;
    rules::can_write_block(
        book.owner == ctx.sender(),
        &title,
        &body_html,
        is_resource_link,
        url.as_deref(),
    )?;

    let positions: Vec<u32> = ctx
        .db
        .knowledge_blocks()
        .chapter_id()
        .filter(chapter_id)
        .map(|b| b.position)
        .collect();

    ctx.db.knowledge_blocks().insert(KnowledgeBlock {
        block_id: 0, // assigned by #[auto_inc]
        chapter_id,
        title: title.trim().to_string(),
        block_type,
        body_html: sanitize::sanitize_html(&body_html),
        url: rules::resolve_block_url(is_resource_link, url),
        position: rules::next_position(&positions),
        is_optional,
        locale: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    Ok(())
}

/// Edit a block. The body is re-sanitized rather than trusted, because the
/// client's copy came from a subscription and could have been altered in transit
/// or by a hostile client.
#[spacetimedb::reducer]
pub fn update_block(
    ctx: &ReducerContext,
    block_id: u64,
    title: String,
    block_type: BlockType,
    body_html: String,
    url: Option<String>,
    is_optional: bool,
) -> Result<(), String> {
    let block = find_block(ctx, block_id)?;
    let chapter = find_chapter(ctx, block.chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;
    let is_resource_link = block_type == BlockType::ResourceLink;
    rules::can_write_block(
        book.owner == ctx.sender(),
        &title,
        &body_html,
        is_resource_link,
        url.as_deref(),
    )?;

    // Retyping a Quiz into something else leaves its questions with no block that
    // can render them, and its answer key with nothing that can grade against it.
    // Dropping the quiz is the honest reading of the author's edit; keeping it
    // would mean a later retype back to Quiz silently resurrects an old key.
    if block.block_type == BlockType::Quiz && block_type != BlockType::Quiz {
        clear_quiz(ctx, block_id);
    }

    ctx.db.knowledge_blocks().block_id().update(KnowledgeBlock {
        title: title.trim().to_string(),
        block_type,
        body_html: sanitize::sanitize_html(&body_html),
        url: rules::resolve_block_url(is_resource_link, url),
        is_optional,
        updated_at: ctx.timestamp,
        ..block
    });
    Ok(())
}

/// Remove a block and close the gap it leaves in the chapter's ordering.
///
/// Reader progress rows that reference the block are deleted with it. Leaving
/// them would let a deleted block keep counting toward chapter completion, which
/// the unlock engine (M3) would read as progress the reader never made.
#[spacetimedb::reducer]
pub fn delete_block(ctx: &ReducerContext, block_id: u64) -> Result<(), String> {
    let block = find_block(ctx, block_id)?;
    let chapter = find_chapter(ctx, block.chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;
    rules::require_owner(book.owner == ctx.sender())?;

    let chapter_id = block.chapter_id;
    let removed_position = block.position;
    // Before the block goes, so its quiz rows cannot outlive it. An orphaned
    // answer key is invisible — nothing references it, so nothing reports it.
    clear_quiz(ctx, block_id);
    ctx.db.knowledge_blocks().block_id().delete(block_id);

    // Edges in both directions, or a deleted block leaves a prerequisite nothing
    // can ever satisfy. The unlock engine fails closed on a dangling edge — see
    // `unlock::chapter_state` — so leaving these behind would silently lock a
    // block forever, with nothing on screen to explain why.
    let dep_ids: Vec<u64> = ctx
        .db
        .block_deps()
        .block_id()
        .filter(block_id)
        .chain(ctx.db.block_deps().depends_on_block_id().filter(block_id))
        .map(|d| d.dep_id)
        .collect();
    for dep_id in dep_ids {
        ctx.db.block_deps().dep_id().delete(dep_id);
    }

    for progress in ctx.db.reader_progress().block_id().filter(block_id) {
        ctx.db
            .reader_progress()
            .progress_id()
            .delete(progress.progress_id);
    }
    // Attempts go the same way as progress: a score against a block nobody can
    // open is unreadable history that only grows.
    let attempt_ids: Vec<u64> = ctx
        .db
        .quiz_attempts()
        .block_id()
        .filter(block_id)
        .map(|a| a.attempt_id)
        .collect();
    for attempt_id in attempt_ids {
        let result_ids: Vec<u64> = ctx
            .db
            .quiz_attempt_results()
            .attempt_id()
            .filter(attempt_id)
            .map(|r| r.result_id)
            .collect();
        for result_id in result_ids {
            ctx.db.quiz_attempt_results().result_id().delete(result_id);
        }
        ctx.db.quiz_attempts().attempt_id().delete(attempt_id);
    }

    // Positions stay contiguous so `position` remains a usable sort key and the
    // next append does not reuse a number.
    let after: Vec<KnowledgeBlock> = ctx
        .db
        .knowledge_blocks()
        .chapter_id()
        .filter(chapter_id)
        .filter(|b| b.position > removed_position)
        .collect();
    for b in after {
        ctx.db.knowledge_blocks().block_id().update(KnowledgeBlock {
            position: b.position - 1,
            updated_at: ctx.timestamp,
            ..b
        });
    }
    Ok(())
}

/// Replace a block's prerequisites with `depends_on_block_ids`.
///
/// Wholesale replacement, owner-gated, cycle-checked at write time — the same
/// three decisions `set_chapter_deps` makes, for the same reasons. The eleventh
/// owner-gated reducer, and covered by `auth-reject` like the other ten.
///
/// Candidates are the book's blocks rather than the chapter's: the v0.2 scope
/// allows a block to depend on a block in another chapter, so a chapter-scoped
/// candidate set would refuse something the release promises. Cross-*book* edges
/// stay refused — a book has to be a self-contained graph.
#[spacetimedb::reducer]
pub fn set_block_deps(
    ctx: &ReducerContext,
    block_id: u64,
    depends_on_block_ids: Vec<u64>,
) -> Result<(), String> {
    let block = find_block(ctx, block_id)?;
    let chapter = find_chapter(ctx, block.chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;
    rules::require_owner(book.owner == ctx.sender())?;

    let book_block_ids = block_ids_in_book(ctx, chapter.book_id);

    // Every block edge in the book except this block's own, which are being
    // replaced. Scoped to the book so the cycle search stays proportional to the
    // book rather than to the whole platform.
    let other_edges: Vec<rules::DepEdge> = book_block_ids
        .iter()
        .filter(|id| **id != block_id)
        .flat_map(|id| {
            ctx.db
                .block_deps()
                .block_id()
                .filter(*id)
                .map(|d| (d.block_id, d.depends_on_block_id))
        })
        .collect();

    rules::validate_block_deps(
        block_id,
        &depends_on_block_ids,
        &book_block_ids,
        &other_edges,
    )?;

    // Validation passed, so the replacement below cannot leave a partial graph.
    let stale: Vec<u64> = ctx
        .db
        .block_deps()
        .block_id()
        .filter(block_id)
        .map(|d| d.dep_id)
        .collect();
    for dep_id in stale {
        ctx.db.block_deps().dep_id().delete(dep_id);
    }
    for depends_on_block_id in depends_on_block_ids {
        ctx.db.block_deps().insert(BlockDep {
            dep_id: 0, // assigned by #[auto_inc]
            block_id,
            depends_on_block_id,
        });
    }
    Ok(())
}

/// Every block in a book, across all its chapters.
///
/// Block prerequisites may cross chapters but not books, so this is exactly the
/// candidate set `set_block_deps` validates against.
fn block_ids_in_book(ctx: &ReducerContext, book_id: u64) -> Vec<u64> {
    ctx.db
        .chapters()
        .book_id()
        .filter(book_id)
        .flat_map(|c| {
            ctx.db
                .knowledge_blocks()
                .chapter_id()
                .filter(c.chapter_id)
                .map(|b| b.block_id)
        })
        .collect()
}

fn find_block(ctx: &ReducerContext, block_id: u64) -> Result<KnowledgeBlock, String> {
    ctx.db
        .knowledge_blocks()
        .block_id()
        .find(block_id)
        .ok_or_else(|| "That block no longer exists.".to_string())
}

// ---------------------------------------------------------------------------
// Quiz authoring
// ---------------------------------------------------------------------------

/// One answer option as the author submits it.
///
/// `is_correct` travels *in* on this struct and never travels back out: it is
/// split off into `quiz_answer_key` on write, and no public table carries it.
#[derive(SpacetimeType, Clone, Debug)]
pub struct QuizOptionInput {
    pub text_html: String,
    pub is_correct: bool,
}

/// One question as the author submits it. Order is the order of the vector.
#[derive(SpacetimeType, Clone, Debug)]
pub struct QuizQuestionInput {
    pub prompt_html: String,
    pub options: Vec<QuizOptionInput>,
}

/// Replace a `Quiz` block's questions, options, answer key and pass threshold.
///
/// Wholesale replacement, like `set_chapter_deps` and for the same reason: the
/// author edits a whole form and submits it, and the properties worth enforcing
/// — "every question has a correct answer", "the threshold is a percentage" —
/// are properties of the finished quiz rather than of any one edit. Validating
/// the complete proposal once is both simpler and stricter than validating each
/// change as it arrives, and it means a rejected quiz leaves the previous one
/// exactly as it was.
///
/// `is_multi_answer` is computed here from the submitted key, never accepted from
/// the client — see `rules::correct_count`.
///
/// Prompt and option text are sanitized on write, exactly like a block body: the
/// stored string is what every reader renders, so nothing downstream has to
/// remember to clean it again.
#[spacetimedb::reducer]
pub fn set_quiz(
    ctx: &ReducerContext,
    block_id: u64,
    pass_threshold: u32,
    questions: Vec<QuizQuestionInput>,
) -> Result<(), String> {
    let block = find_block(ctx, block_id)?;
    let chapter = find_chapter(ctx, block.chapter_id)?;
    let book = find_book(ctx, chapter.book_id)?;

    // A borrowed view of the submission, so the rules module never sees a
    // SpacetimeDB-derived type.
    let proposed: Vec<rules::ProposedQuestion<'_>> = questions
        .iter()
        .map(|q| rules::ProposedQuestion {
            prompt_html: &q.prompt_html,
            options: q
                .options
                .iter()
                .map(|o| rules::ProposedOption {
                    text_html: &o.text_html,
                    is_correct: o.is_correct,
                })
                .collect(),
        })
        .collect();

    rules::can_write_quiz(
        book.owner == ctx.sender(),
        block.block_type == BlockType::Quiz,
        pass_threshold,
        &proposed,
    )?;

    // Validation passed, so nothing below can fail part-way and leave a quiz
    // with half its old questions and half its new ones.
    clear_quiz(ctx, block_id);

    ctx.db.quiz_config().insert(QuizConfig {
        block_id,
        pass_threshold,
    });

    for (position, question) in questions.iter().enumerate() {
        let is_multi_answer = rules::correct_count(&proposed[position].options) > 1;
        let inserted = ctx.db.quiz_questions().insert(QuizQuestion {
            question_id: 0, // assigned by #[auto_inc]
            block_id,
            prompt_html: sanitize::sanitize_html(&question.prompt_html),
            position: position as u32,
            is_multi_answer,
        });

        for (option_position, option) in question.options.iter().enumerate() {
            let stored = ctx.db.quiz_options().insert(QuizOption {
                option_id: 0, // assigned by #[auto_inc]
                question_id: inserted.question_id,
                text_html: sanitize::sanitize_html(&option.text_html),
                position: option_position as u32,
            });
            if option.is_correct {
                ctx.db.quiz_answer_key().insert(QuizAnswerKey {
                    option_id: stored.option_id,
                    question_id: inserted.question_id,
                });
            }
        }
    }
    Ok(())
}

/// Remove every row belonging to a block's quiz, answer key included.
///
/// Written as one function because forgetting any one of the four tables leaves
/// orphans, and an orphaned `quiz_answer_key` row is the worst of them: it would
/// keep marking an option correct that no question can reach any more.
fn clear_quiz(ctx: &ReducerContext, block_id: u64) {
    let question_ids: Vec<u64> = ctx
        .db
        .quiz_questions()
        .block_id()
        .filter(block_id)
        .map(|q| q.question_id)
        .collect();

    for question_id in question_ids {
        let option_ids: Vec<u64> = ctx
            .db
            .quiz_options()
            .question_id()
            .filter(question_id)
            .map(|o| o.option_id)
            .collect();
        for option_id in option_ids {
            ctx.db.quiz_answer_key().option_id().delete(option_id);
            ctx.db.quiz_options().option_id().delete(option_id);
        }
        ctx.db.quiz_questions().question_id().delete(question_id);
    }
    ctx.db.quiz_config().block_id().delete(block_id);
}

// ---------------------------------------------------------------------------
// Reader progress
// ---------------------------------------------------------------------------

/// Mark a block complete for the calling reader.
///
/// Idempotent: a second call is a no-op that returns `Ok`. Completion is the
/// presence of a row, so there is nothing to toggle and a double-click, a retry
/// after a dropped connection, and two tabs racing all converge on the same
/// single row.
///
/// The chapter's unlock state is recomputed *before* the write and the call is
/// refused if the chapter is Blocked. Without that, a client could call this
/// reducer directly for every block in a locked book and unlock it one call at
/// a time — the map is UX, this is the boundary.
///
/// A `Quiz` block is refused outright: it completes only through `submit_quiz`,
/// with a passing score. This reducer predates `BlockType::Quiz` and would
/// otherwise be a one-call bypass of the entire release.
///
/// Nothing is recomputed *after* the write: chapter state is derived from
/// `reader_progress` rather than stored, so the subscription that carries the
/// new row is the same thing that moves the node on the map.
#[spacetimedb::reducer]
pub fn complete_block(ctx: &ReducerContext, block_id: u64) -> Result<(), String> {
    let reader = ctx.sender();
    let block = find_block(ctx, block_id)?;
    let chapter = find_chapter(ctx, block.chapter_id)?;

    let graph = graph_for_book(ctx, chapter.book_id);
    let progress = progress_for_reader(ctx, reader);
    rules::can_complete_block(
        unlock::chapter_state(&graph, &progress, chapter.chapter_id),
        block.block_type == BlockType::Quiz,
    )?;

    if progress.has_completed(block_id) {
        return Ok(());
    }
    ctx.db.reader_progress().insert(ReaderProgress {
        progress_id: 0, // assigned by #[auto_inc]
        identity: reader,
        block_id,
        completed_at: ctx.timestamp,
    });
    Ok(())
}

/// One question's selections, as the reader submits them.
///
/// Questions the reader skipped may simply be absent; an absent question is
/// wrong, not an error. See `rules::grade_quiz`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct QuizAnswerInput {
    pub question_id: u64,
    pub selected_option_ids: Vec<u64>,
}

/// Grade a submission and, if it passes, complete the block.
///
/// This is the reducer v0.2 exists for. Everything the client sends is a claim
/// about what it selected; everything about *correctness* is read here, from a
/// table the client cannot subscribe to, and the only thing that travels back is
/// a score. A client that lies about its selections gets an honest grade of the
/// lie.
///
/// Retakes are unlimited and every attempt is recorded. A failing attempt after a
/// passing one does not un-complete the block: completion is the presence of a
/// `reader_progress` row, and taking it away would mean a reader could lose a
/// chapter they had already earned by pressing a button. Best-of scoring is what
/// that amounts to, and it is the deferred retake policy's only v0.2 position.
///
/// A `Quiz` block with no quiz configured is refused rather than treated as an
/// empty pass. `create_block` will happily make one — the author sets the block
/// type before writing the questions — so this state is normal and transient, and
/// the safe reading of "no questions" is "not ready", never "you passed".
#[spacetimedb::reducer]
pub fn submit_quiz(
    ctx: &ReducerContext,
    block_id: u64,
    answers: Vec<QuizAnswerInput>,
) -> Result<(), String> {
    let reader = ctx.sender();
    let block = find_block(ctx, block_id)?;
    if block.block_type != BlockType::Quiz {
        return Err("That block is not a quiz.".to_string());
    }
    let chapter = find_chapter(ctx, block.chapter_id)?;

    // The same gate `complete_block` uses, and for the same reason: a quiz inside
    // a Blocked chapter is a chapter the reader has not reached.
    let graph = graph_for_book(ctx, chapter.book_id);
    let progress = progress_for_reader(ctx, reader);
    rules::require_reachable_chapter(unlock::chapter_state(&graph, &progress, chapter.chapter_id))?;

    let config = ctx
        .db
        .quiz_config()
        .block_id()
        .find(block_id)
        .ok_or_else(|| "This quiz has not been written yet.".to_string())?;

    let mut key: Vec<rules::QuestionKey> = ctx
        .db
        .quiz_questions()
        .block_id()
        .filter(block_id)
        .map(|question| {
            let option_ids: Vec<u64> = ctx
                .db
                .quiz_options()
                .question_id()
                .filter(question.question_id)
                .map(|o| o.option_id)
                .collect();
            rules::QuestionKey {
                question_id: question.question_id,
                option_ids,
                correct_option_ids: ctx
                    .db
                    .quiz_answer_key()
                    .question_id()
                    .filter(question.question_id)
                    .map(|k| k.option_id)
                    .collect(),
            }
        })
        .collect();
    // Filter order is not a guarantee, and `results` is per-question feedback the
    // reader will read next to the questions as displayed.
    key.sort_by_key(|q| q.question_id);

    let submitted: Vec<rules::SubmittedAnswer> = answers
        .into_iter()
        .map(|a| rules::SubmittedAnswer {
            question_id: a.question_id,
            selected_option_ids: a.selected_option_ids,
        })
        .collect();

    let grade = rules::grade_quiz(config.pass_threshold, &key, &submitted)?;

    let attempt = ctx.db.quiz_attempts().insert(QuizAttempt {
        attempt_id: 0, // assigned by #[auto_inc]
        identity: reader,
        block_id,
        score_percent: grade.score_percent,
        passed: grade.passed,
        submitted_at: ctx.timestamp,
    });
    // One row per question, so the reader can be shown *which* ones were wrong
    // rather than only how many. `insert` returns the row with its assigned id,
    // which is the only way to tie these to the attempt above.
    for result in &grade.results {
        ctx.db.quiz_attempt_results().insert(QuizAttemptResult {
            result_id: 0, // assigned by #[auto_inc]
            attempt_id: attempt.attempt_id,
            question_id: result.question_id,
            is_correct: result.is_correct,
        });
    }

    if grade.passed && !progress.has_completed(block_id) {
        ctx.db.reader_progress().insert(ReaderProgress {
            progress_id: 0, // assigned by #[auto_inc]
            identity: reader,
            block_id,
            completed_at: ctx.timestamp,
        });
    }
    Ok(())
}

/// Assemble the unlock engine's view of one book.
///
/// Scoped to the book because prerequisites cannot cross books, so this is the
/// smallest snapshot that can answer any question about it.
fn graph_for_book(ctx: &ReducerContext, book_id: u64) -> unlock::Graph {
    let chapters = ctx
        .db
        .chapters()
        .book_id()
        .filter(book_id)
        .map(|c| unlock::ChapterNode {
            chapter_id: c.chapter_id,
            is_optional: c.is_optional,
            is_pinned: c.is_pinned,
            prerequisites: ctx
                .db
                .chapter_deps()
                .chapter_id()
                .filter(c.chapter_id)
                .map(|d| d.depends_on_chapter_id)
                .collect(),
            blocks: ctx
                .db
                .knowledge_blocks()
                .chapter_id()
                .filter(c.chapter_id)
                .map(|b| unlock::BlockNode {
                    block_id: b.block_id,
                    is_optional: b.is_optional,
                })
                .collect(),
        })
        .collect();
    unlock::Graph::new(chapters)
}

/// One reader's completed blocks, across every book.
///
/// Not filtered to the book: block ids are unique platform-wide, so a wider set
/// cannot change an answer, and filtering would cost a second lookup per row.
fn progress_for_reader(ctx: &ReducerContext, reader: Identity) -> unlock::Progress {
    unlock::Progress::from_completed_blocks(
        ctx.db
            .reader_progress()
            .identity()
            .filter(reader)
            .map(|p| p.block_id),
    )
}
