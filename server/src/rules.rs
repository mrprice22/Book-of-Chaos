//! Pure domain rules.
//!
//! Nothing in this module touches SpacetimeDB. Reducers gather the facts a rule
//! needs, call in here, and mutate only on `Ok`. That keeps every rejection path
//! testable with `cargo test` and no running database — which matters because the
//! rejection paths, not the happy paths, are the trust boundary.
//!
//! Error strings are written for a human reading a toast.

/// Usernames are lowercase `[a-z0-9_-]`, 3–32 characters, starting with a letter
/// or digit.
///
/// Lowercase-only is deliberate. `username` carries a `#[unique]` constraint on the
/// exact string, so permitting mixed case would let `Ada` and `ada` coexist as
/// distinct users — a well-known impersonation vector. Case-insensitive uniqueness
/// would need a second normalised column and an index to match on; restricting the
/// charset buys the same guarantee for free.
pub const USERNAME_MIN: usize = 3;
pub const USERNAME_MAX: usize = 32;

pub fn validate_username(username: &str) -> Result<(), String> {
    if username.is_empty() {
        return Err("Choose a username.".to_string());
    }
    // Counting chars, not bytes: a multi-byte input should be rejected by the
    // charset rule below with a useful message, not by a confusing length error.
    let len = username.chars().count();
    if len < USERNAME_MIN {
        return Err(format!(
            "Usernames must be at least {USERNAME_MIN} characters."
        ));
    }
    if len > USERNAME_MAX {
        return Err(format!(
            "Usernames can be at most {USERNAME_MAX} characters."
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(
            "Usernames can only use lowercase letters, numbers, underscores and hyphens."
                .to_string(),
        );
    }
    let first = username.chars().next().unwrap_or_default();
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return Err("Usernames must start with a letter or number.".to_string());
    }
    Ok(())
}

/// Decides whether an identity may claim `username`.
///
/// The two DB facts are passed in as plain bools so both rejection paths can be
/// tested directly:
/// - `caller_has_username` — this identity already claimed one. Usernames are
///   immutable, so a re-claim is refused rather than treated as a rename.
/// - `username_taken` — some other identity holds it.
pub fn can_claim_username(
    caller_has_username: bool,
    username_taken: bool,
    username: &str,
) -> Result<(), String> {
    validate_username(username)?;
    if caller_has_username {
        return Err("You already have a username, and usernames cannot be changed.".to_string());
    }
    if username_taken {
        return Err(format!("The username \"{username}\" is already taken."));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

pub const TITLE_MAX: usize = 200;
pub const DESCRIPTION_MAX: usize = 4_000;

/// Titles are trimmed by the caller before reaching here; a title that is only
/// whitespace is empty as far as a reader is concerned.
pub fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("Give it a title.".to_string());
    }
    if title.chars().count() > TITLE_MAX {
        return Err(format!("Titles can be at most {TITLE_MAX} characters."));
    }
    Ok(())
}

pub fn validate_description(description: &str) -> Result<(), String> {
    if description.chars().count() > DESCRIPTION_MAX {
        return Err(format!(
            "Descriptions can be at most {DESCRIPTION_MAX} characters."
        ));
    }
    Ok(())
}

/// The authorization half of every author-side reducer.
///
/// Owner is the only writing role in v0.1, so this is deliberately one bool. It
/// exists as a named function rather than an inline `if` so that "did we check
/// authorization?" is greppable, and so the refusal message stays identical
/// across reducers — a message that varies by call site tells an attacker which
/// check they tripped.
pub fn require_owner(is_owner: bool) -> Result<(), String> {
    if is_owner {
        Ok(())
    } else {
        Err("Only the owner of this book can change it.".to_string())
    }
}

/// Owner check first, then inputs. Both halves in the order CLAUDE.md mandates.
pub fn can_write_book(is_owner: bool, title: &str, description: &str) -> Result<(), String> {
    require_owner(is_owner)?;
    validate_title(title)?;
    validate_description(description)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

/// Same shape as `can_write_book`: authorization first, then inputs. Chapter
/// ownership is the *book's* ownership — there is no per-chapter role in v0.1.
pub fn can_write_chapter(is_owner: bool, title: &str, description: &str) -> Result<(), String> {
    require_owner(is_owner)?;
    validate_title(title)?;
    validate_description(description)?;
    Ok(())
}

/// Validates a requested chapter ordering against the book's actual chapters.
///
/// `reorder_chapters` takes the full ordering rather than a (chapter, position)
/// pair because positions are only meaningful relative to their siblings: a
/// single-chapter move has to renumber everything after it anyway, and doing
/// that client-side then trusting the result would put ordering outside the
/// trust boundary. Requiring an exact permutation also makes the reducer
/// naturally reject a stale client that is working from a chapter list which has
/// since gained or lost a chapter.
///
/// `existing` is the book's chapter ids in any order; `requested` is the desired
/// order. Both are plain slices so this is testable without a database.
pub fn validate_chapter_order(existing: &[u64], requested: &[u64]) -> Result<(), String> {
    let mut seen: Vec<u64> = Vec::with_capacity(requested.len());
    for id in requested {
        if seen.contains(id) {
            return Err("That ordering lists the same chapter twice.".to_string());
        }
        if !existing.contains(id) {
            return Err("That ordering refers to a chapter from another book.".to_string());
        }
        seen.push(*id);
    }
    if requested.len() != existing.len() {
        return Err("That ordering is missing some of the book's chapters.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

pub const BODY_MAX: usize = 200_000;

/// Whether a block's `url` field is required, forbidden, or ignored.
///
/// Passed in as a bool rather than taking `BlockType` so this module stays free
/// of SpacetimeDB-derived types, per CLAUDE.md.
pub fn validate_block_url(is_resource_link: bool, url: Option<&str>) -> Result<(), String> {
    let url = url.map(str::trim).filter(|u| !u.is_empty());
    match (is_resource_link, url) {
        (true, None) => Err("A resource link needs a URL.".to_string()),
        (true, Some(u)) => {
            // Scheme check only. The sanitizer owns URLs inside body HTML; this
            // field is rendered as an href of its own and needs the same rule.
            if u.starts_with("http://") || u.starts_with("https://") {
                Ok(())
            } else {
                Err("Links must start with http:// or https://.".to_string())
            }
        }
        // A reading block with a stray URL is a client bug, not an attack: the
        // reducer drops the value rather than failing an author who cannot see
        // the field.
        (false, _) => Ok(()),
    }
}

/// Body length is checked *before* sanitizing, on the raw input: the limit exists
/// to bound work, and a megabyte of nested tags that sanitizes down to nothing
/// has already cost the parse.
pub fn validate_body(body_html: &str) -> Result<(), String> {
    if body_html.chars().count() > BODY_MAX {
        return Err(format!(
            "Block content can be at most {BODY_MAX} characters."
        ));
    }
    Ok(())
}

/// Authorization first, then inputs — same order as the book and chapter rules.
pub fn can_write_block(
    is_owner: bool,
    title: &str,
    body_html: &str,
    is_resource_link: bool,
    url: Option<&str>,
) -> Result<(), String> {
    require_owner(is_owner)?;
    validate_title(title)?;
    validate_body(body_html)?;
    validate_block_url(is_resource_link, url)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_username() {
        assert!(validate_username("ada").is_ok());
        assert!(validate_username("ada_lovelace-1815").is_ok());
        assert!(validate_username("7of9").is_ok());
    }

    #[test]
    fn rejects_empty() {
        assert!(validate_username("").is_err());
    }

    #[test]
    fn rejects_too_short_and_too_long() {
        assert!(validate_username("ab").is_err());
        assert!(validate_username(&"a".repeat(USERNAME_MAX + 1)).is_err());
        // Boundaries themselves are valid.
        assert!(validate_username("abc").is_ok());
        assert!(validate_username(&"a".repeat(USERNAME_MAX)).is_ok());
    }

    #[test]
    fn rejects_uppercase() {
        // The whole point of the lowercase rule: these must not become two users.
        assert!(validate_username("Ada").is_err());
        assert!(validate_username("ADA").is_err());
    }

    #[test]
    fn rejects_spaces_and_punctuation() {
        assert!(validate_username("ada lovelace").is_err());
        assert!(validate_username("ada.lovelace").is_err());
        assert!(validate_username("ada@example").is_err());
        assert!(validate_username("../etc").is_err());
    }

    #[test]
    fn rejects_non_ascii() {
        assert!(validate_username("adá").is_err());
        // Cyrillic 'а' looks identical to Latin 'a' — a homograph must not slip through.
        assert!(validate_username("аda").is_err());
    }

    #[test]
    fn rejects_leading_separator() {
        assert!(validate_username("_ada").is_err());
        assert!(validate_username("-ada").is_err());
    }

    #[test]
    fn claim_succeeds_when_free_and_caller_is_new() {
        assert!(can_claim_username(false, false, "ada").is_ok());
    }

    #[test]
    fn claim_rejected_when_caller_already_claimed() {
        // Immutability: re-claiming is refused even if the new name is free.
        let err = can_claim_username(true, false, "ada").unwrap_err();
        assert!(
            err.contains("cannot be changed"),
            "unhelpful message: {err}"
        );
    }

    #[test]
    fn claim_rejected_when_username_taken() {
        let err = can_claim_username(false, true, "ada").unwrap_err();
        assert!(err.contains("already taken"), "unhelpful message: {err}");
    }

    #[test]
    fn claim_validates_format_before_availability() {
        // An invalid username must not report "taken" — that would leak whether a
        // name exists and would be a confusing message besides.
        let err = can_claim_username(false, true, "Ada!").unwrap_err();
        assert!(err.contains("lowercase"), "unhelpful message: {err}");
    }

    // --- books ---------------------------------------------------------------

    #[test]
    fn accepts_a_reasonable_book() {
        assert!(can_write_book(true, "Chaos Theory", "An introduction.").is_ok());
        // An empty description is fine; an empty title is not.
        assert!(can_write_book(true, "Chaos Theory", "").is_ok());
    }

    #[test]
    fn rejects_empty_or_whitespace_title() {
        assert!(validate_title("").is_err());
        assert!(validate_title("   ").is_err());
        assert!(validate_title("\t\n").is_err());
    }

    #[test]
    fn rejects_overlong_title_and_description() {
        assert!(validate_title(&"a".repeat(TITLE_MAX + 1)).is_err());
        assert!(validate_title(&"a".repeat(TITLE_MAX)).is_ok());
        assert!(validate_description(&"a".repeat(DESCRIPTION_MAX + 1)).is_err());
        assert!(validate_description(&"a".repeat(DESCRIPTION_MAX)).is_ok());
    }

    #[test]
    fn non_owner_is_rejected() {
        let err = require_owner(false).unwrap_err();
        assert!(err.contains("owner"), "unhelpful message: {err}");
        assert!(require_owner(true).is_ok());
    }

    #[test]
    fn authorization_is_checked_before_input_validation() {
        // A non-owner sending garbage must be told they lack permission, not that
        // their title is empty: the reply must not confirm the book is editable.
        let err = can_write_book(false, "", "").unwrap_err();
        assert!(
            err.contains("owner"),
            "leaked validation to a non-owner: {err}"
        );
    }

    // --- chapters ------------------------------------------------------------

    #[test]
    fn accepts_a_reasonable_chapter() {
        assert!(can_write_chapter(true, "Attractors", "Strange ones.").is_ok());
        assert!(can_write_chapter(true, "Attractors", "").is_ok());
    }

    #[test]
    fn chapter_non_owner_is_rejected_before_validation() {
        let err = can_write_chapter(false, "", "").unwrap_err();
        assert!(
            err.contains("owner"),
            "leaked validation to a non-owner: {err}"
        );
    }

    #[test]
    fn chapter_title_is_validated() {
        assert!(can_write_chapter(true, "   ", "").is_err());
        assert!(can_write_chapter(true, &"a".repeat(TITLE_MAX + 1), "").is_err());
    }

    #[test]
    fn accepts_a_full_permutation() {
        assert!(validate_chapter_order(&[1, 2, 3], &[3, 1, 2]).is_ok());
        // Identity is a permutation too, and an empty book reorders to nothing.
        assert!(validate_chapter_order(&[1, 2, 3], &[1, 2, 3]).is_ok());
        assert!(validate_chapter_order(&[], &[]).is_ok());
    }

    #[test]
    fn rejects_a_partial_ordering() {
        let err = validate_chapter_order(&[1, 2, 3], &[1, 2]).unwrap_err();
        assert!(err.contains("missing"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_duplicates() {
        let err = validate_chapter_order(&[1, 2, 3], &[1, 1, 2]).unwrap_err();
        assert!(err.contains("twice"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_chapter_from_another_book() {
        // The load-bearing case: smuggling a foreign chapter id into the list must
        // not renumber a book the caller does not own.
        let err = validate_chapter_order(&[1, 2, 3], &[1, 2, 99]).unwrap_err();
        assert!(err.contains("another book"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_extra_ids_even_when_all_are_valid() {
        // Same length check from the other side: duplicates are caught first, so a
        // longer list can only mean a foreign id.
        assert!(validate_chapter_order(&[1, 2], &[1, 2, 3]).is_err());
    }

    // --- blocks --------------------------------------------------------------

    #[test]
    fn accepts_a_reading_block() {
        assert!(can_write_block(true, "Intro", "<p>hello</p>", false, None).is_ok());
    }

    #[test]
    fn accepts_a_resource_link_with_an_http_url() {
        assert!(can_write_block(true, "Docs", "", true, Some("https://example.com")).is_ok());
        assert!(can_write_block(true, "Docs", "", true, Some("http://example.com")).is_ok());
    }

    #[test]
    fn block_non_owner_is_rejected_before_validation() {
        let err = can_write_block(false, "", "", true, None).unwrap_err();
        assert!(
            err.contains("owner"),
            "leaked validation to a non-owner: {err}"
        );
    }

    #[test]
    fn resource_link_requires_a_url() {
        assert!(validate_block_url(true, None).is_err());
        assert!(validate_block_url(true, Some("")).is_err());
        assert!(validate_block_url(true, Some("   ")).is_err());
    }

    #[test]
    fn resource_link_rejects_dangerous_schemes() {
        for hostile in [
            "javascript:alert(1)",
            "data:text/html,<script>x</script>",
            "file:///etc/passwd",
            "ftp://example.com",
            "//example.com",
        ] {
            assert!(
                validate_block_url(true, Some(hostile)).is_err(),
                "accepted a dangerous URL: {hostile}"
            );
        }
    }

    #[test]
    fn reading_block_tolerates_a_stray_url() {
        assert!(validate_block_url(false, Some("anything")).is_ok());
        assert!(validate_block_url(false, None).is_ok());
    }

    #[test]
    fn rejects_an_overlong_body() {
        assert!(validate_body(&"a".repeat(BODY_MAX)).is_ok());
        assert!(validate_body(&"a".repeat(BODY_MAX + 1)).is_err());
    }
}
