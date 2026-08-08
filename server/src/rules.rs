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

/// A `Reading` block has no URL of its own. A stray value is dropped rather than
/// rejected: it is a client bug, not an attack, and the author cannot see the
/// field to fix it — see `validate_block_url`.
pub fn resolve_block_url(is_resource_link: bool, url: Option<String>) -> Option<String> {
    if !is_resource_link {
        return None;
    }
    url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty())
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
// Quizzes
// ---------------------------------------------------------------------------

pub const PROMPT_MAX: usize = 4_000;
pub const OPTION_TEXT_MAX: usize = 1_000;
pub const QUESTIONS_MIN: usize = 1;
pub const QUESTIONS_MAX: usize = 100;
pub const OPTIONS_MIN: usize = 2;
pub const OPTIONS_MAX: usize = 12;
pub const THRESHOLD_MIN: u32 = 1;
pub const THRESHOLD_MAX: u32 = 100;

/// One proposed answer option, borrowed from whatever the reducer was handed.
///
/// Borrowed rather than owned so this module keeps no copy of the author's input
/// and, more importantly, needs no `SpacetimeType` — the reducer's wire structs
/// live in `lib.rs`, and nothing SpacetimeDB-derived crosses into here.
pub struct ProposedOption<'a> {
    pub text_html: &'a str,
    pub is_correct: bool,
}

/// One proposed question with its options, in author order.
pub struct ProposedQuestion<'a> {
    pub prompt_html: &'a str,
    pub options: Vec<ProposedOption<'a>>,
}

