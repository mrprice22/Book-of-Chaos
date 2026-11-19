//! M14.1 spike: can a view filter a private table by the caller's identity?
//!
//! `vault` and `vault_grant` are private (no `public` attribute). The only way a
//! client reaches a `vault` row is `my_vault`, a view on `ViewContext` that returns
//! the caller's own rows plus the rows of every owner who granted the caller.
//!
//! `notice` is a public control table, so a refused subscription to `vault` can be
//! told apart from a server that refuses everything.

use spacetimedb::{Identity, ReducerContext, Table, ViewContext, reducer, table, view};

#[table(accessor = vault)]
pub struct Vault {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    owner: Identity,
    body: String,
}

#[table(accessor = vault_grant)]
pub struct VaultGrant {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    owner: Identity,
    #[index(btree)]
    worker: Identity,
}

#[table(accessor = notice, public)]
pub struct Notice {
    #[primary_key]
    #[auto_inc]
    id: u64,
    text: String,
}

#[reducer]
pub fn put(ctx: &ReducerContext, body: String) -> Result<(), String> {
    ctx.db.vault().insert(Vault {
        id: 0,
        owner: ctx.sender(),
        body,
    });
    ctx.db.notice().insert(Notice {
        id: 0,
        text: "a vault row was written".into(),
    });
    Ok(())
}

/// Identities travel as hex strings so the HTTP caller needs no knowledge of the
/// SATS JSON encoding of `Identity`.
#[reducer]
pub fn grant(ctx: &ReducerContext, worker_hex: String) -> Result<(), String> {
    let worker = Identity::from_hex(&worker_hex).map_err(|e| format!("bad identity: {e}"))?;
    ctx.db.vault_grant().insert(VaultGrant {
        id: 0,
        owner: ctx.sender(),
        worker,
    });
    Ok(())
}

#[reducer]
pub fn revoke(ctx: &ReducerContext, worker_hex: String) -> Result<(), String> {
    let worker = Identity::from_hex(&worker_hex).map_err(|e| format!("bad identity: {e}"))?;
    let mine: Vec<VaultGrant> = ctx
        .db
        .vault_grant()
        .owner()
        .filter(ctx.sender())
        .filter(|g| g.worker == worker)
        .collect();
    for g in mine {
        ctx.db.vault_grant().id().delete(g.id);
    }
    Ok(())
}

#[view(accessor = my_vault, public)]
fn my_vault(ctx: &ViewContext) -> Vec<Vault> {
    if cfg!(feature = "leaky") {
        // A view's table handle has no `iter()`: views reach rows only through an
        // index. So the leak walks the primary key, which is dense from 1 here.
        return (1..=1_000u64)
            .filter_map(|id| ctx.db.vault().id().find(id))
            .collect();
    }
    let me = ctx.sender();
    let mut rows: Vec<Vault> = ctx.db.vault().owner().filter(me).collect();
    for g in ctx.db.vault_grant().worker().filter(me) {
        rows.extend(ctx.db.vault().owner().filter(g.owner));
    }
    rows
}
