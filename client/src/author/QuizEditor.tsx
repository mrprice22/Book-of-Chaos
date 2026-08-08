import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { KnowledgeBlock, QuizQuestion } from '../module_bindings/types';
import { QuizForm, type QuizDraft } from './QuizForm';
import { useAction } from './useAction';

/**
 * The `set_quiz` call for one Quiz block.
 *
 * One of these per block rather than one per screen, for the same reason
 * `ChapterEditor` is per chapter: a rejection naming "question 3" must appear under
 * the quiz that has a question 3.
 */
export function QuizEditor({
  block,
  quizQuestions,
}: {
  block: KnowledgeBlock;
  quizQuestions: readonly QuizQuestion[];
}) {
  const setQuiz = useReducer(reducers.setQuiz);
  const action = useAction((draft: QuizDraft) =>
    setQuiz({ blockId: block.blockId, ...draft }),
  );

  return (
    <QuizForm
      blockId={block.blockId}
      existingQuestionCount={
        quizQuestions.filter((q) => q.blockId === block.blockId).length
      }
      onSubmit={action.run}
      pending={action.pending}
      error={action.error}
    />
  );
}
