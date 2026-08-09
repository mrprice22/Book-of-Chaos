import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Identity, getQueryAccessorName } from 'spacetimedb';
import {
  aBlock,
  aBlockDep,
  aChapter,
  anAttempt,
  anOption,
  aQuestion,
  aQuizConfig,
  aResult,
  someProgress,
} from '../test/factories';
import { ChapterScreen } from './ChapterScreen';

const READER = Identity.fromString('a11ce'.padStart(64, '0'));
const OTHER_READER = Identity.fromString('b0b'.padStart(64, '0'));

// The fake stands in for the subscription, not for a fetch: tests push new rows into
// it and re-render, which is exactly what an incoming subscription update does.
const sdk = vi.hoisted(() => ({
  ready: true,
  rows: {} as Record<string, readonly unknown[]>,
  identity: undefined as unknown,
  // Keyed by accessor name, because the screen now calls two reducers and a
  // single shared spy could not tell "submitted a quiz" from "clicked complete".
  reducers: {} as Record<string, unknown>,
}));

vi.mock('spacetimedb/react', async () => {
  const { getQueryAccessorName: accessorName } =
    await vi.importActual<typeof import('spacetimedb')>('spacetimedb');
  return {
    useSpacetimeDB: () => ({ identity: sdk.identity }),
    useTable: (query: unknown) => [sdk.rows[accessorName(query)] ?? [], sdk.ready],
    useReducer: (reducer: { accessorName: string }) => sdk.reducers[reducer.accessorName],
  };
});

/** Add a written Quiz block (101) to the chapter alongside the reading block. */
function quizRows() {
  sdk.rows = {
    ...sdk.rows,
    knowledgeBlocks: [
      aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' }),
      aBlock({
        blockId: 101n,
        chapterId: 10n,
        title: 'The quiz',
        position: 1,
        blockType: { tag: 'Quiz' },
      }),
    ],
    quizConfig: [aQuizConfig({ blockId: 101n, passThreshold: 100 })],
    quizQuestions: [aQuestion({ questionId: 200n, blockId: 101n })],
    quizOptions: [
      anOption({ optionId: 300n, questionId: 200n, textHtml: 'The server', position: 0 }),
      anOption({ optionId: 301n, questionId: 200n, textHtml: 'The client', position: 1 }),
    ],
    quizAttempts: [],
    quizAttemptResults: [],
  };
}

