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

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

/// An edge `(chapter, prerequisite)`: `chapter` stays Blocked until
/// `prerequisite` is Complete.
pub type DepEdge = (ChapterId, ChapterId);

/// Returns a cycle in a graph snapshot, as the chapters along it, or `None` if
/// the graph is acyclic.
///
/// A cycle is a book that can never be finished — every chapter on the loop
/// waits on another chapter on the loop, so none of them ever becomes Available.
/// `chapter_state` does not recurse and so answers safely even for a cyclic
/// graph, but the answer is `Blocked` forever. That is why the write path
/// rejects cycles the moment an author draws one, rather than at publish time.
pub fn detect_cycle(graph: &Graph) -> Option<Vec<ChapterId>> {
    let edges: Vec<DepEdge> = graph
        .chapters
        .iter()
        .flat_map(|c| c.prerequisites.iter().map(|p| (c.chapter_id, *p)))
        .collect();
    find_cycle(&edges)
}

/// The same search over a bare edge list.
///
/// `set_chapter_deps` validates the graph as it *would be* after a write, which
/// is a set of edges and not yet a `Graph`, so the edge-level entry point is the
/// one the trust boundary uses.
///
/// Iterative depth-first search with an explicit stack. Recursion would be the
/// shorter code, but a hostile or merely enthusiastic author can nest a graph
/// deeper than the wasm stack, and a module that traps takes the whole reducer
/// call with it.
pub fn find_cycle(edges: &[DepEdge]) -> Option<Vec<ChapterId>> {
    // 0 = unvisited, 1 = on the current path, 2 = fully explored.
    let mut state: Vec<(ChapterId, u8)> = Vec::new();
    let mut nodes: Vec<ChapterId> = Vec::new();
    for (from, to) in edges {
        for n in [from, to] {
            if !nodes.contains(n) {
                nodes.push(*n);
                state.push((*n, 0));
            }
        }
    }
    let mark = |state: &mut Vec<(ChapterId, u8)>, node: ChapterId, value: u8| {
        if let Some(entry) = state.iter_mut().find(|(n, _)| *n == node) {
            entry.1 = value;
        }
    };
    let get = |state: &Vec<(ChapterId, u8)>, node: ChapterId| -> u8 {
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
        let mut stack: Vec<(ChapterId, usize)> = vec![(*start, 0)];
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
                            let mut path: Vec<ChapterId> = stack.iter().map(|(n, _)| *n).collect();
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

    // --- cycles, over a bare edge list --------------------------------------

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

    // --- cycles, over a graph snapshot --------------------------------------

    #[test]
    fn an_empty_graph_has_no_cycle() {
        assert_eq!(detect_cycle(&Graph::default()), None);
    }

    #[test]
    fn an_acyclic_book_has_no_cycle() {
        // Diamond: 4 waits on 2 and 3, both of which wait on 1.
        let graph = Graph::new(vec![
            chapter(1, &[], 1),
            chapter(2, &[1], 1),
            chapter(3, &[1], 1),
            chapter(4, &[2, 3], 1),
        ]);
        assert_eq!(detect_cycle(&graph), None);
    }

    #[test]
    fn a_book_with_no_edges_at_all_has_no_cycle() {
        let graph = Graph::new(vec![chapter(1, &[], 1), chapter(2, &[], 0)]);
        assert_eq!(detect_cycle(&graph), None);
    }

    #[test]
    fn detects_a_self_dependent_chapter() {
        let graph = Graph::new(vec![chapter(1, &[1], 1)]);
        assert_eq!(detect_cycle(&graph), Some(vec![1]));
    }

    #[test]
    fn detects_a_loop_among_chapters() {
        let graph = Graph::new(vec![
            chapter(1, &[3], 1),
            chapter(2, &[1], 1),
            chapter(3, &[2], 1),
        ]);
        let cycle = detect_cycle(&graph).expect("3-chapter loop not detected");
        assert_eq!(cycle.len(), 3);
        for n in [1, 2, 3] {
            assert!(cycle.contains(&n), "incomplete cycle: {cycle:?}");
        }
    }

    #[test]
    fn a_loop_leaves_every_chapter_on_it_blocked() {
        // Why cycles are rejected at write time: nothing on the loop is ever
        // reachable, and the engine reports that rather than looping forever.
        let graph = Graph::new(vec![chapter(1, &[2], 1), chapter(2, &[1], 1)]);
        let progress = Progress::default();
        assert_eq!(chapter_state(&graph, &progress, 1), ChapterState::Blocked);
        assert_eq!(chapter_state(&graph, &progress, 2), ChapterState::Blocked);
    }

    // --- graph shapes, table-driven -----------------------------------------
    //
    // The tests above pin down one decision each. This table pins down the
    // *shapes*: the degenerate graphs that break traversals. Every case asserts
    // the state of every chapter, not just the interesting one, because the
    // common failure here is a chapter that changes state when nothing about it
    // did. Failures are collected and reported together — one broken traversal
    // usually breaks several cases, and seeing all of them names the cause.

    struct Case {
        shape: &'static str,
        chapters: Vec<ChapterNode>,
        completed: Vec<BlockId>,
        expect: &'static [(ChapterId, ChapterState)],
    }

    fn optional(mut c: ChapterNode) -> ChapterNode {
        c.is_optional = true;
        c
    }

    fn pinned(mut c: ChapterNode) -> ChapterNode {
        c.is_pinned = true;
        c
    }

    /// A chapter whose single block is optional, so it has nothing required.
    fn all_optional(chapter_id: ChapterId) -> ChapterNode {
        let mut c = chapter(chapter_id, &[], 1);
        c.blocks[0].is_optional = true;
        c
    }

    fn cases() -> Vec<Case> {
        use ChapterState::{Available, Blocked, Complete, InProgress};
        vec![
            Case {
                shape: "empty graph",
                chapters: vec![],
                completed: vec![],
                expect: &[(1, Blocked)],
            },
            Case {
                shape: "linear chain, untouched",
                chapters: vec![chapter(1, &[], 1), chapter(2, &[1], 1), chapter(3, &[2], 1)],
                completed: vec![],
                expect: &[(1, Available), (2, Blocked), (3, Blocked)],
            },
            Case {
                shape: "linear chain, first done",
                chapters: vec![chapter(1, &[], 1), chapter(2, &[1], 1), chapter(3, &[2], 1)],
                completed: vec![100],
                expect: &[(1, Complete), (2, Available), (3, Blocked)],
            },
            Case {
                shape: "linear chain, finished",
                chapters: vec![chapter(1, &[], 1), chapter(2, &[1], 1), chapter(3, &[2], 1)],
                completed: vec![100, 200, 300],
                expect: &[(1, Complete), (2, Complete), (3, Complete)],
            },
            Case {
                shape: "diamond, one arm done",
                chapters: vec![
                    chapter(1, &[], 1),
                    chapter(2, &[1], 1),
                    chapter(3, &[1], 1),
                    chapter(4, &[2, 3], 1),
                ],
                completed: vec![100, 200],
                // The join waits for both arms; the arm reachable twice is not
                // confused by being visited twice.
                expect: &[(1, Complete), (2, Complete), (3, Available), (4, Blocked)],
            },
            Case {
                shape: "diamond, both arms done",
                chapters: vec![
                    chapter(1, &[], 1),
                    chapter(2, &[1], 1),
                    chapter(3, &[1], 1),
                    chapter(4, &[2, 3], 1),
                ],
                completed: vec![100, 200, 300],
                expect: &[(1, Complete), (2, Complete), (3, Complete), (4, Available)],
            },
            Case {
                shape: "disconnected islands",
                chapters: vec![
                    chapter(1, &[], 1),
                    chapter(2, &[1], 1),
                    chapter(3, &[], 1),
                    chapter(4, &[3], 1),
                ],
                completed: vec![100],
                // Progress on one island must not move the other.
                expect: &[(1, Complete), (2, Available), (3, Available), (4, Blocked)],
            },
            Case {
                shape: "optional chapter as a prerequisite",
                chapters: vec![
                    chapter(1, &[], 1),
                    optional(chapter(2, &[1], 1)),
                    chapter(3, &[2], 1),
                ],
                completed: vec![100],
                // Optional means "does not count toward finishing the book", not
                // "can be skipped as a prerequisite". An author who wants it
                // skippable does not draw the edge.
                expect: &[(1, Complete), (2, Available), (3, Blocked)],
            },
            Case {
                shape: "chapter with only optional blocks",
                chapters: vec![all_optional(1), chapter(2, &[1], 1)],
                completed: vec![],
                // Nothing required, so nothing downstream waits forever.
                expect: &[(1, Complete), (2, Available)],
            },
            Case {
                shape: "pinned chapter behind an unmet prerequisite",
                chapters: vec![chapter(1, &[], 1), pinned(chapter(2, &[1], 2))],
                completed: vec![200],
                // A glossary is reachable from the start and still tracks reading.
                expect: &[(1, Available), (2, InProgress)],
            },
            Case {
                shape: "self-cycle",
                chapters: vec![chapter(1, &[1], 1), chapter(2, &[], 1)],
                completed: vec![],
                expect: &[(1, Blocked), (2, Available)],
            },
            Case {
                shape: "three-node cycle",
                chapters: vec![
                    chapter(1, &[3], 1),
                    chapter(2, &[1], 1),
                    chapter(3, &[2], 1),
                ],
                completed: vec![],
                // Every chapter on a loop is unreachable, and the engine says so
                // instead of recursing forever. This is why the write path
                // rejects cycles.
                expect: &[(1, Blocked), (2, Blocked), (3, Blocked)],
            },
        ]
    }

    #[test]
    fn every_graph_shape_yields_the_expected_states() {
        let mut failures: Vec<String> = Vec::new();
        for case in cases() {
            let graph = Graph::new(case.chapters);
            let progress = Progress::from_completed_blocks(case.completed);
            for (chapter_id, expected) in case.expect {
                let actual = chapter_state(&graph, &progress, *chapter_id);
                if actual != *expected {
                    failures.push(format!(
                        "{}: chapter {chapter_id} is {actual:?}, expected {expected:?}",
                        case.shape
                    ));
                }
            }
        }
        assert!(failures.is_empty(), "\n{}", failures.join("\n"));
    }

    #[test]
    fn every_graph_shape_agrees_with_detect_cycle() {
        // The same table, read for the other property: exactly the two cyclic
        // shapes are cyclic. A traversal that reports a diamond as a cycle would
        // make the author-side rejection message a lie.
        let cyclic = ["self-cycle", "three-node cycle"];
        let mut failures: Vec<String> = Vec::new();
        for case in cases() {
            let expected = cyclic.contains(&case.shape);
            let found = detect_cycle(&Graph::new(case.chapters));
            if found.is_some() != expected {
                failures.push(format!("{}: detect_cycle returned {found:?}", case.shape));
            }
        }
        assert!(failures.is_empty(), "\n{}", failures.join("\n"));
    }
}
