import { t } from './i18n';
import { AuthorBookScreen } from './author/AuthorBookScreen';
import { AuthorScreen } from './author/AuthorScreen';
import { ChapterScreen } from './reader/ChapterScreen';
import { Library } from './reader/Library';
import { AUTHOR_PATH, HOME_PATH, navigate, useRoute, type Route } from './routing/route';
import { useSession } from './spacetime/session';
import { useConnectionStatus } from './spacetime/useConnectionStatus';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'chapter':
      return <ChapterScreen chapterId={route.chapterId} />;
    case 'author':
      return <AuthorScreen />;
    case 'authorBook':
      return <AuthorBookScreen bookId={route.bookId} />;
    case 'home':
      return <Library />;
  }
}

/**
 * Authoring is reachable from here, and only from here.
 *
 * Every identity may create a book — Owner is per-book, not a platform role (see
 * docs/mvp-scope.md) — so this is not gated. What is gated is *someone else's* book:
 * /author/book/:id refuses a non-owner, and every write reducer refuses again. The
 * nav being visible is not permission; the reducer is (CLAUDE.md).
 */
function Nav({ route }: { route: Route }) {
  const authoring = route.name === 'author' || route.name === 'authorBook';
  return (
    <nav className="nav">
      <button
        type="button"
        onClick={() => navigate(HOME_PATH)}
        aria-current={authoring ? undefined : 'page'}
      >
        {t('nav.read')}
      </button>
      <button
        type="button"
        onClick={() => navigate(AUTHOR_PATH)}
        aria-current={authoring ? 'page' : undefined}
      >
        {t('nav.author')}
      </button>
    </nav>
  );
}

/**
 * Sign in or out. Being signed in is a fact about the token, not a permission (CLAUDE.md).
 *
 * Signed out, with an account this browser remembers, the reader chooses: continue
 * as that account, or use another one (M15.5). With nothing remembered, there is
 * nothing to choose between, so there is one "Sign in".
 */
function Account() {
  const session = useSession();
  if (session.signedIn) {
    return (
      <p className="account" data-signed-in={true}>
        <span>{t('account.signedIn')}</span>{' '}
        <button type="button" onClick={session.signOut}>
          {t('account.signOut')}
        </button>
      </p>
    );
  }
  return (
    <p className="account" data-signed-in={false}>
      <span>{t('account.anonymous')}</span>{' '}
      {session.lastAccount ? (
        <>
          <button type="button" onClick={() => session.signIn('continue')}>
            {t('account.continueAs', { email: session.lastAccount })}
          </button>{' '}
          <button type="button" onClick={() => session.signIn('another')}>
            {t('account.useAnother')}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => session.signIn('continue')}>
          {t('account.signIn')}
        </button>
      )}
    </p>
  );
}

export function App() {
  const status = useConnectionStatus();
  const route = useRoute();

  return (
    <main className="app">
      <h1>{t('app.title')}</h1>
      <p className="connection" data-status={status.kind}>
        {status.kind === 'connected' ? (
          <>
            <span>{t('connection.connectedAs')}</span> <code>{status.identity}</code>
          </>
        ) : (
          <span>
            {status.kind === 'connecting'
              ? t('connection.connecting')
              : t('connection.reconnecting')}
          </span>
        )}
      </p>
      <Account />
      {/* Nothing below the connection banner can do anything useful without one. */}
      {status.kind === 'connected' && (
        <>
          <Nav route={route} />
          <Screen route={route} />
        </>
      )}
    </main>
  );
}
