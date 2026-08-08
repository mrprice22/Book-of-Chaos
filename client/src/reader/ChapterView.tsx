import { t } from '../i18n';
import type { Chapter, KnowledgeBlock } from '../module_bindings/types';
import { inReadingOrder } from './blockOrder';
import { QuizBlock } from './QuizBlock';
import type { QuizAnswer, QuizView } from './quizModel';

export type ChapterViewProps = {
  chapter: Chapter;
  blocks: readonly KnowledgeBlock[];
  completedBlockIds: ReadonlySet<bigint>;
  onComplete: (blockId: bigint) => void;
  /** The quiz on a `Quiz` block, by block id. Absent means nobody has written it. */
  quizzes: ReadonlyMap<bigint, QuizView>;
  onSubmitQuiz: (blockId: bigint, answers: QuizAnswer[]) => void;
  onBack: () => void;
  /**
   * A rejection from the server, and which call it came from. Carried as a fact
   * rather than a finished sentence so the copy stays in this file — "could not
   * mark that complete" is the wrong thing to say about a refused submission.
   */
  error?: { readonly kind: 'complete' | 'submit'; readonly reason: string };
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
  quizzes,
  onSubmitQuiz,
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
          {t(error.kind === 'submit' ? 'quiz.submitFailed' : 'block.completeFailed', {
            reason: error.reason,
          })}
        </p>
      )}

      {ordered.length === 0 ? (
        <p className="chapter-status">{t('chapter.empty')}</p>
      ) : (
        <ol className="blocks">
          {ordered.map((block) => {
            const done = completedBlockIds.has(block.blockId);
            const isQuiz = block.blockType.tag === 'Quiz';
            return (
              <li key={String(block.blockId)} data-complete={done}>
                <h3>{block.title}</h3>
                <BlockBody block={block} />
                {done && <p className="block-done">{t('block.completed')}</p>}
                {/* A quiz is completed by passing it and by nothing else, so it
                    gets no "Mark as complete" button — the server refuses that
                    call (M10.3), and a control that is always rejected is a bug
                    the reader gets to discover. It keeps its form after passing:
                    retakes are unlimited in v0.2. */}
                {isQuiz ? (
                  <QuizBlock quiz={quizzes.get(block.blockId)} onSubmit={onSubmitQuiz} />
                ) : (
                  !done && (
                    <button type="button" onClick={() => onComplete(block.blockId)}>
                      {t('block.markComplete')}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
