import { t } from './i18n';
import { AuthorBookScreen } from './author/AuthorBookScreen';
import { AuthorScreen } from './author/AuthorScreen';
import { ChapterScreen } from './reader/ChapterScreen';
import { Library } from './reader/Library';
import { useRoute } from './routing/route';
import { useConnectionStatus } from './spacetime/useConnectionStatus';

function Screen() {
  const route = useRoute();
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

export function App() {
  const status = useConnectionStatus();

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
      {status.kind === 'connected' && <Screen />}
    </main>
  );
}
