/**
 * Seed the demo book.
 *
 * Run it with the dev container's toolchain, from the client (whose node_modules and
 * generated bindings it uses):
 *
 *   ./scripts/dev.sh run 'cd client && npm run seed'
 *
 * The demo graph is the shape the product exists to show — a diamond, so two
 * branches must both complete before the join unlocks, plus an optional side branch
 * and a pinned appendix that is reachable regardless of its prerequisite:
 *
 *   Foundations ──┬─> Attractors ──┬─> Synthesis ──> Appendix (pinned)
 *                 └─> Bifurcation ─┘
 *                 └─> Aside (optional)
 *
 * Idempotent: it looks for the demo book by title and does nothing if it is already
 * there. Re-running after a `spacetime publish --clear-database` seeds again.
 */
import { DbConnection } from '../client/src/module_bindings';
import type { BlockType } from '../client/src/module_bindings/types';

const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

const BOOK_TITLE = 'Chaos, Briefly';

type BlockSpec = {
  title: string;
  bodyHtml: string;
  blockType?: BlockType;
  url?: string;
  isOptional?: boolean;
};

type ChapterSpec = {
  key: string;
  title: string;
  description: string;
  isOptional?: boolean;
  isPinned?: boolean;
  /** Keys of the chapters this one waits on. */
  dependsOn?: string[];
  blocks: BlockSpec[];
};

const CHAPTERS: ChapterSpec[] = [
  {
    key: 'foundations',
    title: 'Foundations',
    description: 'What a dynamical system is, and why small differences matter.',
    blocks: [
      {
        title: 'State and evolution',
        bodyHtml:
          '<h2>State and evolution</h2><p>A <em>dynamical system</em> is a rule that says where a point goes next. Nothing more.</p><p>The rule can be simple and the behaviour it produces can be inexhaustible. That gap is the whole subject.</p>',
      },
      {
        title: 'Sensitive dependence',
        bodyHtml:
          '<h2>Sensitive dependence</h2><p>Two states that begin arbitrarily close together can end up arbitrarily far apart. Prediction fails not because the rule is unknown, but because your knowledge of the starting point is finite.</p><ul><li>The rule is deterministic.</li><li>The outcome is unforecastable.</li><li>Both statements are true at once.</li></ul>',
      },
    ],
  },
  {
    key: 'attractors',
    title: 'Attractors',
    description: 'Where trajectories end up when they do not settle down.',
    dependsOn: ['foundations'],
    blocks: [
      {
        title: 'Fixed points and cycles',
        bodyHtml:
          '<h2>Fixed points and cycles</h2><p>The tame outcomes: a system that stops moving, or one that repeats. Everything interesting is what happens when neither is available.</p>',
      },
      {
        title: 'Strange attractors',
        bodyHtml:
          '<h2>Strange attractors</h2><p>A bounded region that trajectories are drawn into and never leave, yet never repeat inside. Confined and non-repeating — that is what makes it strange.</p>',
      },
      {
        title: 'The Lorenz system',
        bodyHtml:
          '<p>Three equations, no closed-form solution, and a shape everyone recognises.</p>',
        blockType: { tag: 'ResourceLink' },
        url: 'https://en.wikipedia.org/wiki/Lorenz_system',
      },
    ],
  },
  {
    key: 'bifurcation',
    title: 'Bifurcation',
    description: 'How a system changes its mind as a parameter moves.',
    dependsOn: ['foundations'],
    blocks: [
      {
        title: 'Period doubling',
        bodyHtml:
          '<h2>Period doubling</h2><p>Turn one knob slowly. A stable point becomes a two-cycle, then a four-cycle, then eight — the intervals shrinking geometrically until periodicity gives out entirely.</p>',
      },
      {
        title: 'The route to chaos',
        bodyHtml:
          '<h2>The route to chaos</h2><p>Chaos here is not a sudden failure. It is the accumulation point of an infinite sequence of ordinary, well-behaved changes.</p>',
      },
    ],
  },
  {
    key: 'aside',
    title: 'Aside: Measuring Divergence',
    description: 'Lyapunov exponents, for the curious. Not required.',
    isOptional: true,
    dependsOn: ['foundations'],
    blocks: [
      {
        title: 'Lyapunov exponents',
        bodyHtml:
          '<h2>Lyapunov exponents</h2><p>The average rate at which nearby trajectories separate. Positive means chaotic. It is the closest thing the subject has to a single number.</p>',
      },
    ],
  },
  {
    key: 'synthesis',
    title: 'Synthesis',
    description: 'Putting attractors and bifurcations together.',
    dependsOn: ['attractors', 'bifurcation'],
    blocks: [
      {
        title: 'One picture',
        bodyHtml:
          '<h2>One picture</h2><p>Bifurcation says <em>when</em> a system becomes chaotic; the attractor says <em>what</em> it does afterwards. Neither half is much use alone — which is why this chapter waits for both.</p>',
      },
      {
        title: 'Where this shows up',
        bodyHtml:
          '<h2>Where this shows up</h2><p>Weather, heart rhythms, population ecology, fluid turbulence. The mathematics does not care which.</p>',
      },
    ],
  },
  {
    key: 'appendix',
    title: 'Appendix: Notation',
    description: 'Symbols used throughout. Readable at any time.',
    isPinned: true,
    dependsOn: ['synthesis'],
    blocks: [
      {
        title: 'Symbols',
        bodyHtml:
          '<h2>Symbols</h2><ul><li><code>x&#39;</code> — the next state</li><li><code>&#955;</code> — Lyapunov exponent</li><li><code>r</code> — the parameter being turned</li></ul>',
      },
    ],
  },
];

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .onConnect((conn) => resolve(conn))
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(
      () => reject(new Error(`Timed out connecting to ${URI}/${DB_NAME}`)),
      15_000,
    );
  });
}

