import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { t } from '../i18n';
import { reducers, tables } from '../module_bindings';
import { inReadingOrder } from '../reader/blockOrder';
import { AUTHOR_PATH, navigate } from '../routing/route';
import { BlockForm, type BlockDraft } from './BlockForm';
import { ChapterForm } from './ChapterForm';
import { useAction } from './useAction';

/** One book's chapters, with the forms that add to it. */
export function AuthorBookScreen({ bookId }: { bookId: bigint }) {
  const { identity } = useSpacetimeDB();
  const [books, booksReady] = useTable(tables.books);
  const [chapters] = useTable(tables.chapters);
  const [blocks] = useTable(tables.knowledgeBlocks);

  const createChapter = useReducer(reducers.createChapter);
  const createBlock = useReducer(reducers.createBlock);

  const chapterAction = useAction((draft: Parameters<typeof createChapter>[0]) =>
    createChapter(draft),
  );
  const blockAction = useAction((draft: Parameters<typeof createBlock>[0]) =>
    createBlock(draft),
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

  const submitBlock = (chapterId: bigint, draft: BlockDraft) => {
    blockAction.run({ chapterId, ...draft });
  };

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
            <li key={String(chapter.chapterId)}>
              <h4>{chapter.title}</h4>
              <ul className="author-blocks">
                {inReadingOrder(
                  blocks.filter((b) => b.chapterId === chapter.chapterId),
                ).map((block) => (
                  <li key={String(block.blockId)}>{block.title}</li>
                ))}
              </ul>
              <BlockForm
                chapterId={chapter.chapterId}
                onSubmit={(draft) => submitBlock(chapter.chapterId, draft)}
                pending={blockAction.pending}
                error={blockAction.error}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
