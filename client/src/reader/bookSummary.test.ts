import { Identity, Timestamp } from 'spacetimedb';
import type { Book, Chapter, KnowledgeBlock } from '../module_bindings/types';
import { countWords, summarizeBook } from './bookSummary';

const NOW = new Timestamp(0n);
const OWNER = Identity.zero();

function book(bookId: bigint): Book {
  return {
    bookId,
    owner: OWNER,
    title: 'A Book',
    description: 'About things',
    status: { tag: 'Published' },
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function chapter(chapterId: bigint, bookId: bigint): Chapter {
  return {
    chapterId,
    bookId,
    title: 'A Chapter',
    description: '',
    position: 0,
    isOptional: false,
    isPinned: false,
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function block(blockId: bigint, chapterId: bigint, bodyHtml: string): KnowledgeBlock {
  return {
    blockId,
    chapterId,
    title: 'A Block',
    blockType: { tag: 'Reading' },
    bodyHtml,
    url: undefined,
    position: 0,
    isOptional: false,
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** `n` words of prose wrapped in a paragraph. */
function prose(n: number): string {
  return `<p>${Array.from({ length: n }, () => 'word').join(' ')}</p>`;
}

describe('countWords', () => {
  it.each([
    ['', 0],
    ['<p></p>', 0],
    ['   ', 0],
    ['<p>hello</p>', 1],
    ['<p>hello world</p>', 2],
    ['<h2>Title</h2><p>one two</p>', 3],
    ['<ul><li>a</li><li>b</li></ul>', 2],
    ['<a href="https://example.com">link text</a>', 2],
  ])('counts %j as %i words', (html, expected) => {
    expect(countWords(html)).toBe(expected);
  });

  it('does not count tag names or attributes as words', () => {
    expect(countWords('<p class="lead" id="x">one</p>')).toBe(1);
  });
});

describe('summarizeBook', () => {
  it('counts only the chapters belonging to this book', () => {
    const summary = summarizeBook(
      book(1n),
      [chapter(10n, 1n), chapter(11n, 1n), chapter(20n, 2n)],
      [],
    );
    expect(summary.chapterCount).toBe(2);
  });

  it('counts only the blocks belonging to this book’s chapters', () => {
    const summary = summarizeBook(
      book(1n),
      [chapter(10n, 1n), chapter(20n, 2n)],
      [block(100n, 10n, prose(225)), block(200n, 20n, prose(2250))],
    );
    expect(summary.readMinutes).toBe(1);
  });

  it('estimates reading time across every block in the book', () => {
    const summary = summarizeBook(
      book(1n),
      [chapter(10n, 1n), chapter(11n, 1n)],
      [
        block(100n, 10n, prose(225)),
        block(101n, 10n, prose(225)),
        block(102n, 11n, prose(450)),
      ],
    );
    expect(summary.readMinutes).toBe(4);
  });

  it('rounds a short book up to one minute rather than down to zero', () => {
    const summary = summarizeBook(
      book(1n),
      [chapter(10n, 1n)],
      [block(100n, 10n, prose(5))],
    );
    expect(summary.readMinutes).toBe(1);
  });

  it('reports zero minutes for a book with no content, which is a different fact', () => {
    expect(summarizeBook(book(1n), [chapter(10n, 1n)], []).readMinutes).toBe(0);
  });

  it('handles a book with no chapters at all', () => {
    expect(summarizeBook(book(1n), [], [])).toEqual({ chapterCount: 0, readMinutes: 0 });
  });
});
