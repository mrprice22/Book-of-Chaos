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

// ---------------------------------------------------------------------------
// Chapter dependencies
// ---------------------------------------------------------------------------

/// An edge `(chapter, prerequisite)`: `chapter` stays Blocked until
/// `prerequisite` is Complete.
pub type DepEdge = (u64, u64);

/// Returns a cycle in the dependency graph, as the chapters along it, or `None`
/// if the graph is acyclic.
///
/// Iterative depth-first search with an explicit stack. Recursion would be the
/// shorter code, but a hostile or merely enthusiastic author can nest a graph
/// deeper than the wasm stack, and a module that traps takes the whole reducer
/// call with it.
pub fn find_cycle(edges: &[DepEdge]) -> Option<Vec<u64>> {
    // 0 = unvisited, 1 = on the current path, 2 = fully explored.
    let mut state: Vec<(u64, u8)> = Vec::new();
    let mut nodes: Vec<u64> = Vec::new();
    for (from, to) in edges {
        for n in [from, to] {
            if !nodes.contains(n) {
                nodes.push(*n);
                state.push((*n, 0));
            }
        }
    }
    let mark = |state: &mut Vec<(u64, u8)>, node: u64, value: u8| {
        if let Some(entry) = state.iter_mut().find(|(n, _)| *n == node) {
            entry.1 = value;
        }
    };
    let get = |state: &Vec<(u64, u8)>, node: u64| -> u8 {
        state
            .iter()
            .find(|(n, _)| *n == node)
            .map(|(_, s)| *s)
            .unwrap_or(0)
    };

    for start in &nodes {
        if get(&state, *start) != 0 {
            continue;
        }
        // (node, index of the next outgoing edge to try)
        let mut stack: Vec<(u64, usize)> = vec![(*start, 0)];
        mark(&mut state, *start, 1);
        while let Some((node, edge_index)) = stack.pop() {
            let next = edges
                .iter()
                .filter(|(from, _)| *from == node)
                .nth(edge_index)
                .map(|(_, to)| *to);
            match next {
                Some(to) => {
                    stack.push((node, edge_index + 1));
                    match get(&state, to) {
                        // `to` is on the current path: everything from it onward
                        // is the cycle.
                        1 => {
                            let mut path: Vec<u64> = stack.iter().map(|(n, _)| *n).collect();
                            if let Some(start_of_cycle) = path.iter().position(|n| *n == to) {
                                path.drain(..start_of_cycle);
                            }
                            return Some(path);
                        }
                        0 => {
                            mark(&mut state, to, 1);
                            stack.push((to, 0));
                        }
                        _ => {}
                    }
                }
                // Exhausted this node's edges.
                None => mark(&mut state, node, 2),
            }
        }
    }
    None
}

