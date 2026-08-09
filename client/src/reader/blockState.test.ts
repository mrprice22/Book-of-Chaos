import { aBlock, aBlockDep, aChapter } from '../test/factories';
import { blockState, buildBlockGraph } from './blockState';

// The same cases as `block_state`'s in `server/src/unlock.rs`, deliberately. The
// two implementations are a known duplication (see the parking lot in
// docs/backlog.md); matching tests are what would catch them disagreeing.

/** One book, one chapter per `chapterId`, with the given blocks and edges. */
function graphOf(
  blocks: readonly { id: bigint; chapterId?: bigint }[],
  edges: readonly (readonly [bigint, bigint])[] = [],
) {
  const chapterIds = [...new Set(blocks.map((b) => b.chapterId ?? 10n))];
  return buildBlockGraph(
    1n,
    chapterIds.map((chapterId) => aChapter({ chapterId, bookId: 1n })),
    blocks.map((b) => aBlock({ blockId: b.id, chapterId: b.chapterId ?? 10n })),
    edges.map(([from, to]) => aBlockDep(from, to)),
  );
}

describe('blockState', () => {
  it('is Available with no prerequisites', () => {
    expect(blockState(graphOf([{ id: 1n }]), new Set(), 1n)).toBe('Available');
  });

  it('is Locked while a prerequisite is unread', () => {
    const graph = graphOf([{ id: 1n }, { id: 2n }], [[2n, 1n]]);
    expect(blockState(graph, new Set(), 2n)).toBe('Locked');
  });

  it('opens once the prerequisite is complete', () => {
    const graph = graphOf([{ id: 1n }, { id: 2n }], [[2n, 1n]]);
    expect(blockState(graph, new Set([1n]), 1n)).toBe('Complete');
    expect(blockState(graph, new Set([1n]), 2n)).toBe('Available');
  });

  it('accepts a prerequisite in another chapter', () => {
    // v0.2 scope: "within its chapter or across chapters". A chapter-scoped graph
    // would call this edge dangling and lock the block forever.
    const graph = graphOf(
      [
        { id: 1n, chapterId: 10n },
        { id: 2n, chapterId: 11n },
      ],
      [[2n, 1n]],
    );
    expect(blockState(graph, new Set(), 2n)).toBe('Locked');
    expect(blockState(graph, new Set([1n]), 2n)).toBe('Available');
  });

  it('requires every prerequisite, not just one', () => {
    const graph = graphOf(
      [{ id: 1n }, { id: 2n }, { id: 3n }],
      [
        [3n, 1n],
        [3n, 2n],
      ],
    );
    expect(blockState(graph, new Set([1n]), 3n)).toBe('Locked');
    expect(blockState(graph, new Set([1n, 2n]), 3n)).toBe('Available');
  });

  it('does not re-lock a block the reader already finished', () => {
    const graph = graphOf([{ id: 1n }, { id: 2n }], [[2n, 1n]]);
    expect(blockState(graph, new Set([2n]), 2n)).toBe('Complete');
  });

  it('fails closed on a prerequisite that is not in the graph', () => {
    // Note the reader has "completed" the missing id — the case a presence check
    // alone would wave through.
    const graph = graphOf([{ id: 1n }], [[1n, 999n]]);
    expect(blockState(graph, new Set([999n]), 1n)).toBe('Locked');
  });

  it('fails closed on an unknown block', () => {
    expect(blockState(graphOf([{ id: 1n }]), new Set(), 4242n)).toBe('Locked');
    expect(blockState(new Map(), new Set(), 1n)).toBe('Locked');
  });
});

describe('buildBlockGraph', () => {
  it('ignores blocks from another book, since prerequisites cannot cross books', () => {
    const graph = buildBlockGraph(
      1n,
      [
        aChapter({ chapterId: 10n, bookId: 1n }),
        aChapter({ chapterId: 20n, bookId: 2n }),
      ],
      [
        aBlock({ blockId: 100n, chapterId: 10n }),
        aBlock({ blockId: 200n, chapterId: 20n }),
      ],
      [aBlockDep(100n, 200n)],
    );
    expect([...graph.keys()]).toEqual([100n]);
    // And the edge into the other book is therefore dangling, which fails closed
    // rather than opening on a block this book cannot see.
    expect(blockState(graph, new Set([200n]), 100n)).toBe('Locked');
  });
});
