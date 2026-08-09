import { useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { t } from '../i18n';
import { HOME_PATH, navigate } from '../routing/route';
import { ChapterView } from './ChapterView';
import type { ChapterViewProps } from './ChapterView';
import { buildGraph, chapterState } from './chapterState';
import { blockState, buildBlockGraph } from './blockState';
import type { BlockState } from './blockState';
import { buildQuiz } from './quizModel';
import type { QuizAnswer, QuizView } from './quizModel';

function BackToBook({ children }: { children: React.ReactNode }) {
  return (
    <div className="chapter-status">
      {children}
      <button type="button" onClick={() => navigate(HOME_PATH)}>
        {t('chapter.backToBook')}
      </button>
    </div>
  );
}

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Live data for one chapter, plus the two writes the reader can make. */
export function ChapterScreen({ chapterId }: { chapterId: bigint }) {
  const { identity } = useSpacetimeDB();
  const [chapters, chaptersReady] = useTable(tables.chapters);
  const [blocks, blocksReady] = useTable(tables.knowledgeBlocks);
  const [deps, depsReady] = useTable(tables.chapterDeps);
  const [blockDeps, blockDepsReady] = useTable(tables.blockDeps);
  const [progress] = useTable(tables.readerProgress);
  const [quizConfigs] = useTable(tables.quizConfig);
  const [quizQuestions] = useTable(tables.quizQuestions);
  const [quizOptions] = useTable(tables.quizOptions);
  const [quizAttempts] = useTable(tables.quizAttempts);
  const [quizResults] = useTable(tables.quizAttemptResults);
  const completeBlock = useReducer(reducers.completeBlock);
  const submitQuiz = useReducer(reducers.submitQuiz);
  const [error, setError] = useState<ChapterViewProps['error']>(undefined);

  // `blockDeps` is waited on with the rest: a block whose edges have not arrived yet
  // would render as unlocked, which is the one direction this must never fail in.
  if (!chaptersReady || !blocksReady || !depsReady || !blockDepsReady) {
    return <p className="chapter-status">{t('book.loading')}</p>;
  }

  const chapter = chapters.find((c) => c.chapterId === chapterId);
  if (!chapter) {
    return (
      <BackToBook>
        <p>{t('chapter.notFound')}</p>
      </BackToBook>
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

  // A direct URL is the only way into a chapter right now, so the lock has to live
  // on the screen itself rather than on whatever linked here. The server refuses a
  // Blocked chapter too; this is what makes the refusal legible instead of a toast.
  const state = chapterState(
    buildGraph(chapter.bookId, chapters, blocks, deps),
    completedBlockIds,
    chapterId,
  );
  if (state === 'Blocked') {
    return (
      <BackToBook>
        <p className="locked" data-state="Blocked">
          {t('chapter.locked')}
        </p>
        <p>{t('chapter.lockedReason')}</p>
      </BackToBook>
    );
  }

  const onComplete = (blockId: bigint) => {
    setError(undefined);
    // The reducer refuses a Blocked chapter, so a rejection here is authoritative
    // and worth showing rather than swallowing.
    completeBlock({ blockId }).catch((e: unknown) => {
      setError({ kind: 'complete', reason: reasonFrom(e) });
    });
  };

  const onSubmitQuiz = (blockId: bigint, answers: QuizAnswer[]) => {
    setError(undefined);
    // Grading is the server's, and so is the verdict: nothing is decided here.
    // The score comes back as a `quiz_attempts` row through the subscription.
    submitQuiz({ blockId, answers }).catch((e: unknown) => {
      setError({ kind: 'submit', reason: reasonFrom(e) });
    });
  };

  const chapterBlocks = blocks.filter((b) => b.chapterId === chapterId);

  // The block half of the gate, beside the chapter half above rather than instead
  // of it — the same composition the two reducers make. Built book-wide because a
  // prerequisite may live in another chapter.
  const blockGraph = buildBlockGraph(chapter.bookId, chapters, blocks, blockDeps);
  const blockStates = new Map<bigint, BlockState>(
    chapterBlocks.map((b) => [
      b.blockId,
      blockState(blockGraph, completedBlockIds, b.blockId),
    ]),
  );

  const quizzes = new Map<bigint, QuizView>();
  for (const block of chapterBlocks) {
    if (block.blockType.tag !== 'Quiz') continue;
    const quiz = buildQuiz(
      block.blockId,
      {
        configs: quizConfigs,
        questions: quizQuestions,
        options: quizOptions,
        attempts: quizAttempts,
        results: quizResults,
      },
      identity,
    );
    // A Quiz block with no config row has no entry, which is how `ChapterView`
    // tells "not written yet" from "written".
    if (quiz) quizzes.set(block.blockId, quiz);
  }

  return (
    <ChapterView
      chapter={chapter}
      blocks={chapterBlocks}
      completedBlockIds={completedBlockIds}
      blockStates={blockStates}
      onComplete={onComplete}
      quizzes={quizzes}
      onSubmitQuiz={onSubmitQuiz}
      onBack={() => navigate(HOME_PATH)}
      error={error}
    />
  );
}
