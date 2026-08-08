import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuizBlock } from './QuizBlock';
import type { QuizAttemptView, QuizView } from './quizModel';

/** Two questions: one single-answer, one multi-answer. */
function aQuizView(overrides: Partial<QuizView> = {}): QuizView {
  return {
    blockId: 100n,
    passThreshold: 100,
    questions: [
      {
        questionId: 200n,
        promptHtml: '<p>Who decides?</p>',
        isMultiAnswer: false,
        options: [
          { optionId: 300n, textHtml: 'The server' },
          { optionId: 301n, textHtml: 'The client' },
        ],
      },
      {
        questionId: 201n,
        promptHtml: '<p>Which are public?</p>',
        isMultiAnswer: true,
        options: [
          { optionId: 310n, textHtml: 'Questions' },
          { optionId: 311n, textHtml: 'Options' },
          { optionId: 312n, textHtml: 'The answer key' },
        ],
      },
    ],
    ...overrides,
  };
}

function anAttemptView(overrides: Partial<QuizAttemptView> = {}): QuizAttemptView {
  return {
    attemptId: 400n,
    scorePercent: 50,
    passed: false,
    gradedQuestionIds: new Set([200n, 201n]),
    correctQuestionIds: new Set([200n]),
    ...overrides,
  };
}

// No default parameter: `renderQuiz(undefined)` is the unwritten-quiz case, and a
// default would silently turn it back into the written one.
function renderQuiz(quiz: QuizView | undefined) {
  const onSubmit = vi.fn();
  render(<QuizBlock quiz={quiz} onSubmit={onSubmit} />);
  return { onSubmit };
}

describe('QuizBlock', () => {
  it('says so when nobody has written the quiz yet, and offers no way to submit', () => {
    renderQuiz(undefined);
    expect(screen.getByText(/has not been written yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the prompt as sanitized markup, not as text', () => {
    renderQuiz(
      aQuizView({
        questions: [
          {
            questionId: 200n,
            promptHtml: '<p>Who <em>decides</em>?</p>',
            isMultiAnswer: false,
            options: [{ optionId: 300n, textHtml: 'The server' }],
          },
        ],
      }),
    );
    expect(screen.getByText('decides').tagName).toBe('EM');
  });

  it('gives a single-answer question radios and a multi-answer one checkboxes', () => {
    // The only fact about the answer key the client is given, and this is what it
    // is for: how many answers to select, never which.
    renderQuiz(aQuizView());
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('shows the pass mark', () => {
    renderQuiz(aQuizView({ passThreshold: 80 }));
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('replaces the selection on a single-answer question', async () => {
    const { onSubmit } = renderQuiz(aQuizView());
    await userEvent.click(screen.getByRole('radio', { name: 'The server' }));
    await userEvent.click(screen.getByRole('radio', { name: 'The client' }));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith(100n, [
      { questionId: 200n, selectedOptionIds: [301n] },
      { questionId: 201n, selectedOptionIds: [] },
    ]);
  });

  it('accumulates selections on a multi-answer question, and unticks them', async () => {
    const { onSubmit } = renderQuiz(aQuizView());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Questions' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'The answer key' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'The answer key' }));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith(100n, [
      { questionId: 200n, selectedOptionIds: [] },
      { questionId: 201n, selectedOptionIds: [310n, 311n] },
    ]);
  });

  it('submits an empty answer sheet rather than nothing at all', async () => {
    // The server grades a skipped question as wrong. Refusing to send it here
    // would be the client deciding, which is the thing this release removes.
    const { onSubmit } = renderQuiz(aQuizView());
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith(100n, [
      { questionId: 200n, selectedOptionIds: [] },
      { questionId: 201n, selectedOptionIds: [] },
    ]);
  });

  it('shows no score before the reader has attempted the quiz', () => {
    renderQuiz(aQuizView());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the score and which question was wrong after a failing attempt', () => {
    renderQuiz(aQuizView({ latestAttempt: anAttemptView() }));
    expect(screen.getByRole('status')).toHaveTextContent('50%');
    expect(screen.getByRole('status')).toHaveTextContent(/not passed/i);
    expect(screen.getByText(/got this one right/i)).toBeInTheDocument();
    expect(screen.getByText(/got this one wrong/i)).toBeInTheDocument();
  });

  it('says a passing attempt passed', () => {
    renderQuiz(
      aQuizView({
        latestAttempt: anAttemptView({
          scorePercent: 100,
          passed: true,
          correctQuestionIds: new Set([200n, 201n]),
        }),
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/passed/i);
    expect(screen.queryByText(/got this one wrong/i)).not.toBeInTheDocument();
  });

  it('leaves an ungraded question unmarked', () => {
    renderQuiz(
      aQuizView({
        latestAttempt: anAttemptView({
          gradedQuestionIds: new Set([200n]),
          correctQuestionIds: new Set([200n]),
        }),
      }),
    );
    expect(screen.queryByText(/got this one wrong/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/got this one right/i)).toHaveLength(1);
  });

  it('invites a retry after a failing attempt', () => {
    renderQuiz(aQuizView({ latestAttempt: anAttemptView() }));
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });

  it('keeps the form usable after a passing attempt, because retakes are unlimited', () => {
    // Relabelled rather than removed: a pass is not undone by a later failure, so
    // going again costs the reader nothing, and the button should not imply it does.
    renderQuiz(
      aQuizView({ latestAttempt: anAttemptView({ scorePercent: 100, passed: true }) }),
    );
    expect(screen.getByRole('button', { name: /take it again/i })).toBeEnabled();
  });
});
