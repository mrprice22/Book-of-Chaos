import { act, renderHook } from '@testing-library/react';
import type { DbConnection } from '../module_bindings';
import type { ConnectionHandlers, Connector } from './connect';
import { saveToken } from './token';
import { backoffDelayMs, useConnection } from './useConnection';

type Attempt = {
  token: string | undefined;
  handlers: ConnectionHandlers;
  disconnected: boolean;
};

/** Records every connection attempt and lets a test fire the SDK's callbacks by hand. */
function fakeConnector() {
  const attempts: Attempt[] = [];
  const connector: Connector = (token, handlers) => {
    const attempt: Attempt = { token, handlers, disconnected: false };
    attempts.push(attempt);
    return {
      disconnect: () => {
        attempt.disconnected = true;
      },
    };
  };
  return { attempts, connector };
}

function fakeDbConnection(): DbConnection {
  return { disconnect: () => {} } as unknown as DbConnection;
}

describe('backoffDelayMs', () => {
  it('doubles per attempt and caps at 30s', () => {
    expect(backoffDelayMs(1)).toBe(500);
    expect(backoffDelayMs(2)).toBe(1000);
    expect(backoffDelayMs(3)).toBe(2000);
    expect(backoffDelayMs(50)).toBe(30_000);
  });
});

describe('useConnection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects on mount and reports the identity', () => {
    const { attempts, connector } = fakeConnector();
    const { result } = renderHook(() => useConnection(connector));

    expect(result.current.kind).toBe('connecting');
    expect(attempts).toHaveLength(1);

    act(() => {
      attempts[0]?.handlers.onConnect(fakeDbConnection(), 'deadbeef', 'tok-new');
    });

    expect(result.current).toMatchObject({ kind: 'connected', identity: 'deadbeef' });
  });

  it('persists the token it is given and replays it on the next connection', () => {
    const { attempts, connector } = fakeConnector();
    const first = renderHook(() => useConnection(connector));

    expect(attempts[0]?.token).toBeUndefined();
    act(() => {
      attempts[0]?.handlers.onConnect(fakeDbConnection(), 'deadbeef', 'tok-new');
    });
    first.unmount();

    renderHook(() => useConnection(connector));
    expect(attempts[1]?.token).toBe('tok-new');
  });

  it('sends a token stored by a previous session', () => {
    saveToken('tok-old');
    const { attempts, connector } = fakeConnector();
    renderHook(() => useConnection(connector));
    expect(attempts[0]?.token).toBe('tok-old');
  });

  it('reconnects after a drop, quickly, because the server was just reachable', () => {
    const { attempts, connector } = fakeConnector();
    const { result } = renderHook(() => useConnection(connector));

    act(() => {
      attempts[0]?.handlers.onConnect(fakeDbConnection(), 'deadbeef', 'tok-new');
    });
    act(() => {
      attempts[0]?.handlers.onDisconnect(new Error('socket closed'));
    });

    expect(result.current).toMatchObject({
      kind: 'reconnecting',
      reason: 'socket closed',
    });
    expect(attempts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(backoffDelayMs(1));
    });
    expect(attempts).toHaveLength(2);
  });

  it('backs off further on each successive failure to connect', () => {
    const { attempts, connector } = fakeConnector();
    renderHook(() => useConnection(connector));

    act(() => {
      attempts[0]?.handlers.onConnectError(new Error('refused'));
    });
    act(() => {
      vi.advanceTimersByTime(backoffDelayMs(1));
    });
    expect(attempts).toHaveLength(2);

    act(() => {
      attempts[1]?.handlers.onConnectError(new Error('refused'));
    });
    // Still waiting: the second retry waits longer than the first.
    act(() => {
      vi.advanceTimersByTime(backoffDelayMs(1));
    });
    expect(attempts).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(backoffDelayMs(2) - backoffDelayMs(1));
    });
    expect(attempts).toHaveLength(3);
  });

  it('closes the socket on unmount', () => {
    const { attempts, connector } = fakeConnector();
    const { unmount } = renderHook(() => useConnection(connector));
    unmount();
    expect(attempts[0]?.disconnected).toBe(true);
  });

  it('cancels a pending retry on unmount', () => {
    const { attempts, connector } = fakeConnector();
    const { unmount } = renderHook(() => useConnection(connector));

    act(() => {
      attempts[0]?.handlers.onConnectError(new Error('refused'));
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(attempts).toHaveLength(1);
  });

  it('drops a connection that lands after unmount', () => {
    const { attempts, connector } = fakeConnector();
    const { unmount } = renderHook(() => useConnection(connector));
    unmount();

    const late = fakeDbConnection();
    const disconnect = vi.spyOn(late, 'disconnect');
    act(() => {
      attempts[0]?.handlers.onConnect(late, 'deadbeef', 'tok-new');
    });
    expect(disconnect).toHaveBeenCalled();
  });
});
