import { t } from './i18n';
import { ChapterScreen } from './reader/ChapterScreen';
import { Library } from './reader/Library';
import { useRoute } from './routing/route';
import { useConnectionStatus } from './spacetime/useConnectionStatus';

function Screen() {
  const route = useRoute();
  return route.name === 'chapter' ? (
    <ChapterScreen chapterId={route.chapterId} />
  ) : (
    <Library />
  );
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
