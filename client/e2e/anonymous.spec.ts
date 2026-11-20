/**
 * What a caller who is not signed in can read and do, against a live database (M15.3).
 *
 * The book tables are private, and the `visible_*` views are the only way to read
 * them. A view returns a book's rows to an anonymous caller only when the book is
 * published and its owner turned on anonymous access. "Anonymous" here means two
 * shapes of caller: SpacetimeDB's own anonymous token, and a token from the trusted
 * issuer with no verified email, which is what SpacetimeAuth's anonymous login is.
 *
 * The positive controls carry the weight. A signed-in stranger reads every book the
 * anonymous caller is refused, and the anonymous caller reads the open one. So an
 * empty result can only mean the view filtered, not that the rows were never written.
 */
import { test, expect } from '@playwright/test';
import type { DbConnection } from '../src/module_bindings';
import { startIssuer, type MockIssuer } from './support/mockIssuer';
import {
  CLIENT_ID,
  connectAs,
  connectSignedIn,
  startTrustedIssuer,
  uniqueSub,
  type Caller,
} from './support/signIn';

let issuer: MockIssuer;
/** Valid tokens, properly signed and served, from an issuer the module does not trust. */
let untrusted: MockIssuer;
const UNTRUSTED_PORT = 3201;
let author: Caller;
const opened: Caller[] = [];

/** Book ids made by `author`, one per visibility case. */
let books: { open: bigint; closed: bigint; openDraft: bigint };

