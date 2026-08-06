//! Book of Chaos — SpacetimeDB module.
//!
//! Content is a dependency graph, not a page sequence. This crate owns the graph,
//! the unlock rules, and the trust boundary: every reducer validates authorization
//! first, then inputs, then mutates. Client-side checks are UX, never security.
//!
//! Domain reducers arrive in M2 and the unlock engine in M3.

pub mod rules;

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
