import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type {
  Chapter,
  ChapterDep,
  KnowledgeBlock,
  QuizQuestion,
} from '../module_bindings/types';
import { inReadingOrder } from '../reader/blockOrder';
import { BlockForm, type BlockDraft } from './BlockForm';
import { PrerequisiteForm } from './PrerequisiteForm';
import { QuizEditor } from './QuizEditor';
import { useAction } from './useAction';

/**
 * One chapter's editing surface.
 *
 * A component per chapter rather than one screen holding every form, so that pending
 * state and — more importantly — a rejection belong to the chapter that caused them.
 * With a single shared action, a cycle error raised by chapter 4 would appear under
 * all of them.
 */
export function ChapterEditor({
  chapter,
  siblings,
  blocks,
  deps,
  quizQuestions,
}: {
  chapter: Chapter;
  siblings: readonly Chapter[];
  blocks: readonly KnowledgeBlock[];
  deps: readonly ChapterDep[];
  quizQuestions: readonly QuizQuestion[];
}) {
  const createBlock = useReducer(reducers.createBlock);
  const setChapterDeps = useReducer(reducers.setChapterDeps);

  const blockAction = useAction((draft: BlockDraft) =>
    createBlock({ chapterId: chapter.chapterId, ...draft }),
  );
  const depsAction = useAction((dependsOn: bigint[]) =>
    setChapterDeps({ chapterId: chapter.chapterId, dependsOnChapterIds: dependsOn }),
  );

  const selected = new Set(
    deps
      .filter((d) => d.chapterId === chapter.chapterId)
      .map((d) => d.dependsOnChapterId),
  );

  return (
    <li className="chapter-editor">
      <h4>{chapter.title}</h4>
      <ul className="author-blocks">
        {inReadingOrder(blocks.filter((b) => b.chapterId === chapter.chapterId)).map(
          (block) => (
            <li key={String(block.blockId)}>
              {block.title}
              {block.blockType.tag === 'Quiz' && (
                <QuizEditor block={block} quizQuestions={quizQuestions} />
              )}
            </li>
          ),
        )}
      </ul>

      <BlockForm
        chapterId={chapter.chapterId}
        onSubmit={blockAction.run}
        pending={blockAction.pending}
        error={blockAction.error}
      />

      <PrerequisiteForm
        // Remount when the server's answer changes, so the checkboxes reflect the
        // stored edges rather than a stale local draft.
        key={[...selected].sort().join(',')}
        chapter={chapter}
        candidates={siblings}
        selected={selected}
        onSubmit={depsAction.run}
        pending={depsAction.pending}
        error={depsAction.error}
      />
    </li>
  );
}
