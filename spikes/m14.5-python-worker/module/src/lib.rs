//! M14.5 spike: the smallest module a non-browser worker can talk to.
//!
//! `hello` records who called it, so the worker can read its own identity back over
//! SQL and compare it across restarts. `refuse` always returns an error, so the worker
//! is seen to receive a reducer's message rather than only a status code.

use spacetimedb::{Identity, ReducerContext, Table, reducer, table};

#[table(accessor = hellos, public)]
pub struct Hello {
    #[primary_key]
    #[auto_inc]
    id: u64,
    label: String,
    caller: Identity,
}

#[reducer]
pub fn hello(ctx: &ReducerContext, label: String) -> Result<(), String> {
    ctx.db.hellos().insert(Hello {
        id: 0,
        label,
        caller: ctx.sender(),
    });
    Ok(())
}

#[reducer]
pub fn refuse(_ctx: &ReducerContext) -> Result<(), String> {
    Err("Workers must be authorized by the work's owner.".into())
}
