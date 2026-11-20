/**
 * Carrying an anonymous identity over to a signed-in one (M15.2), against a live
 * database and real ID tokens.
 *
 * Signed-in callers here hold tokens from a mock OIDC issuer the test runs itself
 * (`support/mockIssuer.ts`), which `deploy.sh local` builds the module to trust. A
 * second, equally valid issuer on another port is trusted by nobody. That is the
 * attack decision 0002 watched succeed when the module skipped its issuer check: a
 * stranger with their own issuer takes someone's username.
 *
 * The happy path is the positive control for every refusal below. Each refusal is
 * set up so that exactly one condition is wrong. Most use an offer that really exists
 * and really names the caller, so the refusal can only come from the rule under test.
 *
 * No browser: this drives the real SDK from Node, as `auth-reject` does.
 */
import { test, expect } from '@playwright/test';
import { DbConnection } from '../src/module_bindings';
import { startIssuer, type MintOptions, type MockIssuer } from './support/mockIssuer';

const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

/** Must match `MOCK_ISSUER_CLIENT` in scripts/deploy.sh. */
const TRUSTED_PORT = 3200;
const CLIENT_ID = 'boc-e2e';
/** Valid tokens, signed and served properly, from an issuer the module does not trust. */
const UNTRUSTED_PORT = 3201;

const NOT_SIGNED_IN = 'Sign in before carrying anything over.';

interface Caller {
  readonly conn: DbConnection;
  readonly identity: NonNullable<DbConnection['identity']>;
}

let trusted: MockIssuer;
let untrusted: MockIssuer;
/** An anonymous connection subscribed to everything, to read the results. */
let observer: Caller;
const opened: DbConnection[] = [];
const run = Date.now().toString(36);
let counter = 0;

function connect(token?: string): Promise<Caller> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .withToken(token)
      .onConnect((conn, identity) => {
        opened.push(conn);
        resolve({ conn, identity });
      })
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(() => reject(new Error(`Timed out connecting to ${URI}/${DB_NAME}`)), 15_000);
  });
}

function uniqueSub(label: string): string {
  counter += 1;
  return `${label}-${run}-${counter}`;
}

/** A signed-in caller: a verified email at the trusted issuer, unless told otherwise. */
function signedIn(overrides: Partial<MintOptions> = {}, issuer: MockIssuer = trusted) {
  return connect(
    issuer.mint({ sub: uniqueSub('reader'), aud: CLIENT_ID, emailVerified: true, ...overrides }),
  );
}

/** A brand-new anonymous identity that has claimed a username. */
async function anonymousWithUsername(): Promise<Caller & { username: string }> {
  const caller = await connect();
  counter += 1;
  const username = `l${run}${counter}`;
  await caller.conn.reducers.claimUsername({ username });
  await waitFor(
    () => [...observer.conn.db.users.iter()].find((u) => u.username === username),
    `username ${username}`,
  );
  return { ...caller, username };
}

