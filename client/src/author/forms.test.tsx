import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockForm } from './BlockForm';
import { BookForm } from './BookForm';
import { ChapterForm } from './ChapterForm';

describe('BookForm', () => {
  it('submits what was typed', async () => {
    const onSubmit = vi.fn();
    render(<BookForm onSubmit={onSubmit} pending={false} error={undefined} />);

    await userEvent.type(screen.getByLabelText('Title'), 'Chaos');
    await userEvent.type(screen.getByLabelText('Description'), 'Order, eventually.');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Chaos',
      description: 'Order, eventually.',
    });
  });

  it('clears itself so the next book does not inherit the last one', async () => {
    render(<BookForm onSubmit={vi.fn()} pending={false} error={undefined} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Chaos');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
  });

  it('cannot be submitted twice while the first call is in flight', () => {
    render(<BookForm onSubmit={vi.fn()} pending error={undefined} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows the server’s rejection verbatim', () => {
    render(<BookForm onSubmit={vi.fn()} pending={false} error="Title cannot be empty" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Title cannot be empty');
  });
});

describe('ChapterForm', () => {
  it('submits the author’s flags', async () => {
    const onSubmit = vi.fn();
    render(<ChapterForm onSubmit={onSubmit} pending={false} error={undefined} />);

    await userEvent.type(screen.getByLabelText('Title'), 'Glossary');
    await userEvent.click(screen.getByLabelText('Optional'));
    await userEvent.click(screen.getByLabelText('Pinned'));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Glossary',
      description: '',
      isOptional: true,
      isPinned: true,
    });
  });

  it('defaults both flags off', async () => {
    const onSubmit = vi.fn();
    render(<ChapterForm onSubmit={onSubmit} pending={false} error={undefined} />);
    await userEvent.type(screen.getByLabelText('Title'), 'One');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ isOptional: false, isPinned: false }),
    );
  });
});

describe('BlockForm', () => {
  it('sends no url for a Reading block, which the reducer would reject', async () => {
    const onSubmit = vi.fn();
    render(
      <BlockForm chapterId={10n} onSubmit={onSubmit} pending={false} error={undefined} />,
    );

    await userEvent.type(screen.getByLabelText('Title'), 'Intro');
    await userEvent.type(screen.getByLabelText('Body'), '<p>hello</p>');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Intro',
      blockType: { tag: 'Reading' },
      bodyHtml: '<p>hello</p>',
      url: undefined,
      isOptional: false,
    });
  });

  it('asks for a link only once the type needs one', async () => {
    render(
      <BlockForm chapterId={10n} onSubmit={vi.fn()} pending={false} error={undefined} />,
    );
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ResourceLink');
    expect(screen.getByLabelText('Link')).toBeInTheDocument();
  });

  it('sends the url for a ResourceLink', async () => {
    const onSubmit = vi.fn();
    render(
      <BlockForm chapterId={10n} onSubmit={onSubmit} pending={false} error={undefined} />,
    );

    await userEvent.type(screen.getByLabelText('Title'), 'Paper');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ResourceLink');
    await userEvent.type(screen.getByLabelText('Link'), 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        blockType: { tag: 'ResourceLink' },
        url: 'https://example.com',
      }),
    );
  });

  it('gives each chapter’s form its own field ids', () => {
    const { unmount } = render(
      <BlockForm chapterId={10n} onSubmit={vi.fn()} pending={false} error={undefined} />,
    );
    const first = screen.getByLabelText('Title').id;
    unmount();

    render(
      <BlockForm chapterId={11n} onSubmit={vi.fn()} pending={false} error={undefined} />,
    );
    expect(screen.getByLabelText('Title').id).not.toBe(first);
  });
});