describe('ChapterScreen', () => {
  beforeEach(() => {
    sdk.ready = true;
    sdk.identity = READER;
    sdk.reducers = {
      completeBlock: vi.fn(() => Promise.resolve()),
      submitQuiz: vi.fn(() => Promise.resolve()),
    };
    sdk.rows = {
      chapters: [aChapter({ chapterId: 10n, title: 'Attractors' })],
      knowledgeBlocks: [aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' })],
      chapterDeps: [],
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
    expect(sdk.reducers.completeBlock).toHaveBeenCalledWith({ blockId: 100n });
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

  it('locks a block whose prerequisite is unread, inside an open chapter', () => {
    // The two gates composing: the chapter is open — its first block offers a
    // button — and only the second block is held back. A chapter-level lock
    // would have hidden both.
    sdk.rows = {
      ...sdk.rows,
      knowledgeBlocks: [
        aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' }),
        aBlock({ blockId: 101n, chapterId: 10n, title: 'Later', position: 1 }),
      ],
      blockDeps: [aBlockDep(101n, 100n)],
    };
    const { rerender } = render(<ChapterScreen chapterId={10n} />);

    expect(screen.getByText(/this block is locked/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /mark as complete/i })).toHaveLength(1);

    // Reading the prerequisite opens it, from the subscription alone.
    sdk.rows = {
      ...sdk.rows,
      readerProgress: [someProgress({ identity: READER, blockId: 100n })],
    };
    rerender(<ChapterScreen chapterId={10n} />);

    expect(screen.queryByText(/this block is locked/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /mark as complete/i })).toHaveLength(1);
  });

  it('locks a block whose prerequisite lives in another chapter', () => {
    // The edge the graph has to be built book-wide to see at all.
    sdk.rows = {
      chapters: [
        aChapter({ chapterId: 9n, title: 'Elsewhere' }),
        aChapter({ chapterId: 10n, title: 'Attractors' }),
      ],
      knowledgeBlocks: [
        aBlock({ blockId: 90n, chapterId: 9n }),
        aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' }),
      ],
      chapterDeps: [],
      blockDeps: [aBlockDep(100n, 90n)],
      readerProgress: [],
    };
    render(<ChapterScreen chapterId={10n} />);

    expect(screen.getByText(/this block is locked/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
  });

  it('locks a blocked chapter reached by direct URL, with no way to complete it', () => {
    sdk.rows = {
      chapters: [
        aChapter({ chapterId: 9n, title: 'Prerequisite' }),
        aChapter({ chapterId: 10n, title: 'Attractors' }),
      ],
      knowledgeBlocks: [
        aBlock({ blockId: 90n, chapterId: 9n }),
        aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' }),
      ],
      chapterDeps: [{ depId: 1n, chapterId: 10n, dependsOnChapterId: 9n }],
      readerProgress: [],
    };
    render(<ChapterScreen chapterId={10n} />);

    expect(screen.getByText(/locked/i)).toBeInTheDocument();
    expect(screen.queryByText('Intro')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
  });

  it('opens that same chapter once the prerequisite is finished', () => {
    sdk.rows = {
      chapters: [
        aChapter({ chapterId: 9n, title: 'Prerequisite' }),
        aChapter({ chapterId: 10n, title: 'Attractors' }),
      ],
      knowledgeBlocks: [
        aBlock({ blockId: 90n, chapterId: 9n }),
        aBlock({ blockId: 100n, chapterId: 10n, title: 'Intro' }),
      ],
      chapterDeps: [{ depId: 1n, chapterId: 10n, dependsOnChapterId: 9n }],
      readerProgress: [someProgress({ identity: READER, blockId: 90n })],
    };
    render(<ChapterScreen chapterId={10n} />);

    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.queryByText(/locked/i)).not.toBeInTheDocument();
  });

  it('submits a quiz through submit_quiz, never through complete_block', async () => {
    quizRows();
    render(<ChapterScreen chapterId={10n} />);
    await userEvent.click(screen.getByRole('radio', { name: 'The server' }));
    await userEvent.click(screen.getByRole('button', { name: /submit answers/i }));
    expect(sdk.reducers.submitQuiz).toHaveBeenCalledWith({
      blockId: 101n,
      answers: [{ questionId: 200n, selectedOptionIds: [300n] }],
    });
    expect(sdk.reducers.completeBlock).not.toHaveBeenCalled();
  });

  it('shows a failing score and an invitation to retry, arriving over the subscription', () => {
    quizRows();
    const { rerender } = render(<ChapterScreen chapterId={10n} />);
    expect(screen.getByRole('button', { name: /submit answers/i })).toBeInTheDocument();

    // The reducer graded and wrote the rows; the subscription delivers them.
    // Nothing in the component asked for the score.
    sdk.rows = {
      ...sdk.rows,
      quizAttempts: [anAttempt({ attemptId: 400n, identity: READER, blockId: 101n })],
      quizAttemptResults: [aResult({ attemptId: 400n, questionId: 200n })],
    };
    rerender(<ChapterScreen chapterId={10n} />);

    expect(screen.getByRole('status')).toHaveTextContent('0%');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Completed$/)).not.toBeInTheDocument();
  });

  it('completes the block when a passing attempt arrives, with no reload', () => {
    quizRows();
    const { rerender } = render(<ChapterScreen chapterId={10n} />);

    sdk.rows = {
      ...sdk.rows,
      quizAttempts: [
        anAttempt({
          attemptId: 400n,
          identity: READER,
          blockId: 101n,
          scorePercent: 100,
          passed: true,
        }),
      ],
      quizAttemptResults: [
        aResult({ attemptId: 400n, questionId: 200n, isCorrect: true }),
      ],
      // `submit_quiz` writes progress in the same transaction as the attempt.
      readerProgress: [someProgress({ identity: READER, blockId: 101n })],
    };
    rerender(<ChapterScreen chapterId={10n} />);

    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    // Still retakeable — unlimited retakes, and a pass is not undone by a later fail.
    expect(screen.getByRole('button', { name: /take it again/i })).toBeInTheDocument();
  });

  it('does not read another reader’s attempt as this reader’s score', () => {
    quizRows();
    sdk.rows = {
      ...sdk.rows,
      quizAttempts: [
        anAttempt({
          identity: OTHER_READER,
          blockId: 101n,
          scorePercent: 100,
          passed: true,
        }),
      ],
    };
    render(<ChapterScreen chapterId={10n} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says a refused submission was refused, not that a completion failed', async () => {
    quizRows();
    sdk.reducers.submitQuiz = vi.fn(() =>
      Promise.reject(new Error('This quiz has not been written yet.')),
    );
    render(<ChapterScreen chapterId={10n} />);
    await userEvent.click(screen.getByRole('button', { name: /submit answers/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not submit that');
    expect(alert).not.toHaveTextContent('mark that complete');
  });

  it('shows a rejected completion instead of swallowing it', async () => {
    sdk.reducers.completeBlock = vi.fn(() =>
      Promise.reject(new Error('Chapter is blocked')),
    );
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
    expect(getQueryAccessorName(tables.chapterDeps)).toBe('chapterDeps');
    expect(getQueryAccessorName(tables.quizConfig)).toBe('quizConfig');
    expect(getQueryAccessorName(tables.quizQuestions)).toBe('quizQuestions');
    expect(getQueryAccessorName(tables.quizOptions)).toBe('quizOptions');
    expect(getQueryAccessorName(tables.quizAttempts)).toBe('quizAttempts');
    expect(getQueryAccessorName(tables.quizAttemptResults)).toBe('quizAttemptResults');
  });

  it('keys reducers by the names the screen looks them up under', async () => {
    // The control for the reducer fake: if these names were wrong, every
    // `useReducer` above would resolve to `undefined` and the calls would throw
    // rather than quietly pass.
    const { reducers } = await import('../module_bindings');
    expect(reducers.completeBlock.accessorName).toBe('completeBlock');
    expect(reducers.submitQuiz.accessorName).toBe('submitQuiz');
  });
});
