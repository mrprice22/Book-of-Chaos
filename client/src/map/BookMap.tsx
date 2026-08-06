import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { t } from '../i18n';
import { buildGraph, chapterState } from '../reader/chapterState';
import { KnowledgeMap } from './KnowledgeMap';
import { toMermaid, type NodeInput } from './mermaidSource';

/**
 * The knowledge map for one book, fed from live subscriptions.
 *
 * Every node's state is recomputed from the same rows the reader UI uses, so the map
 * and the chapter screen cannot disagree about what is locked.
 */
export function BookMap({ bookId }: { bookId: bigint }) {
  const { identity } = useSpacetimeDB();
  const [chapters, chaptersReady] = useTable(tables.chapters);
  const [blocks, blocksReady] = useTable(tables.knowledgeBlocks);
  const [deps, depsReady] = useTable(tables.chapterDeps);
  const [progress] = useTable(tables.readerProgress);

  if (!chaptersReady || !blocksReady || !depsReady) {
    return <p className="map-status">{t('map.rendering')}</p>;
  }

  const inBook = chapters.filter((c) => c.bookId === bookId);
  if (inBook.length === 0) {
    return <p className="map-status">{t('map.empty')}</p>;
  }

  const completed = new Set(
    progress
      .filter((p) => identity && p.identity.isEqual(identity))
      .map((p) => p.blockId),
  );
  const graph = buildGraph(bookId, chapters, blocks, deps);

  const nodes: NodeInput[] = inBook.map((c) => ({
    chapterId: c.chapterId,
    title: c.title,
    state: chapterState(graph, completed, c.chapterId),
    isOptional: c.isOptional,
    isPinned: c.isPinned,
  }));

  return <KnowledgeMap source={toMermaid(graph, nodes)} />;
}
