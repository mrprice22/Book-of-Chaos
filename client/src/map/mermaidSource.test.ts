import type { ChapterDep } from '../module_bindings/types';
import { buildGraph } from '../reader/chapterState';
import { aChapter } from '../test/factories';
import { escapeLabel, nodeId, parseNodeId, toMermaid } from './mermaidSource';

function graphOf(chapters: bigint[], deps: [bigint, bigint][]) {
  const depRows: ChapterDep[] = deps.map(([chapterId, dependsOnChapterId], i) => ({
    depId: BigInt(i + 1),
    chapterId,
    dependsOnChapterId,
  }));
  return buildGraph(
    1n,
    chapters.map((id) => aChapter({ chapterId: id, bookId: 1n })),
    [],
    depRows,
  );
}

/** Available, unflagged chapters — the uninteresting default for structural tests. */
const titles = (ids: bigint[]) =>
  ids.map((id) => ({
    chapterId: id,
    title: `Chapter ${id}`,
    state: 'Available' as const,
    isOptional: false,
    isPinned: false,
  }));

describe('toMermaid', () => {
  it('declares a top-down flowchart', () => {
    expect(toMermaid(graphOf([], []), []).split('\n')[0]).toBe('flowchart TD');
  });

  it('emits one node per chapter, labelled with its title', () => {
    const [one, two] = titles([1n, 2n]);
    if (!one || !two) throw new Error('fixture');
    const source = toMermaid(graphOf([1n, 2n], []), [
      { ...one, title: 'Beginnings' },
      { ...two, title: 'Middles' },
    ]);
    expect(source).toContain('c1["○ Beginnings"]');
    expect(source).toContain('c2["○ Middles"]');
  });

  it('points edges from prerequisite to dependent — the direction the reader travels', () => {
    const source = toMermaid(graphOf([1n, 2n], [[2n, 1n]]), titles([1n, 2n]));
    expect(source).toContain('c1 --> c2');
    expect(source).not.toContain('c2 --> c1');
  });

  it('renders a diamond as four nodes and four edges', () => {
    const source = toMermaid(
      graphOf(
        [1n, 2n, 3n, 4n],
        [
          [2n, 1n],
          [3n, 1n],
          [4n, 2n],
          [4n, 3n],
        ],
      ),
      titles([1n, 2n, 3n, 4n]),
    );
    expect(source.match(/^ {2}c\d+\[/gm)).toHaveLength(4);
    expect(source.match(/-->/g)).toHaveLength(4);
  });

  it('is byte-identical for the same graph, so layout does not jump on an update', () => {
    const a = toMermaid(graphOf([3n, 1n, 2n], [[3n, 1n]]), titles([1n, 2n, 3n]));
    const b = toMermaid(graphOf([1n, 2n, 3n], [[3n, 1n]]), titles([3n, 2n, 1n]));
    expect(a).toBe(b);
  });

  it('drops an edge to a prerequisite outside the graph rather than inventing a node', () => {
    const source = toMermaid(graphOf([2n], [[2n, 99n]]), titles([2n]));
    expect(source).not.toContain('c99');
    expect(source).not.toContain('-->');
  });

  it('keeps a self-cycle as a self-edge instead of looping forever', () => {
    const source = toMermaid(graphOf([1n], [[1n, 1n]]), titles([1n]));
    expect(source).toContain('c1 --> c1');
  });

  it('falls back to a placeholder label for a chapter with no title supplied', () => {
    expect(toMermaid(graphOf([7n], []), [])).toContain('c7["🔒 Chapter 7"]');
  });

  it('handles an empty book — styles but no nodes', () => {
    const source = toMermaid(graphOf([], []), []);
    expect(source.split('\n')[0]).toBe('flowchart TD');
    expect(source).not.toMatch(/^ {2}c\d+/m);
  });
});

describe('escapeLabel', () => {
  it.each([
    ['Quote "this"', 'Quote #quot;this#quot;'],
    ['Brackets [x]', 'Brackets #91;x#93;'],
    ['Parens (x)', 'Parens #40;x#41;'],
    ['Braces {x}', 'Braces #123;x#125;'],
    ['Hash #1', 'Hash #35;1'],
  ])(
    'escapes %j, which would otherwise change the node or fail to parse',
    (input, expected) => {
      expect(escapeLabel(input)).toBe(expected);
    },
  );

  it('escapes the hash first, so an escape is not itself re-escaped', () => {
    expect(escapeLabel('"')).toBe('#quot;');
    expect(escapeLabel('#quot;')).toBe('#35;quot;');
  });

  it('flattens newlines, which would end the statement', () => {
    expect(escapeLabel('one\ntwo')).toBe('one two');
  });

  it('leaves ordinary titles alone', () => {
    expect(escapeLabel('Strange Attractors')).toBe('Strange Attractors');
  });
});

describe('node ids', () => {
  it('round-trips a chapter id', () => {
    expect(parseNodeId(nodeId(42n))).toBe(42n);
  });

  it('survives an id beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseNodeId(nodeId(9007199254740993n))).toBe(9007199254740993n);
  });

  it.each(['', 'c', 'cx', 'chapter1', '1'])('rejects %j', (id) => {
    expect(parseNodeId(id)).toBeUndefined();
  });
});

describe('node states and badges', () => {
  const node = (over: Partial<Parameters<typeof toMermaid>[1][number]> = {}) => ({
    chapterId: 1n,
    title: 'Chapter 1',
    state: 'Available' as const,
    isOptional: false,
    isPinned: false,
    ...over,
  });

  it('defines a class for each of the four states', () => {
    const source = toMermaid(graphOf([1n], []), [node()]);
    for (const name of ['blocked', 'available', 'inprogress', 'complete']) {
      expect(source).toContain(`classDef ${name} `);
    }
  });

  it.each([
    ['Blocked', 'blocked', '🔒'],
    ['Available', 'available', '○'],
    ['InProgress', 'inprogress', '◐'],
    ['Complete', 'complete', '✓'],
  ] as const)(
    'marks a %s chapter with the %s class and a text badge',
    (state, cls, badge) => {
      const source = toMermaid(graphOf([1n], []), [node({ state })]);
      expect(source).toContain(`class c1 ${cls}`);
      expect(source).toContain(`c1["${badge} Chapter 1"]`);
    },
  );

  it('badges an optional chapter', () => {
    expect(toMermaid(graphOf([1n], []), [node({ isOptional: true })])).toContain(
      'c1["○ Chapter 1 ⭐"]',
    );
  });

  it('badges a pinned chapter', () => {
    expect(toMermaid(graphOf([1n], []), [node({ isPinned: true })])).toContain(
      'c1["○ Chapter 1 📌"]',
    );
  });

  it('badges a chapter that is both', () => {
    expect(
      toMermaid(graphOf([1n], []), [node({ isOptional: true, isPinned: true })]),
    ).toContain('c1["○ Chapter 1 ⭐ 📌"]');
  });

  it('treats a chapter with no state supplied as blocked, failing closed', () => {
    const source = toMermaid(graphOf([1n], []), []);
    expect(source).toContain('class c1 blocked');
  });

  it('still emits every classDef when only one state is present', () => {
    expect(toMermaid(graphOf([1n], []), [node({ state: 'Complete' })])).toContain(
      'classDef available ',
    );
  });
});
