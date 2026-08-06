//! Book of Chaos — SpacetimeDB module.
//!
//! Content is a dependency graph, not a page sequence. This crate owns the graph,
//! the unlock rules, and the trust boundary: every reducer validates authorization
//! first, then inputs, then mutates. Client-side checks are UX, never security.
//!
//! Tables arrive in M1.2 and domain reducers in M2 — this is the skeleton that
//! proves the crate compiles to wasm32 and publishes.

use spacetimedb::ReducerContext;

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
