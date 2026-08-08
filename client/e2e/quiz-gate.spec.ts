/**
 * A quiz can only be completed by passing it, and only from a chapter the reader
 * has reached — asserted against a live database, by a real client.
 *
 * The Rust rules are unit-tested, but a unit test cannot notice a check being
 * deleted from a *reducer*: `rules::can_complete_block` would keep passing its own
 * tests while `complete_block` stopped calling it, and the door this release
 * exists to shut would be standing open. That is the same argument
 * `auth-reject.spec.ts` makes about `require_owner`, applied to the reader side.
 *
 * Four doors, each of which would individually reduce v0.2 to v0.1:
 *
 * 1. **"Mark as complete" on a quiz.** `complete_block` predates `BlockType::Quiz`
 *    and takes any block id. If it completes a quiz, nobody needs to answer one.
 * 2. **A failing attempt completing the block anyway.** The score is computed
 *    server-side; this checks the server acts on it.
 * 3. **A quiz nobody has written yet.** A `Quiz` block with no questions must not
 *    grade as an empty pass — `create_block` produces exactly that state.
 * 4. **A quiz inside a Blocked chapter.** Otherwise the graph is walkable one
 *    submission at a time, which is what `can_complete_block` was written to stop.
 *
 * Every refusal here has a positive control with equally valid arguments, because
 * a call that fails for an unrelated reason — a bad id, a renamed field — looks
 * exactly like a gate working while testing nothing at all.
 *
 * No browser: this drives the real SDK from Node, like `auth-reject.spec.ts`, and
 * is a Playwright test only to reuse the one `webServer` that brings the stack up.
 */
import { test, expect } from '@playwright/test';
import { DbConnection } from '../src/module_bindings';

const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

/** Two questions, so a half-right submission is a distinguishable score. */
const FIRST_PROMPT = 'What decides whether a quiz was passed?';
const SECOND_PROMPT = 'Which of these are true?';
const RIGHT = 'Right';
const WRONG = 'Wrong';
/** Pass only on both questions, so 50% is unambiguously a failure. */
const THRESHOLD = 100;

let conn: DbConnection;

/** Ids of the fixture built in `beforeAll`. */
let open: { chapterId: bigint; quizBlockId: bigint; readingBlockId: bigint; blankQuizId: bigint };
let locked: { quizBlockId: bigint };

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .onConnect((c) => resolve(c))
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(() => reject(new Error(`Timed out connecting to ${URI}/${DB_NAME}`)), 15_000);
  });
}

