import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { t } from '../i18n';
import { reducers, tables } from '../module_bindings';
import { AUTHOR_PATH, navigate } from '../routing/route';
import { ChapterEditor } from './ChapterEditor';
import { ChapterForm } from './ChapterForm';
import { useAction } from './useAction';

/** One book's chapters, with the forms that add to it. */
export function AuthorBookScreen({ bookId }: { bookId: bigint }) {
  const { identity } = useSpacetimeDB();
  const [books, booksReady] = useTable(tables.books);
  const [chapters] = useTable(tables.chapters);
  const [blocks] = useTable(tables.knowledgeBlocks);
  const [deps] = useTable(tables.chapterDeps);

  const createChapter = useReducer(reducers.createChapter);
  const chapterAction = useAction((draft: Parameters<typeof createChapter>[0]) =>
    createChapter(draft),
  );

  const book = books.find((b) => b.bookId === bookId);
  const isOwner =
    book !== undefined && identity !== undefined && book.owner.isEqual(identity);

  if (!booksReady) {
    return <p className="author-status">{t('book.loading')}</p>;
  }

  // Not-yours and does-not-exist are one message on purpose: telling a stranger that
  // book 7 exists but belongs to someone else is information they did not have.
  if (!isOwner) {
    return (
      <div className="author-status">
        <p>{t('author.bookNotFound')}</p>
        <button type="button" onClick={() => navigate(AUTHOR_PATH)}>
          {t('author.backToAuthor')}
        </button>
      </div>
    );
  }

  const bookChapters = chapters
    .filter((c) => c.bookId === bookId)
    .sort((a, b) =>
      a.position !== b.position
        ? a.position - b.position
        : a.chapterId < b.chapterId
          ? -1
          : 1,
    );

  return (
    <section className="author">
      <h2>{book.title}</h2>
      <button type="button" onClick={() => navigate(AUTHOR_PATH)}>
        {t('author.backToAuthor')}
      </button>

      <ChapterForm
        onSubmit={(draft) => chapterAction.run({ bookId, ...draft })}
        pending={chapterAction.pending}
        error={chapterAction.error}
      />

      <h3>{t('author.chapters')}</h3>
      {bookChapters.length === 0 ? (
        <p className="author-status">{t('author.noChapters')}</p>
      ) : (
        <ol className="author-chapters">
          {bookChapters.map((chapter) => (
            <ChapterEditor
              key={String(chapter.chapterId)}
              chapter={chapter}
              siblings={bookChapters}
              blocks={blocks}
              deps={deps}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
