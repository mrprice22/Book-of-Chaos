//! M14.3 spike: how big can a reducer argument and a row be?
//!
//! Two limits that are easy to confuse, so they are measured separately:
//!
//! - `put(body)` takes the payload as an **argument** and stores it. Whatever fails here
//!   failed at the argument limit or the row limit, whichever is smaller.
//! - `put_generated(len)` takes a few bytes of argument and builds a `len`-byte string
//!   **inside the module**. That isolates the row limit from the transport.
//!
//! Each row records its length, so a probe can confirm the stored size matches what was
//! sent rather than trusting a 200.

use spacetimedb::{ReducerContext, Table, reducer, table};

#[table(accessor = blob, public)]
pub struct Blob {
    #[primary_key]
    #[auto_inc]
    id: u64,
    label: String,
    len: u64,
    body: String,
}

#[reducer]
pub fn put(ctx: &ReducerContext, label: String, body: String) -> Result<(), String> {
    ctx.db.blob().insert(Blob {
        id: 0,
        label,
        len: body.len() as u64,
        body,
    });
    Ok(())
}

#[reducer]
pub fn put_generated(ctx: &ReducerContext, label: String, len: u64) -> Result<(), String> {
    let body = "x".repeat(len as usize);
    ctx.db.blob().insert(Blob {
        id: 0,
        label,
        len,
        body,
    });
    Ok(())
}

/// Rows are dropped between probes, so a large table does not slow the next one or
/// cost storage on Maincloud for longer than the run.
#[reducer]
pub fn clear(ctx: &ReducerContext) -> Result<(), String> {
    for row in ctx.db.blob().iter() {
        ctx.db.blob().id().delete(row.id);
    }
    Ok(())
}
