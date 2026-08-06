import { render, screen } from '@testing-library/react';
import { BookLanding } from './BookLanding';

describe('BookLanding', () => {
  it('shows the title, description, chapter count and read time', () => {
    render(
      <BookLanding
        title="Chaos Theory"
        description="Order, eventually."
        summary={{ chapterCount: 7, readMinutes: 42 }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Chaos Theory' })).toBeInTheDocument();
    expect(screen.getByText('Order, eventually.')).toBeInTheDocument();
    expect(screen.getByText('7 chapters')).toBeInTheDocument();
    expect(screen.getByText(/42 min read/)).toBeInTheDocument();
  });

  it('uses the singular form for a one-chapter book', () => {
    render(
      <BookLanding
        title="Short"
        description=""
        summary={{ chapterCount: 1, readMinutes: 1 }}
      />,
    );
    expect(screen.getByText('1 chapter')).toBeInTheDocument();
  });

  it('says a book with no content has none, rather than claiming a 0 minute read', () => {
    render(
      <BookLanding
        title="Empty"
        description=""
        summary={{ chapterCount: 0, readMinutes: 0 }}
      />,
    );
    expect(screen.getByText(/no content/i)).toBeInTheDocument();
    expect(screen.queryByText(/min read/)).not.toBeInTheDocument();
  });
});
