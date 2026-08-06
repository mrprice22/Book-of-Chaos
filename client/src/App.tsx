import { t } from './i18n';
import { AuthorBookScreen } from './author/AuthorBookScreen';
import { AuthorScreen } from './author/AuthorScreen';
import { ChapterScreen } from './reader/ChapterScreen';
import { Library } from './reader/Library';
import { AUTHOR_PATH, HOME_PATH, navigate, useRoute, type Route } from './routing/route';
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
