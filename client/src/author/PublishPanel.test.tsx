import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublishPanel } from './PublishPanel';

describe('PublishPanel', () => {
  it('offers publishing while the book is a draft', async () => {
    const onPublish = vi.fn();
    render(
      <PublishPanel
        status={{ tag: 'Draft' }}
        onPublish={onPublish}
        pending={false}
        error={undefined}
      />,
    );
    expect(screen.getByText(/only you can see/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).toHaveBeenCalled();
  });

  it('offers no control once published — there is no unpublish reducer to call', () => {
    render(
      <PublishPanel
        status={{ tag: 'Published' }}
        onPublish={vi.fn()}
        pending={false}
        error={undefined}
      />,
    );
    expect(screen.getByText(/readers can see/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('cannot be pressed twice while publishing', () => {
    render(
      <PublishPanel
        status={{ tag: 'Draft' }}
        onPublish={vi.fn()}
        pending
        error={undefined}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows a rejection', () => {
    render(
      <PublishPanel
        status={{ tag: 'Draft' }}
        onPublish={vi.fn()}
        pending={false}
        error="Only the owner may publish this book."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Only the owner may publish');
  });
});
