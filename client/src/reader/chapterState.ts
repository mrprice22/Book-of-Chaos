import type { Chapter, ChapterDep, KnowledgeBlock } from '../module_bindings/types';

/**
 * The client-side mirror of `server/src/unlock.rs`.
 *
 * The server stays authoritative — `complete_block` refuses a Blocked chapter — so
 * everything here is UX, per the trust-boundary rule in CLAUDE.md. It exists because
 * the reader has to *see* a locked chapter, and the state is derived on read rather
 * than materialised in a table (see the parking lot in docs/backlog.md).
 *
 * The rules, and the order they are checked in, are deliberately identical to the
 * Rust version. If the two ever disagree, that is a bug in this file.
 */

export type ChapterState = 'Blocked' | 'Available' | 'InProgress' | 'Complete';

export type ChapterNode = {
  readonly chapterId: bigint;
  readonly isOptional: boolean;
  readonly isPinned: boolean;
  readonly prerequisites: readonly bigint[];
  readonly blocks: readonly { readonly blockId: bigint; readonly isOptional: boolean }[];
};

/** One book's chapters, keyed by id. */
export type Graph = ReadonlyMap<bigint, ChapterNode>;

/**
 * Assemble the graph for one book from subscription rows.
 *
 * Scoped to a book because prerequisites cannot cross books, so no wider view can
 * change an answer.
 */
export function buildGraph(
  bookId: bigint,
  chapters: readonly Chapter[],
  blocks: readonly KnowledgeBlock[],
  deps: readonly ChapterDep[],
): Graph {
  const inBook = chapters.filter((c) => c.bookId === bookId);

  return new Map(
    inBook.map((c) => [
      c.chapterId,
      {
        chapterId: c.chapterId,
        isOptional: c.isOptional,
        isPinned: c.isPinned,
        prerequisites: deps
          .filter((d) => d.chapterId === c.chapterId)
          .map((d) => d.dependsOnChapterId),
        blocks: blocks
          .filter((b) => b.chapterId === c.chapterId)
          .map((b) => ({ blockId: b.blockId, isOptional: b.isOptional })),
      },
    ]),
  );
}

/**
 * A chapter with no non-optional blocks is complete: there is nothing in it the
 * reader is required to do. Requiring at least one completed block instead would
 * make a chapter of purely optional blocks impossible to finish, permanently
 * blocking everything downstream.
 */
export function isChapterComplete(
  chapter: ChapterNode,
  completed: ReadonlySet<bigint>,
): boolean {
  return chapter.blocks
    .filter((b) => !b.isOptional)
    .every((b) => completed.has(b.blockId));
}

export function chapterState(
  graph: Graph,
  completed: ReadonlySet<bigint>,
  chapterId: bigint,
): ChapterState {
  const chapter = graph.get(chapterId);
  // Fail closed: an unknown chapter is Blocked, not open.
  if (!chapter) return 'Blocked';

  // Complete wins over Blocked. If an author adds a prerequisite to a chapter the
  // reader has already finished, they keep it rather than watching it re-lock.
  if (isChapterComplete(chapter, completed)) return 'Complete';

  // Pinned skips the prerequisite check but not the completion rules, so a glossary
  // is reachable immediately and still tracks progress normally. A prerequisite that
  // is missing from the graph counts as incomplete — a dangling edge must not
  // silently unlock content.
  const unlocked =
    chapter.isPinned ||
    chapter.prerequisites.every((id) => {
      const prereq = graph.get(id);
      return prereq !== undefined && isChapterComplete(prereq, completed);
    });
  if (!unlocked) return 'Blocked';

  // Any completed block counts as started, including an optional one — the reader
  // did work, and the map should say so.
  return chapter.blocks.some((b) => completed.has(b.blockId))
    ? 'InProgress'
    : 'Available';
}
