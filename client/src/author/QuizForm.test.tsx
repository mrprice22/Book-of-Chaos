import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuizForm } from './QuizForm';

function renderForm(props: Partial<Parameters<typeof QuizForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <QuizForm
      blockId={100n}
      existingQuestionCount={0}
      onSubmit={onSubmit}
      pending={false}
      error={undefined}
      {...props}
    />,
  );
  return { onSubmit };
}

/** The controls of one question, found by the number the server's errors use. */
function question(n: number) {
  return within(screen.getByRole('group', { name: `Question ${String(n)}` }));
}

async function writeQuestion(n: number, prompt: string, answers: string[]) {
  const q = question(n);
  await userEvent.type(q.getByLabelText('Question'), prompt);
  for (const [index, answer] of answers.entries()) {
    await userEvent.type(q.getByLabelText(`Answer ${String(index + 1)}`), answer);
  }
}

describe('QuizForm', () => {
  it('starts with one question and the two options the server demands', () => {
    renderForm();
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(question(1).getAllByRole('textbox')).toHaveLength(3); // prompt + two answers
  });

  it('submits a quiz with the correct answers marked', async () => {
    const { onSubmit } = renderForm();
    await userEvent.clear(screen.getByLabelText(/pass mark/i));
    await userEvent.type(screen.getByLabelText(/pass mark/i), '80');
    await writeQuestion(1, 'Who grades?', ['The server', 'The client']);
    await userEvent.click(question(1).getByLabelText('Answer 1 is correct'));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiz' }));

    expect(onSubmit).toHaveBeenCalledWith({
      passThreshold: 80,
      questions: [
        {
          promptHtml: 'Who grades?',
          options: [
            { textHtml: 'The server', isCorrect: true },
            { textHtml: 'The client', isCorrect: false },
          ],
        },
      ],
    });
  });

  it('marks more than one answer correct, which is what makes a question multi-answer', async () => {
    // `set_quiz` derives `is_multi_answer` from the key rather than accepting it,
    // so this checkbox pair is the whole of the author's control over it.
    const { onSubmit } = renderForm();
    await writeQuestion(1, 'Which are public?', ['Questions', 'Options']);
    await userEvent.click(question(1).getByLabelText('Answer 1 is correct'));
    await userEvent.click(question(1).getByLabelText('Answer 2 is correct'));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiz' }));

    const draft = onSubmit.mock.calls[0]?.[0] as { questions: { options: unknown[] }[] };
    expect(draft.questions[0]?.options).toEqual([
      { textHtml: 'Questions', isCorrect: true },
      { textHtml: 'Options', isCorrect: true },
    ]);
  });

  it('adds and removes questions, renumbering what is left', async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    await writeQuestion(1, 'First', ['a', 'b']);
    await writeQuestion(2, 'Second', ['c', 'd']);
    expect(screen.getAllByRole('group')).toHaveLength(2);

    // Removing the first must leave the second as question 1, or the number in
    // "Question 2 has no correct answer marked" points at nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Remove question 1' }));
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(question(1).getByLabelText('Question')).toHaveValue('Second');

    await userEvent.click(screen.getByRole('button', { name: 'Save quiz' }));
    const draft = onSubmit.mock.calls[0]?.[0] as { questions: { promptHtml: string }[] };
    expect(draft.questions.map((q) => q.promptHtml)).toEqual(['Second']);
  });

  it('adds and removes answer options', async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add an answer to question 1' }),
    );
    await writeQuestion(1, 'Three answers', ['a', 'b', 'c']);
    await userEvent.click(question(1).getByRole('button', { name: 'Remove answer 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiz' }));

    const draft = onSubmit.mock.calls[0]?.[0] as {
      questions: { options: { textHtml: string }[] }[];
    };
    expect(draft.questions[0]?.options.map((o) => o.textHtml)).toEqual(['a', 'c']);
  });

  it('sends a quiz the server will reject rather than pre-judging it here', async () => {
    // No client-side validation: `rules::validate_quiz` is the trust boundary, and a
    // second copy of its rules in the browser would disagree with it eventually.
    const { onSubmit } = renderForm();
    await userEvent.clear(screen.getByLabelText(/pass mark/i));
    await userEvent.click(screen.getByRole('button', { name: 'Remove question 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiz' }));
    expect(onSubmit).toHaveBeenCalledWith({ passThreshold: 0, questions: [] });
  });

  it('shows the server’s rejection verbatim, numbers and all', async () => {
    renderForm({ error: 'Question 2 has no correct answer marked.' });
    // The number has to mean something: the form labels its questions the same way.
    await userEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Question 2 has no correct answer marked.',
    );
    expect(screen.getByRole('group', { name: 'Question 2' })).toBeInTheDocument();
  });

  it('warns that saving replaces a quiz that already exists', () => {
    renderForm({ existingQuestionCount: 3 });
    expect(screen.getByText(/replaces the quiz/i)).toBeInTheDocument();
  });

  it('says nothing about replacing when the block has no quiz yet', () => {
    renderForm();
    expect(screen.queryByText(/replaces the quiz/i)).not.toBeInTheDocument();
  });

  it('cannot be submitted twice while the first call is in flight', () => {
    renderForm({ pending: true });
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  it('gives each block’s form its own field ids', () => {
    render(
      <>
        <QuizForm
          blockId={1n}
          existingQuestionCount={0}
          onSubmit={vi.fn()}
          pending={false}
          error={undefined}
        />
        <QuizForm
          blockId={2n}
          existingQuestionCount={0}
          onSubmit={vi.fn()}
          pending={false}
          error={undefined}
        />
      </>,
    );
    const ids = screen.getAllByLabelText(/pass mark/i).map((input) => input.id);
    expect(new Set(ids).size).toBe(2);
  });
});
