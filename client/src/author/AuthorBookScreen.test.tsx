import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Identity } from 'spacetimedb';
import { aBlock, aBook, aChapter } from '../test/factories';
import { AuthorBookScreen } from './AuthorBookScreen';

const ME = Identity.fromString('a11ce'.padStart(64, '0'));
const SOMEONE_ELSE = Identity.fromString('b0b'.padStart(64, '0'));

const sdk = vi.hoisted(() => ({
  ready: true,
  rows: {} as Record<string, readonly unknown[]>,
  calls: [] as { name: string; args: unknown }[],
}));

vi.mock('spacetimedb/react', async () => {
  const { getQueryAccessorName } =
    await vi.importActual<typeof import('spacetimedb')>('spacetimedb');
  return {
    useSpacetimeDB: () => ({ identity: ME }),
    useTable: (query: unknown) => [
      sdk.rows[getQueryAccessorName(query)] ?? [],
      sdk.ready,
    ],
    useReducer: (def: { accessorName: string }) => (args: unknown) => {
      sdk.calls.push({ name: def.accessorName, args });
      return Promise.resolve();
    },
  };
});

const callTo = (name: string) => sdk.calls.filter((c) => c.name === name);

describe('AuthorBookScreen', () => {
  beforeEach(() => {
    sdk.ready = true;
    sdk.calls = [];
    sdk.rows = {
      books: [aBook({ bookId: 1n, title: 'Chaos', owner: ME })],
      chapters: [],
      knowledgeBlocks: [],
    };
  });

  it('refuses a book that is not the caller’s, without confirming it exists', () => {
    sdk.rows = { books: [aBook({ bookId: 1n, title: 'Theirs', owner: SOMEONE_ELSE })] };
    render(<AuthorBookScreen bookId={1n} />);
    expect(screen.getByText(/does not exist, or is not yours/i)).toBeInTheDocument();
    expect(screen.queryByText('Theirs')).not.toBeInTheDocument();
  });

  it('gives a missing book the same answer as someone else’s', () => {
    render(<AuthorBookScreen bookId={999n} />);
    expect(screen.getByText(/does not exist, or is not yours/i)).toBeInTheDocument();
  });

  it('waits for the subscription before refusing', () => {
    sdk.ready = false;
    render(<AuthorBookScreen bookId={1n} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('creates a chapter in this book', async () => {
    render(<AuthorBookScreen bookId={1n} />);
    await userEvent.type(screen.getByLabelText('Title'), 'One');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(callTo('createChapter')[0]?.args).toEqual({
      bookId: 1n,
      title: 'One',
      description: '',
      isOptional: false,
      isPinned: false,
    });
  });

  it('creates a block in the chapter whose form was used', async () => {
    sdk.rows = {
      ...sdk.rows,
      chapters: [
        aChapter({ chapterId: 10n, bookId: 1n, title: 'First', position: 0 }),
        aChapter({ chapterId: 11n, bookId: 1n, title: 'Second', position: 1 }),
      ],
    };
    render(<AuthorBookScreen bookId={1n} />);

    // The second chapter's block form — the ids are per-chapter for exactly this.
    await userEvent.type(
      screen.getByLabelText(/^Title$/, { selector: '#block-11-title' }),
      'B',
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Create' })[2] as HTMLElement,
    );

    expect(callTo('createBlock')[0]?.args).toEqual({
      chapterId: 11n,
      title: 'B',
      blockType: { tag: 'Reading' },
      bodyHtml: '',
      url: undefined,
      isOptional: false,
    });
  });

  it('lists chapters in author order and their blocks in reading order', () => {
    sdk.rows = {
      ...sdk.rows,
      chapters: [
        aChapter({ chapterId: 11n, bookId: 1n, title: 'Second', position: 1 }),
        aChapter({ chapterId: 10n, bookId: 1n, title: 'First', position: 0 }),
      ],
      knowledgeBlocks: [
        aBlock({ blockId: 101n, chapterId: 10n, title: 'Later', position: 1 }),
        aBlock({ blockId: 102n, chapterId: 10n, title: 'Earlier', position: 0 }),
      ],
    };
    render(<AuthorBookScreen bookId={1n} />);

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent);
    expect(headings.filter((h) => h === 'First' || h === 'Second')).toEqual([
      'First',
      'Second',
    ]);

    const blocks = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const earlier = blocks.findIndex((text) => text === 'Earlier');
    const later = blocks.findIndex((text) => text === 'Later');
    expect(earlier).toBeGreaterThanOrEqual(0);
    expect(earlier).toBeLessThan(later);
  });
});
