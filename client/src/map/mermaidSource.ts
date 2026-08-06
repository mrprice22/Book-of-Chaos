import type { Graph } from '../reader/chapterState';

/**
 * Mermaid flowchart source for one book's chapter graph.
 *
 * Kept separate from rendering so the interesting part — which nodes, which edges,
 * which labels — is a string a test can read. M6.2 styles it, M6.3 makes it
 * clickable.
 */

export type NodeInput = {
  readonly chapterId: bigint;
  readonly title: string;
};

/** Mermaid node ids must be identifier-ish; chapter ids are numeric. */
export function nodeId(chapterId: bigint): string {
  return `c${chapterId}`;
}

export function parseNodeId(id: string): bigint | undefined {
  const match = /^c(\d+)$/.exec(id);
  return match?.[1] === undefined ? undefined : BigInt(match[1]);
}

/**
 * Escape a chapter title for use inside a Mermaid node label.
 *
 * Mermaid's parser is not HTML and not a template language: a `"` ends the label,
 * `[`/`]`/`(`/`)` change the node shape, and `#` starts an entity. Author titles are
 * arbitrary text, so an unescaped one does not merely look wrong — it produces a
 * source string that fails to parse and takes the whole map with it.
 */
export function escapeLabel(title: string): string {
  return title
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/[[\]]/g, (c) => (c === '[' ? '#91;' : '#93;'))
    .replace(/[()]/g, (c) => (c === '(' ? '#40;' : '#41;'))
    .replace(/[{}]/g, (c) => (c === '{' ? '#123;' : '#125;'))
    .replace(/[\r\n]+/g, ' ');
}

/**
 * Build the flowchart.
 *
 * Node and edge order is sorted by chapter id rather than left in map order, so the
 * same graph always produces byte-identical source. Mermaid lays out from the source
 * text, so an unstable order would make nodes jump around whenever a subscription
 * update arrived.
 */
export function toMermaid(graph: Graph, nodes: readonly NodeInput[]): string {
  const byId = new Map(nodes.map((n) => [n.chapterId, n]));
  const ids = [...graph.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const lines = ['flowchart TD'];

  for (const id of ids) {
    const node = byId.get(id);
    const label = escapeLabel(node?.title ?? `Chapter ${id}`);
    lines.push(`  ${nodeId(id)}["${label}"]`);
  }

  for (const id of ids) {
    const chapter = graph.get(id);
    if (!chapter) continue;
    // Edges point prerequisite -> dependent, which is the direction the reader
    // travels. A prerequisite outside this book's graph is dropped rather than
    // drawn as a node that does not exist.
    for (const prereq of [...chapter.prerequisites].sort((a, b) => (a < b ? -1 : 1))) {
      if (!graph.has(prereq)) continue;
      lines.push(`  ${nodeId(prereq)} --> ${nodeId(id)}`);
    }
  }

  return lines.join('\n');
}
