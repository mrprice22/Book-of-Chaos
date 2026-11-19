//! M14.2 spike: sign-in with an external OIDC issuer, and carrying an anonymous
//! identity's username over to the signed-in one.
//!
//! The server, not this module, verifies a token's signature against the issuer's
//! JWKS and derives `ctx.sender()` from `iss` + `sub`. What the server does *not* do
//! is decide which issuers are welcome: any OIDC-compliant issuer is accepted. So
//! the module checks `iss` and `aud` itself before treating a caller as signed in.
//!
//! The carry-over is two steps, because neither identity can prove the other alone.
//! A reducer sees one caller, and a token for the old identity cannot be presented
//! from inside a call made with the new one:
//!
//! 1. `begin_link`, called by the **anonymous** identity that owns the username,
//!    stores a one-time code in a private table. Only that identity can read it,
//!    through the `my_link_code` view (the M14.1 pattern).
//! 2. `complete_link(code)`, called by the **signed-in** identity, moves the users row
//!    across and burns the code.
//!
//! In a browser both steps are one click: the page still holds the anonymous token in
//! localStorage when the sign-in redirect returns, so it opens one connection with
//! each.

use spacetimedb::{Identity, ReducerContext, Table, Timestamp, ViewContext, reducer, table, view};

/// The mock issuer `run.sh` starts. In a real module this is configuration, not a
/// constant: SpacetimeAuth's issuer is `https://auth.spacetimedb.com/oidc`.
const TRUSTED_ISSUER: &str = "http://127.0.0.1:3200";
/// The OIDC client id the trusted issuer mints tokens for.
const CLIENT_ID: &str = "boc-spike";
/// How long a link code stays good, in microseconds.
const LINK_TTL_MICROS: i64 = 10 * 60 * 1_000_000;

#[table(accessor = users, public)]
pub struct User {
    #[primary_key]
    identity: Identity,
    #[unique]
    username: String,
}

/// What the server told the module about each caller. Public, so the probes can read
/// it back over SQL.
#[table(accessor = seen, public)]
pub struct Seen {
    #[primary_key]
    #[auto_inc]
    id: u64,
    label: String,
    identity: Identity,
    has_jwt: bool,
    iss: String,
    sub: String,
    aud: String,
    signed_in: bool,
}

#[table(accessor = link_codes)]
pub struct LinkCode {
    #[primary_key]
    code: String,
    #[unique]
    from_identity: Identity,
    created_at: Timestamp,
}

/// Is this caller signed in with the issuer and client this module trusts?
fn signed_in(ctx: &ReducerContext) -> bool {
    if cfg!(feature = "trust_any") {
        return ctx
            .sender_auth()
            .jwt()
            .is_some_and(|jwt| jwt.issuer() != "localhost");
    }
    ctx.sender_auth().jwt().is_some_and(|jwt| {
        jwt.issuer() == TRUSTED_ISSUER && jwt.audience().iter().any(|a| a == CLIENT_ID)
    })
}

#[reducer]
pub fn whoami(ctx: &ReducerContext, label: String) -> Result<(), String> {
    let jwt = ctx.sender_auth().jwt();
    ctx.db.seen().insert(Seen {
        id: 0,
        label,
        identity: ctx.sender(),
        has_jwt: jwt.is_some(),
        iss: jwt.map(|j| j.issuer().to_owned()).unwrap_or_default(),
        sub: jwt.map(|j| j.subject().to_owned()).unwrap_or_default(),
        aud: jwt.map(|j| j.audience().join(" ")).unwrap_or_default(),
        signed_in: signed_in(ctx),
    });
    Ok(())
}

#[reducer]
pub fn claim_username(ctx: &ReducerContext, username: String) -> Result<(), String> {
    if ctx.db.users().identity().find(ctx.sender()).is_some() {
        return Err("You already have a username.".into());
    }
    if ctx.db.users().username().find(&username).is_some() {
        return Err("That username is taken.".into());
    }
    ctx.db.users().insert(User {
        identity: ctx.sender(),
        username,
    });
    Ok(())
}

#[reducer]
pub fn begin_link(ctx: &ReducerContext) -> Result<(), String> {
    if signed_in(ctx) {
        return Err("You are already signed in; there is nothing to carry over.".into());
    }
    if ctx.db.users().identity().find(ctx.sender()).is_none() {
        return Err("This browser has no username to carry over.".into());
    }
    if let Some(old) = ctx.db.link_codes().from_identity().find(ctx.sender()) {
        ctx.db.link_codes().code().delete(old.code);
    }
    let code = format!("{:016x}{:016x}", ctx.random::<u64>(), ctx.random::<u64>());
    ctx.db.link_codes().insert(LinkCode {
        code,
        from_identity: ctx.sender(),
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn complete_link(ctx: &ReducerContext, code: String) -> Result<(), String> {
    if !signed_in(ctx) {
        return Err("Sign in before carrying a username over.".into());
    }
    if ctx.db.users().identity().find(ctx.sender()).is_some() {
        return Err("This account already has a username.".into());
    }
    let link = ctx
        .db
        .link_codes()
        .code()
        .find(&code)
        .ok_or("That link has expired or was already used.")?;
    let age =
        ctx.timestamp.to_micros_since_unix_epoch() - link.created_at.to_micros_since_unix_epoch();
    if age > LINK_TTL_MICROS {
        ctx.db.link_codes().code().delete(&code);
        return Err("That link has expired or was already used.".into());
    }
    let old = ctx
        .db
        .users()
        .identity()
        .find(link.from_identity)
        .ok_or("The username to carry over no longer exists.")?;
    ctx.db.link_codes().code().delete(&code);
    ctx.db.users().identity().delete(old.identity);
    ctx.db.users().insert(User {
        identity: ctx.sender(),
        username: old.username,
    });
    Ok(())
}

#[view(accessor = my_link_code, public)]
fn my_link_code(ctx: &ViewContext) -> Option<LinkCode> {
    ctx.db.link_codes().from_identity().find(ctx.sender())
}