/**
 * Reducer calls resolve when the server accepts them, but the caller's own view of
 * the tables catches up on the next subscription update. Everything here reads back
 * an auto-incremented id, so each step waits for the row to appear rather than
 * assuming it has.
 */
async function waitFor<T>(find: () => T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gave up waiting for ${what}`);
}

async function main() {
  const conn = await connect();
  await conn.subscriptionBuilder().subscribeToAllTables();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const existing = [...conn.db.books.iter()].find((b) => b.title === BOOK_TITLE);
  if (existing) {
    console.log(
      `"${BOOK_TITLE}" is already seeded (book ${existing.bookId}). Nothing to do.`,
    );
    conn.disconnect();
    return;
  }

  await conn.reducers.createBook({
    title: BOOK_TITLE,
    description:
      'A short tour of dynamical systems, arranged as a dependency graph rather than a reading order.',
  });
  const book = await waitFor(
    () => [...conn.db.books.iter()].find((b) => b.title === BOOK_TITLE),
    'the book',
  );
  console.log(`book ${book.bookId}: ${book.title}`);

  const chapterIds = new Map<string, bigint>();

  for (const spec of CHAPTERS) {
    await conn.reducers.createChapter({
      bookId: book.bookId,
      title: spec.title,
      description: spec.description,
      isOptional: spec.isOptional ?? false,
      isPinned: spec.isPinned ?? false,
    });
    const chapter = await waitFor(
      () =>
        [...conn.db.chapters.iter()].find(
          (c) => c.bookId === book.bookId && c.title === spec.title,
        ),
      `chapter "${spec.title}"`,
    );
    chapterIds.set(spec.key, chapter.chapterId);
    console.log(`  chapter ${chapter.chapterId}: ${chapter.title}`);

    for (const block of spec.blocks) {
      await conn.reducers.createBlock({
        chapterId: chapter.chapterId,
        title: block.title,
        blockType: block.blockType ?? { tag: 'Reading' },
        bodyHtml: block.bodyHtml,
        url: block.url,
        isOptional: block.isOptional ?? false,
      });
      await waitFor(
        () =>
          [...conn.db.knowledgeBlocks.iter()].find(
            (b) => b.chapterId === chapter.chapterId && b.title === block.title,
          ),
        `block "${block.title}"`,
      );
      console.log(`    block: ${block.title}`);
    }
  }

  // Edges go in after every chapter exists: set_chapter_deps rejects an unknown
  // prerequisite, and a forward reference is unknown until its chapter is created.
  for (const spec of CHAPTERS) {
    if (!spec.dependsOn?.length) continue;
    const chapterId = chapterIds.get(spec.key);
    if (chapterId === undefined) throw new Error(`no chapter for ${spec.key}`);

    const dependsOnChapterIds = spec.dependsOn.map((key) => {
      const id = chapterIds.get(key);
      if (id === undefined) throw new Error(`"${spec.key}" depends on unknown "${key}"`);
      return id;
    });

    await conn.reducers.setChapterDeps({ chapterId, dependsOnChapterIds });
    console.log(`  ${spec.title} depends on ${spec.dependsOn.join(', ')}`);
  }

  await conn.reducers.publishBook({ bookId: book.bookId });
  await waitFor(
    () =>
      [...conn.db.books.iter()].find(
        (b) => b.bookId === book.bookId && b.status.tag === 'Published',
      ),
    'the book to be published',
  );
  console.log(`published "${BOOK_TITLE}"`);

  conn.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
