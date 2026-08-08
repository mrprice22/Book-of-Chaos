import { Identity } from 'spacetimedb';
import { aQuestion, aQuizConfig, aResult, anAttempt, anOption } from '../test/factories';
import { answersFrom, buildQuiz, wasWrong } from './quizModel';
import type { QuizTables } from './quizModel';

const ME = Identity.zero();
const SOMEONE_ELSE = new Identity(7n);

const EMPTY: QuizTables = {
  configs: [],
  questions: [],
  options: [],
  attempts: [],
  results: [],
};

function tables(overrides: Partial<QuizTables> = {}): QuizTables {
  return { ...EMPTY, ...overrides };
}

/** One two-question quiz on block 100: single-answer, then multi-answer. */
function aQuizOnBlock100(overrides: Partial<QuizTables> = {}): QuizTables {
  return tables({
    configs: [aQuizConfig({ blockId: 100n, passThreshold: 100 })],
    questions: [
      aQuestion({ questionId: 200n, position: 0 }),
      aQuestion({ questionId: 201n, position: 1, isMultiAnswer: true }),
    ],
    options: [
      anOption({ optionId: 300n, questionId: 200n, textHtml: 'A', position: 0 }),
      anOption({ optionId: 301n, questionId: 200n, textHtml: 'B', position: 1 }),
      anOption({ optionId: 310n, questionId: 201n, textHtml: 'C', position: 0 }),
      anOption({ optionId: 311n, questionId: 201n, textHtml: 'D', position: 1 }),
    ],
    ...overrides,
  });
}

describe('buildQuiz', () => {
  it('has no quiz for a block with no config row', () => {
    // The normal transient state: the author set the block type before writing
    // the questions, and `submit_quiz` refuses it.
    expect(buildQuiz(100n, EMPTY, ME)).toBeUndefined();
  });

  it('assembles questions and options in author order', () => {
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        questions: [
          aQuestion({ questionId: 201n, position: 1, promptHtml: 'second' }),
          aQuestion({ questionId: 200n, position: 0, promptHtml: 'first' }),
        ],
        options: [
          anOption({ optionId: 301n, questionId: 200n, textHtml: 'B', position: 1 }),
          anOption({ optionId: 300n, questionId: 200n, textHtml: 'A', position: 0 }),
        ],
      }),
      ME,
    );
    expect(quiz?.questions.map((q) => q.promptHtml)).toEqual(['first', 'second']);
    expect(quiz?.questions[0]?.options.map((o) => o.textHtml)).toEqual(['A', 'B']);
  });

  it('carries the pass threshold and the multi-answer flag', () => {
    const quiz = buildQuiz(100n, aQuizOnBlock100(), ME);
    expect(quiz?.passThreshold).toBe(100);
    expect(quiz?.questions.map((q) => q.isMultiAnswer)).toEqual([false, true]);
  });

  it('takes only the blocks own questions', () => {
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        questions: [
          aQuestion({ questionId: 200n }),
          aQuestion({ questionId: 900n, blockId: 999n, promptHtml: 'another quiz' }),
        ],
      }),
      ME,
    );
    expect(quiz?.questions).toHaveLength(1);
  });

  it('has no attempt before the reader has submitted one', () => {
    expect(buildQuiz(100n, aQuizOnBlock100(), ME)?.latestAttempt).toBeUndefined();
  });

  it('reports the reader’s most recent attempt, by id rather than arrival order', () => {
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        attempts: [
          anAttempt({ attemptId: 402n, identity: ME, scorePercent: 50 }),
          anAttempt({ attemptId: 401n, identity: ME, scorePercent: 100, passed: true }),
        ],
      }),
      ME,
    );
    expect(quiz?.latestAttempt?.attemptId).toBe(402n);
    expect(quiz?.latestAttempt?.scorePercent).toBe(50);
    expect(quiz?.latestAttempt?.passed).toBe(false);
  });

  it('ignores another reader’s attempts on the same block', () => {
    // `quiz_attempts` is public and holds everyone's rows. Showing another
    // reader's score as this reader's would be wrong in both directions.
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        attempts: [
          anAttempt({
            attemptId: 999n,
            identity: SOMEONE_ELSE,
            scorePercent: 100,
            passed: true,
          }),
        ],
      }),
      ME,
    );
    expect(quiz?.latestAttempt).toBeUndefined();
  });

  it('ignores an attempt on a different block', () => {
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        attempts: [anAttempt({ attemptId: 999n, identity: ME, blockId: 101n })],
      }),
      ME,
    );
    expect(quiz?.latestAttempt).toBeUndefined();
  });

  it('reads per-question verdicts from the latest attempt only', () => {
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        attempts: [
          anAttempt({ attemptId: 400n, identity: ME, scorePercent: 100, passed: true }),
          anAttempt({ attemptId: 401n, identity: ME, scorePercent: 50 }),
        ],
        results: [
          // The older attempt got both right; the newer one only the first.
          aResult({ resultId: 1n, attemptId: 400n, questionId: 200n, isCorrect: true }),
          aResult({ resultId: 2n, attemptId: 400n, questionId: 201n, isCorrect: true }),
          aResult({ resultId: 3n, attemptId: 401n, questionId: 200n, isCorrect: true }),
          aResult({ resultId: 4n, attemptId: 401n, questionId: 201n, isCorrect: false }),
        ],
      }),
      ME,
    );
    const attempt = quiz?.latestAttempt;
    if (!attempt) throw new Error('expected an attempt');
    expect(wasWrong(attempt, 200n)).toBe(false);
    expect(wasWrong(attempt, 201n)).toBe(true);
  });

  it('calls a question the attempt never graded neither right nor wrong', () => {
    // An author can add a question after the reader's last attempt. There is no
    // verdict for it, and inventing one would be a lie in whichever direction.
    const quiz = buildQuiz(
      100n,
      aQuizOnBlock100({
        attempts: [anAttempt({ attemptId: 400n, identity: ME })],
        results: [aResult({ attemptId: 400n, questionId: 200n, isCorrect: true })],
      }),
      ME,
    );
    const attempt = quiz?.latestAttempt;
    if (!attempt) throw new Error('expected an attempt');
    expect(attempt.gradedQuestionIds.has(201n)).toBe(false);
    expect(wasWrong(attempt, 201n)).toBe(false);
  });
});

describe('answersFrom', () => {
  const questions = buildQuiz(100n, aQuizOnBlock100(), ME)?.questions ?? [];

  it('sends every question, including the ones left blank', () => {
    // A skipped question grades as wrong either way, but sending it is what gets
    // it a result row — and so a visible verdict — instead of silence.
    expect(answersFrom(questions, new Map([[200n, new Set([300n])]]))).toEqual([
      { questionId: 200n, selectedOptionIds: [300n] },
      { questionId: 201n, selectedOptionIds: [] },
    ]);
  });

  it('sends the selected options in author order', () => {
    const answers = answersFrom(questions, new Map([[201n, new Set([311n, 310n])]]));
    expect(answers[1]?.selectedOptionIds).toEqual([310n, 311n]);
  });

  it('drops a selection whose option no longer belongs to the question', () => {
    // The author can rewrite a quiz while the reader has it open. Submitting an
    // option from somewhere else is refused outright by `grade_quiz`, so the
    // whole submission would fail rather than that one question.
    const answers = answersFrom(questions, new Map([[200n, new Set([300n, 999n])]]));
    expect(answers[0]?.selectedOptionIds).toEqual([300n]);
  });
});
