import type { BlockDep, Chapter, KnowledgeBlock } from '../module_bindings/types';

/**
 * The client-side mirror of `block_state` in `server/src/unlock.rs`.
 *
 * The server stays authoritative — `complete_block` and `submit_quiz` both refuse a
 * block whose prerequisites are unmet — so everything here is UX, per the
 * trust-boundary rule in CLAUDE.md. It exists because the reader has to *see* which
 * block they owe, rather than press a button and read a toast about it.
 *
 * Its own graph rather than an extra field on `chapterState.ts`'s: that one is built
 * by the map as well, which has no use for block edges, and handing it an empty list
 * would quietly make every block look unlocked. The two builders read the same
 * subscription rows, so neither can be stale relative to the other.
 *
 * Silent about the chapter, exactly like the Rust function: a chapter-level lock is
 * `chapterState`'s answer, and keeping them apart is what lets the screen say which
 * of the two a reader is looking at.
 */

export type BlockState = 'Locked' | 'Available' | 'Complete';

export type BlockNode = {
  readonly blockId: bigint;
  readonly prerequisites: readonly bigint[];
};

/** One book's blocks, keyed by id. */
export type BlockGraph = ReadonlyMap<bigint, BlockNode>;

/**
 * Assemble one book's block graph from subscription rows.
 *
 * Book-wide, across every chapter, because a prerequisite may live in another
 * chapter — v0.2 scope, "within its chapter or across chapters". A chapter-scoped
 * map would report those edges as dangling and lock the block forever.
 */
export function buildBlockGraph(
  bookId: bigint,
  chapters: readonly Chapter[],
  blocks: readonly KnowledgeBlock[],
  blockDeps: readonly BlockDep[],
): BlockGraph {
  const chapterIds = new Set(
    chapters.filter((c) => c.bookId === bookId).map((c) => c.chapterId),
  );

  return new Map(
    blocks
      .filter((b) => chapterIds.has(b.chapterId))
      .map((b) => [
        b.blockId,
        {
          blockId: b.blockId,
          prerequisites: blockDeps
            .filter((d) => d.blockId === b.blockId)
            .map((d) => d.dependsOnBlockId),
        },
      ]),
  );
}

export function blockState(
  graph: BlockGraph,
  completed: ReadonlySet<bigint>,
  blockId: bigint,
): BlockState {
  const block = graph.get(blockId);
  // Fail closed: an unknown block is Locked, not open.
  if (!block) return 'Locked';

  // Complete wins over Locked. An author adding a prerequisite to a block the reader
  // has already finished does not take it back off them.
  if (completed.has(blockId)) return 'Complete';

  // A prerequisite missing from the graph counts as incomplete — a dangling edge
  // must never be the thing that opens a block.
  const unlocked = block.prerequisites.every((id) => graph.has(id) && completed.has(id));
  return unlocked ? 'Available' : 'Locked';
}