async function waitFor<T>(find: () => T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gave up waiting for ${what}`);
}

/** The server's refusal, or the empty string if the call was accepted. */
async function refusalFrom(call: Promise<void>): Promise<string> {
  try {
    await call;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const hex = (identity: Caller['identity']) => identity.toHexString();

/** Every identity-keyed row the observer can see for `identity`, by table. */
function rowsOf(identity: Caller['identity']) {
  const id = hex(identity);
  const db = observer.conn.db;
  return {
    users: [...db.users.iter()].filter((r) => hex(r.identity) === id),
    books: [...db.books.iter()].filter((r) => hex(r.owner) === id),
    progress: [...db.readerProgress.iter()].filter((r) => hex(r.identity) === id),
    attempts: [...db.quizAttempts.iter()].filter((r) => hex(r.identity) === id),
  };
}

test.beforeAll(async () => {
  trusted = await startIssuer(TRUSTED_PORT);
  untrusted = await startIssuer(UNTRUSTED_PORT);
  observer = await connect();
  await new Promise<void>((resolve) => {
    observer.conn.subscriptionBuilder().onApplied(() => resolve()).subscribeToAllTables();
  });
});

test.afterAll(async () => {
  for (const conn of opened) conn.disconnect();
  await trusted?.close();
  await untrusted?.close();
});

test('a signed-in identity takes every row the anonymous one held', async () => {
  const anon = await anonymousWithUsername();
  const a = anon.conn.reducers;

  // One row in each identity-keyed table: a book, progress, and a quiz attempt.
  const title = `Carried over ${run}`;
  await a.createBook({ title, description: 'Owned before signing in.' });
  const book = await waitFor(
    () => [...observer.conn.db.books.iter()].find((b) => b.title === title),
    'the book',
  );
  await a.createChapter({
    bookId: book.bookId,
    title: 'Only chapter',
    description: 'Somewhere to keep the blocks.',
    isOptional: false,
    isPinned: false,
  });
  const chapter = await waitFor(
    () => [...observer.conn.db.chapters.iter()].find((c) => c.bookId === book.bookId),
    'the chapter',
  );
  const blockIn = async (blockTitle: string, kind: 'Reading' | 'Quiz') => {
    await a.createBlock({
      chapterId: chapter.chapterId,
      title: blockTitle,
      blockType: { tag: kind },
      bodyHtml: '<p>Built by the identity-link harness.</p>',
      url: undefined,
      isOptional: false,
    });
    const block = await waitFor(
      () =>
        [...observer.conn.db.knowledgeBlocks.iter()].find(
          (b) => b.chapterId === chapter.chapterId && b.title === blockTitle,
        ),
      `block ${blockTitle}`,
    );
    return block.blockId;
  };
  const readingId = await blockIn('Reading', 'Reading');
  const quizId = await blockIn('Quiz', 'Quiz');
  await a.completeBlock({ blockId: readingId });
  await a.setQuiz({
    blockId: quizId,
    passThreshold: 100,
    questions: [
      {
        promptHtml: '<p>Which?</p>',
        options: [
          { textHtml: 'This', isCorrect: true },
          { textHtml: 'That', isCorrect: false },
        ],
      },
    ],
  });
  // An empty submission is a recorded, failing attempt: still a row to move.
  await a.submitQuiz({ blockId: quizId, answers: [] });

  const before = await waitFor(() => {
    const rows = rowsOf(anon.identity);
    return rows.progress.length > 0 && rows.attempts.length > 0 ? rows : undefined;
  }, 'the anonymous identity to hold a row in every table');
  expect(before.users).toHaveLength(1);
  expect(before.books).toHaveLength(1);

  const reader = await signedIn();
  await a.beginLink({ target: reader.identity });
  await reader.conn.reducers.completeLink({ from: anon.identity });

  const after = await waitFor(() => {
    const rows = rowsOf(reader.identity);
    return rows.users.length > 0 ? rows : undefined;
  }, 'the rows to arrive at the signed-in identity');
  expect(after.users.map((u) => u.username)).toEqual([anon.username]);
  expect(after.books.map((b) => b.bookId)).toEqual([book.bookId]);
  expect(after.progress.map((p) => p.blockId)).toEqual([readingId]);
  expect(after.attempts.map((q) => q.blockId)).toEqual([quizId]);

  const left = rowsOf(anon.identity);
  expect(left).toEqual({ users: [], books: [], progress: [], attempts: [] });

  // The offer is consumed: it cannot be taken a second time.
  const again = await refusalFrom(reader.conn.reducers.completeLink({ from: anon.identity }));
  expect(again).toContain('already has');
});

test('begin_link is refused for a signed-in caller', async () => {
  const target = await signedIn();
  const caller = await signedIn();
  await caller.conn.reducers.claimUsername({ username: `s${run}${++counter}` });
  const refusal = await refusalFrom(
    caller.conn.reducers.beginLink({ target: target.identity }),
  );
  expect(refusal).toContain('already signed in');
});

test('an anonymous author with books but no username carries them over', async () => {
  // The case every real reader is in: the reader has no screen that claims a
  // username, so what an anonymous author has is books and progress.
  const anon = await connect();
  const title = `No username ${run}`;
  await anon.conn.reducers.createBook({ title, description: 'Owned with no username.' });
  const book = await waitFor(
    () => [...observer.conn.db.books.iter()].find((b) => b.title === title),
    'the book',
  );
  expect(rowsOf(anon.identity).users).toEqual([]);

  const reader = await signedIn();
  await anon.conn.reducers.beginLink({ target: reader.identity });
  await reader.conn.reducers.completeLink({ from: anon.identity });

  await waitFor(() => rowsOf(reader.identity).books[0], 'the book to change owner');
  expect(rowsOf(reader.identity).books.map((b) => b.bookId)).toEqual([book.bookId]);
  expect(rowsOf(reader.identity).users).toEqual([]);
  expect(rowsOf(anon.identity).books).toEqual([]);
});

test('begin_link is refused for an identity with nothing to carry', async () => {
  const caller = await connect();
  const target = await signedIn();
  const refusal = await refusalFrom(
    caller.conn.reducers.beginLink({ target: target.identity }),
  );
  expect(refusal).toContain('nothing to carry over');
});

/**
 * Offer `anon`'s rows to `taker`, then have `taker` try to take them. The offer is
 * real and names the taker, so a refusal can only be about the taker itself.
 */
async function takeOffer(taker: Caller): Promise<{ refusal: string; anon: Caller }> {
  const anon = await anonymousWithUsername();
  await anon.conn.reducers.beginLink({ target: taker.identity });
  const refusal = await refusalFrom(taker.conn.reducers.completeLink({ from: anon.identity }));
  return { refusal, anon };
}

test('complete_link is refused for an anonymous caller', async () => {
  const { refusal, anon } = await takeOffer(await connect());
  expect(refusal).toContain(NOT_SIGNED_IN);
  expect(rowsOf(anon.identity).users).toHaveLength(1);
});

test('complete_link is refused for a valid token from an issuer nobody trusts', async () => {
  const { refusal, anon } = await takeOffer(await signedIn({}, untrusted));
  expect(refusal).toContain(NOT_SIGNED_IN);
  expect(rowsOf(anon.identity).users).toHaveLength(1);
});

test('complete_link is refused for the trusted issuer without a verified email', async () => {
  // The shape of SpacetimeAuth's own anonymous login: right issuer, right client, no email.
  const { refusal } = await takeOffer(await signedIn({ emailVerified: undefined }));
  expect(refusal).toContain(NOT_SIGNED_IN);
  const unverified = await takeOffer(await signedIn({ emailVerified: false }));
  expect(unverified.refusal).toContain(NOT_SIGNED_IN);
});

test('complete_link is refused for the trusted issuer with another client’s audience', async () => {
  const { refusal } = await takeOffer(await signedIn({ aud: 'someone-elses-app' }));
  expect(refusal).toContain(NOT_SIGNED_IN);
});

test('complete_link is refused for a signed-in caller the offer does not name', async () => {
  const named = await signedIn();
  const stranger = await signedIn();
  const anon = await anonymousWithUsername();
  await anon.conn.reducers.beginLink({ target: named.identity });

  const refusal = await refusalFrom(stranger.conn.reducers.completeLink({ from: anon.identity }));
  expect(refusal).toContain('no carry-over');

  // The control: the identity it does name can take it.
  await named.conn.reducers.completeLink({ from: anon.identity });
  await waitFor(() => rowsOf(named.identity).users[0], 'the named identity to take it');
});

test('complete_link is refused for a caller that already has rows of its own', async () => {
  const caller = await signedIn();
  // claim_username is still open to anyone until M15.3, so a signed-in reader can hold one.
  await caller.conn.reducers.claimUsername({ username: `h${run}${++counter}` });
  await waitFor(() => rowsOf(caller.identity).users[0], 'the caller’s own username');

  const { refusal, anon } = await takeOffer(caller);
  expect(refusal).toContain('already has');
  expect(rowsOf(anon.identity).users).toHaveLength(1);
});
