import { t } from '../i18n';
import { HOME_PATH, navigate } from '../routing/route';
import { useSession } from '../spacetime/session';

/**
 * What the author screens show a visitor who is not signed in.
 *
 * Since M15.3 every writing reducer refuses such a caller, so offering them a form
 * would only collect a refusal. This is the UX half; the reducers are the lock.
 */
export function SignInToWrite() {
  const { signIn } = useSession();
  return (
    <section className="author">
      <h2>{t('author.title')}</h2>
      <p className="author-status">{t('author.signInToWrite')}</p>
      <button type="button" onClick={signIn}>
        {t('account.signIn')}
      </button>{' '}
      <button type="button" onClick={() => navigate(HOME_PATH)}>
        {t('chapter.backToBook')}
      </button>
    </section>
  );
}
