import { aBlock, aBook, aChapter, prose } from '../test/factories';
import { countWords, summarizeBook } from './bookSummary';

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
      aBook({ bookId: 1n }),
      [
        aChapter({ chapterId: 10n, bookId: 1n }),
        aChapter({ chapterId: 11n, bookId: 1n }),
        aChapter({ chapterId: 20n, bookId: 2n }),
      ],
      [],
    );
    expect(summary.chapterCount).toBe(2);
  });

  it('counts only the blocks belonging to this book’s chapters', () => {
    const summary = summarizeBook(
      aBook({ bookId: 1n }),
      [
        aChapter({ chapterId: 10n, bookId: 1n }),
        aChapter({ chapterId: 20n, bookId: 2n }),
      ],
      [
        aBlock({ blockId: 100n, chapterId: 10n, bodyHtml: prose(225) }),
        aBlock({ blockId: 200n, chapterId: 20n, bodyHtml: prose(2250) }),
      ],
    );
    expect(summary.readMinutes).toBe(1);
  });

  it('estimates reading time across every block in the book', () => {
    const summary = summarizeBook(
      aBook({ bookId: 1n }),
      [
        aChapter({ chapterId: 10n, bookId: 1n }),
        aChapter({ chapterId: 11n, bookId: 1n }),
      ],
      [
        aBlock({ blockId: 100n, chapterId: 10n, bodyHtml: prose(225) }),
        aBlock({ blockId: 101n, chapterId: 10n, bodyHtml: prose(225) }),
        aBlock({ blockId: 102n, chapterId: 11n, bodyHtml: prose(450) }),
      ],
    );
    expect(summary.readMinutes).toBe(4);
  });

  it('rounds a short book up to one minute rather than down to zero', () => {
    const summary = summarizeBook(
      aBook(),
      [aChapter({ chapterId: 10n, bookId: 1n })],
      [aBlock({ chapterId: 10n, bodyHtml: prose(5) })],
    );
    expect(summary.readMinutes).toBe(1);
  });

  it('reports zero minutes for a book with no content, which is a different fact', () => {
    expect(summarizeBook(aBook(), [aChapter({ bookId: 1n })], []).readMinutes).toBe(0);
  });

  it('handles a book with no chapters at all', () => {
    expect(summarizeBook(aBook(), [], [])).toEqual({ chapterCount: 0, readMinutes: 0 });
  });
});