async function waitFor<T>(find: () => T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gave up waiting for ${what}`);
}

async function subscribed(caller: Promise<Caller>): Promise<Caller> {
  const c = await caller;
  opened.push(c);
  await new Promise<void>((resolve, reject) => {
    c.conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(ctx.event?.message ?? 'subscription refused')))
      .subscribeToAllTables();
  });
  return c;
}

const anonymousToken = () => subscribed(connectAs());
/** SpacetimeAuth's anonymous login: the trusted issuer and client, and no email claim. */
const anonymousLogin = () =>
  subscribed(connectAs(issuer.mint({ sub: uniqueSub('anon-login'), aud: CLIENT_ID })));

/** A book with one chapter and one block, so every view has a row to show or hide. */
async function makeBook(label: string, publish: boolean, anonymousAccess: boolean) {
  const r = author.conn.reducers;
  const db = author.conn.db;
  const title = `${label} ${uniqueSub('book')}`;
  await r.createBook({ title, description: 'Made by the anonymous-read harness.' });
  const book = await waitFor(() => [...db.visibleBooks.iter()].find((b) => b.title === title), title);
  await r.createChapter({
    bookId: book.bookId,
    title: `${label} chapter`,
    description: 'A chapter to hide or show.',
    isOptional: false,
    isPinned: false,
  });
  const chapter = await waitFor(
    () => [...db.visibleChapters.iter()].find((c) => c.bookId === book.bookId),
    `${label} chapter`,
  );
  await r.createBlock({
    chapterId: chapter.chapterId,
    title: `${label} block`,
    blockType: { tag: 'Reading' },
    bodyHtml: '<p>A block to hide or show.</p>',
    url: undefined,
    isOptional: false,
  });
  await waitFor(
    () => [...db.visibleBlocks.iter()].find((b) => b.chapterId === chapter.chapterId),
    `${label} block`,
  );
  if (publish) await r.publishBook({ bookId: book.bookId });
  if (anonymousAccess) await r.setAnonymousAccess({ bookId: book.bookId, enabled: true });
  await waitFor(
    () =>
      [...db.visibleBooks.iter()].find(
        (b) =>
          b.bookId === book.bookId &&
          b.anonymousAccess === anonymousAccess &&
          (b.status.tag === 'Published') === publish,
      ),
    `${label} settings`,
  );
  return book.bookId;
}

/** Every row a caller holds for `bookId`, across the book views. */
function rowsFor(caller: Caller, bookId: bigint) {
  const db = caller.conn.db;
  const chapterIds = [...db.visibleChapters.iter()]
    .filter((c) => c.bookId === bookId)
    .map((c) => c.chapterId);
  return {
    books: [...db.visibleBooks.iter()].filter((b) => b.bookId === bookId).length,
    chapters: chapterIds.length,
    blocks: [...db.visibleBlocks.iter()].filter((b) => chapterIds.includes(b.chapterId)).length,
  };
}

const ALL = { books: 1, chapters: 1, blocks: 1 };
const NONE = { books: 0, chapters: 0, blocks: 0 };

test.beforeAll(async () => {
  issuer = await startTrustedIssuer();
  untrusted = await startIssuer(UNTRUSTED_PORT);
  author = await subscribed(connectSignedIn(issuer, { sub: uniqueSub('author') }));
  books = {
    open: await makeBook('Open', true, true),
    closed: await makeBook('Closed', true, false),
    openDraft: await makeBook('Open draft', false, true),
  };
});

test.afterAll(async () => {
  for (const c of opened) c.conn.disconnect();
  await issuer?.close();
  await untrusted?.close();
});

test('a signed-in stranger reads every book, drafts included', async () => {
  const stranger = await subscribed(connectSignedIn(issuer));
  // The control for every refusal below: the rows exist and the views can return them.
  for (const bookId of [books.open, books.closed, books.openDraft]) {
    await waitFor(
      () => (rowsFor(stranger, bookId).blocks === 1 ? true : undefined),
      `book ${String(bookId)} for a signed-in reader`,
    );
    expect(rowsFor(stranger, bookId)).toEqual(ALL);
  }
});

for (const [shape, connect] of [
  ['an anonymous token', anonymousToken],
  ['SpacetimeAuth’s anonymous login', anonymousLogin],
] as const) {
  test(`${shape} reads a published book open to anonymous readers`, async () => {
    const anon = await connect();
    await waitFor(
      () => (rowsFor(anon, books.open).blocks === 1 ? true : undefined),
      'the open book',
    );
    expect(rowsFor(anon, books.open)).toEqual(ALL);
  });

  test(`${shape} reads nothing of a book without anonymous access, or of a draft`, async () => {
    const anon = await connect();
    // Wait on the open book first, so "nothing" is a settled answer, not an early one.
    await waitFor(() => (rowsFor(anon, books.open).blocks === 1 ? true : undefined), 'the open book');
    expect(rowsFor(anon, books.closed)).toEqual(NONE);
    expect(rowsFor(anon, books.openDraft)).toEqual(NONE);
  });
}

test('turning anonymous access off takes the book away from an open subscription', async () => {
  const anon = await anonymousToken();
  const bookId = await makeBook('Withdrawn', true, true);
  await waitFor(() => (rowsFor(anon, bookId).blocks === 1 ? true : undefined), 'the book, before');

  await author.conn.reducers.setAnonymousAccess({ bookId, enabled: false });
  await waitFor(() => (rowsFor(anon, bookId).books === 0 ? true : undefined), 'the book to go');
  expect(rowsFor(anon, bookId)).toEqual(NONE);
});

test('only the owner can change anonymous access', async () => {
  const stranger = await connectSignedIn(issuer);
  opened.push(stranger);
  let refusal = '';
  try {
    await stranger.conn.reducers.setAnonymousAccess({ bookId: books.closed, enabled: true });
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  expect(refusal).toContain('Only the owner of this book can change it.');
});

/** The outcome of one raw SQL subscription, on a fresh anonymous connection. */
async function rawSubscription(sql: string): Promise<'applied' | 'refused' | 'timedOut'> {
  const anon = await connectAs();
  opened.push(anon);
  return new Promise((resolve) => {
    anon.conn
      .subscriptionBuilder()
      .onApplied(() => resolve('applied'))
      .onError(() => resolve('refused'))
      .subscribe(sql);
    setTimeout(() => resolve('timedOut'), 15_000);
  });
}

test('the book tables themselves cannot be subscribed to, only the views', async () => {
  expect(await rawSubscription('SELECT * FROM visible_books'), 'the control').toBe('applied');
  for (const table of ['books', 'chapters', 'knowledge_blocks', 'quiz_options']) {
    expect(await rawSubscription(`SELECT * FROM ${table}`), table).toBe('refused');
  }
});

test('narrowing the view to a closed book still returns nothing', async () => {
  const anon = await connectAs();
  opened.push(anon);
  await new Promise<void>((resolve, reject) => {
    anon.conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(ctx.event?.message ?? 'refused')))
      .subscribe(`SELECT * FROM visible_books WHERE book_id = ${String(books.closed)}`);
  });
  expect([...anon.conn.db.visibleBooks.iter()]).toEqual([]);
});

// ---------------------------------------------------------------------------
// Quizzes: graded by `grade_quiz`, which returns the verdict and records nothing
// ---------------------------------------------------------------------------

const RIGHT = 'Right';

/** A one-question quiz in `bookId`'s chapter. Returns the block and its option ids. */
async function addQuiz(bookId: bigint) {
  const r = author.conn.reducers;
  const db = author.conn.db;
  const chapter = await waitFor(
    () => [...db.visibleChapters.iter()].find((c) => c.bookId === bookId),
    'the chapter',
  );
  const title = `Quiz ${uniqueSub('quiz')}`;
  await r.createBlock({
    chapterId: chapter.chapterId,
    title,
    blockType: { tag: 'Quiz' },
    bodyHtml: '<p>One question.</p>',
    url: undefined,
    isOptional: false,
  });
  const block = await waitFor(
    () => [...db.visibleBlocks.iter()].find((b) => b.title === title),
    'the quiz block',
  );
  await r.setQuiz({
    blockId: block.blockId,
    passThreshold: 100,
    questions: [
      {
        promptHtml: 'Which one?',
        options: [
          { textHtml: RIGHT, isCorrect: true },
          { textHtml: 'Wrong', isCorrect: false },
        ],
      },
    ],
  });
  const question = await waitFor(
    () => [...db.visibleQuizQuestions.iter()].find((q) => q.blockId === block.blockId),
    'the question',
  );
  const options = await waitFor(() => {
    const found = [...db.visibleQuizOptions.iter()].filter((o) => o.questionId === question.questionId);
    return found.length === 2 ? found : undefined;
  }, 'the options');
  const option = (text: string) => {
    const found = options.find((o) => o.textHtml === text);
    if (!found) throw new Error(`no option ${text}`);
    return found.optionId;
  };
  return {
    blockId: block.blockId,
    answer: (text: string) => [{ questionId: question.questionId, selectedOptionIds: [option(text)] }],
  };
}

/** The rows `identity` holds in the tables a graded attempt writes, as `observer` sees them. */
function writtenBy(observer: Caller, identity: Caller['identity']) {
  const id = identity.toHexString();
  const db = observer.conn.db;
  return {
    attempts: [...db.quizAttempts.iter()].filter((a) => a.identity.toHexString() === id).length,
    progress: [...db.readerProgress.iter()].filter((p) => p.identity.toHexString() === id).length,
  };
}

test('an anonymous reader is graded by grade_quiz, and the attempt leaves no row behind', async () => {
  const quiz = await addQuiz(books.open);
  const observer = await subscribed(connectSignedIn(issuer));

  // The control: a signed-in reader's passing submission does write, and the
  // observer sees it. So "no rows" below is a settled answer, not an unwatched table.
  const reader = await connectSignedIn(issuer);
  opened.push(reader);
  await reader.conn.reducers.submitQuiz({ blockId: quiz.blockId, answers: quiz.answer(RIGHT) });
  await waitFor(
    () => (writtenBy(observer, reader.identity).progress === 1 ? true : undefined),
    'the signed-in reader’s rows',
  );
  expect(writtenBy(observer, reader.identity)).toEqual({ attempts: 1, progress: 1 });

  for (const anon of [await anonymousToken(), await anonymousLogin()]) {
    const failed = await anon.conn.procedures.gradeQuiz({
      blockId: quiz.blockId,
      answers: quiz.answer('Wrong'),
    });
    // The wire shape of a Rust `Result` (see `readGradeResult` in src/reader/localProgress.ts).
    expect(failed).toMatchObject({ ok: { scorePercent: 0, passed: false } });
    const passed = await anon.conn.procedures.gradeQuiz({
      blockId: quiz.blockId,
      answers: quiz.answer(RIGHT),
    });
    expect(passed).toMatchObject({ ok: { scorePercent: 100, passed: true } });

    // A write made by the procedure would reach the observer as fast as the control's
    // did, so a short wait after the call settles it.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(writtenBy(observer, anon.identity)).toEqual({ attempts: 0, progress: 0 });
  }
});

test('grade_quiz refuses a quiz in a book closed to anonymous readers', async () => {
  const quiz = await addQuiz(books.closed);
  const anon = await connectAs();
  opened.push(anon);
  const verdict = await anon.conn.procedures.gradeQuiz({
    blockId: quiz.blockId,
    answers: quiz.answer(RIGHT),
  });
  expect(verdict).toEqual({ err: 'That block no longer exists.' });

  // The control: the same call by a signed-in reader is graded.
  const reader = await connectSignedIn(issuer);
  opened.push(reader);
  expect(
    await reader.conn.procedures.gradeQuiz({ blockId: quiz.blockId, answers: quiz.answer(RIGHT) }),
  ).toMatchObject({ ok: { passed: true } });
});

// ---------------------------------------------------------------------------
// Writing: every writing reducer refuses a caller who is not signed in
// ---------------------------------------------------------------------------

/** The exact text of `rules::NOT_SIGNED_IN`, the same for every reducer by design. */
const NOT_SIGNED_IN = 'Sign in to make changes.';

/**
 * Every writing reducer, called with arguments that name real rows of the author's
 * open book. Without the sign-in check each call would succeed or meet a different
 * refusal (ownership, validation), so only that check can produce `NOT_SIGNED_IN`.
 * A reducer added to the module and missing here is caught by the count below.
 */
function writingCalls(ids: { bookId: bigint; chapterId: bigint; blockId: bigint }) {
  const { bookId, chapterId, blockId } = ids;
  const calls: Record<string, (r: DbConnection['reducers']) => Promise<void>> = {
    claim_username: (r) => r.claimUsername({ username: `a${uniqueSub('u').replace(/-/g, '')}` }),
    create_book: (r) => r.createBook({ title: 'Anonymous book', description: '' }),
    update_book: (r) => r.updateBook({ bookId, title: 'Renamed', description: '' }),
    publish_book: (r) => r.publishBook({ bookId }),
    set_anonymous_access: (r) => r.setAnonymousAccess({ bookId, enabled: false }),
    create_chapter: (r) =>
      r.createChapter({ bookId, title: 'More', description: '', isOptional: false, isPinned: false }),
    update_chapter: (r) =>
      r.updateChapter({ chapterId, title: 'Renamed', description: '', isOptional: false, isPinned: false }),
    reorder_chapters: (r) => r.reorderChapters({ bookId, orderedChapterIds: [chapterId] }),
    set_chapter_deps: (r) => r.setChapterDeps({ chapterId, dependsOnChapterIds: [] }),
    create_block: (r) =>
      r.createBlock({
        chapterId,
        title: 'More',
        blockType: { tag: 'Reading' },
        bodyHtml: '<p>x</p>',
        url: undefined,
        isOptional: false,
      }),
    update_block: (r) =>
      r.updateBlock({
        blockId,
        title: 'Renamed',
        blockType: { tag: 'Reading' },
        bodyHtml: '<p>x</p>',
        url: undefined,
        isOptional: false,
      }),
    delete_block: (r) => r.deleteBlock({ blockId }),
    set_block_deps: (r) => r.setBlockDeps({ blockId, dependsOnBlockIds: [] }),
    set_quiz: (r) =>
      r.setQuiz({
        blockId,
        passThreshold: 50,
        questions: [{ promptHtml: 'Q', options: [{ textHtml: 'A', isCorrect: true }] }],
      }),
    complete_block: (r) => r.completeBlock({ blockId }),
    submit_quiz: (r) => r.submitQuiz({ blockId, answers: [] }),
  };
  return calls;
}

async function refusalFrom(call: Promise<void>): Promise<string> {
  try {
    await call;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Ids in the open book, read from the author's subscription. */
function openBookIds() {
  const db = author.conn.db;
  const chapter = [...db.visibleChapters.iter()].find((c) => c.bookId === books.open);
  const block = chapter && [...db.visibleBlocks.iter()].find((b) => b.chapterId === chapter.chapterId);
  if (!chapter || !block) throw new Error('the open book has no chapter or block');
  return { bookId: books.open, chapterId: chapter.chapterId, blockId: block.blockId };
}

test('the list of writing reducers is every reducer the module has', async () => {
  // Reducers a client can call, from the generated bindings of the running module.
  const caller = await connectAs();
  opened.push(caller);
  const inBindings = Object.keys(caller.conn.reducers).sort();
  const camel = (name: string) => name.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
  expect(Object.keys(writingCalls(openBookIds())).map(camel).sort()).toEqual(inBindings);
});

const notSignedIn: [string, () => Promise<Caller>][] = [
  ['an anonymous token', () => connectAs()],
  // Also the shape of a worker's token (decision 0005): no verified email.
  ['SpacetimeAuth’s anonymous login', () => connectAs(issuer.mint({ sub: uniqueSub('anon-login'), aud: CLIENT_ID }))],
  [
    'a verified email from an issuer nobody trusts',
    () => connectAs(untrusted.mint({ sub: uniqueSub('stranger'), aud: CLIENT_ID, emailVerified: true })),
  ],
  [
    'a verified email for another client’s audience',
    () => connectAs(issuer.mint({ sub: uniqueSub('other-aud'), aud: 'some-other-client', emailVerified: true })),
  ],
];

for (const [shape, connect] of notSignedIn) {
  test(`${shape} is refused by every writing reducer`, async () => {
    const caller = await connect();
    opened.push(caller);
    const before = rowsFor(author, books.open);
    const refusals: Record<string, string> = {};
    for (const [name, call] of Object.entries(writingCalls(openBookIds()))) {
      refusals[name] = await refusalFrom(call(caller.conn.reducers));
    }
    const expected = Object.fromEntries(Object.keys(refusals).map((name) => [name, NOT_SIGNED_IN]));
    expect(refusals).toEqual(expected);

    // And nothing changed: no chapter or block was added or deleted.
    expect(rowsFor(author, books.open)).toEqual(before);
  });
}

test('the same calls by the signed-in owner get past the sign-in check', async () => {
  // The control. Every call above was refused before anything else was asked; here
  // none of them is refused for not being signed in. (Some are refused for other
  // reasons, such as submitting a reading block as a quiz.)
  const bookId = await makeBook('Control', true, true);
  const db = author.conn.db;
  const chapter = [...db.visibleChapters.iter()].find((c) => c.bookId === bookId);
  const block = chapter && [...db.visibleBlocks.iter()].find((b) => b.chapterId === chapter.chapterId);
  if (!chapter || !block) throw new Error('the control book has no chapter or block');
  for (const [name, call] of Object.entries(
    writingCalls({ bookId, chapterId: chapter.chapterId, blockId: block.blockId }),
  )) {
    expect(await refusalFrom(call(author.conn.reducers)), name).not.toBe(NOT_SIGNED_IN);
  }
});
