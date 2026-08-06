import { useConnection } from './spacetime/useConnection';
import type { Connector } from './spacetime/connect';

// Copy lives outside JSX per CLAUDE.md. M4.4 replaces these constants with the
// `t()` lookup into `src/i18n/en-US.ts`.
const COPY = {
  appTitle: 'Book of Chaos',
  connecting: 'Connecting…',
  reconnecting: 'Connection lost — retrying…',
  connectedAs: 'Connected as',
} as const;

// The connector is injectable so tests can drive the connection state machine
// without a websocket. Production never passes it.
export function App({ connector }: { connector?: Connector }) {
  const status = useConnection(connector);

  return (
    <main className="app">
      <h1>{COPY.appTitle}</h1>
      <p className="connection" data-status={status.kind}>
        {status.kind === 'connected' ? (
          <>
            <span>{COPY.connectedAs}</span> <code>{status.identity}</code>
          </>
        ) : (
          <span>
            {status.kind === 'connecting' ? COPY.connecting : COPY.reconnecting}
          </span>
        )}
      </p>
    </main>
  );
}
