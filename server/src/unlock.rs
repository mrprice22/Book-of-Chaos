//! The unlock engine.
//!
//! This is the core of the product: what a reader may open, and when. Nothing in
//! here touches SpacetimeDB. A reducer gathers a book-sized snapshot of the graph
//! and the reader's progress, calls in, and renders or stores the answer — which
//! means every rule below is testable with `cargo test` and no running database.
//!
//! The two rules, from `docs/mvp-scope.md`:
//!
//! - A chapter is **Complete** when every non-optional block in it is complete.
//! - A chapter is **Available** when every prerequisite chapter is Complete.

pub type ChapterId = u64;
pub type BlockId = u64;

/// A block, reduced to the two facts unlocking cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlockNode {
    pub block_id: BlockId,
    /// Optional blocks do not hold their chapter back from Complete.
    pub is_optional: bool,
}

/// A chapter and its edges, as the engine sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChapterNode {
    pub chapter_id: ChapterId,
    /// Optional chapters do not count toward *book* completion. It has no effect
    /// on this chapter's own state; it is carried here because the map (M6) reads
    /// the same snapshot.
    pub is_optional: bool,
    /// Pinned chapters (glossary, appendix) are reachable regardless of their
    /// prerequisites — see `chapter_state`.
    pub is_pinned: bool,
    /// The chapters this one waits on.
    pub prerequisites: Vec<ChapterId>,
    pub blocks: Vec<BlockNode>,
}

/// A snapshot of one book's chapter graph.
///
/// Scoped to a book because prerequisites cannot cross books, so no wider view
/// can change an answer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Graph {
    pub chapters: Vec<ChapterNode>,
}

impl Graph {
    pub fn new(chapters: Vec<ChapterNode>) -> Self {
        Self { chapters }
    }

    pub fn chapter(&self, chapter_id: ChapterId) -> Option<&ChapterNode> {
        self.chapters.iter().find(|c| c.chapter_id == chapter_id)
    }
}

/// One reader's completed blocks.
///
/// Absence means "not complete", which is what makes `complete_block` (M3.3)
/// naturally idempotent.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Progress {
    completed: Vec<BlockId>,
}

impl Progress {
    pub fn from_completed_blocks(block_ids: impl IntoIterator<Item = BlockId>) -> Self {
        Self {
            completed: block_ids.into_iter().collect(),
        }
    }

    pub fn has_completed(&self, block_id: BlockId) -> bool {
        self.completed.contains(&block_id)
    }
}

/// The four node states v0.1 renders on the knowledge map.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChapterState {
    /// A prerequisite is not yet complete.
    Blocked,
    /// Open, and untouched.
    Available,
    /// Open, and at least one block done — but not finished.
    InProgress,
    /// Every non-optional block is done.
    Complete,
}

/// Whether a chapter counts as complete for the reader.
///
/// A chapter with no non-optional blocks is complete: there is nothing in it the
/// reader is required to do. That reading matters — the alternative, requiring at
/// least one completed block, would make a chapter of purely optional blocks
/// impossible to finish and would permanently block everything downstream of it.
pub fn is_chapter_complete(chapter: &ChapterNode, progress: &Progress) -> bool {
    chapter
        .blocks
        .iter()
        .filter(|b| !b.is_optional)
        .all(|b| progress.has_completed(b.block_id))
}

