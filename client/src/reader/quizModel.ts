import type { Identity } from 'spacetimedb';
import type {
  QuizAttempt,
  QuizAttemptResult,
  QuizConfig,
  QuizOption,
  QuizQuestion,
} from '../module_bindings/types';

/**
 * The reader's view of one quiz, assembled from the five public quiz tables.
 *
 * Everything here is display shaping. Correctness is not in it and cannot be: the
 * answer key is a non-public table, so `is_multi_answer` — how many answers to
 * select, never which — is the only fact about it the client is given, and it is
 * here because a radio group and a checkbox group are different controls.
 *
 * Feedback is read back out of `quiz_attempt_results`, which the grading reducer
 * writes. A question is only "wrong" if the attempt actually graded it; a question
 * the author added after the attempt has no result row, and calling that wrong
 * would be inventing a verdict the server never reached.
 */

export type QuizOptionView = {
  readonly optionId: bigint;
  readonly textHtml: string;
};

export type QuizQuestionView = {
  readonly questionId: bigint;
  readonly promptHtml: string;
  readonly isMultiAnswer: boolean;
  readonly options: readonly QuizOptionView[];
};

export type QuizAttemptView = {
  readonly attemptId: bigint;
  readonly scorePercent: number;
  readonly passed: boolean;
  /** Questions this attempt was graded on — everything else has no verdict. */
  readonly gradedQuestionIds: ReadonlySet<bigint>;
  readonly correctQuestionIds: ReadonlySet<bigint>;
};

export type QuizView = {
  readonly blockId: bigint;
  readonly passThreshold: number;
  readonly questions: readonly QuizQuestionView[];
  /** The reader's most recent attempt, if they have made one. */
  readonly latestAttempt?: QuizAttemptView;
};

/** One question's selections, in the shape `submit_quiz` takes. */
export type QuizAnswer = {
  readonly questionId: bigint;
  readonly selectedOptionIds: bigint[];
};

export type QuizTables = {
  readonly configs: readonly QuizConfig[];
  readonly questions: readonly QuizQuestion[];
  readonly options: readonly QuizOption[];
  readonly attempts: readonly QuizAttempt[];
  readonly results: readonly QuizAttemptResult[];
};

/** Author order, with the id as a stable tie-break — the same rule as `blockOrder`. */
function byPosition<T extends { position: number }>(
  rows: readonly T[],
  id: (row: T) => bigint,
) {
  return [...rows].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return id(a) < id(b) ? -1 : 1;
  });
}

/**
 * The quiz on a block, or `undefined` if nobody has written one.
 *
 * The absent case is normal rather than exceptional: an author sets a block's type
 * before writing its questions, and `submit_quiz` refuses that state outright. The
 * reader has to be told so rather than shown an empty form that the server would
 * reject.
 */
export function buildQuiz(
  blockId: bigint,
  tables: QuizTables,
  identity: Identity | undefined,
): QuizView | undefined {
  const config = tables.configs.find((c) => c.blockId === blockId);
  if (!config) return undefined;

  const questions = byPosition(
    tables.questions.filter((q) => q.blockId === blockId),
    (q) => q.questionId,
  ).map((question) => ({
    questionId: question.questionId,
    promptHtml: question.promptHtml,
    isMultiAnswer: question.isMultiAnswer,
    options: byPosition(
      tables.options.filter((o) => o.questionId === question.questionId),
      (o) => o.optionId,
    ).map((option) => ({ optionId: option.optionId, textHtml: option.textHtml })),
  }));

  return {
    blockId,
    passThreshold: config.passThreshold,
    questions,
    latestAttempt: latestAttempt(blockId, tables, identity),
  };
}

/**
 * `quiz_attempts` is public and holds every reader's rows, so it is filtered to this
 * identity here — display scoping, not access control.
 *
 * "Latest" is the highest attempt id rather than the newest timestamp: ids are
 * assigned by `#[auto_inc]` in submission order, and two attempts can share a
 * timestamp where they cannot share an id.
 */
function latestAttempt(
  blockId: bigint,
  tables: QuizTables,
  identity: Identity | undefined,
): QuizAttemptView | undefined {
  if (!identity) return undefined;
  const mine = tables.attempts.filter(
    (a) => a.blockId === blockId && a.identity.isEqual(identity),
  );
  if (mine.length === 0) return undefined;
  const latest = mine.reduce((best, a) => (a.attemptId > best.attemptId ? a : best));

  const graded = tables.results.filter((r) => r.attemptId === latest.attemptId);
  return {
    attemptId: latest.attemptId,
    scorePercent: latest.scorePercent,
    passed: latest.passed,
    gradedQuestionIds: new Set(graded.map((r) => r.questionId)),
    correctQuestionIds: new Set(
      graded.filter((r) => r.isCorrect).map((r) => r.questionId),
    ),
  };
}

/** Whether the attempt says this question was answered wrongly. */
export function wasWrong(attempt: QuizAttemptView, questionId: bigint): boolean {
  return (
    attempt.gradedQuestionIds.has(questionId) &&
    !attempt.correctQuestionIds.has(questionId)
  );
}

/**
 * Selections as `submit_quiz` wants them.
 *
 * Every question is sent, including the ones left blank. An absent question grades
 * as wrong on the server either way, but sending it keeps the attempt's result rows
 * covering the whole quiz — otherwise a skipped question would come back with no
 * verdict and be displayed as neither right nor wrong.
 */
export function answersFrom(
  questions: readonly QuizQuestionView[],
  selections: ReadonlyMap<bigint, ReadonlySet<bigint>>,
): QuizAnswer[] {
  return questions.map((question) => ({
    questionId: question.questionId,
    selectedOptionIds: question.options
      .map((o) => o.optionId)
      .filter((id) => selections.get(question.questionId)?.has(id) ?? false),
  }));
}
