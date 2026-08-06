import { useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { t } from '../i18n';
import { HOME_PATH, navigate } from '../routing/route';
import { ChapterView } from './ChapterView';

/** Live data for one chapter, plus the one write the reader can make. */
export function ChapterScreen({ chapterId }: { chapterId: bigint }) {
  const { identity } = useSpacetimeDB();
  const [chapters, chaptersReady] = useTable(tables.chapters);
  const [blocks, blocksReady] = useTable(tables.knowledgeBlocks);
  const [progress] = useTable(tables.readerProgress);
  const completeBlock = useReducer(reducers.completeBlock);
  const [error, setError] = useState<string | undefined>(undefined);

  if (!chaptersReady || !blocksReady) {
    return <p className="chapter-status">{t('book.loading')}</p>;
  }

  const chapter = chapters.find((c) => c.chapterId === chapterId);
  if (!chapter) {
    return (
      <div className="chapter-status">
        <p>{t('chapter.notFound')}</p>
        <button type="button" onClick={() => navigate(HOME_PATH)}>
          {t('chapter.backToBook')}
        </button>
      </div>
    );
  }

  // reader_progress is public and holds every reader's rows, so it is filtered to
  // this identity here. That is display scoping, not access control — the reducer
  // is the trust boundary.
  const completedBlockIds = new Set(
    progress
      .filter((p) => identity && p.identity.isEqual(identity))
      .map((p) => p.blockId),
  );

  const onComplete = (blockId: bigint) => {
    setError(undefined);
    // The reducer refuses a Blocked chapter, so a rejection here is authoritative
    // and worth showing rather than swallowing.
    completeBlock({ blockId }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <ChapterView
      chapter={chapter}
      blocks={blocks.filter((b) => b.chapterId === chapterId)}
      completedBlockIds={completedBlockIds}
      onComplete={onComplete}
      onBack={() => navigate(HOME_PATH)}
      error={error}
    />
  );
}
