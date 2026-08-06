import { t } from '../i18n';
import type { BookStatus } from '../module_bindings/types';
import { ErrorMessage } from './Fields';

/**
 * The book's visibility, and the one-way door to changing it.
 *
 * Publishing is deliberately not reversible in v0.1: `docs/mvp-scope.md` defines
 * publish as a flip from Draft to Published, and there is no unpublish reducer to
 * call. A disabled "Unpublish" would advertise a feature that does not exist, so a
 * published book simply states its status and offers no control.
 */
export function PublishPanel({
  status,
  onPublish,
  pending,
  error,
}: {
  status: BookStatus;
  onPublish: () => void;
  pending: boolean;
  error: string | undefined;
}) {
  return (
    <div className="publish-panel">
      <p className="book-status" data-status={status.tag}>
        {status.tag === 'Published'
          ? t('author.status.Published')
          : t('author.status.Draft')}
      </p>
      <ErrorMessage error={error} />
      {status.tag === 'Draft' && (
        <button type="button" onClick={onPublish} disabled={pending}>
          {pending ? t('action.publishing') : t('action.publish')}
        </button>
      )}
    </div>
  );
}
