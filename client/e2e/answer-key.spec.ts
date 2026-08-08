/**
 * The answer key must not reach the browser.
 *
 * This is the load-bearing constraint of v0.2 (see
 * [v0.2-scope.md](../../docs/v0.2-scope.md#the-answer-key-must-not-reach-the-browser)):
 * a quiz whose answers ship to the reader is a "Mark as complete" button with extra
 * steps, and would leave the release exactly where v0.1 was. So it is *tested*
 * against a live database rather than argued from the table definition.
 *
 * Two independent things are asserted, because they can fail independently:
 *
 * 1. **The bindings expose no way to ask.** `spacetime generate` emits a table
 *    accessor for every table in the *client's* view of the schema. `quiz_options`
 *    gets one; `quiz_answer_key` does not. Not a stale-file check, either: the
 *    `webServer` these tests run against is `deploy.sh local`, which regenerates the
 *    bindings from the module it publishes, so `conn.db` reflects the schema that is
 *    actually running.
 *
 * 2. **The server refuses to be asked anyway.** Point 1 is about generated code, and
 *    generated code can be worked around by writing the SQL by hand. So a raw
 *    subscription naming the table is issued directly, and must be refused. The
 *    positive control is the same subscription against `quiz_options`, which must
 *    apply — without it, this test would pass just as happily if the database were
 *    down, the module unpublished, or the query malformed.
 *
 * Both were watched failing before being trusted, per M9's rule that a test which has
 * never been seen to fail is not evidence: adding `public` to the `quiz_answer_key`
 * table turns exactly these two red — the raw subscription comes back `applied` and
 * the accessor appears on `conn.db` — while both controls stay green.
 *
 * 3. **A populated key stays hidden.** Since M10.2 there is a `set_quiz` to write
 *    one with, so the file authors a real quiz through the real reducer and then
 *    looks for its answers from the client. The control that keeps this from being
 *    vacuous is `is_multi_answer`: it is computed by the server from the submitted
 *    key, so a question we sent with two correct options coming back `true` proves
 *    the key reached the database and was read — the rows are hidden, not missing.
 *
 * The lengths this goes to are proportional to what is being claimed. "The answers
 * are not in the browser" is the difference between v0.2 and v0.1 with extra steps,
 * and it is a claim that would fail silently: nothing else in the stack breaks if
 * the key ships.
 *
 * No browser: this drives the real SDK from Node, like `auth-reject.spec.ts`, and is
 * a Playwright test only to reuse the one `webServer` that brings the stack up.
 */
import { test, expect } from '@playwright/test';
import { DbConnection } from '../src/module_bindings';

const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

/** The private table. Named as the server names it, because that is what SQL takes. */
const ANSWER_KEY_TABLE = 'quiz_answer_key';
/** Its public sibling — same shape of query, same connection kind, opposite verdict. */
const PUBLIC_TABLE = 'quiz_options';

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

type Outcome =
  | { tag: 'applied' }
  | { tag: 'refused'; message: string }
  | { tag: 'timedOut' };

/**
 * Issue one raw SQL subscription and report what the server did with it.
 *
 * A fresh connection per query: a refused subscription is an error condition for the
 * connection that raised it, so sharing one would let the refusal under test
 * contaminate the control. `timedOut` is a distinct outcome rather than a thrown
 * error, so a hung server reads as "neither applied nor refused" instead of quietly
 * resembling one of them.
 */
async function subscriptionOutcome(sql: string): Promise<Outcome> {
  const conn = await connect();
  try {
    return await new Promise<Outcome>((resolve) => {
      conn
        .subscriptionBuilder()
        .onApplied(() => resolve({ tag: 'applied' }))
        .onError((ctx) => resolve({ tag: 'refused', message: ctx.event?.message ?? '' }))
        .subscribe(sql);
      setTimeout(() => resolve({ tag: 'timedOut' }), 15_000);
    });
  } finally {
    conn.disconnect();
  }
}

test('the generated bindings expose the public quiz tables', async () => {
  // The control for the assertion below: if `spacetime generate` had emitted no quiz
  // tables at all — a stale bindings directory, a failed regeneration — the absence
  // of the answer key would prove nothing.
  const conn = await connect();
  try {
    expect(Object.keys(conn.db)).toEqual(
      expect.arrayContaining(['quizConfig', 'quizQuestions', 'quizOptions']),
    );
  } finally {
    conn.disconnect();
  }
});

test('the generated bindings expose no answer-key table', async () => {
  const conn = await connect();
  try {
    expect(Object.keys(conn.db)).not.toContain('quizAnswerKey');
  } finally {
    conn.disconnect();
  }
});

test('a raw subscription to the public options table is applied', async () => {
  const outcome = await subscriptionOutcome(`SELECT * FROM ${PUBLIC_TABLE}`);
  expect(
    outcome,
    'the control must succeed, or a refusal below proves nothing about privacy',
  ).toEqual({ tag: 'applied' });
});

