import { useState } from 'react';
import { t } from '../i18n';
import type { Chapter } from '../module_bindings/types';
import { ErrorMessage } from './Fields';

/**
 * Choose which chapters a chapter waits on.
 *
 * A multi-select of checkboxes rather than `<select multiple>`: the latter needs a
 * modifier key to select more than one, which is a well-known trap and the reason
 * authors end up with a single prerequisite by accident.
 *
 * The candidate list excludes the chapter itself — `set_chapter_deps` rejects a
 * self-reference anyway, but offering it as a choice invites the mistake. Cycles are
 * *not* filtered out: which combinations form a loop is the reducer's judgement, and
 * pre-filtering here would be a second cycle detector to keep in sync.
 */
export function PrerequisiteForm({
  chapter,
  candidates,
  selected,
  onSubmit,
  pending,
  error,
}: {
  chapter: Chapter;
  candidates: readonly Chapter[];
  selected: ReadonlySet<bigint>;
  onSubmit: (dependsOn: bigint[]) => void;
  pending: boolean;
  error: string | undefined;
}) {
  // Seeded from the server's rows, then owned locally until submit — an author
  // ticking three boxes should not fire three reducer calls.
  const [draft, setDraft] = useState<ReadonlySet<bigint>>(selected);

  const others = candidates.filter((c) => c.chapterId !== chapter.chapterId);
  const field = (id: bigint) => `prereq-${chapter.chapterId}-${id}`;

  const toggle = (chapterId: bigint, on: boolean) => {
    const next = new Set(draft);
    if (on) next.add(chapterId);
    else next.delete(chapterId);
    setDraft(next);
  };

  return (
    <form
      className="author-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit([...draft]);
      }}
    >
      <h5>{t('author.prerequisites')}</h5>
      {others.length === 0 ? (
        <p className="author-status">{t('author.noPrerequisiteCandidates')}</p>
      ) : (
        <ul className="prereq-list">
          {others.map((candidate) => (
            <li key={String(candidate.chapterId)}>
              <input
                id={field(candidate.chapterId)}
                type="checkbox"
                checked={draft.has(candidate.chapterId)}
                onChange={(e) => toggle(candidate.chapterId, e.target.checked)}
              />
              <label htmlFor={field(candidate.chapterId)}>{candidate.title}</label>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={error} />
      <button type="submit" disabled={pending || others.length === 0}>
        {pending ? t('action.saving') : t('action.savePrerequisites')}
      </button>
    </form>
  );
}
