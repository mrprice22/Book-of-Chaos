import type { ChapterState, Graph } from '../reader/chapterState';
import { chapterPath } from '../routing/route';

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
  readonly state: ChapterState;
  readonly isOptional: boolean;
  readonly isPinned: boolean;
};

/**
 * State is carried by both a badge and a class.
 *
 * The colours alone would leave the four states indistinguishable to a reader who
 * cannot see the difference between them, and Mermaid gives us no other place to put
 * a text cue — so the glyph is part of the label.
 */
const STATE_BADGE: Record<ChapterState, string> = {
  Blocked: '🔒',
  Available: '○',
  InProgress: '◐',
  Complete: '✓',
};

/**
 * One class per state, plus the two flags.
 *
 * Colours are stated explicitly rather than inherited from a Mermaid theme: the
 * theme follows the page's light/dark mode, and "dimmed" has to mean dimmer than the
 * surrounding nodes in both.
 */
const CLASS_DEFS = [
  'classDef blocked fill:#8882,stroke:#8886,color:#888',
  'classDef available fill:transparent,stroke:#d99e00,stroke-width:2px',
  'classDef inprogress fill:#2b6cb022,stroke:#2b6cb0,stroke-width:2px',
  'classDef complete fill:#2f855a22,stroke:#2f855a,stroke-width:2px',
];

const STATE_CLASS: Record<ChapterState, string> = {
  Blocked: 'blocked',
  Available: 'available',
  InProgress: 'inprogress',
  Complete: 'complete',
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
    lines.push(`  ${nodeId(id)}["${nodeLabel(id, node)}"]`);
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

  // classDefs are emitted unconditionally: Mermaid tolerates an unused class, and
  // conditional style blocks would make the source depend on which states happen to
  // be present, breaking the byte-identical guarantee above.
  for (const def of CLASS_DEFS) lines.push(`  ${def}`);
  for (const id of ids) {
    const state = byId.get(id)?.state ?? 'Blocked';
    lines.push(`  class ${nodeId(id)} ${STATE_CLASS[state]}`);
  }

  // Navigation is a link, not a callback: `click ... call` needs securityLevel
  // 'loose', and a real href still works if the SPA's click interception ever
  // breaks. Blocked chapters are linked too — the chapter screen explains the lock,
  // which is more use than a dead node.
  for (const id of ids) {
    lines.push(`  click ${nodeId(id)} "${chapterPath(id)}"`);
  }

  return lines.join('\n');
}

/** `🔒 Title ⭐📌` — state first, author flags after. */
function nodeLabel(chapterId: bigint, node: NodeInput | undefined): string {
  const title = escapeLabel(node?.title ?? `Chapter ${chapterId}`);
  const badges = [
    STATE_BADGE[node?.state ?? 'Blocked'],
    title,
    node?.isOptional ? '⭐' : '',
    node?.isPinned ? '📌' : '',
  ];
  return badges.filter((part) => part !== '').join(' ');
}
