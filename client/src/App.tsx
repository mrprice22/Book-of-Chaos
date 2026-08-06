import { t } from './i18n';
import { useConnection } from './spacetime/useConnection';
import type { Connector } from './spacetime/connect';

// The connector is injectable so tests can drive the connection state machine
// without a websocket. Production never passes it.
export function App({ connector }: { connector?: Connector }) {
  const status = useConnection(connector);

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
