import { t } from '../i18n';
import { ErrorMessage } from './Fields';

/**
 * The owner's switch for readers who are not signed in (M15.3).
 *
 * The checkbox shows the stored setting, not a local draft: it is checked exactly when
 * the subscription says the book is open, so a refused change leaves it as it was.
 * The server decides who reads what. This only asks it to change the setting.
 */
export function AnonymousAccess({
  enabled,
  published,
  onChange,
  pending,
  error,
}: {
  enabled: boolean;
  published: boolean;
  onChange: (enabled: boolean) => void;
  pending: boolean;
  error: string | undefined;
}) {
  return (
    <div className="anonymous-access">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={() => onChange(!enabled)}
        />{' '}
        {t('author.anonymousAccess.label')}
      </label>
      {enabled && !published && (
        <p className="author-status">{t('author.anonymousAccess.draftNote')}</p>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}