/// The reader's state for one chapter.
///
/// Order of the checks is the interesting part:
///
/// 1. **Complete wins over Blocked.** If an author adds a prerequisite to a
///    chapter a reader has already finished, the reader keeps their progress
///    rather than watching a finished chapter re-lock.
/// 2. **Pinned skips the prerequisite check** but not the completion rules, so a
///    glossary is reachable immediately and still tracks progress normally.
/// 3. A prerequisite that is not in the graph is treated as *not* complete. This
///    fails closed; it cannot arise in v0.1 (there is no chapter deletion) and a
///    dangling edge should not silently unlock content.
///
/// An unknown `chapter_id` is `Blocked` for the same fail-closed reason.
pub fn chapter_state(graph: &Graph, progress: &Progress, chapter_id: ChapterId) -> ChapterState {
    let Some(chapter) = graph.chapter(chapter_id) else {
        return ChapterState::Blocked;
    };

    if is_chapter_complete(chapter, progress) {
        return ChapterState::Complete;
    }

    let unlocked = chapter.is_pinned
        || chapter.prerequisites.iter().all(|prereq| {
            graph
                .chapter(*prereq)
                .is_some_and(|c| is_chapter_complete(c, progress))
        });
    if !unlocked {
        return ChapterState::Blocked;
    }

    // Any completed block counts as started, including an optional one — the
    // reader did work, and the map should say so.
    if chapter
        .blocks
        .iter()
        .any(|b| progress.has_completed(b.block_id))
    {
        ChapterState::InProgress
    } else {
        ChapterState::Available
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A chapter with `count` required blocks, whose ids are `chapter_id * 100 + n`.
    fn chapter(chapter_id: ChapterId, prerequisites: &[ChapterId], blocks: usize) -> ChapterNode {
        ChapterNode {
            chapter_id,
            is_optional: false,
            is_pinned: false,
            prerequisites: prerequisites.to_vec(),
            blocks: (0..blocks)
                .map(|n| BlockNode {
                    block_id: chapter_id * 100 + n as BlockId,
                    is_optional: false,
                })
                .collect(),
        }
    }

    fn block(chapter_id: ChapterId, n: BlockId) -> BlockId {
        chapter_id * 100 + n
    }

    #[test]
    fn a_chapter_with_no_prerequisites_is_available() {
        let graph = Graph::new(vec![chapter(1, &[], 2)]);
        let progress = Progress::default();
        assert_eq!(chapter_state(&graph, &progress, 1), ChapterState::Available);
    }

    #[test]
    fn a_chapter_waiting_on_an_unfinished_prerequisite_is_blocked() {
        let graph = Graph::new(vec![chapter(1, &[], 1), chapter(2, &[1], 1)]);
        let progress = Progress::default();
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Blocked);
    }

    #[test]
    fn finishing_the_prerequisite_unlocks_the_next_chapter() {
        let graph = Graph::new(vec![chapter(1, &[], 1), chapter(2, &[1], 1)]);
        let progress = Progress::from_completed_blocks([block(1, 0)]);
        assert_eq!(chapter_state(&graph, &progress, 1), ChapterState::Complete);
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Available);
    }

    #[test]
    fn a_partly_read_chapter_is_in_progress() {
        let graph = Graph::new(vec![chapter(1, &[], 3)]);
        let progress = Progress::from_completed_blocks([block(1, 0)]);
        assert_eq!(
            chapter_state(&graph, &progress, 1),
            ChapterState::InProgress
        );
    }

    #[test]
    fn every_prerequisite_must_be_complete_not_just_one() {
        // A join node: 3 waits on both 1 and 2.
        let graph = Graph::new(vec![
            chapter(1, &[], 1),
            chapter(2, &[], 1),
            chapter(3, &[1, 2], 1),
        ]);
        let half = Progress::from_completed_blocks([block(1, 0)]);
        assert_eq!(chapter_state(&graph, &half, 3), ChapterState::Blocked);

        let both = Progress::from_completed_blocks([block(1, 0), block(2, 0)]);
        assert_eq!(chapter_state(&graph, &both, 3), ChapterState::Available);
    }

    #[test]
    fn optional_blocks_do_not_hold_a_chapter_back() {
        let mut c = chapter(1, &[], 2);
        c.blocks[1].is_optional = true;
        let graph = Graph::new(vec![c]);
        let progress = Progress::from_completed_blocks([block(1, 0)]);
        assert_eq!(chapter_state(&graph, &progress, 1), ChapterState::Complete);
    }

    #[test]
    fn a_completed_optional_block_still_counts_as_started() {
        let mut c = chapter(1, &[], 2);
        c.blocks[0].is_optional = true;
        let graph = Graph::new(vec![c]);
        let progress = Progress::from_completed_blocks([block(1, 0)]);
        assert_eq!(
            chapter_state(&graph, &progress, 1),
            ChapterState::InProgress
        );
    }

    #[test]
    fn a_chapter_with_nothing_required_is_complete() {
        // Nothing the reader must do — see `is_chapter_complete`. The important
        // consequence is that it does not permanently block its dependents.
        let graph = Graph::new(vec![chapter(1, &[], 0), chapter(2, &[1], 1)]);
        let progress = Progress::default();
        assert_eq!(chapter_state(&graph, &progress, 1), ChapterState::Complete);
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Available);
    }

    #[test]
    fn a_pinned_chapter_ignores_its_prerequisites() {
        let mut pinned = chapter(2, &[1], 1);
        pinned.is_pinned = true;
        let graph = Graph::new(vec![chapter(1, &[], 1), pinned]);
        let progress = Progress::default();
        assert_eq!(chapter_state(&graph, &progress, 1), ChapterState::Available);
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Available);
    }

    #[test]
    fn a_pinned_chapter_still_tracks_completion() {
        let mut pinned = chapter(2, &[1], 2);
        pinned.is_pinned = true;
        let graph = Graph::new(vec![chapter(1, &[], 1), pinned]);
        let started = Progress::from_completed_blocks([block(2, 0)]);
        assert_eq!(chapter_state(&graph, &started, 2), ChapterState::InProgress);
        let done = Progress::from_completed_blocks([block(2, 0), block(2, 1)]);
        assert_eq!(chapter_state(&graph, &done, 2), ChapterState::Complete);
    }

    #[test]
    fn a_finished_chapter_does_not_relock_when_a_prerequisite_is_added() {
        // The author adds 1 as a prerequisite of 2 after the reader finished 2.
        let graph = Graph::new(vec![chapter(1, &[], 1), chapter(2, &[1], 1)]);
        let progress = Progress::from_completed_blocks([block(2, 0)]);
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Complete);
    }

    #[test]
    fn an_unknown_chapter_is_blocked() {
        let graph = Graph::new(vec![chapter(1, &[], 1)]);
        assert_eq!(
            chapter_state(&graph, &Progress::default(), 99),
            ChapterState::Blocked
        );
    }

    #[test]
    fn a_dangling_prerequisite_fails_closed() {
        // An edge to a chapter that is not in the snapshot must not unlock
        // anything, however the graph came to be that way.
        let graph = Graph::new(vec![chapter(2, &[99], 1)]);
        assert_eq!(
            chapter_state(&graph, &Progress::default(), 2),
            ChapterState::Blocked
        );
    }

    #[test]
    fn an_empty_graph_answers_without_panicking() {
        let graph = Graph::default();
        assert_eq!(
            chapter_state(&graph, &Progress::default(), 1),
            ChapterState::Blocked
        );
    }

    #[test]
    fn progress_in_another_chapter_does_not_leak() {
        let graph = Graph::new(vec![chapter(1, &[], 1), chapter(2, &[], 1)]);
        let progress = Progress::from_completed_blocks([block(1, 0)]);
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Available);
    }
}
