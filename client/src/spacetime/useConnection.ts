import { useEffect, useRef, useState } from 'react';
import type { DbConnection } from '../module_bindings';
import { connectToSpacetime, type Connector } from './connect';
import { loadToken, saveToken } from './token';

export type ConnectionStatus =
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'connected'; readonly identity: string; readonly conn: DbConnection }
  | { readonly kind: 'reconnecting'; readonly attempt: number; readonly reason?: string };

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/** Exponential backoff, capped. `attempt` is 1 for the first retry. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

/**
 * Holds one live connection for the lifetime of the component.
 *
 * A dropped connection retries with backoff using the persisted token, so the reader
 * comes back as the same identity. Unmounting cancels any pending retry and closes
 * the socket — under React StrictMode the effect runs twice in development, and
 * without that teardown the first connection would leak.
 */
export function useConnection(
  connector: Connector = connectToSpacetime,
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>({
    kind: 'connecting',
    attempt: 0,
  });
  // Held in a ref, not a dependency: a caller that passes an inline connector would
  // otherwise tear down and rebuild the socket on every render. Updated in its own
  // effect because writing a ref during render is a React violation.
  const connectorRef = useRef(connector);
  useEffect(() => {
    connectorRef.current = connector;
  }, [connector]);

  useEffect(() => {
    let cancelled = false;
    let handle: { disconnect: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const retry = (attempt: number, reason?: string) => {
      if (cancelled) return;
      setStatus({ kind: 'reconnecting', attempt, reason });
      timer = setTimeout(() => {
        open(attempt);
      }, backoffDelayMs(attempt));
    };

    const open = (attempt: number) => {
      if (cancelled) return;
      setStatus({ kind: 'connecting', attempt });
      handle = connectorRef.current(loadToken(), {
        onConnect: (conn, identity, token) => {
          if (cancelled) {
            conn.disconnect();
            return;
          }
          saveToken(token);
          setStatus({ kind: 'connected', identity, conn });
        },
        // A drop after a successful connect resets the backoff: the server was
        // reachable a moment ago, so the first retry should be quick.
        onDisconnect: (error) => retry(1, error?.message),
        onConnectError: (error) => retry(attempt + 1, error.message),
      });
    };

    open(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      handle?.disconnect();
    };
  }, []);

  return status;
}
