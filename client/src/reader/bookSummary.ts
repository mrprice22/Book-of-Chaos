import type { Book, Chapter, KnowledgeBlock } from '../module_bindings/types';

/** Words per minute for silent reading of prose. Conventional midpoint of 200–250. */
const WORDS_PER_MINUTE = 225;

export type BookSummary = {
  readonly chapterCount: number;
  readonly readMinutes: number;
};

/**
 * Word count of a sanitized HTML fragment.
 *
 * Tags are dropped, not counted: `<p>hello</p>` is one word. The body is already
 * sanitized server-side (M2.4), so this is a display heuristic operating on known
 * markup, not a parser hardened against hostile input.
 */
export function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ');
  const words = text.trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}

/**
 * Chapter count and estimated reading time for one book.
 *
 * Both are derived from the subscription rather than stored, so they cannot go stale
 * against the content. Optional chapters are counted: the reader is being told how
 * big the book is, not what the unlock engine requires of them.
 */
export function summarizeBook(
  book: Book,
  chapters: readonly Chapter[],
  blocks: readonly KnowledgeBlock[],
): BookSummary {
  const chapterIds = new Set(
    chapters.filter((c) => c.bookId === book.bookId).map((c) => c.chapterId),
  );

  const words = blocks
    .filter((b) => chapterIds.has(b.chapterId))
    .reduce((total, b) => total + countWords(b.bodyHtml), 0);

  return {
    chapterCount: chapterIds.size,
    // A book with any content at all reads as at least a minute; "0 min read"
    // says the book is empty, which is a different fact.
    readMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}