test('a raw subscription to the answer-key table is refused', async () => {
  const outcome = await subscriptionOutcome(`SELECT * FROM ${ANSWER_KEY_TABLE}`);
  // Asserted on the tag rather than on the message: the wording belongs to
  // SpacetimeDB and may change between versions, but "refused" is the contract.
  expect(outcome.tag, `server answered ${JSON.stringify(outcome)}`).toBe('refused');
});

// ---------------------------------------------------------------------------
// A real quiz, authored through the real reducer
// ---------------------------------------------------------------------------

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
 * The correct answers this test submits. Written here so the assertions can look
 * for them by text: if any of these strings can be distinguished from a wrong one
 * using only what the client holds, the key has leaked in some form.
 */
const SINGLE_ANSWER_PROMPT = 'Where does the answer key live?';
const MULTI_ANSWER_PROMPT = 'Which of these are correct?';

test('the answers to a real quiz cannot be found from the client', async () => {
  const conn = await connect();
  try {
    await conn.subscriptionBuilder().subscribeToAllTables();

    // A book of our own — `set_quiz` is owner-only, so this cannot be done to the
    // seeded one, and should not be: this test must not leave a quiz behind on the
    // book the smoke test reads.
    const title = `Answer key control ${Date.now()}`;
    await conn.reducers.createBook({
      title,
      description: 'Created by the answer-key harness.',
    });
    const book = await waitFor(
      () => [...conn.db.books.iter()].find((b) => b.title === title),
      'the control book',
    );

    await conn.reducers.createChapter({
      bookId: book.bookId,
      title: 'A chapter with a quiz in it',
      description: 'Owned by the harness.',
      isOptional: false,
      isPinned: false,
    });
    const chapter = await waitFor(
      () => [...conn.db.chapters.iter()].find((c) => c.bookId === book.bookId),
      'the control chapter',
    );

    await conn.reducers.createBlock({
      chapterId: chapter.chapterId,
      title: 'The quiz',
      blockType: { tag: 'Quiz' },
      bodyHtml: '<p>Answer these.</p>',
      url: undefined,
      isOptional: false,
    });
    const block = await waitFor(
      () => [...conn.db.knowledgeBlocks.iter()].find((b) => b.chapterId === chapter.chapterId),
      'the control quiz block',
    );

    await conn.reducers.setQuiz({
      blockId: block.blockId,
      passThreshold: 50,
      questions: [
        {
          promptHtml: SINGLE_ANSWER_PROMPT,
          options: [
            { textHtml: 'In a private table', isCorrect: true },
            { textHtml: 'In the page source', isCorrect: false },
            { textHtml: 'In localStorage', isCorrect: false },
          ],
        },
        {
          promptHtml: MULTI_ANSWER_PROMPT,
          options: [
            { textHtml: 'This one', isCorrect: true },
            { textHtml: 'And this one', isCorrect: true },
            { textHtml: 'But not this one', isCorrect: false },
          ],
        },
      ],
    });

    const questions = await waitFor(() => {
      const found = [...conn.db.quizQuestions.iter()].filter((q) => q.blockId === block.blockId);
      return found.length === 2 ? found : undefined;
    }, 'the two quiz questions');

    // The reader can read the quiz — otherwise there is nothing to take.
    const options = [...conn.db.quizOptions.iter()].filter((o) =>
      questions.some((q) => q.questionId === o.questionId),
    );
    expect(options).toHaveLength(6);
    expect(options.map((o) => o.textHtml)).toEqual(
      expect.arrayContaining(['In a private table', 'In the page source']),
    );

    // The non-vacuity control. `is_multi_answer` is derived server-side from the
    // key we just submitted, so these two values being right proves the key was
    // stored and read. Without this, every assertion below would pass just as
    // happily against a quiz whose answers were never saved at all.
    const single = questions.find((q) => q.promptHtml === SINGLE_ANSWER_PROMPT);
    const multi = questions.find((q) => q.promptHtml === MULTI_ANSWER_PROMPT);
    expect(single?.isMultiAnswer, 'the server did not read the submitted key').toBe(false);
    expect(multi?.isMultiAnswer, 'the server did not read the submitted key').toBe(true);

    // And now the claim itself: nothing the client holds distinguishes the correct
    // options from the wrong ones. Asserted as an exact field list rather than
    // "there is no isCorrect", so a key leaking under any other name — `correct`,
    // `weight`, `score` — fails this too.
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual(
        ['optionId', 'position', 'questionId', 'textHtml'].sort(),
      );
    }
    for (const question of questions) {
      expect(Object.keys(question).sort()).toEqual(
        ['blockId', 'isMultiAnswer', 'position', 'promptHtml', 'questionId'].sort(),
      );
    }

    // Still no way to ask, now that there is something worth asking for.
    expect(Object.keys(conn.db)).not.toContain('quizAnswerKey');
  } finally {
    conn.disconnect();
  }
});

test('the answer-key table stays refused once it has rows in it', async () => {
  // The test above leaves a populated key behind, so this re-runs the raw
  // subscription against a database that actually has answers to leak.
  const outcome = await subscriptionOutcome(`SELECT * FROM ${ANSWER_KEY_TABLE}`);
  expect(outcome.tag, `server answered ${JSON.stringify(outcome)}`).toBe('refused');
});
