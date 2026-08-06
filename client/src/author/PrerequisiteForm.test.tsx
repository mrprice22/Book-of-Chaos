import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { aChapter } from '../test/factories';
import { PrerequisiteForm } from './PrerequisiteForm';

const CHAPTER = aChapter({ chapterId: 10n, title: 'Third' });
const SIBLINGS = [
  aChapter({ chapterId: 8n, title: 'First' }),
  aChapter({ chapterId: 9n, title: 'Second' }),
  CHAPTER,
];

function renderForm(over: Partial<Parameters<typeof PrerequisiteForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <PrerequisiteForm
      chapter={CHAPTER}
      candidates={SIBLINGS}
      selected={new Set()}
      onSubmit={onSubmit}
      pending={false}
      error={undefined}
      {...over}
    />,
  );
  return { onSubmit };
}

describe('PrerequisiteForm', () => {
  it('does not offer the chapter as its own prerequisite', () => {
    renderForm();
    expect(screen.getByLabelText('First')).toBeInTheDocument();
    expect(screen.queryByLabelText('Third')).not.toBeInTheDocument();
  });

  it('submits several prerequisites in one call, not one per tick', async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(screen.getByLabelText('First'));
    await userEvent.click(screen.getByLabelText('Second'));
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual([8n, 9n]);
  });

  it('starts from the edges the server already has', () => {
    renderForm({ selected: new Set([9n]) });
    expect(screen.getByLabelText('Second')).toBeChecked();
    expect(screen.getByLabelText('First')).not.toBeChecked();
  });

  it('sends an empty list when every prerequisite is unticked', async () => {
    const { onSubmit } = renderForm({ selected: new Set([9n]) });
    await userEvent.click(screen.getByLabelText('Second'));
    await userEvent.click(screen.getByRole('button'));
    expect(onSubmit).toHaveBeenCalledWith([]);
  });

  it('shows the reducer’s cycle rejection where the author drew it', () => {
    renderForm({ error: 'That would create a dependency cycle: Third → First → Third' });
    expect(screen.getByRole('alert')).toHaveTextContent('dependency cycle');
  });

  it('offers a checkbox per candidate rather than a modifier-key multi-select', () => {
    renderForm();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('has nothing to offer in a one-chapter book', () => {
    renderForm({ candidates: [CHAPTER] });
    expect(screen.getByText(/add another chapter/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
