import { render, screen } from '@testing-library/react';
import { Identity, Timestamp, getQueryAccessorName } from 'spacetimedb';
import type { Book, Chapter, KnowledgeBlock } from '../module_bindings/types';
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

const NOW = new Timestamp(0n);

function book(bookId: bigint, title: string, status: 'Draft' | 'Published'): Book {
  return {
    bookId,
    owner: Identity.zero(),
    title,
    description: `${title} description`,
    status: { tag: status },
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function chapter(chapterId: bigint, bookId: bigint): Chapter {
  return {
    chapterId,
    bookId,
    title: 'Chapter',
    description: '',
    position: 0,
    isOptional: false,
    isPinned: false,
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function seed(rows: {
  books?: Book[];
  chapters?: Chapter[];
  knowledgeBlocks?: KnowledgeBlock[];
}) {
  sdk.rows = {
    books: rows.books ?? [],
    chapters: rows.chapters ?? [],
    knowledge_blocks: rows.knowledgeBlocks ?? [],
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
    seed({ books: [book(1n, 'Draft Book', 'Draft')] });
    render(<Library />);
    expect(screen.getByText(/no book/i)).toBeInTheDocument();
  });

  it('never shows a draft book to a reader', () => {
    seed({
      books: [book(1n, 'Draft Book', 'Draft'), book(2n, 'Published Book', 'Published')],
      chapters: [chapter(10n, 2n)],
    });
    render(<Library />);
    expect(screen.getByRole('heading', { name: 'Published Book' })).toBeInTheDocument();
    expect(screen.queryByText('Draft Book')).not.toBeInTheDocument();
  });

  it('summarises the published book it lands on', () => {
    seed({
      books: [book(3n, 'Chaos', 'Published')],
      chapters: [chapter(10n, 3n), chapter(11n, 3n)],
    });
    render(<Library />);
    expect(screen.getByText('2 chapters')).toBeInTheDocument();
  });
});

// The accessor names above have to match what the query builder reports, or the
// fake would silently return no rows for every table and the assertions would be
// testing the empty state.
describe('the fake subscription', () => {
  it('keys rows by the same accessor name the query builder uses', async () => {
    const { tables } = await import('../module_bindings');
    expect(getQueryAccessorName(tables.books)).toBe('books');
    expect(getQueryAccessorName(tables.chapters)).toBe('chapters');
    expect(Object.keys(sdk.rows)).toContain(getQueryAccessorName(tables.knowledgeBlocks));
  });
});
