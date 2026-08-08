import { useState } from 'react';
import { t } from '../i18n';
import { answersFrom, wasWrong } from './quizModel';
import type { QuizAnswer, QuizQuestionView, QuizView } from './quizModel';

export type QuizBlockProps = {
  /** `undefined` when the block is a Quiz but nobody has written the quiz yet. */
  quiz: QuizView | undefined;
  onSubmit: (blockId: bigint, answers: QuizAnswer[]) => void;
};

type Selections = ReadonlyMap<bigint, ReadonlySet<bigint>>;

/** Tick or untick one option, respecting how many the question accepts. */
function toggle(
  selections: Selections,
  question: QuizQuestionView,
  optionId: bigint,
): Selections {
  const next = new Map(selections);
  const current = selections.get(question.questionId) ?? new Set<bigint>();
  if (!question.isMultiAnswer) {
    // A single-answer question is a radio group: choosing replaces.
    next.set(question.questionId, new Set([optionId]));
    return next;
  }
  const chosen = new Set(current);
  if (chosen.has(optionId)) chosen.delete(optionId);
  else chosen.add(optionId);
  next.set(question.questionId, chosen);
  return next;
}

/**
 * A `Quiz` block's reader UI: the questions, the reader's selections, and the
 * grade the server returned for their last attempt.
 *
 * There is no "Mark as complete" here and there must not be — `complete_block`
 * refuses a Quiz block outright (M10.3), so offering the control would be offering
 * a button the server always rejects. Passing is the only way through.
 *
 * The last attempt's marks stay on screen while the reader changes their answers
 * for a retake. They describe the attempt, not the current selections, and the
 * score beside them says which it is.
 */
export function QuizBlock({ quiz, onSubmit }: QuizBlockProps) {
  const [selections, setSelections] = useState<Selections>(new Map());

  if (!quiz) {
    return <p className="quiz-unwritten">{t('quiz.notWritten')}</p>;
  }

  const attempt = quiz.latestAttempt;

  return (
    <form
      className="quiz"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(quiz.blockId, answersFrom(quiz.questions, selections));
      }}
    >
      <p className="quiz-threshold">
        {t('quiz.threshold', { threshold: quiz.passThreshold })}
      </p>

      {attempt !== undefined && (
        <p className="quiz-score" role="status" data-passed={attempt.passed}>
          {t('quiz.score', { score: attempt.scorePercent })}{' '}
          {attempt.passed ? t('quiz.passed') : t('quiz.failed')}
        </p>
      )}

      {quiz.questions.map((question) => {
        const chosen = selections.get(question.questionId) ?? new Set<bigint>();
        const graded =
          attempt !== undefined && attempt.gradedQuestionIds.has(question.questionId);
        const wrong = attempt !== undefined && wasWrong(attempt, question.questionId);
        return (
          <fieldset key={String(question.questionId)} data-wrong={wrong}>
            <legend>
              <div
                className="quiz-prompt"
                // Sanitized server-side on write, exactly like a block body.
                dangerouslySetInnerHTML={{ __html: question.promptHtml }}
              />
            </legend>
            <p className="quiz-hint">
              {question.isMultiAnswer ? t('quiz.chooseAll') : t('quiz.chooseOne')}
            </p>
            {graded && (
              <p className="quiz-verdict">
                {wrong ? t('quiz.wrong') : t('quiz.correct')}
              </p>
            )}
            <ul className="quiz-options">
              {question.options.map((option) => (
                <li key={String(option.optionId)}>
                  <label>
                    <input
                      type={question.isMultiAnswer ? 'checkbox' : 'radio'}
                      name={`question-${String(question.questionId)}`}
                      checked={chosen.has(option.optionId)}
                      onChange={() =>
                        setSelections((s) => toggle(s, question, option.optionId))
                      }
                    />
                    <span dangerouslySetInnerHTML={{ __html: option.textHtml }} />
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}

      <button type="submit">{t('quiz.submit')}</button>
    </form>
  );
}
