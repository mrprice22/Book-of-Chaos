import type { ChapterDep } from '../module_bindings/types';
import { aBlock, aChapter } from '../test/factories';
import { buildGraph, chapterState, type ChapterState } from './chapterState';

function dep(chapterId: bigint, dependsOn: bigint): ChapterDep {
  return {
    depId: chapterId * 1000n + dependsOn,
    chapterId,
    dependsOnChapterId: dependsOn,
  };
}

/**
 * Every shape from M3.4, mirrored: the Rust engine and this one have to agree, and
 * the way that stays true is being asked the same questions.
 */
type Case = {
  name: string;
  chapters: { id: bigint; optional?: boolean; pinned?: boolean; blocks?: bigint[] }[];
  deps: [bigint, bigint][];
  completed: bigint[];
  expect: Record<string, ChapterState>;
};

const cases: Case[] = [
  {
    name: 'empty graph — an unknown chapter fails closed',
    chapters: [],
    deps: [],
    completed: [],
    expect: { '1': 'Blocked' },
  },
  {
    name: 'linear chain, nothing done',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
      { id: 3n, blocks: [301n] },
    ],
    deps: [
      [2n, 1n],
      [3n, 2n],
    ],
    completed: [],
    expect: { '1': 'Available', '2': 'Blocked', '3': 'Blocked' },
  },
  {
    name: 'linear chain, first chapter finished',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
      { id: 3n, blocks: [301n] },
    ],
    deps: [
      [2n, 1n],
      [3n, 2n],
    ],
    completed: [101n],
    expect: { '1': 'Complete', '2': 'Available', '3': 'Blocked' },
  },
  {
    name: 'diamond — the join waits for both arms',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
      { id: 3n, blocks: [301n] },
      { id: 4n, blocks: [401n] },
    ],
    deps: [
      [2n, 1n],
      [3n, 1n],
      [4n, 2n],
      [4n, 3n],
    ],
    completed: [101n, 201n],
    expect: { '2': 'Complete', '3': 'Available', '4': 'Blocked' },
  },
  {
    name: 'diamond — both arms done unlocks the join',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
      { id: 3n, blocks: [301n] },
      { id: 4n, blocks: [401n] },
    ],
    deps: [
      [2n, 1n],
      [3n, 1n],
      [4n, 2n],
      [4n, 3n],
    ],
    completed: [101n, 201n, 301n],
    expect: { '4': 'Available' },
  },
  {
    name: 'disconnected islands do not affect each other',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
      { id: 10n, blocks: [1001n] },
    ],
    deps: [[2n, 1n]],
    completed: [],
    expect: { '1': 'Available', '2': 'Blocked', '10': 'Available' },
  },
  {
    name: 'a chapter of only optional blocks is complete with nothing done',
    chapters: [{ id: 1n, blocks: [] }],
    deps: [],
    completed: [],
    expect: { '1': 'Complete' },
  },
  {
    name: 'pinned skips prerequisites but still tracks progress',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, pinned: true, blocks: [201n, 202n] },
    ],
    deps: [[2n, 1n]],
    completed: [201n],
    expect: { '1': 'Available', '2': 'InProgress' },
  },
  {
    name: 'an optional chapter is stated like any other',
    chapters: [{ id: 1n, optional: true, blocks: [101n] }],
    deps: [],
    completed: [],
    expect: { '1': 'Available' },
  },
  {
    name: 'a dangling prerequisite fails closed',
    chapters: [{ id: 2n, blocks: [201n] }],
    deps: [[2n, 99n]],
    completed: [],
    expect: { '2': 'Blocked' },
  },
  {
    name: 'a self-cycle blocks itself rather than looping',
    chapters: [{ id: 1n, blocks: [101n] }],
    deps: [[1n, 1n]],
    completed: [],
    expect: { '1': 'Blocked' },
  },
  {
    name: 'a three-node cycle blocks all of it and terminates',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
      { id: 3n, blocks: [301n] },
    ],
    deps: [
      [1n, 3n],
      [2n, 1n],
      [3n, 2n],
    ],
    completed: [],
    expect: { '1': 'Blocked', '2': 'Blocked', '3': 'Blocked' },
  },
  {
    name: 'Complete wins over Blocked when an author adds a prerequisite later',
    chapters: [
      { id: 1n, blocks: [101n] },
      { id: 2n, blocks: [201n] },
    ],
    deps: [[2n, 1n]],
    completed: [201n],
    expect: { '1': 'Available', '2': 'Complete' },
  },
  {
    name: 'a partially finished chapter is InProgress',
    chapters: [{ id: 1n, blocks: [101n, 102n] }],
    deps: [],
    completed: [101n],
    expect: { '1': 'InProgress' },
  },
];

describe.each(cases)('chapterState: $name', (testCase) => {
  const graph = buildGraph(
    1n,
    testCase.chapters.map((c) =>
      aChapter({
        chapterId: c.id,
        bookId: 1n,
        isOptional: c.optional ?? false,
        isPinned: c.pinned ?? false,
      }),
    ),
    testCase.chapters.flatMap((c) =>
      (c.blocks ?? []).map((blockId) => aBlock({ blockId, chapterId: c.id })),
    ),
    testCase.deps.map(([from, to]) => dep(from, to)),
  );
  const completed = new Set(testCase.completed);

  it.each(Object.entries(testCase.expect))('chapter %s is %s', (id, expected) => {
    expect(chapterState(graph, completed, BigInt(id))).toBe(expected);
  });
});

describe('buildGraph', () => {
  it('ignores chapters from another book, since prerequisites cannot cross books', () => {
    const graph = buildGraph(
      1n,
      [
        aChapter({ chapterId: 10n, bookId: 1n }),
        aChapter({ chapterId: 20n, bookId: 2n }),
      ],
      [],
      [],
    );
    expect([...graph.keys()]).toEqual([10n]);
  });

  it('counts only a chapter’s own blocks toward its completion', () => {
    const graph = buildGraph(
      1n,
      [aChapter({ chapterId: 10n, bookId: 1n })],
      [
        aBlock({ blockId: 100n, chapterId: 10n }),
        aBlock({ blockId: 200n, chapterId: 11n }),
      ],
      [],
    );
    expect(chapterState(graph, new Set([100n]), 10n)).toBe('Complete');
  });

  it('treats an optional block as not required for completion', () => {
    const graph = buildGraph(
      1n,
      [aChapter({ chapterId: 10n, bookId: 1n })],
      [
        aBlock({ blockId: 100n, chapterId: 10n }),
        aBlock({ blockId: 101n, chapterId: 10n, isOptional: true }),
      ],
      [],
    );
    expect(chapterState(graph, new Set([100n]), 10n)).toBe('Complete');
  });
});
