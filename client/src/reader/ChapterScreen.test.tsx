import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Identity, getQueryAccessorName } from 'spacetimedb';
import { aBlock, aChapter, someProgress } from '../test/factories';
import { ChapterScreen } from './ChapterScreen';

const READER = Identity.fromString('a11ce'.padStart(64, '0'));
const OTHER_READER = Identity.fromString('b0b'.padStart(64, '0'));

// The fake stands in for the subscription, not for a fetch: tests push new rows into
// it and re-render, which is exactly what an incoming subscription update does.
const sdk = vi.hoisted(() => ({
  ready: true,
  rows: {} as Record<string, readonly unknown[]>,
  identity: undefined as unknown,
  completeBlock: undefined as unknown,
}));

vi.mock('spacetimedb/react', async () => {
  const { getQueryAccessorName: accessorName } =
    await vi.importActual<typeof import('spacetimedb')>('spacetimedb');
  return {
    useSpacetimeDB: () => ({ identity: sdk.identity }),
    useTable: (query: unknown) => [sdk.rows[accessorName(query)] ?? [], sdk.ready],
    useReducer: () => sdk.completeBlock,
  };
});

describe('ChapterScreen', () => {
  beforeEach(() => {
    sdk.ready = true;
    sdk.identity = READER;
    sdk.completeBlock = vi.fn(() => Promise.resolve());
    sdk.rows = {
      chapters: [aChapter({ chapterId: 10n, title: 'Attractors' })],
      knowledgeBlocks: [aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' })],
      readerProgress: [],
    };
  });

  it('shows the chapter named in the route', () => {
    render(<ChapterScreen chapterId={10n} />);
    expect(screen.getByRole('heading', { name: 'Attractors' })).toBeInTheDocument();
  });

  it('shows only the blocks of that chapter', () => {
    sdk.rows = {
      ...sdk.rows,
      knowledgeBlocks: [
        aBlock({ blockId: 100n, chapterId: 10n, title: 'Mine' }),
        aBlock({ blockId: 200n, chapterId: 11n, title: 'Someone else’s' }),
      ],
    };
    render(<ChapterScreen chapterId={10n} />);
    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText('Someone else’s')).not.toBeInTheDocument();
  });

  it('says so when the route points at a chapter that does not exist', () => {
    render(<ChapterScreen chapterId={999n} />);
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });

  it('waits for the subscription rather than claiming the chapter is missing', () => {
    sdk.ready = false;
    render(<ChapterScreen chapterId={999n} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
  });

  it('calls the reducer with the block id', async () => {
    render(<ChapterScreen chapterId={10n} />);
    await userEvent.click(screen.getByRole('button', { name: /mark as complete/i }));
    expect(sdk.completeBlock).toHaveBeenCalledWith({ blockId: 100n });
  });

  it('reflects a completion that arrives over the subscription, with no refetch', () => {
    const { rerender } = render(<ChapterScreen chapterId={10n} />);
    expect(screen.getByRole('button', { name: /mark as complete/i })).toBeInTheDocument();

    // The reducer wrote a row; the subscription delivers it. Nothing in the
    // component asked for it.
    sdk.rows = {
      ...sdk.rows,
      readerProgress: [someProgress({ identity: READER, blockId: 100n })],
    };
    rerender(<ChapterScreen chapterId={10n} />);

    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
  });

  it('does not treat another reader’s progress as this reader’s', () => {
    sdk.rows = {
      ...sdk.rows,
      readerProgress: [someProgress({ identity: OTHER_READER, blockId: 100n })],
    };
    render(<ChapterScreen chapterId={10n} />);
    expect(screen.getByRole('button', { name: /mark as complete/i })).toBeInTheDocument();
  });

  it('shows a rejected completion instead of swallowing it', async () => {
    sdk.completeBlock = vi.fn(() => Promise.reject(new Error('Chapter is blocked')));
    render(<ChapterScreen chapterId={10n} />);
    await userEvent.click(screen.getByRole('button', { name: /mark as complete/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chapter is blocked');
  });
});

describe('the fake subscription', () => {
  it('keys rows by the same accessor names the query builder uses', async () => {
    const { tables } = await import('../module_bindings');
    expect(getQueryAccessorName(tables.chapters)).toBe('chapters');
    expect(getQueryAccessorName(tables.knowledgeBlocks)).toBe('knowledgeBlocks');
    expect(getQueryAccessorName(tables.readerProgress)).toBe('readerProgress');
  });
});
