import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnonymousAccess } from './AnonymousAccess';

const LABEL = /not signed in can read this book/i;

describe('AnonymousAccess', () => {
  it('shows the stored setting and asks to turn it on', async () => {
    const onChange = vi.fn();
    render(
      <AnonymousAccess
        enabled={false}
        published
        onChange={onChange}
        pending={false}
        error={undefined}
      />,
    );
    const box = screen.getByRole('checkbox', { name: LABEL });
    expect(box).not.toBeChecked();

    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('asks to turn it off when it is on', async () => {
    const onChange = vi.fn();
    render(
      <AnonymousAccess
        enabled
        published
        onChange={onChange}
        pending={false}
        error={undefined}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: LABEL }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('says a draft stays hidden until it is published', () => {
    render(
      <AnonymousAccess
        enabled
        published={false}
        onChange={vi.fn()}
        pending={false}
        error={undefined}
      />,
    );
    expect(screen.getByText(/once the book is published/i)).toBeInTheDocument();
  });

  it('cannot be changed while a change is in flight', () => {
    render(
      <AnonymousAccess
        enabled={false}
        published
        onChange={vi.fn()}
        pending
        error={undefined}
      />,
    );
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('shows a rejection', () => {
    render(
      <AnonymousAccess
        enabled={false}
        published
        onChange={vi.fn()}
        pending={false}
        error="Only the owner of this book can change it."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Only the owner');
  });
});
