/**
 * Every owner-gated reducer, refused for a non-owner, against a live database.
 *
 * `rules::require_owner` is unit-tested in Rust, but a unit test cannot notice the
 * call being *deleted* from a reducer — the rule keeps passing its own tests while
 * the door stands open. That is measured, not assumed: deleting the check from
 * `publish_book` leaves the whole Rust suite green (87 tests when this was measured;
 * it has grown since), and turns exactly one test here red.
 *
 * The shape that makes it real: each reducer is called twice with equally valid
 * arguments — once on a book this identity owns, once on the seeded demo book it
 * does not. The positive control is the load-bearing half. Without it a test can
 * pass because the call failed for some unrelated reason (a bad id, a validation
 * rule, a renamed field), which would look exactly like authorization working while
 * testing nothing at all. So the refusal is matched against the exact message
 * `require_owner` produces, and the same arguments must succeed when we own the row.
 *
 * No browser here — this drives the real SDK from Node. It is a Playwright test only
 * to reuse the one `webServer` that already brings the stack up.
 */
import { test, expect } from '@playwright/test';
import { DbConnection } from '../src/module_bindings';

const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

/** The single message `rules::require_owner` returns, by design — it must not vary by call site. */
const REFUSAL = 'Only the owner of this book can change it.';

const SEEDED_BOOK = 'Chaos, Briefly';

let conn: DbConnection;

/**
 * Named ids rather than arrays: `strict` plus `noUncheckedIndexedAccess` makes
 * `chapterIds[0]` a `bigint | undefined`, and CLAUDE.md forbids asserting that away
 * with `!`. Anything needing the *full* chapter set reads it live via `chapterIdsOf`.
 */
/** Ids in the seeded book, which this identity does not own. */
let foreign: { bookId: bigint; chapterId: bigint; blockId: bigint };
/** Ids in a book created by this identity, used as the positive control. */
let own: {
  bookId: bigint;
  chapterId: bigint;
  laterChapterId: bigint;
  blockId: bigint;
  /** In `laterChapterId`, so `set_block_deps` can be seen drawing a cross-chapter edge. */
  laterBlockId: bigint;
  quizBlockId: bigint;
};

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
 * Returns the server's rejection message, or the empty string if the call was
 * *accepted*. Empty then fails the `toContain` assertion, so a reducer that quietly
 * starts allowing non-owners reads as a failure rather than a pass.
 */
