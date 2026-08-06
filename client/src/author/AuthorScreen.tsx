import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { t } from '../i18n';
import { reducers, tables } from '../module_bindings';
import { authorBookPath, HOME_PATH, navigate } from '../routing/route';
import { BookForm } from './BookForm';
import { useAction } from './useAction';

/** The author's own books, and the form that makes another one. */
export function AuthorScreen() {
  const { identity } = useSpacetimeDB();
  const [books, booksReady] = useTable(tables.books);
  const createBook = useReducer(reducers.createBook);
  const action = useAction(createBook);

  // Ownership is filtered here for display; `create_book` and every update reducer
  // check it again server-side. This is the list, not the lock (M7.4).
  const mine = books
    .filter((b) => identity && b.owner.isEqual(identity))
    .sort((a, b) => (a.bookId < b.bookId ? -1 : 1));

  return (
    <section className="author">
      <h2>{t('author.title')}</h2>
      <button type="button" onClick={() => navigate(HOME_PATH)}>
        {t('chapter.backToBook')}
      </button>

      <BookForm onSubmit={action.run} pending={action.pending} error={action.error} />

      <h3>{t('author.yourBooks')}</h3>
      {!booksReady ? (
        <p className="author-status">{t('book.loading')}</p>
      ) : mine.length === 0 ? (
        <p className="author-status">{t('author.noBooks')}</p>
      ) : (
        <ul className="author-books">
          {mine.map((book) => (
            <li key={String(book.bookId)}>
              <button type="button" onClick={() => navigate(authorBookPath(book.bookId))}>
                {book.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
