import { useState } from 'react';
import { t } from '../i18n';
import { ErrorMessage } from './Fields';

export type OptionDraft = { textHtml: string; isCorrect: boolean };
export type QuestionDraft = { promptHtml: string; options: OptionDraft[] };
export type QuizDraft = { passThreshold: number; questions: QuestionDraft[] };

/** The minimum `rules::validate_quiz` accepts, so a fresh question starts legal. */
const OPTIONS_MIN = 2;

function blankQuestion(): QuestionDraft {
  return {
    promptHtml: '',
    options: Array.from({ length: OPTIONS_MIN }, () => ({
      textHtml: '',
      isCorrect: false,
    })),
  };
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return items.map((existing, i) => (i === index ? item : existing));
}

/**
 * Write the quiz on a `Quiz` block.
 *
 * `set_quiz` replaces the whole quiz rather than patching it, and this form is
 * shaped to match: it always composes a complete quiz. That is not laziness — the
 * answer key lives in a non-public table, so **not even the author's client can
 * read back which options are correct**. A form that pre-filled the prompts from
 * the stored rows would look like an edit while silently dropping the marks, so it
 * starts blank and says so when there is something to replace.
 *
 * Nothing here duplicates `rules::validate_quiz`. Every rejection it can produce
 * names the offending question by its 1-based position, so each question carries
 * that number as a visible heading — otherwise "Question 3 has no correct answer
 * marked" is a message about a question the author cannot find.
 */
export function QuizForm({
  blockId,
  existingQuestionCount,
  onSubmit,
  pending,
  error,
}: {
  blockId: bigint;
  /** How many questions the block's stored quiz has; 0 when it has none. */
  existingQuestionCount: number;
  onSubmit: (draft: QuizDraft) => void;
  pending: boolean;
  error: string | undefined;
}) {
  const [passThreshold, setPassThreshold] = useState('100');
  const [questions, setQuestions] = useState<readonly QuestionDraft[]>([blankQuestion()]);

  const field = (name: string) => `quiz-${blockId}-${name}`;

  const updateQuestion = (index: number, question: QuestionDraft) =>
    setQuestions((current) => replaceAt(current, index, question));

  return (
    <form
      className="author-form"
      onSubmit={(e) => {
        e.preventDefault();
        // Sent as typed, including a blank threshold: the reducer is the validator
        // and its message is the one the author should read.
        onSubmit({
          passThreshold: Number.parseInt(passThreshold, 10) || 0,
          questions: questions.map((q) => ({ ...q, options: [...q.options] })),
        });
      }}
    >
      <h5>{t('author.quiz')}</h5>
      {existingQuestionCount > 0 && (
        <p className="author-status">{t('author.quizReplaces')}</p>
      )}

      <p className="field">
        <label htmlFor={field('threshold')}>{t('field.passThreshold')}</label>
        <input
          id={field('threshold')}
          type="number"
          min={1}
          max={100}
          value={passThreshold}
          onChange={(e) => setPassThreshold(e.target.value)}
        />
      </p>

      <ol className="quiz-questions">
        {questions.map((question, questionIndex) => {
          const number = questionIndex + 1;
          return (
            <li key={questionIndex}>
              <fieldset>
                {/* The number the server's rejections refer to. */}
                <legend>{t('author.quizQuestion', { n: number })}</legend>
                <p className="field">
                  <label htmlFor={field(`prompt-${String(questionIndex)}`)}>
                    {t('field.prompt')}
                  </label>
                  <textarea
                    id={field(`prompt-${String(questionIndex)}`)}
                    rows={2}
                    value={question.promptHtml}
                    onChange={(e) =>
                      updateQuestion(questionIndex, {
                        ...question,
                        promptHtml: e.target.value,
                      })
                    }
                  />
                </p>

                <ul className="quiz-option-drafts">
                  {question.options.map((option, optionIndex) => {
                    const optionId = field(
                      `option-${String(questionIndex)}-${String(optionIndex)}`,
                    );
                    return (
                      <li key={optionIndex}>
                        <label htmlFor={optionId}>
                          {t('field.optionText', { n: optionIndex + 1 })}
                        </label>
                        <input
                          id={optionId}
                          type="text"
                          value={option.textHtml}
                          onChange={(e) =>
                            updateQuestion(questionIndex, {
                              ...question,
                              options: replaceAt(question.options, optionIndex, {
                                ...option,
                                textHtml: e.target.value,
                              }),
                            })
                          }
                        />
                        <input
                          id={`${optionId}-correct`}
                          type="checkbox"
                          checked={option.isCorrect}
                          onChange={(e) =>
                            updateQuestion(questionIndex, {
                              ...question,
                              options: replaceAt(question.options, optionIndex, {
                                ...option,
                                isCorrect: e.target.checked,
                              }),
                            })
                          }
                        />
                        <label htmlFor={`${optionId}-correct`}>
                          {t('field.correct', { n: optionIndex + 1 })}
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            updateQuestion(questionIndex, {
                              ...question,
                              options: question.options.filter(
                                (_, i) => i !== optionIndex,
                              ),
                            })
                          }
                        >
                          {t('author.removeOption', { n: optionIndex + 1 })}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <button
                  type="button"
                  onClick={() =>
                    updateQuestion(questionIndex, {
                      ...question,
                      options: [...question.options, { textHtml: '', isCorrect: false }],
                    })
                  }
                >
                  {t('author.addOption', { n: number })}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setQuestions((current) =>
                      current.filter((_, i) => i !== questionIndex),
                    )
                  }
                >
                  {t('author.removeQuestion', { n: number })}
                </button>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => setQuestions((current) => [...current, blankQuestion()])}
      >
        {t('author.addQuestion')}
      </button>

      <ErrorMessage error={error} />
      <button type="submit" disabled={pending}>
        {pending ? t('action.saving') : t('action.saveQuiz')}
      </button>
    </form>
  );
}