/// Validates a proposed prerequisite set for one chapter.
///
/// `set_chapter_deps` replaces a chapter's dependencies wholesale, so
/// `other_edges` must be every edge in the book *except* the ones belonging to
/// `chapter_id` — the cycle check runs against the graph as it would be after
/// the write, not as it is now.
///
/// `sibling_ids` is every chapter in the same book. Cross-book prerequisites are
/// refused: a book has to be a self-contained graph, or publishing one book
/// could silently block chapters in another.
pub fn validate_chapter_deps(
    chapter_id: u64,
    requested: &[u64],
    sibling_ids: &[u64],
    other_edges: &[DepEdge],
) -> Result<(), String> {
    let mut seen: Vec<u64> = Vec::with_capacity(requested.len());
    for prereq in requested {
        if *prereq == chapter_id {
            return Err("A chapter cannot depend on itself.".to_string());
        }
        if !sibling_ids.contains(prereq) {
            return Err("A prerequisite must be another chapter in the same book.".to_string());
        }
        if seen.contains(prereq) {
            return Err("That chapter is listed as a prerequisite twice.".to_string());
        }
        seen.push(*prereq);
    }

    let mut edges: Vec<DepEdge> = other_edges.to_vec();
    edges.extend(requested.iter().map(|prereq| (chapter_id, *prereq)));
    if find_cycle(&edges).is_some() {
        return Err(
            "That would create a loop: these chapters would each be waiting on the other."
                .to_string(),
        );
    }
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

    // --- dependency graph ----------------------------------------------------

    #[test]
    fn empty_graph_has_no_cycle() {
        assert_eq!(find_cycle(&[]), None);
    }

    #[test]
    fn linear_chain_has_no_cycle() {
        assert_eq!(find_cycle(&[(3, 2), (2, 1)]), None);
    }

    #[test]
    fn diamond_has_no_cycle() {
        // 4 -> {2,3} -> 1. A node reachable by two paths is not a cycle, and a
        // DFS that forgets which nodes it has finished will claim it is.
        assert_eq!(find_cycle(&[(4, 2), (4, 3), (2, 1), (3, 1)]), None);
    }

    #[test]
    fn disconnected_islands_have_no_cycle() {
        assert_eq!(find_cycle(&[(2, 1), (4, 3), (6, 5)]), None);
    }

    #[test]
    fn detects_a_self_loop() {
        let cycle = find_cycle(&[(1, 1)]).expect("self-loop not detected");
        assert_eq!(cycle, vec![1]);
    }

    #[test]
    fn detects_a_two_node_cycle() {
        let cycle = find_cycle(&[(1, 2), (2, 1)]).expect("2-cycle not detected");
        assert_eq!(cycle.len(), 2);
        assert!(cycle.contains(&1) && cycle.contains(&2), "{cycle:?}");
    }

    #[test]
    fn detects_a_three_node_cycle() {
        let cycle = find_cycle(&[(1, 2), (2, 3), (3, 1)]).expect("3-cycle not detected");
        assert_eq!(cycle.len(), 3);
        for n in [1, 2, 3] {
            assert!(cycle.contains(&n), "incomplete cycle: {cycle:?}");
        }
    }

    #[test]
    fn detects_a_cycle_hanging_off_an_acyclic_prefix() {
        // The search must not stop after exhausting the clean component.
        assert!(find_cycle(&[(9, 8), (1, 2), (2, 3), (3, 1)]).is_some());
    }

    #[test]
    fn accepts_reasonable_prerequisites() {
        assert!(validate_chapter_deps(3, &[1, 2], &[1, 2, 3], &[]).is_ok());
        // Clearing a chapter's prerequisites is always allowed.
        assert!(validate_chapter_deps(3, &[], &[1, 2, 3], &[(2, 1)]).is_ok());
    }

    #[test]
    fn rejects_self_reference() {
        let err = validate_chapter_deps(3, &[3], &[1, 2, 3], &[]).unwrap_err();
        assert!(err.contains("itself"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_missing_or_foreign_chapter() {
        let err = validate_chapter_deps(3, &[99], &[1, 2, 3], &[]).unwrap_err();
        assert!(err.contains("same book"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_duplicate_prerequisites() {
        let err = validate_chapter_deps(3, &[1, 1], &[1, 2, 3], &[]).unwrap_err();
        assert!(err.contains("twice"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_cycle_the_write_would_close() {
        // 1 already depends on 2; making 2 depend on 1 closes the loop.
        let err = validate_chapter_deps(2, &[1], &[1, 2], &[(1, 2)]).unwrap_err();
        assert!(err.contains("loop"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_longer_cycle_the_write_would_close() {
        let err = validate_chapter_deps(3, &[1], &[1, 2, 3], &[(1, 2), (2, 3)]).unwrap_err();
        assert!(err.contains("loop"), "unhelpful message: {err}");
    }

    #[test]
    fn replacing_deps_ignores_the_chapters_own_old_edges() {
        // Chapter 2's current edge (2 -> 1) is being replaced, so it must not be
        // in `other_edges` and must not make (1 -> 2) look like a cycle.
        assert!(validate_chapter_deps(2, &[], &[1, 2], &[]).is_ok());
        assert!(validate_chapter_deps(1, &[2], &[1, 2], &[]).is_ok());
    }

    #[test]
    fn deps_are_validated_before_the_cycle_check() {
        // A self-reference must be named as such, not reported as a generic loop.
        let err = validate_chapter_deps(1, &[1], &[1], &[]).unwrap_err();
        assert!(err.contains("itself"), "unhelpful message: {err}");
    }
}
