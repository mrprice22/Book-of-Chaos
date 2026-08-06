import type { KnowledgeBlock } from '../module_bindings/types';

/**
 * Blocks in reading order.
 *
 * `position` is author-defined and v0.1 has fixed ordering only, but nothing stops
 * two blocks sharing a position — reordering is a client-supplied list of ids, so a
 * half-applied edit can collide. `blockId` breaks the tie, which at least makes the
 * order stable across renders instead of dependent on subscription arrival order.
 */
export function inReadingOrder(blocks: readonly KnowledgeBlock[]): KnowledgeBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.blockId < b.blockId ? -1 : 1;
  });
}
