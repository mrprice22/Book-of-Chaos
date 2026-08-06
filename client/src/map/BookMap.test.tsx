import { render, screen, waitFor } from '@testing-library/react';
import { Identity } from 'spacetimedb';
import { aBlock, aChapter, someProgress } from '../test/factories';
import { BookMap } from './BookMap';

const READER = Identity.fromString('a11ce'.padStart(64, '0'));

const sdk = vi.hoisted(() => ({
  ready: true,
  rows: {} as Record<string, readonly unknown[]>,
}));

vi.mock('spacetimedb/react', async () => {
  const { getQueryAccessorName } =
    await vi.importActual<typeof import('spacetimedb')>('spacetimedb');
  return {
    useSpacetimeDB: () => ({ identity: READER }),
    useTable: (query: unknown) => [
      sdk.rows[getQueryAccessorName(query)] ?? [],
      sdk.ready,
    ],
  };
});

// The map's own rendering is covered by KnowledgeMap.test.tsx; here the assertions
// are about the source it is handed.
const mermaidMock = vi.hoisted(() => ({
  render: vi.fn(() => Promise.resolve({ svg: '<svg></svg>' })),
  initialize: vi.fn(),
}));
vi.mock('mermaid', () => ({ default: mermaidMock }));

const lastSource = () => {
  const call = mermaidMock.render.mock.calls.at(-1) as unknown as
    [string, string] | undefined;
  return call?.[1] ?? '';
};

describe('BookMap', () => {
  beforeEach(() => {
    mermaidMock.render.mockClear();
    sdk.ready = true;
    sdk.rows = {};
  });

  it('says a book with no chapters has none', () => {
    sdk.rows = { chapters: [aChapter({ bookId: 2n })] };
    render(<BookMap bookId={1n} />);
    expect(screen.getByText(/no chapters/i)).toBeInTheDocument();
  });

  it('states every node from the reader’s own progress', async () => {
    sdk.rows = {
      chapters: [
        aChapter({ chapterId: 1n, bookId: 1n, title: 'One' }),
        aChapter({ chapterId: 2n, bookId: 1n, title: 'Two' }),
        aChapter({ chapterId: 3n, bookId: 1n, title: 'Three' }),
      ],
      knowledgeBlocks: [
        aBlock({ blockId: 10n, chapterId: 1n }),
        aBlock({ blockId: 20n, chapterId: 2n }),
        aBlock({ blockId: 21n, chapterId: 2n }),
        aBlock({ blockId: 30n, chapterId: 3n }),
      ],
      chapterDeps: [
        { depId: 1n, chapterId: 2n, dependsOnChapterId: 1n },
        { depId: 2n, chapterId: 3n, dependsOnChapterId: 2n },
      ],
      readerProgress: [
        someProgress({ progressId: 1n, identity: READER, blockId: 10n }),
        someProgress({ progressId: 2n, identity: READER, blockId: 20n }),
      ],
    };

    render(<BookMap bookId={1n} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalled());

    const source = lastSource();
    expect(source).toContain('class c1 complete');
    expect(source).toContain('class c2 inprogress');
    expect(source).toContain('class c3 blocked');
    expect(source).toContain('c1 --> c2');
  });

  it('carries the author’s flags onto the nodes', async () => {
    sdk.rows = {
      chapters: [
        aChapter({ chapterId: 1n, bookId: 1n, title: 'Glossary', isPinned: true }),
        aChapter({ chapterId: 2n, bookId: 1n, title: 'Aside', isOptional: true }),
      ],
      knowledgeBlocks: [
        aBlock({ blockId: 10n, chapterId: 1n }),
        aBlock({ blockId: 20n, chapterId: 2n }),
      ],
      chapterDeps: [],
      readerProgress: [],
    };

    render(<BookMap bookId={1n} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalled());

    expect(lastSource()).toContain('📌');
    expect(lastSource()).toContain('⭐');
  });

  it('leaves another book’s chapters off the map', async () => {
    sdk.rows = {
      chapters: [
        aChapter({ chapterId: 1n, bookId: 1n, title: 'Mine' }),
        aChapter({ chapterId: 9n, bookId: 2n, title: 'Theirs' }),
      ],
      knowledgeBlocks: [],
      chapterDeps: [],
      readerProgress: [],
    };

    render(<BookMap bookId={1n} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalled());

    expect(lastSource()).toContain('c1[');
    expect(lastSource()).not.toContain('c9[');
  });
});
