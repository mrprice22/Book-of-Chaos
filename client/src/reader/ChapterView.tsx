import { t } from '../i18n';
import type { Chapter, KnowledgeBlock } from '../module_bindings/types';
import { inReadingOrder } from './blockOrder';

export type ChapterViewProps = {
  chapter: Chapter;
  blocks: readonly KnowledgeBlock[];
  completedBlockIds: ReadonlySet<bigint>;
  onComplete: (blockId: bigint) => void;
  onBack: () => void;
  error?: string;
};

function BlockBody({ block }: { block: KnowledgeBlock }) {
  return (
    <>
      {/* The body is sanitized server-side on write (M2.4) — that is the trust
          boundary. Re-sanitizing here would be a second, weaker implementation of
          the same rule and would disagree with it eventually. */}
      <div className="block-body" dangerouslySetInnerHTML={{ __html: block.bodyHtml }} />
      {block.url !== undefined && (
        <p>
          <a href={block.url} rel="noreferrer noopener" target="_blank">
            {t('block.openResource')}
          </a>
        </p>
      )}
    </>
  );
}

/** Presentational: the chapter, its blocks in order, and one button per block. */
export function ChapterView({
  chapter,
  blocks,
  completedBlockIds,
  onComplete,
  onBack,
  error,
}: ChapterViewProps) {
  const ordered = inReadingOrder(blocks);

  return (
    <article className="chapter">
      <button type="button" className="back" onClick={onBack}>
        {t('chapter.backToBook')}
      </button>
      <h2>{chapter.title}</h2>
      {chapter.isOptional && <p className="badge">{t('chapter.optional')}</p>}
      <p className="chapter-description">{chapter.description}</p>

      {error !== undefined && (
        <p className="error" role="alert">
          {t('block.completeFailed', { reason: error })}
        </p>
      )}

      {ordered.length === 0 ? (
        <p className="chapter-status">{t('chapter.empty')}</p>
      ) : (
        <ol className="blocks">
          {ordered.map((block) => {
            const done = completedBlockIds.has(block.blockId);
            return (
              <li key={String(block.blockId)} data-complete={done}>
                <h3>{block.title}</h3>
                <BlockBody block={block} />
                {done ? (
                  <p className="block-done">{t('block.completed')}</p>
                ) : (
                  <button type="button" onClick={() => onComplete(block.blockId)}>
                    {t('block.markComplete')}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
