import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { aBlock, aChapter } from '../test/factories';
import { ChapterView } from './ChapterView';
import type { QuizView } from './quizModel';

function renderView(props: Partial<Parameters<typeof ChapterView>[0]> = {}) {
  const onComplete = vi.fn();
  const onSubmitQuiz = vi.fn();
  const onBack = vi.fn();
  render(
    <ChapterView
      chapter={aChapter({ title: 'Strange Attractors' })}
      blocks={[aBlock()]}
      completedBlockIds={new Set()}
      onComplete={onComplete}
      quizzes={new Map()}
      onSubmitQuiz={onSubmitQuiz}
      onBack={onBack}
      {...props}
    />,
  );
  return { onComplete, onSubmitQuiz, onBack };
}

const A_QUIZ: QuizView = {
  blockId: 100n,
  passThreshold: 100,
  questions: [
    {
      questionId: 200n,
      promptHtml: '<p>Who decides?</p>',
      isMultiAnswer: false,
      options: [{ optionId: 300n, textHtml: 'The server' }],
    },
  ],
};

describe('ChapterView', () => {
  it('shows the chapter title and description', () => {
    renderView();
    expect(
      screen.getByRole('heading', { name: 'Strange Attractors' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Chapter description')).toBeInTheDocument();
  });

  it('renders blocks in reading order', () => {
    renderView({
      blocks: [
        aBlock({ blockId: 1n, title: 'Third', position: 2 }),
        aBlock({ blockId: 2n, title: 'First', position: 0 }),
        aBlock({ blockId: 3n, title: 'Second', position: 1 }),
      ],
    });
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['First', 'Second', 'Third']);
  });

  it('renders the sanitized block HTML as markup, not as text', () => {
    renderView({
      blocks: [aBlock({ bodyHtml: '<p>Lorenz <em>system</em></p>' })],
    });
    expect(screen.getByText('system').tagName).toBe('EM');
  });

  it('completes a block when the button is pressed', async () => {
    const { onComplete } = renderView({ blocks: [aBlock({ blockId: 77n })] });
    await userEvent.click(screen.getByRole('button', { name: /mark as complete/i }));
    expect(onComplete).toHaveBeenCalledWith(77n);
  });

  it('offers no button for a block already completed', () => {
    renderView({
      blocks: [aBlock({ blockId: 77n })],
      completedBlockIds: new Set([77n]),
    });
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('links out from a resource block only', () => {
    renderView({
      blocks: [
        aBlock({
          blockId: 1n,
          blockType: { tag: 'ResourceLink' },
          url: 'https://example.com',
        }),
        aBlock({ blockId: 2n, position: 1 }),
      ],
    });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com');
  });

  it('marks an optional chapter as optional', () => {
    renderView({ chapter: aChapter({ isOptional: true }) });
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it('says a chapter with no blocks is empty', () => {
    renderView({ blocks: [] });
    expect(screen.getByText(/no blocks/i)).toBeInTheDocument();
  });

  it('surfaces a rejection from the server as an alert', () => {
    renderView({ error: { kind: 'complete', reason: 'Chapter is blocked' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Chapter is blocked');
    expect(screen.getByRole('alert')).toHaveTextContent(/mark that complete/i);
  });

  it('does not describe a refused submission as a failed completion', () => {
    renderView({ error: { kind: 'submit', reason: 'This quiz has no questions.' } });
    expect(screen.getByRole('alert')).toHaveTextContent('This quiz has no questions.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/mark that complete/i);
  });

  it('offers no "Mark as complete" on a quiz block, and shows the quiz instead', async () => {
    // Not merely ineffective: `complete_block` refuses a Quiz block (M10.3), so
    // the button would be a control the server always rejects.
    const { onSubmitQuiz } = renderView({
      blocks: [aBlock({ blockId: 100n, blockType: { tag: 'Quiz' } })],
      quizzes: new Map([[100n, A_QUIZ]]),
    });
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'The server' }));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmitQuiz).toHaveBeenCalledWith(100n, [
      { questionId: 200n, selectedOptionIds: [300n] },
    ]);
  });

  it('keeps the quiz on screen after it has been passed, and still offers no button', () => {
    // Completion is shown, but retakes are unlimited in v0.2 — the quiz stays.
    renderView({
      blocks: [aBlock({ blockId: 100n, blockType: { tag: 'Quiz' } })],
      quizzes: new Map([[100n, A_QUIZ]]),
      completedBlockIds: new Set([100n]),
    });
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('says a quiz block with no quiz configured has not been written yet', () => {
    renderView({
      blocks: [aBlock({ blockId: 100n, blockType: { tag: 'Quiz' } })],
      quizzes: new Map(),
    });
    expect(screen.getByText(/has not been written yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mark as complete/i }),
    ).not.toBeInTheDocument();
  });

  it('goes back to the book', async () => {
    const { onBack } = renderView();
    await userEvent.click(screen.getByRole('button', { name: /back to the book/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