/// How many of a question's options are correct.
///
/// Public because it is also what decides `QuizQuestion::is_multi_answer`, and
/// that value must be derived from the key rather than accepted from the author
/// — an author who ticked one box but declared "multi" would ship a checkbox
/// group the reader cannot satisfy.
pub fn correct_count(options: &[ProposedOption<'_>]) -> usize {
    options.iter().filter(|o| o.is_correct).count()
}

/// Validates a whole proposed quiz.
///
/// The whole quiz at once, not question by question, because `set_quiz` replaces
/// it wholesale: a partially valid quiz is not a thing that should ever reach the
/// database, and checking everything before writing anything is what makes the
/// rejection leave the previous quiz untouched.
///
/// Messages name the question by its 1-based position. An author looking at a
/// form with eight questions needs to be told which one, and the ids do not exist
/// yet at validation time.
pub fn validate_quiz(
    pass_threshold: u32,
    questions: &[ProposedQuestion<'_>],
) -> Result<(), String> {
    if !(THRESHOLD_MIN..=THRESHOLD_MAX).contains(&pass_threshold) {
        return Err(format!(
            "The pass mark must be between {THRESHOLD_MIN}% and {THRESHOLD_MAX}%."
        ));
    }
    if questions.len() < QUESTIONS_MIN {
        return Err("A quiz needs at least one question.".to_string());
    }
    if questions.len() > QUESTIONS_MAX {
        return Err(format!(
            "A quiz can have at most {QUESTIONS_MAX} questions."
        ));
    }

    for (index, question) in questions.iter().enumerate() {
        let n = index + 1;
        if question.prompt_html.trim().is_empty() {
            return Err(format!("Question {n} has no text."));
        }
        if question.prompt_html.chars().count() > PROMPT_MAX {
            return Err(format!(
                "Question {n} is too long — questions can be at most {PROMPT_MAX} characters."
            ));
        }
        if question.options.len() < OPTIONS_MIN {
            return Err(format!(
                "Question {n} needs at least {OPTIONS_MIN} answer options."
            ));
        }
        if question.options.len() > OPTIONS_MAX {
            return Err(format!(
                "Question {n} can have at most {OPTIONS_MAX} answer options."
            ));
        }
        for (option_index, option) in question.options.iter().enumerate() {
            if option.text_html.trim().is_empty() {
                return Err(format!(
                    "Option {} of question {n} has no text.",
                    option_index + 1
                ));
            }
            if option.text_html.chars().count() > OPTION_TEXT_MAX {
                return Err(format!(
                    "An option of question {n} is too long — options can be at most {OPTION_TEXT_MAX} characters."
                ));
            }
        }
        if correct_count(&question.options) == 0 {
            return Err(format!("Question {n} has no correct answer marked."));
        }
    }
    Ok(())
}

/// Authorization first, then the block is the right kind, then inputs.
///
/// The block-type check is passed in as a bool for the same reason
/// `validate_block_url` takes one: `BlockType` is a SpacetimeDB-derived type and
/// does not belong in this module. It sits between the two halves deliberately —
/// "that block is not a quiz" is a fact about the target, not about the author's
/// input, and reporting it before the input errors saves an author fixing eight
/// questions attached to the wrong block.
pub fn can_write_quiz(
    is_owner: bool,
    is_quiz_block: bool,
    pass_threshold: u32,
    questions: &[ProposedQuestion<'_>],
) -> Result<(), String> {
    require_owner(is_owner)?;
    if !is_quiz_block {
        return Err("That block is not a quiz.".to_string());
    }
    validate_quiz(pass_threshold, questions)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/// Where a newly created chapter or block lands: at the end.
///
/// Positions are assigned server-side because the client cannot see concurrent
/// inserts, so any position it proposes is a guess. Taking `max + 1` rather than
/// `len` means a gap left by an older bug never causes a collision — two rows
/// sharing a position would make the reader's ordering depend on scan order.
pub fn next_position(existing: &[u32]) -> u32 {
    existing.iter().copied().max().map_or(0, |max| max + 1)
}

// ---------------------------------------------------------------------------
// Chapter dependencies
// ---------------------------------------------------------------------------

/// Re-exported so the reducers and this module's callers keep one vocabulary for
/// an edge. The search itself lives in [`crate::unlock`] — it is the same
/// traversal the reader-facing engine runs, and two copies would be two chances
/// to disagree about what a cycle is.
pub use crate::unlock::{DepEdge, find_cycle};

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

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// Whether a reader may touch a chapter's blocks at all, given its unlock state.
///
/// This is the reader-side trust boundary. Without it a client could complete
/// blocks in any order and walk itself through a locked book one reducer call at
/// a time — the map would show the chapter as Blocked while the progress rows
/// said otherwise, and the graph would stop meaning anything.
///
/// `Complete` is allowed through: a chapter finishes when its non-optional
/// blocks are done, so its optional blocks are still there to be read.
///
/// Shared by `complete_block` and `submit_quiz` rather than duplicated, because a
/// second copy is a second chance to forget it — and a quiz that could be
/// submitted inside a Blocked chapter would reopen exactly the door
/// `can_complete_block` was written to shut.
pub fn require_reachable_chapter(state: crate::unlock::ChapterState) -> Result<(), String> {
    match state {
        crate::unlock::ChapterState::Blocked => {
            Err("Finish this chapter's prerequisites first.".to_string())
        }
        _ => Ok(()),
    }
}

/// Whether a reader may mark a block complete by asserting they have read it.
///
/// `is_quiz` closes the hole M10.1 opened. A `Quiz` block completes *only* on a
/// passing attempt — [v0.2-scope.md](../../docs/v0.2-scope.md#in-scope) — and
/// `complete_block` is a reducer any client can call with any block id. Without
/// this check the release's entire thesis is bypassed by calling the v0.1 reducer
/// on the v0.2 block type, and the answer key being unreachable would stop
/// mattering because nobody would need it.
///
/// The chapter check runs first: an unreachable chapter is the coarser fact, and
/// the reply should not confirm what kind of block sits inside a chapter the
/// reader has not earned.
pub fn can_complete_block(state: crate::unlock::ChapterState, is_quiz: bool) -> Result<(), String> {
    require_reachable_chapter(state)?;
    if is_quiz {
        return Err("Answer this quiz to complete it.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/// One question's answer key, as grading needs to see it.
///
/// `option_ids` is every option the question has, not just the correct ones: it
/// is what makes "that option is not part of this question" answerable, and a
/// grader that cannot tell an unknown id from a wrong one would silently accept
/// a submission naming options from somebody else's quiz.
pub struct QuestionKey {
    pub question_id: u64,
    pub option_ids: Vec<u64>,
    pub correct_option_ids: Vec<u64>,
}

/// One question's selections, as the reader submitted them.
pub struct SubmittedAnswer {
    pub question_id: u64,
    pub selected_option_ids: Vec<u64>,
}

/// Per-question outcome, in the order the key lists the questions.
#[derive(Debug, PartialEq, Eq)]
pub struct QuestionResult {
    pub question_id: u64,
    pub is_correct: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Grade {
    pub correct: u32,
    pub total: u32,
    /// Percentage of questions answered fully correctly, rounded **down**.
    pub score_percent: u32,
    pub passed: bool,
    pub results: Vec<QuestionResult>,
}

/// Grade a submission against an answer key.
///
/// Pure — no database, no reducer context — for the same reason the unlock engine
/// is: this is where "earned" is decided, and it has to be testable exhaustively.
///
/// Three decisions worth naming:
///
/// - **A question is correct only if the selected set matches the key exactly.**
///   No partial credit; the v0.2 scope defers it. A multi-answer question with
///   one of two correct options selected is wrong, not half right.
/// - **An unanswered question is wrong, but an unknown one is a rejection.** A
///   reader who skips a question has simply failed it. A submission naming a
///   question or an option that is not part of this quiz is a broken or hostile
///   client, and answering it with a score would be pretending to have graded
///   something.
/// - **`passed` is decided from the number the reader is shown.** `score_percent`
///   floors, and the comparison uses that same floored value rather than exact
///   arithmetic, so "66% ≥ 67%" and "you failed" can never appear together.
pub fn grade_quiz(
    pass_threshold: u32,
    key: &[QuestionKey],
    submitted: &[SubmittedAnswer],
) -> Result<Grade, String> {
    if key.is_empty() {
        // Unreachable through `set_quiz`, which demands at least one question.
        // Guarded anyway because the alternative is a division by zero.
        return Err("This quiz has no questions.".to_string());
    }

    let mut answered: Vec<u64> = Vec::with_capacity(submitted.len());
    for answer in submitted {
        let Some(question) = key.iter().find(|q| q.question_id == answer.question_id) else {
            return Err("That answer is for a question in a different quiz.".to_string());
        };
        if answered.contains(&answer.question_id) {
            return Err("That submission answers the same question twice.".to_string());
        }
        answered.push(answer.question_id);

        let mut seen: Vec<u64> = Vec::with_capacity(answer.selected_option_ids.len());
        for option_id in &answer.selected_option_ids {
            if !question.option_ids.contains(option_id) {
                return Err(
                    "That answer selects an option this question does not have.".to_string()
                );
            }
            if seen.contains(option_id) {
                return Err("That answer selects the same option twice.".to_string());
            }
            seen.push(*option_id);
        }
    }

    let results: Vec<QuestionResult> = key
        .iter()
        .map(|question| {
            let selected: &[u64] = submitted
                .iter()
                .find(|a| a.question_id == question.question_id)
                .map_or(&[], |a| a.selected_option_ids.as_slice());
            // Both sides are duplicate-free by now, so equal length plus
            // containment is set equality.
            let is_correct = selected.len() == question.correct_option_ids.len()
                && selected
                    .iter()
                    .all(|id| question.correct_option_ids.contains(id));
            QuestionResult {
                question_id: question.question_id,
                is_correct,
            }
        })
        .collect();

    let total = key.len() as u32;
    let correct = results.iter().filter(|r| r.is_correct).count() as u32;
    let score_percent = correct * 100 / total;
    Ok(Grade {
        correct,
        total,
        score_percent,
        passed: score_percent >= pass_threshold,
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unlock::ChapterState;

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

    #[test]
    fn reading_block_never_stores_a_url() {
        // The field is not author-visible on a Reading block, so a value that
        // arrives anyway is dropped rather than persisted.
        assert_eq!(resolve_block_url(false, Some("https://e.com".into())), None);
        assert_eq!(resolve_block_url(false, None), None);
    }

    #[test]
    fn resource_link_url_is_trimmed_and_blank_becomes_none() {
        assert_eq!(
            resolve_block_url(true, Some("  https://e.com  ".into())),
            Some("https://e.com".to_string())
        );
        assert_eq!(resolve_block_url(true, Some("   ".into())), None);
    }

    // --- ordering ------------------------------------------------------------

    #[test]
    fn first_item_lands_at_zero() {
        assert_eq!(next_position(&[]), 0);
    }

    #[test]
    fn new_items_append() {
        assert_eq!(next_position(&[0, 1, 2]), 3);
        // Order of the input must not matter — it comes from an unordered scan.
        assert_eq!(next_position(&[2, 0, 1]), 3);
    }

    #[test]
    fn a_gap_does_not_cause_a_collision() {
        // max + 1, not len: with a gap, `len` would reuse a live position and two
        // rows sharing one would make ordering depend on scan order.
        assert_eq!(next_position(&[0, 5]), 6);
    }

    // --- dependency graph ----------------------------------------------------

    // The cycle search itself is tested in `crate::unlock`; what belongs here is
    // that `validate_chapter_deps` runs it against the *post-write* graph.

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

    // --- reading -------------------------------------------------------------

    #[test]
    fn a_reader_may_complete_blocks_in_a_reachable_chapter() {
        assert!(can_complete_block(ChapterState::Available, false).is_ok());
        assert!(can_complete_block(ChapterState::InProgress, false).is_ok());
        // A finished chapter can still have optional blocks left to read.
        assert!(can_complete_block(ChapterState::Complete, false).is_ok());
    }

    #[test]
    fn a_reader_may_not_complete_blocks_in_a_blocked_chapter() {
        // The load-bearing case: a hostile client calling the reducer directly
        // must not be able to walk itself through a locked book.
        let err = can_complete_block(ChapterState::Blocked, false).unwrap_err();
        assert!(err.contains("prerequisites"), "unhelpful message: {err}");
        // And the same for a quiz block, by the other route.
        assert!(require_reachable_chapter(ChapterState::Blocked).is_err());
        assert!(require_reachable_chapter(ChapterState::Available).is_ok());
    }

    #[test]
    fn a_quiz_block_cannot_be_completed_by_assertion() {
        // The hole M10.1 opened: `complete_block` predates `BlockType::Quiz` and
        // would happily complete one, which is the exact bypass v0.2 exists to
        // prevent. Every reachable state must refuse it, not just some.
        for state in [
            ChapterState::Available,
            ChapterState::InProgress,
            ChapterState::Complete,
        ] {
            let err = can_complete_block(state, true).unwrap_err();
            assert!(err.contains("quiz"), "unhelpful message: {err}");
        }
    }

    #[test]
    fn an_unreachable_chapter_is_reported_before_the_block_type() {
        // A reader who has not earned the chapter should be told that, rather
        // than what kind of block is waiting inside it.
        let err = can_complete_block(ChapterState::Blocked, true).unwrap_err();
        assert!(err.contains("prerequisites"), "unhelpful message: {err}");
    }

    // --- grading -------------------------------------------------------------

    fn one_question_key() -> Vec<QuestionKey> {
        vec![QuestionKey {
            question_id: 1,
            option_ids: vec![10, 11],
            correct_option_ids: vec![10],
        }]
    }

    #[test]
    fn a_correct_answer_passes() {
        let grade = grade_quiz(
            100,
            &one_question_key(),
            &[SubmittedAnswer {
                question_id: 1,
                selected_option_ids: vec![10],
            }],
        )
        .unwrap();
        assert_eq!(grade.correct, 1);
        assert_eq!(grade.score_percent, 100);
        assert!(grade.passed);
    }

    #[test]
    fn a_wrong_answer_fails() {
        let grade = grade_quiz(
            50,
            &one_question_key(),
            &[SubmittedAnswer {
                question_id: 1,
                selected_option_ids: vec![11],
            }],
        )
        .unwrap();
        assert_eq!(grade.score_percent, 0);
        assert!(!grade.passed);
        assert!(!grade.results[0].is_correct);
    }

    #[test]
    fn an_option_from_another_question_is_refused_rather_than_marked_wrong() {
        // Scoring it would be pretending to have graded something.
        let err = grade_quiz(
            50,
            &one_question_key(),
            &[SubmittedAnswer {
                question_id: 1,
                selected_option_ids: vec![99],
            }],
        )
        .unwrap_err();
        assert!(err.contains("does not have"), "unhelpful message: {err}");
    }

    // --- the grading matrix (M10.4) -----------------------------------------
    //
    // One table, read twice: once for the score and verdict, once for the
    // per-question breakdown. Same shape as `unlock`'s graph table, and for the
    // same reason — the interesting failures here are combinations, and a
    // hand-written test per combination is where a combination goes missing.

    /// A three-question quiz: two single-answer, one multi-answer.
    ///
    /// Ids are spaced so a mix-up reads as a wrong id rather than as an
    /// off-by-one that happens to land on a real option.
    fn matrix_key() -> Vec<QuestionKey> {
        vec![
            QuestionKey {
                question_id: 1,
                option_ids: vec![10, 11],
                correct_option_ids: vec![10],
            },
            QuestionKey {
                question_id: 2,
                option_ids: vec![20, 21],
                correct_option_ids: vec![21],
            },
            QuestionKey {
                question_id: 3,
                option_ids: vec![30, 31, 32],
                correct_option_ids: vec![30, 31],
            },
        ]
    }

    fn answer(question_id: u64, selected: &[u64]) -> SubmittedAnswer {
        SubmittedAnswer {
            question_id,
            selected_option_ids: selected.to_vec(),
        }
    }

    struct GradeCase {
        shape: &'static str,
        threshold: u32,
        submitted: Vec<SubmittedAnswer>,
        /// Expected floored percentage and pass verdict.
        expect: (u32, bool),
        /// Expected per-question correctness, in question order.
        breakdown: [bool; 3],
    }

    fn grade_cases() -> Vec<GradeCase> {
        vec![
            GradeCase {
                shape: "all correct",
                threshold: 100,
                submitted: vec![
                    answer(1, &[10]),
                    answer(2, &[21]),
                    // Both correct options, in the order the key does not list
                    // them: a set comparison, not a sequence comparison.
                    answer(3, &[31, 30]),
                ],
                expect: (100, true),
                breakdown: [true, true, true],
            },
            GradeCase {
                shape: "all wrong",
                threshold: 1,
                submitted: vec![answer(1, &[11]), answer(2, &[20]), answer(3, &[32])],
                expect: (0, false),
                breakdown: [false, false, false],
            },
            GradeCase {
                shape: "exactly at threshold",
                // Two of three is 66%, floored. A threshold of 66 must pass.
                threshold: 66,
                submitted: vec![answer(1, &[10]), answer(2, &[21]), answer(3, &[32])],
                expect: (66, true),
                breakdown: [true, true, false],
            },
            GradeCase {
                shape: "one mark below threshold",
                // The same submission against 67. This is the pair that would
                // disagree if `passed` were computed from exact arithmetic
                // (200/3 >= 67 is false) or from a rounded score (67 >= 67 is
                // true) — the reader must never be shown a number that
                // contradicts the verdict.
                threshold: 67,
                submitted: vec![answer(1, &[10]), answer(2, &[21]), answer(3, &[32])],
                expect: (66, false),
                breakdown: [true, true, false],
            },
            GradeCase {
                shape: "multi-answer with a subset selected",
                // One of two correct options. No partial credit in v0.2, so this
                // is wrong, not half right.
                threshold: 50,
                submitted: vec![answer(1, &[10]), answer(2, &[21]), answer(3, &[30])],
                expect: (66, true),
                breakdown: [true, true, false],
            },
            GradeCase {
                shape: "multi-answer with a superset selected",
                // Both correct options plus the wrong one. Also wrong: a reader
                // who ticks everything must not pass a multi-answer question.
                threshold: 50,
                submitted: vec![answer(1, &[10]), answer(2, &[21]), answer(3, &[30, 31, 32])],
                expect: (66, true),
                breakdown: [true, true, false],
            },
            GradeCase {
                shape: "questions left unanswered",
                // Absent is wrong, not an error: skipping a question is a thing
                // readers do, and it fails the question rather than the request.
                threshold: 33,
                submitted: vec![answer(1, &[10])],
                expect: (33, true),
                breakdown: [true, false, false],
            },
            GradeCase {
                shape: "an empty selection for every question",
                threshold: 1,
                submitted: vec![answer(1, &[]), answer(2, &[]), answer(3, &[])],
                expect: (0, false),
                breakdown: [false, false, false],
            },
            GradeCase {
                shape: "nothing submitted at all",
                threshold: 1,
                submitted: vec![],
                expect: (0, false),
                breakdown: [false, false, false],
            },
        ]
    }

    #[test]
    fn every_submission_shape_scores_as_expected() {
        let mut failures: Vec<String> = Vec::new();
        for case in grade_cases() {
            match grade_quiz(case.threshold, &matrix_key(), &case.submitted) {
                Err(err) => failures.push(format!("{}: refused with \"{err}\"", case.shape)),
                Ok(grade) => {
                    let actual = (grade.score_percent, grade.passed);
                    if actual != case.expect {
                        failures.push(format!(
                            "{}: scored {actual:?}, expected {:?}",
                            case.shape, case.expect
                        ));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "\n{}", failures.join("\n"));
    }

    #[test]
    fn every_submission_shape_reports_the_right_questions_wrong() {
        // The same table read for the other property. A grader that got the
        // score right by luck — counting a question wrong and another right in
        // compensation — would pass the test above and fail this one, and the
        // breakdown is what M11.1 shows the reader.
        let mut failures: Vec<String> = Vec::new();
        for case in grade_cases() {
            let Ok(grade) = grade_quiz(case.threshold, &matrix_key(), &case.submitted) else {
                continue; // already reported by the test above
            };
            let actual: Vec<bool> = grade.results.iter().map(|r| r.is_correct).collect();
            if actual != case.breakdown.to_vec() {
                failures.push(format!(
                    "{}: breakdown {actual:?}, expected {:?}",
                    case.shape, case.breakdown
                ));
            }
            let ids: Vec<u64> = grade.results.iter().map(|r| r.question_id).collect();
            if ids != vec![1, 2, 3] {
                failures.push(format!("{}: results out of order: {ids:?}", case.shape));
            }
            if grade.total != 3 {
                failures.push(format!("{}: total was {}", case.shape, grade.total));
            }
        }
        assert!(failures.is_empty(), "\n{}", failures.join("\n"));
    }

    /// Malformed submissions, and the fragment of the message that must name the
    /// actual problem. These are refusals rather than scores: a submission that
    /// does not describe this quiz has not been answered wrongly, it has not
    /// been answered.
    fn refusal_cases() -> Vec<(&'static str, Vec<SubmittedAnswer>, &'static str)> {
        vec![
            (
                "an option id from a different question",
                vec![answer(1, &[20])],
                "does not have",
            ),
            (
                "an option id that exists nowhere",
                vec![answer(1, &[999])],
                "does not have",
            ),
            (
                "a question id from a different quiz",
                vec![answer(99, &[10])],
                "different quiz",
            ),
            (
                "the same question answered twice",
                vec![answer(1, &[10]), answer(1, &[11])],
                "same question twice",
            ),
            (
                "the same option selected twice",
                vec![answer(3, &[30, 30])],
                "same option twice",
            ),
        ]
    }

    #[test]
    fn malformed_submissions_are_refused_by_name() {
        let mut failures: Vec<String> = Vec::new();
        for (shape, submitted, expected) in refusal_cases() {
            match grade_quiz(50, &matrix_key(), &submitted) {
                Ok(grade) => failures.push(format!("{shape}: graded as {grade:?}")),
                Err(err) if !err.contains(expected) => {
                    failures.push(format!("{shape}: unhelpful message \"{err}\""));
                }
                Err(_) => {}
            }
        }
        assert!(failures.is_empty(), "\n{}", failures.join("\n"));
    }

    #[test]
    fn a_quiz_with_no_questions_is_refused_rather_than_dividing_by_zero() {
        // Unreachable through `set_quiz`, which demands a question. Reachable by
        // a future caller that forgets to check, and the failure mode without
        // this guard is a panicking reducer rather than a rejection.
        let err = grade_quiz(50, &[], &[]).unwrap_err();
        assert!(err.contains("no questions"), "unhelpful message: {err}");
    }

    #[test]
    fn grading_is_independent_of_the_thresholds_extremes() {
        // A threshold of 1 passes on any single right answer out of three (33%);
        // a threshold of 100 needs all of them. Both are values `validate_quiz`
        // accepts, so both must behave.
        let one_right = vec![answer(1, &[10])];
        assert!(grade_quiz(1, &matrix_key(), &one_right).unwrap().passed);
        assert!(!grade_quiz(100, &matrix_key(), &one_right).unwrap().passed);
        let all_right = vec![answer(1, &[10]), answer(2, &[21]), answer(3, &[30, 31])];
        assert!(grade_quiz(100, &matrix_key(), &all_right).unwrap().passed);
    }

    #[test]
    fn deps_are_validated_before_the_cycle_check() {
        // A self-reference must be named as such, not reported as a generic loop.
        let err = validate_chapter_deps(1, &[1], &[1], &[]).unwrap_err();
        assert!(err.contains("itself"), "unhelpful message: {err}");
    }

    // --- quizzes -------------------------------------------------------------

    /// Build a question from `(text, is_correct)` pairs. Keeps the cases below
    /// about the rule under test rather than about struct construction.
    fn question<'a>(prompt: &'a str, options: &[(&'a str, bool)]) -> ProposedQuestion<'a> {
        ProposedQuestion {
            prompt_html: prompt,
            options: options
                .iter()
                .map(|(text_html, is_correct)| ProposedOption {
                    text_html,
                    is_correct: *is_correct,
                })
                .collect(),
        }
    }

    /// The smallest quiz that is valid: one question, two options, one correct.
    fn minimal_quiz<'a>() -> Vec<ProposedQuestion<'a>> {
        vec![question(
            "Is this a question?",
            &[("Yes", true), ("No", false)],
        )]
    }

    #[test]
    fn accepts_the_smallest_valid_quiz() {
        assert!(validate_quiz(50, &minimal_quiz()).is_ok());
    }

    #[test]
    fn accepts_a_multi_answer_question() {
        let questions = vec![question(
            "Which of these are chaotic?",
            &[("A", true), ("B", true), ("C", false)],
        )];
        assert!(validate_quiz(100, &questions).is_ok());
        assert_eq!(correct_count(&questions[0].options), 2);
    }

    #[test]
    fn accepts_the_threshold_bounds() {
        assert!(validate_quiz(THRESHOLD_MIN, &minimal_quiz()).is_ok());
        assert!(validate_quiz(THRESHOLD_MAX, &minimal_quiz()).is_ok());
    }

    #[test]
    fn rejects_a_threshold_below_the_floor() {
        // Zero would mean a quiz nobody can fail, which is the whole point of
        // v0.2 written backwards.
        let err = validate_quiz(0, &minimal_quiz()).unwrap_err();
        assert!(err.contains("pass mark"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_threshold_above_a_hundred_percent() {
        let err = validate_quiz(101, &minimal_quiz()).unwrap_err();
        assert!(err.contains("pass mark"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_quiz_with_no_questions() {
        let err = validate_quiz(50, &[]).unwrap_err();
        assert!(err.contains("at least one question"), "unhelpful: {err}");
    }

    #[test]
    fn rejects_a_quiz_with_too_many_questions() {
        let questions: Vec<ProposedQuestion<'_>> = (0..=QUESTIONS_MAX)
            .map(|_| question("Q", &[("Yes", true), ("No", false)]))
            .collect();
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("at most"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_question_with_one_option() {
        // A single option is not a question, it is a formality — and it would
        // make the quiz unfailable.
        let questions = vec![question("Only one way out?", &[("Yes", true)])];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("Question 1"), "unnamed question: {err}");
        assert!(err.contains("answer options"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_a_question_with_no_correct_answer() {
        let questions = vec![question("Unanswerable?", &[("No", false), ("Nope", false)])];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("no correct answer"), "unhelpful: {err}");
    }

    #[test]
    fn names_the_offending_question_by_its_position() {
        // An author staring at a long form has to be told which question, and
        // the ids do not exist yet.
        let questions = vec![
            question("Fine", &[("Yes", true), ("No", false)]),
            question("Also fine", &[("Yes", true), ("No", false)]),
            question("Broken", &[("Yes", false), ("No", false)]),
        ];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("Question 3"), "wrong question named: {err}");
    }

    #[test]
    fn rejects_an_empty_question_prompt() {
        let questions = vec![question("   ", &[("Yes", true), ("No", false)])];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("no text"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_an_empty_option() {
        let questions = vec![question("Real question?", &[("Yes", true), ("  ", false)])];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("Option 2"), "unnamed option: {err}");
    }

    #[test]
    fn rejects_an_overlong_prompt() {
        let long = "x".repeat(PROMPT_MAX + 1);
        let questions = vec![question(&long, &[("Yes", true), ("No", false)])];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("too long"), "unhelpful message: {err}");
    }

    #[test]
    fn rejects_an_overlong_option() {
        let long = "x".repeat(OPTION_TEXT_MAX + 1);
        let questions = vec![question(
            "Real question?",
            &[(long.as_str(), true), ("No", false)],
        )];
        let err = validate_quiz(50, &questions).unwrap_err();
        assert!(err.contains("too long"), "unhelpful message: {err}");
    }

    #[test]
    fn a_non_owner_cannot_write_a_quiz() {
        let err = can_write_quiz(false, true, 50, &minimal_quiz()).unwrap_err();
        assert_eq!(err, require_owner(false).unwrap_err());
    }

    #[test]
    fn a_quiz_cannot_be_attached_to_a_reading_block() {
        let err = can_write_quiz(true, false, 50, &minimal_quiz()).unwrap_err();
        assert!(err.contains("not a quiz"), "unhelpful message: {err}");
    }

    #[test]
    fn authorization_is_checked_before_anything_else() {
        // A non-owner submitting garbage must be told they are a non-owner and
        // nothing more — an input error here would confirm the block exists and
        // is a quiz.
        let err = can_write_quiz(false, false, 0, &[]).unwrap_err();
        assert_eq!(err, require_owner(false).unwrap_err());
    }

    #[test]
    fn the_block_type_is_checked_before_the_authors_input() {
        let err = can_write_quiz(true, false, 0, &[]).unwrap_err();
        assert!(err.contains("not a quiz"), "unhelpful message: {err}");
    }
}
