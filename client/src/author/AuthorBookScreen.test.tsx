import { render, screen, within } from '@testing-library/react';
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
  rejectWith: {} as Record<string, string | undefined>,
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
      const rejection = sdk.rejectWith[def.accessorName];
      return rejection === undefined
        ? Promise.resolve()
        : Promise.reject(new Error(rejection));
    },
  };
});

const callTo = (name: string) => sdk.calls.filter((c) => c.name === name);

/** The nth chapter's "Save prerequisites" button — one per chapter, in list order. */
function savePrerequisitesFor(index: number): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: 'Save prerequisites' });
  const button = buttons[index];
  if (!button) throw new Error(`no prerequisite form at index ${index}`);
  return button;
}

describe('AuthorBookScreen', () => {
  beforeEach(() => {
    sdk.ready = true;
    sdk.calls = [];
    sdk.rejectWith = {};
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

describe('AuthorBookScreen prerequisites', () => {
  beforeEach(() => {
    sdk.ready = true;
    sdk.calls = [];
    sdk.rejectWith = {};
    sdk.rows = {
      books: [aBook({ bookId: 1n, title: 'Chaos', owner: ME })],
      chapters: [
        aChapter({ chapterId: 10n, bookId: 1n, title: 'First', position: 0 }),
        aChapter({ chapterId: 11n, bookId: 1n, title: 'Second', position: 1 }),
      ],
      knowledgeBlocks: [],
      chapterDeps: [],
    };
  });

  it('sets prerequisites for the chapter whose form was used', async () => {
    render(<AuthorBookScreen bookId={1n} />);

    await userEvent.click(screen.getByLabelText('First', { selector: '#prereq-11-10' }));
    await userEvent.click(savePrerequisitesFor(1));

    expect(callTo('setChapterDeps')[0]?.args).toEqual({
      chapterId: 11n,
      dependsOnChapterIds: [10n],
    });
  });

  it('shows a cycle rejection under the chapter that caused it, and only there', async () => {
    sdk.rejectWith = {
      setChapterDeps: 'That would create a cycle: Second → First → Second',
    };
    sdk.rows = {
      ...sdk.rows,
      chapterDeps: [{ depId: 1n, chapterId: 10n, dependsOnChapterId: 11n }],
    };
    render(<AuthorBookScreen bookId={1n} />);

    await userEvent.click(screen.getByLabelText('First', { selector: '#prereq-11-10' }));
    await userEvent.click(savePrerequisitesFor(1));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      'That would create a cycle: Second → First → Second',
    );
  });

  it('offers a quiz form on a Quiz block and on nothing else', () => {
    sdk.rows = {
      ...sdk.rows,
      knowledgeBlocks: [
        aBlock({ blockId: 101n, chapterId: 10n, title: 'Reading', position: 0 }),
        aBlock({
          blockId: 102n,
          chapterId: 10n,
          title: 'The quiz',
          position: 1,
          blockType: { tag: 'Quiz' },
        }),
      ],
    };
    render(<AuthorBookScreen bookId={1n} />);
    expect(screen.getAllByRole('button', { name: 'Save quiz' })).toHaveLength(1);
  });

  it('writes the quiz to the block whose form was used', async () => {
    sdk.rows = {
      ...sdk.rows,
      knowledgeBlocks: [
        aBlock({
          blockId: 102n,
          chapterId: 10n,
          title: 'The quiz',
          blockType: { tag: 'Quiz' },
        }),
      ],
    };
    render(<AuthorBookScreen bookId={1n} />);

    const form = within(screen.getByRole('group', { name: 'Question 1' }));
    await userEvent.type(form.getByLabelText('Question'), 'Who grades?');
    await userEvent.type(form.getByLabelText('Answer 1'), 'The server');
    await userEvent.type(form.getByLabelText('Answer 2'), 'The client');
    await userEvent.click(form.getByLabelText('Answer 1 is correct'));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiz' }));

    expect(callTo('setQuiz')[0]?.args).toEqual({
      blockId: 102n,
      passThreshold: 100,
      questions: [
        {
          promptHtml: 'Who grades?',
          options: [
            { textHtml: 'The server', isCorrect: true },
            { textHtml: 'The client', isCorrect: false },
          ],
        },
      ],
    });
  });

  it('shows a rejected quiz under the block it was rejected for', async () => {
    sdk.rejectWith = { setQuiz: 'Question 1 has no correct answer marked.' };
    sdk.rows = {
      ...sdk.rows,
      knowledgeBlocks: [
        aBlock({ blockId: 102n, chapterId: 10n, blockType: { tag: 'Quiz' } }),
        aBlock({ blockId: 103n, chapterId: 11n, blockType: { tag: 'Quiz' } }),
      ],
    };
    render(<AuthorBookScreen bookId={1n} />);

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Save quiz' })[0] as HTMLElement,
    );
    // One alert, under one quiz: the other block's form must not inherit it.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Question 1 has no correct answer marked.');
  });

  it('reflects the stored edges rather than a stale local draft', () => {
    sdk.rows = {
      ...sdk.rows,
      chapterDeps: [{ depId: 1n, chapterId: 11n, dependsOnChapterId: 10n }],
    };
    render(<AuthorBookScreen bookId={1n} />);
    expect(screen.getByLabelText('First', { selector: '#prereq-11-10' })).toBeChecked();
  });
});

describe('AuthorBookScreen publishing', () => {
  beforeEach(() => {
    sdk.ready = true;
    sdk.calls = [];
    sdk.rejectWith = {};
    sdk.rows = { chapters: [], knowledgeBlocks: [], chapterDeps: [] };
  });

  it('publishes this book', async () => {
    sdk.rows = {
      ...sdk.rows,
      books: [aBook({ bookId: 4n, title: 'Chaos', owner: ME, status: { tag: 'Draft' } })],
    };
    render(<AuthorBookScreen bookId={4n} />);

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(callTo('publishBook')[0]?.args).toEqual({ bookId: 4n });
  });

  it('shows the published state, with nothing left to press', () => {
    sdk.rows = {
      ...sdk.rows,
      books: [
        aBook({ bookId: 4n, title: 'Chaos', owner: ME, status: { tag: 'Published' } }),
      ],
    };
    render(<AuthorBookScreen bookId={4n} />);

    expect(screen.getByText(/readers can see/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });
});
