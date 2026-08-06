import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { t } from '../i18n';
import { BookLanding } from './BookLanding';
import { summarizeBook } from './bookSummary';

/**
 * Picks the book to show and feeds the landing page from live subscriptions.
 *
 * v0.1 has one demo book, so "the book" is the first published one by id. Routing
 * arrives with the chapter view (M5.2/M5.4); until then this is the whole reader.
 *
 * Nothing here refetches: `useTable` rows update from the subscription, per the
 * "if the UI needs a reload to be correct, it is wrong" rule in CLAUDE.md.
 */
export function Library() {
  const [books, booksReady] = useTable(tables.books);
  const [chapters, chaptersReady] = useTable(tables.chapters);
  const [blocks, blocksReady] = useTable(tables.knowledgeBlocks);

  if (!booksReady || !chaptersReady || !blocksReady) {
    return <p className="library-status">{t('book.loading')}</p>;
  }

  const published = books
    .filter((b) => b.status.tag === 'Published')
    .sort((a, b) => (a.bookId < b.bookId ? -1 : 1));
  const book = published[0];

  if (!book) {
    return <p className="library-status">{t('book.none')}</p>;
  }

  return (
    <BookLanding
      title={book.title}
      description={book.description}
      summary={summarizeBook(book, chapters, blocks)}
    />
  );
}
