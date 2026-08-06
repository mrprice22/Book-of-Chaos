import { t } from './i18n';
import { useConnectionStatus } from './spacetime/useConnectionStatus';

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
    </main>
  );
}