async function refusalFrom(call: Promise<void>): Promise<string> {
  try {
    await call;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Every chapter currently in a book, read from the subscription rather than remembered. */
function chapterIdsOf(bookId: bigint): bigint[] {
  return [...conn.db.chapters.iter()]
    .filter((c) => c.bookId === bookId)
    .map((c) => c.chapterId);
}

async function createBlockIn(
  chapterId: bigint,
  title: string,
  kind: 'Reading' | 'Quiz' = 'Reading',
): Promise<bigint> {
  await conn.reducers.createBlock({
    chapterId,
    title,
    blockType: { tag: kind },
    bodyHtml: '<p>A block that exists so it can be written to.</p>',
    url: undefined,
    isOptional: false,
  });
  const block = await waitFor(
    () => [...conn.db.knowledgeBlocks.iter()].find((b) => b.chapterId === chapterId && b.title === title),
    `block "${title}"`,
  );
  return block.blockId;
}

test.beforeAll(async () => {
  // A fresh connection with no stored token is a brand-new anonymous identity, which
  // is precisely the non-owner this file is about.
  conn = await connect();
  await conn.subscriptionBuilder().subscribeToAllTables();

  const seeded = await waitFor(
    () => [...conn.db.books.iter()].find((b) => b.title === SEEDED_BOOK),
    `the seeded book "${SEEDED_BOOK}"`,
  );

  // If this ever fails, every refusal below would be testing nothing.
  expect(
    seeded.owner.toHexString(),
    'the harness must not own the seeded book, or the negative cases are vacuous',
  ).not.toBe(conn.identity?.toHexString());

  const foreignChapters = [...conn.db.chapters.iter()].filter((c) => c.bookId === seeded.bookId);
  const foreignChapter = foreignChapters[0];
  if (!foreignChapter) throw new Error('the seeded book has no chapters to attack');
  const foreignBlock = [...conn.db.knowledgeBlocks.iter()].find((b) =>
    foreignChapters.some((c) => c.chapterId === b.chapterId),
  );
  if (!foreignBlock) throw new Error('the seeded book has no blocks to attack');

  foreign = {
    bookId: seeded.bookId,
    chapterId: foreignChapter.chapterId,
    blockId: foreignBlock.blockId,
  };

  // The positive control: a book this identity does own. `create_book` is open to
  // everyone by design — it is the one author reducer with no owner to check.
  const ownTitle = `Authorization control ${Date.now()}`;
  await conn.reducers.createBook({
    title: ownTitle,
    description: 'Created by the auth-reject harness to prove these calls work when owned.',
  });
  const ownBook = await waitFor(
    () => [...conn.db.books.iter()].find((b) => b.title === ownTitle),
    'the control book',
  );

  const createOwnChapter = async (title: string): Promise<bigint> => {
    await conn.reducers.createChapter({
      bookId: ownBook.bookId,
      title,
      description: 'A chapter owned by the harness.',
      isOptional: false,
      isPinned: false,
    });
    const chapter = await waitFor(
      () =>
        [...conn.db.chapters.iter()].find((c) => c.bookId === ownBook.bookId && c.title === title),
      `control chapter "${title}"`,
    );
    return chapter.chapterId;
  };

  // Two chapters: `set_chapter_deps` needs somewhere to point that is not itself.
  const chapterId = await createOwnChapter('Control one');
  const laterChapterId = await createOwnChapter('Control two');

  own = {
    bookId: ownBook.bookId,
    chapterId,
    laterChapterId,
    blockId: await createBlockIn(chapterId, 'Control block'),
    laterBlockId: await createBlockIn(laterChapterId, 'Control block in another chapter'),
    // `set_quiz` refuses a block that is not a Quiz, so its positive control
    // needs one of the right type — otherwise the "allowed" half would fail on
    // the block type and prove nothing about ownership.
    quizBlockId: await createBlockIn(chapterId, 'Control quiz block', 'Quiz'),
  };
});

test.afterAll(() => {
  conn?.disconnect();
});

test('update_book is refused for a non-owner', async () => {
  await conn.reducers.updateBook({
    bookId: own.bookId,
    title: 'Renamed by its owner',
    description: 'Which is allowed.',
  });

  const refusal = await refusalFrom(
    conn.reducers.updateBook({
      bookId: foreign.bookId,
      title: 'Renamed by a stranger',
      description: 'Which is not allowed.',
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('publish_book is refused for a non-owner', async () => {
  await conn.reducers.publishBook({ bookId: own.bookId });

  const refusal = await refusalFrom(conn.reducers.publishBook({ bookId: foreign.bookId }));
  expect(refusal).toContain(REFUSAL);
});

test('create_chapter is refused for a non-owner', async () => {
  await conn.reducers.createChapter({
    bookId: own.bookId,
    title: 'A chapter in my own book',
    description: 'Allowed.',
    isOptional: false,
    isPinned: false,
  });

  const refusal = await refusalFrom(
    conn.reducers.createChapter({
      bookId: foreign.bookId,
      title: 'A chapter in someone else’s book',
      description: 'Not allowed.',
      isOptional: false,
      isPinned: false,
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('update_chapter is refused for a non-owner', async () => {
  await conn.reducers.updateChapter({
    chapterId: own.chapterId,
    title: 'Retitled by its owner',
    description: 'Allowed.',
    isOptional: false,
    isPinned: false,
  });

  const refusal = await refusalFrom(
    conn.reducers.updateChapter({
      chapterId: foreign.chapterId,
      title: 'Retitled by a stranger',
      description: 'Not allowed.',
      isOptional: false,
      isPinned: false,
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('reorder_chapters is refused for a non-owner', async () => {
  // A valid permutation in both cases: `validate_chapter_order` demands an exact one,
  // so anything less fails on ordering and never reaches the owner check. Read the
  // ids live rather than reusing the ones captured in setup — an earlier test adds a
  // chapter to this book, and a stale list here made the positive control fail with
  // "That ordering is missing some of the book's chapters."
  await conn.reducers.reorderChapters({
    bookId: own.bookId,
    orderedChapterIds: chapterIdsOf(own.bookId).reverse(),
  });

  const refusal = await refusalFrom(
    conn.reducers.reorderChapters({
      bookId: foreign.bookId,
      orderedChapterIds: chapterIdsOf(foreign.bookId).reverse(),
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('set_chapter_deps is refused for a non-owner', async () => {
  // An empty prerequisite set is always valid — no missing chapter, no cycle — so
  // ownership is the only thing left that can reject it.
  await conn.reducers.setChapterDeps({
    chapterId: own.laterChapterId,
    dependsOnChapterIds: [own.chapterId],
  });

  const refusal = await refusalFrom(
    conn.reducers.setChapterDeps({
      chapterId: foreign.chapterId,
      dependsOnChapterIds: [],
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('set_block_deps is refused for a non-owner', async () => {
  // The eleventh owner-gated reducer. The positive control is doing double duty:
  // `own.laterBlockId` sits in a *different chapter* of the same book, so a call
  // that succeeds also demonstrates the cross-chapter edge the v0.2 scope
  // promises — the one thing about `set_block_deps` that no unit test can see,
  // because the pure rule is handed a candidate set and never learns where the
  // ids came from.
  await conn.reducers.setBlockDeps({
    blockId: own.laterBlockId,
    dependsOnBlockIds: [own.blockId],
  });

  // An empty prerequisite set is always valid — no missing block, no cycle — so
  // ownership is the only thing left that can reject it.
  const refusal = await refusalFrom(
    conn.reducers.setBlockDeps({ blockId: foreign.blockId, dependsOnBlockIds: [] }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('create_block is refused for a non-owner', async () => {
  await createBlockIn(own.chapterId, 'A block in my own chapter');

  const refusal = await refusalFrom(
    conn.reducers.createBlock({
      chapterId: foreign.chapterId,
      title: 'A block in someone else’s chapter',
      blockType: { tag: 'Reading' },
      bodyHtml: '<p>Not allowed.</p>',
      url: undefined,
      isOptional: false,
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('update_block is refused for a non-owner', async () => {
  await conn.reducers.updateBlock({
    blockId: own.blockId,
    title: 'Rewritten by its owner',
    blockType: { tag: 'Reading' },
    bodyHtml: '<p>Allowed.</p>',
    url: undefined,
    isOptional: false,
  });

  const refusal = await refusalFrom(
    conn.reducers.updateBlock({
      blockId: foreign.blockId,
      title: 'Rewritten by a stranger',
      blockType: { tag: 'Reading' },
      bodyHtml: '<p>Not allowed.</p>',
      url: undefined,
      isOptional: false,
    }),
  );
  expect(refusal).toContain(REFUSAL);
});

test('set_quiz is refused for a non-owner', async () => {
  // The tenth owner-gated reducer. `require_owner` runs before the block-type
  // check, so pointing this at the seeded book's Reading block still exercises
  // ownership rather than tripping over the type — and the positive control on a
  // real Quiz block is what proves the arguments themselves are good.
  const quiz = {
    passThreshold: 50,
    questions: [
      {
        promptHtml: 'Who may write this quiz?',
        options: [
          { textHtml: 'Its owner', isCorrect: true },
          { textHtml: 'Anyone at all', isCorrect: false },
        ],
      },
    ],
  };

  await conn.reducers.setQuiz({ blockId: own.quizBlockId, ...quiz });

  const refusal = await refusalFrom(conn.reducers.setQuiz({ blockId: foreign.blockId, ...quiz }));
  expect(refusal).toContain(REFUSAL);
});

test('delete_block is refused for a non-owner', async () => {
  // Its own block, so the positive control does not destroy anything another test needs.
  const disposable = await createBlockIn(own.chapterId, 'A block I intend to delete');
  await conn.reducers.deleteBlock({ blockId: disposable });

  const refusal = await refusalFrom(conn.reducers.deleteBlock({ blockId: foreign.blockId }));
  expect(refusal).toContain(REFUSAL);

  // The refusal must also have left the row alone — a reducer that errors *after*
  // mutating would pass every assertion above.
  expect([...conn.db.knowledgeBlocks.iter()].some((b) => b.blockId === foreign.blockId)).toBe(true);
});
