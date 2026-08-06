import { render, screen } from '@testing-library/react';
import { getQueryAccessorName } from 'spacetimedb';
import type { Book, Chapter, KnowledgeBlock } from '../module_bindings/types';
import { aBook, aChapter } from '../test/factories';
import { Library } from './Library';

// The seam is the SDK's subscription hook; Library, BookLanding and summarizeBook
// are all real below it.
const sdk = vi.hoisted(() => ({
  ready: true,
  rows: {} as Record<string, readonly unknown[]>,
}));

vi.mock('spacetimedb/react', async () => {
  const { getQueryAccessorName: accessorName } =
    await vi.importActual<typeof import('spacetimedb')>('spacetimedb');
  return {
    useTable: (query: unknown) => [sdk.rows[accessorName(query)] ?? [], sdk.ready],
  };
});

function seed(rows: {
  books?: Book[];
  chapters?: Chapter[];
  knowledgeBlocks?: KnowledgeBlock[];
}) {
  sdk.rows = {
    books: rows.books ?? [],
    chapters: rows.chapters ?? [],
    knowledgeBlocks: rows.knowledgeBlocks ?? [],
  };
}

describe('Library', () => {
  beforeEach(() => {
    sdk.ready = true;
    seed({});
  });

  it('waits for the subscription before deciding there is no book', () => {
    sdk.ready = false;
    render(<Library />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('says so when nothing is published', () => {
    seed({
      books: [aBook({ bookId: 1n, title: 'Draft Book', status: { tag: 'Draft' } })],
    });
    render(<Library />);
    expect(screen.getByText(/no book/i)).toBeInTheDocument();
  });

  it('never shows a draft book to a reader', () => {
    seed({
      books: [
        aBook({ bookId: 1n, title: 'Draft Book', status: { tag: 'Draft' } }),
        aBook({ bookId: 2n, title: 'Published Book' }),
      ],
      chapters: [aChapter({ chapterId: 10n, bookId: 2n })],
    });
    render(<Library />);
    expect(screen.getByRole('heading', { name: 'Published Book' })).toBeInTheDocument();
    expect(screen.queryByText('Draft Book')).not.toBeInTheDocument();
  });

  it('summarises the published book it lands on', () => {
    seed({
      books: [aBook({ bookId: 3n, title: 'Chaos' })],
      chapters: [
        aChapter({ chapterId: 10n, bookId: 3n }),
        aChapter({ chapterId: 11n, bookId: 3n }),
      ],
    });
    render(<Library />);
    expect(screen.getByText('2 chapters')).toBeInTheDocument();
  });
});

describe('the fake subscription', () => {
  // If these names drifted, the fake would return no rows for every table and the
  // assertions above would quietly be testing the empty state instead.
  it('keys rows by the same accessor name the query builder uses', async () => {
    const { tables } = await import('../module_bindings');
    expect(getQueryAccessorName(tables.books)).toBe('books');
    expect(getQueryAccessorName(tables.chapters)).toBe('chapters');
    expect(getQueryAccessorName(tables.knowledgeBlocks)).toBe('knowledgeBlocks');
  });
});
