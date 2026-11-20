//! Who counts as signed in (decision 0002, docs/decisions/0002-durable-sign-in.md).
//!
//! The server verifies a token's signature against its issuer's JWKS and derives
//! `ctx.sender()` from `iss` + `sub`. It accepts a valid token from *any* OIDC issuer,
//! so deciding which issuers count is this module's job. A caller is signed in when
//! all three hold:
//!
//! 1. the token's `iss` and one of its `aud` values match a trusted `(issuer, client)`
//!    pair,
//! 2. its payload says `email_verified: true`. SpacetimeAuth's anonymous login carries
//!    the trusted issuer and client too, with no email, and it reports the same
//!    `login_method` as a real magic link. So `email_verified` is the marker, never
//!    `login_method` (both real tokens were read 2026-11-20).
//!
//! Pure: it takes the claims as plain data, so it is tested without a database.

/// The hosted provider: SpacetimeAuth, and this project's client id there. The
/// client id is public by design, because it ships in every page.
pub const SPACETIMEAUTH: &str = "https://auth.spacetimedb.com/oidc|client_0350We80wbokeNK7YI9r5X";

/// The trusted `issuer|client_id` pairs, separated by `;`, fixed when the module is
/// built. `BOC_TRUSTED_CLIENTS` sets them; unset, only SpacetimeAuth is trusted, which
/// is what the hosted build is. `deploy.sh local` adds the mock issuer the e2e
/// stages run, because no test can click through a real login page.
///
/// Build-time, not data: a module cannot learn its database owner, so no reducer
/// could tell the operator setting this from anyone else (decision 0002).
pub fn trusted_clients() -> &'static str {
    option_env!("BOC_TRUSTED_CLIENTS").unwrap_or(SPACETIMEAUTH)
}

/// Pure: is a caller holding these claims signed in, under `trusted`?
///
/// `raw_payload` is the token's JSON payload, which is where `email_verified` lives.
/// Only a JSON `true` counts: a missing claim, `false`, or the string `"true"` do not.
pub fn is_signed_in(issuer: &str, audience: &[String], raw_payload: &str, trusted: &str) -> bool {
    let trusted_client = trusted
        .split(';')
        .filter_map(|pair| pair.split_once('|'))
        .any(|(trusted_issuer, client_id)| {
            !trusted_issuer.is_empty()
                && trusted_issuer == issuer
                && audience.iter().any(|aud| aud == client_id)
        });
    trusted_client && email_verified(raw_payload)
}

fn email_verified(raw_payload: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw_payload)
        .ok()
        .and_then(|claims| claims.get("email_verified").cloned())
        == Some(serde_json::Value::Bool(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISS: &str = "https://auth.spacetimedb.com/oidc";
    const CLIENT: &str = "client_0350We80wbokeNK7YI9r5X";
    const VERIFIED: &str = r#"{"email":"a@example.com","email_verified":true}"#;

    fn aud(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn a_verified_email_at_the_trusted_issuer_and_client_is_signed_in() {
        assert!(is_signed_in(ISS, &aud(&[CLIENT]), VERIFIED, SPACETIMEAUTH));
    }

    #[test]
    fn the_client_may_be_one_audience_among_several() {
        assert!(is_signed_in(
            ISS,
            &aud(&["something-else", CLIENT]),
            VERIFIED,
            SPACETIMEAUTH
        ));
    }

    #[test]
    fn spacetimeauths_anonymous_login_is_not_signed_in() {
        // The shape of the real anonymous token: trusted issuer and client, no email,
        // and the same login_method as a magic link.
        let anonymous = r#"{"name":"Anonymous User","login_method":"magic_link"}"#;
        assert!(!is_signed_in(
            ISS,
            &aud(&[CLIENT]),
            anonymous,
            SPACETIMEAUTH
        ));
    }

    #[test]
    fn an_unverified_or_oddly_typed_email_claim_is_not_signed_in() {
        for payload in [
            r#"{"email":"a@example.com","email_verified":false}"#,
            r#"{"email":"a@example.com","email_verified":"true"}"#,
            r#"{"email":"a@example.com","email_verified":1}"#,
            "not json",
            "",
        ] {
            assert!(
                !is_signed_in(ISS, &aud(&[CLIENT]), payload, SPACETIMEAUTH),
                "{payload}"
            );
        }
    }

    #[test]
    fn a_valid_token_from_an_issuer_nobody_chose_is_not_signed_in() {
        assert!(!is_signed_in(
            "http://127.0.0.1:3201",
            &aud(&[CLIENT]),
            VERIFIED,
            SPACETIMEAUTH
        ));
    }

    #[test]
    fn the_trusted_issuer_with_another_clients_audience_is_not_signed_in() {
        assert!(!is_signed_in(
            ISS,
            &aud(&["someone-elses-app"]),
            VERIFIED,
            SPACETIMEAUTH
        ));
        assert!(!is_signed_in(ISS, &[], VERIFIED, SPACETIMEAUTH));
    }

    #[test]
    fn a_pair_matches_only_as_a_pair() {
        // Issuer A with client B is not trusted just because A and B each appear.
        let trusted = "http://a|client-a;http://b|client-b";
        assert!(is_signed_in(
            "http://a",
            &aud(&["client-a"]),
            VERIFIED,
            trusted
        ));
        assert!(!is_signed_in(
            "http://a",
            &aud(&["client-b"]),
            VERIFIED,
            trusted
        ));
    }

    #[test]
    fn an_empty_or_malformed_list_trusts_nobody() {
        for trusted in ["", ";", "no-separator", "|client"] {
            assert!(
                !is_signed_in("", &aud(&["client"]), VERIFIED, trusted),
                "{trusted:?}"
            );
            assert!(
                !is_signed_in(ISS, &aud(&[CLIENT]), VERIFIED, trusted),
                "{trusted:?}"
            );
        }
    }

    #[test]
    fn the_default_build_trusts_spacetimeauth_only() {
        // `cargo test` runs without BOC_TRUSTED_CLIENTS, as the hosted build does.
        if option_env!("BOC_TRUSTED_CLIENTS").is_none() {
            assert_eq!(trusted_clients(), SPACETIMEAUTH);
        }
    }
}
