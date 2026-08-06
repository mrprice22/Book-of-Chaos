import { t } from '../i18n';
import type { BookSummary } from './bookSummary';

/** English has two forms; the key pair keeps the choice in i18n rather than in JSX. */
function chapterCountLabel(count: number): string {
  return count === 1
    ? t('book.chapterCount.one')
    : t('book.chapterCount.other', { count });
}

function readTimeLabel(minutes: number): string {
  return minutes === 0 ? t('book.readTime.empty') : t('book.readTime', { minutes });
}

/**
 * The book's front door: what it is, how big it is, how long it takes.
 *
 * Presentational on purpose — everything it shows is passed in, so it renders
 * identically in a test and in the browser.
 */
export function BookLanding({
  title,
  description,
  summary,
}: {
  title: string;
  description: string;
  summary: BookSummary;
}) {
  return (
    <article className="book-landing">
      <h2>{title}</h2>
      <p className="book-description">{description}</p>
      <ul className="book-facts">
        <li>{chapterCountLabel(summary.chapterCount)}</li>
        <li>{readTimeLabel(summary.readMinutes)}</li>
      </ul>
    </article>
  );
}
