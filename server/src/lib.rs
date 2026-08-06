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

/// The two block types in v0.1. Quiz, Assignment, Reflection and Milestone are
/// each a subsystem and are deferred — `Reading` is what proves the unlock loop.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockType {
    Reading,
    ResourceLink,
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
    ctx.db.knowledge_blocks().block_id().delete(block_id);

    for progress in ctx.db.reader_progress().block_id().filter(block_id) {
        ctx.db
            .reader_progress()
            .progress_id()
            .delete(progress.progress_id);
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

fn find_block(ctx: &ReducerContext, block_id: u64) -> Result<KnowledgeBlock, String> {
    ctx.db
        .knowledge_blocks()
        .block_id()
        .find(block_id)
        .ok_or_else(|| "That block no longer exists.".to_string())
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
    rules::can_complete_block(unlock::chapter_state(&graph, &progress, chapter.chapter_id))?;

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
