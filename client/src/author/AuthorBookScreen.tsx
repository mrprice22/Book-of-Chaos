import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { t } from '../i18n';
import { reducers, tables } from '../module_bindings';
import { AUTHOR_PATH, navigate } from '../routing/route';
import { AnonymousAccess } from './AnonymousAccess';
import { ChapterEditor } from './ChapterEditor';
import { ChapterForm } from './ChapterForm';
import { PublishPanel } from './PublishPanel';
import { useSession } from '../spacetime/session';
import { SignInToWrite } from './SignInToWrite';
import { useAction } from './useAction';

/** One book's chapters, with the forms that add to it. */
function AuthorBookScreenSigned({ bookId }: { bookId: bigint }) {
  const { identity } = useSpacetimeDB();
  const [books, booksReady] = useTable(tables.visibleBooks);
  const [chapters] = useTable(tables.visibleChapters);
  const [blocks] = useTable(tables.visibleBlocks);
  const [deps] = useTable(tables.visibleChapterDeps);
  // Only to tell an author their quiz block already has a quiz to replace; the
  // answer key is not readable from any client, this one included.
  const [quizQuestions] = useTable(tables.visibleQuizQuestions);

  const createChapter = useReducer(reducers.createChapter);
  const publishBook = useReducer(reducers.publishBook);
  const chapterAction = useAction((draft: Parameters<typeof createChapter>[0]) =>
    createChapter(draft),
  );
  const publishAction = useAction(() => publishBook({ bookId }));
  const setAnonymousAccess = useReducer(reducers.setAnonymousAccess);
  const accessAction = useAction((enabled: boolean) =>
    setAnonymousAccess({ bookId, enabled }),
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

      <PublishPanel
        status={book.status}
        onPublish={() => publishAction.run(undefined)}
        pending={publishAction.pending}
        error={publishAction.error}
      />
      <AnonymousAccess
        enabled={book.anonymousAccess}
        published={book.status.tag === 'Published'}
        onChange={(enabled) => accessAction.run(enabled)}
        pending={accessAction.pending}
        error={accessAction.error}
      />

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
              quizQuestions={quizQuestions}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/** The author screen is for signed-in callers; anyone else is asked to sign in. */
export function AuthorBookScreen({ bookId }: { bookId: bigint }) {
  const { signedIn } = useSession();
  return signedIn ? <AuthorBookScreenSigned bookId={bookId} /> : <SignInToWrite />;
}
