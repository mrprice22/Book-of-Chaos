import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Identity, getQueryAccessorName } from 'spacetimedb';
import { aBook } from '../test/factories';
import { AuthorScreen } from './AuthorScreen';

const ME = Identity.fromString('a11ce'.padStart(64, '0'));
const SOMEONE_ELSE = Identity.fromString('b0b'.padStart(64, '0'));

const sdk = vi.hoisted(() => ({
  ready: true,
  rows: {} as Record<string, readonly unknown[]>,
  createBook: undefined as unknown,
}));

vi.mock('spacetimedb/react', async () => {
  const { getQueryAccessorName: accessorName } =
    await vi.importActual<typeof import('spacetimedb')>('spacetimedb');
  return {
    useSpacetimeDB: () => ({ identity: ME }),
    useTable: (query: unknown) => [sdk.rows[accessorName(query)] ?? [], sdk.ready],
    useReducer: () => sdk.createBook,
  };
});

describe('AuthorScreen', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/author');
    sdk.ready = true;
    sdk.createBook = vi.fn(() => Promise.resolve());
    sdk.rows = { books: [] };
  });

  it('says so before there is anything to list', () => {
    render(<AuthorScreen />);
    expect(screen.getByText(/not created a book/i)).toBeInTheDocument();
  });

  it('lists only the caller’s own books', () => {
    sdk.rows = {
      books: [
        aBook({ bookId: 1n, title: 'Mine', owner: ME }),
        aBook({ bookId: 2n, title: 'Theirs', owner: SOMEONE_ELSE }),
      ],
    };
    render(<AuthorScreen />);
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Theirs' })).not.toBeInTheDocument();
  });

  it('creates a book through the reducer', async () => {
    render(<AuthorScreen />);
    await userEvent.type(screen.getByLabelText('Title'), 'Chaos');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(sdk.createBook).toHaveBeenCalledWith({ title: 'Chaos', description: '' });
  });

  it('surfaces a rejected creation', async () => {
    sdk.createBook = vi.fn(() => Promise.reject(new Error('Title cannot be empty')));
    render(<AuthorScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Title cannot be empty');
  });

  it('opens a book for editing', async () => {
    sdk.rows = { books: [aBook({ bookId: 7n, title: 'Mine', owner: ME })] };
    render(<AuthorScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(() => expect(window.location.pathname).toBe('/author/book/7'));
  });

  it('reads books from the books table', async () => {
    const { tables } = await import('../module_bindings');
    expect(getQueryAccessorName(tables.books)).toBe('books');
  });
});