/** Reducer calls resolve before the caller's tables catch up; wait for the row. */
async function waitFor<T>(find: () => T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gave up waiting for ${what}`);
}

/**
 * The server's rejection message, or the empty string if the call was *accepted* —
 * which then fails every `toContain` below, so a gate that quietly opens reads as a
 * failure rather than a pass.
 */
async function refusalFrom(call: Promise<void>): Promise<string> {
  try {
    await call;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function isComplete(blockId: bigint): boolean {
  return [...conn.db.readerProgress.iter()].some(
    (p) => p.blockId === blockId && p.identity.toHexString() === conn.identity?.toHexString(),
  );
}

function attemptsOn(blockId: bigint) {
  return [...conn.db.quizAttempts.iter()].filter((a) => a.blockId === blockId);
}

function resultsFor(attemptId: bigint) {
  return [...conn.db.quizAttemptResults.iter()].filter((r) => r.attemptId === attemptId);
}

/** The block's questions in author order — the order the reader sees them in. */
function questionsOn(blockId: bigint) {
  return [...conn.db.quizQuestions.iter()]
    .filter((q) => q.blockId === blockId)
    .sort((a, b) => a.position - b.position);
}

async function createBlock(chapterId: bigint, title: string, kind: 'Reading' | 'Quiz') {
  await conn.reducers.createBlock({
    chapterId,
    title,
    blockType: { tag: kind },
    bodyHtml: '<p>Built by the quiz-gate harness.</p>',
    url: undefined,
    isOptional: false,
  });
  const block = await waitFor(
    () => [...conn.db.knowledgeBlocks.iter()].find((b) => b.chapterId === chapterId && b.title === title),
    `block "${title}"`,
  );
  return block.blockId;
}

async function createChapter(bookId: bigint, title: string): Promise<bigint> {
  await conn.reducers.createChapter({
    bookId,
    title,
    description: 'A chapter owned by the quiz-gate harness.',
    isOptional: false,
    isPinned: false,
  });
  const chapter = await waitFor(
    () => [...conn.db.chapters.iter()].find((c) => c.bookId === bookId && c.title === title),
    `chapter "${title}"`,
  );
  return chapter.chapterId;
}

/** The quiz both configured blocks get: two questions, one single- and one multi-answer. */
async function writeQuizInto(blockId: bigint): Promise<void> {
  await conn.reducers.setQuiz({
    blockId,
    passThreshold: THRESHOLD,
    questions: [
      {
        promptHtml: FIRST_PROMPT,
        options: [
          { textHtml: RIGHT, isCorrect: true },
          { textHtml: WRONG, isCorrect: false },
        ],
      },
      {
        promptHtml: SECOND_PROMPT,
        options: [
          { textHtml: `${RIGHT} one`, isCorrect: true },
          { textHtml: `${RIGHT} two`, isCorrect: true },
          { textHtml: WRONG, isCorrect: false },
        ],
      },
    ],
  });
  await waitFor(() => {
    const questions = [...conn.db.quizQuestions.iter()].filter((q) => q.blockId === blockId);
    return questions.length === 2 ? questions : undefined;
  }, `the quiz on block ${blockId}`);
}

/**
 * The reader's view of one quiz: options are identified by *text*, because the
 * client has no other way to tell them apart — which is the point of the release.
 * The harness knows which text is right; a real reader would not.
 */
function answersFor(blockId: bigint, correctness: 'all' | 'none' | 'half') {
  const questions = [...conn.db.quizQuestions.iter()]
    .filter((q) => q.blockId === blockId)
    .sort((a, b) => a.position - b.position);

  return questions.map((question, index) => {
    const options = [...conn.db.quizOptions.iter()].filter((o) => o.questionId === question.questionId);
    // 'half' answers the first question correctly and the second wrongly: one of
    // two questions right is 50%, below the 100% threshold.
    const wantRight = correctness === 'all' || (correctness === 'half' && index === 0);
    const wanted = options.filter((o) => o.textHtml.startsWith(RIGHT) === wantRight);
    return {
      questionId: question.questionId,
      // A wrong answer to a multi-answer question is its single wrong option;
      // a right one is both of its correct options.
      selectedOptionIds: wanted.map((o) => o.optionId),
    };
  });
}

test.beforeAll(async () => {
  conn = await connect();
  await conn.subscriptionBuilder().subscribeToAllTables();

  const title = `Quiz gate control ${Date.now()}`;
  await conn.reducers.createBook({
    title,
    description: 'Created by the quiz-gate harness.',
  });
  const book = await waitFor(
    () => [...conn.db.books.iter()].find((b) => b.title === title),
    'the control book',
  );

  // Three chapters. "Gate" is never completed, which is what keeps "Locked"
  // Blocked for the whole run — a state the reader cannot leave by any call this
  // file makes.
  const openChapter = await createChapter(book.bookId, 'Open');
  const gateChapter = await createChapter(book.bookId, 'Gate');
  const lockedChapter = await createChapter(book.bookId, 'Locked');

  await createBlock(gateChapter, 'The block that is never read', 'Reading');
  await conn.reducers.setChapterDeps({
    chapterId: lockedChapter,
    dependsOnChapterIds: [gateChapter],
  });

  open = {
    chapterId: openChapter,
    quizBlockId: await createBlock(openChapter, 'The quiz', 'Quiz'),
    readingBlockId: await createBlock(openChapter, 'Something to read', 'Reading'),
    blankQuizId: await createBlock(openChapter, 'A quiz nobody has written', 'Quiz'),
  };
  locked = { quizBlockId: await createBlock(lockedChapter, 'A quiz behind a wall', 'Quiz') };

  await writeQuizInto(open.quizBlockId);
  await writeQuizInto(locked.quizBlockId);
});

test.afterAll(() => {
  conn?.disconnect();
});

test('complete_block still completes an ordinary reading block', async () => {
  // The control for every refusal below: this chapter is reachable and this
  // identity can complete blocks in it, so nothing that follows can be passing
  // because the reader was blocked all along.
  await conn.reducers.completeBlock({ blockId: open.readingBlockId });
  await waitFor(() => (isComplete(open.readingBlockId) ? true : undefined), 'the reading block to complete');
});

test('complete_block is refused for a quiz block', async () => {
  const refusal = await refusalFrom(conn.reducers.completeBlock({ blockId: open.quizBlockId }));
  expect(refusal).toContain('quiz');
  expect(isComplete(open.quizBlockId), 'the refusal must not have written progress anyway').toBe(false);
});

test('a failing submission records the attempt and leaves the block incomplete', async () => {
  await conn.reducers.submitQuiz({
    blockId: open.quizBlockId,
    answers: answersFor(open.quizBlockId, 'none'),
  });
  const attempt = await waitFor(
    () => attemptsOn(open.quizBlockId).find((a) => a.scorePercent === 0),
    'the failing attempt',
  );
  expect(attempt.passed).toBe(false);
  expect(isComplete(open.quizBlockId)).toBe(false);
});

test('a half-right submission is scored as half and still fails', async () => {
  // Grading is per question and all-or-nothing within one: this must be 50, not
  // some partial-credit number, and 50 must not clear a threshold of 100.
  await conn.reducers.submitQuiz({
    blockId: open.quizBlockId,
    answers: answersFor(open.quizBlockId, 'half'),
  });
  const attempt = await waitFor(
    () => attemptsOn(open.quizBlockId).find((a) => a.scorePercent === 50),
    'the half-right attempt',
  );
  expect(attempt.passed).toBe(false);
  expect(isComplete(open.quizBlockId)).toBe(false);

  // The reader is shown *which* questions were wrong, and a score of 50 cannot
  // say that: one right and one wrong is the same number whichever way round it
  // is. So the per-question breakdown is checked by name, not by counting.
  const results = await waitFor(
    () => {
      const rows = resultsFor(attempt.attemptId);
      return rows.length === 2 ? rows : undefined;
    },
    'the per-question results',
  );
  const questions = questionsOn(open.quizBlockId);
  const verdictOn = (index: number) => {
    const question = questions[index];
    if (!question) throw new Error(`the fixture quiz lost question ${index}`);
    const row = results.find((r) => r.questionId === question.questionId);
    if (!row) throw new Error(`no result row for question ${index}`);
    return row.isCorrect;
  };
  // `answersFor(..., 'half')` answers the first question right and the second wrong.
  expect(verdictOn(0)).toBe(true);
  expect(verdictOn(1)).toBe(false);
});

test('a passing submission completes the block', async () => {
  await conn.reducers.submitQuiz({
    blockId: open.quizBlockId,
    answers: answersFor(open.quizBlockId, 'all'),
  });
  const attempt = await waitFor(
    () => attemptsOn(open.quizBlockId).find((a) => a.passed),
    'the passing attempt',
  );
  expect(attempt.scorePercent).toBe(100);
  await waitFor(() => (isComplete(open.quizBlockId) ? true : undefined), 'the quiz block to complete');
});

test('failing again after a pass does not take the completion away', async () => {
  // Unlimited retakes, and a chapter already earned is not lost by pressing a
  // button. The deferred retake policy's only v0.2 position.
  await conn.reducers.submitQuiz({
    blockId: open.quizBlockId,
    answers: answersFor(open.quizBlockId, 'none'),
  });
  await waitFor(
    () => (attemptsOn(open.quizBlockId).filter((a) => a.scorePercent === 0).length === 2 ? true : undefined),
    'the second failing attempt',
  );
  expect(isComplete(open.quizBlockId)).toBe(true);
});

test('a submission naming an option from another question is refused', async () => {
  const answers = answersFor(open.quizBlockId, 'all');
  const first = answers[0];
  const second = answers[1];
  if (!first || !second) throw new Error('the fixture quiz lost its questions');
  const strayOption = second.selectedOptionIds[0];
  if (strayOption === undefined) throw new Error('the fixture quiz lost its options');

  const refusal = await refusalFrom(
    conn.reducers.submitQuiz({
      blockId: open.quizBlockId,
      answers: [{ questionId: first.questionId, selectedOptionIds: [strayOption] }],
    }),
  );
  // Refused, not scored: grading something that is not this quiz would be
  // pretending to have graded it.
  expect(refusal).toContain('does not have');
});

test('submit_quiz is refused for a block that is not a quiz', async () => {
  // The mirror of `complete_block` refusing a quiz. Neither reducer may be used
  // on the other's block type, or "which door completes this block" stops being
  // a property of the block.
  const refusal = await refusalFrom(
    conn.reducers.submitQuiz({ blockId: open.readingBlockId, answers: [] }),
  );
  expect(refusal).toContain('not a quiz');
});

test('a quiz block with no quiz configured cannot be submitted or completed', async () => {
  const submitRefusal = await refusalFrom(
    conn.reducers.submitQuiz({ blockId: open.blankQuizId, answers: [] }),
  );
  expect(submitRefusal).toContain('not been written yet');

  // And the other door stays shut too, so an unwritten quiz is not a way back to
  // "Mark as complete".
  const completeRefusal = await refusalFrom(conn.reducers.completeBlock({ blockId: open.blankQuizId }));
  expect(completeRefusal).toContain('quiz');
  expect(isComplete(open.blankQuizId)).toBe(false);
});

test('a quiz in a Blocked chapter cannot be submitted, right answers or not', async () => {
  // The submission is fully correct. The only thing standing between it and a
  // completion is the chapter gate.
  const refusal = await refusalFrom(
    conn.reducers.submitQuiz({
      blockId: locked.quizBlockId,
      answers: answersFor(locked.quizBlockId, 'all'),
    }),
  );
  expect(refusal).toContain('prerequisites');
  expect(attemptsOn(locked.quizBlockId), 'a refused submission must not be recorded').toHaveLength(0);
  expect(isComplete(locked.quizBlockId)).toBe(false);
});
