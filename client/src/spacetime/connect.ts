import { DbConnection } from '../module_bindings';
import { SPACETIME_DB_NAME, SPACETIME_URI } from './config';

export type ConnectionHandlers = {
  onConnect: (conn: DbConnection, identityHex: string, token: string) => void;
  onDisconnect: (error?: Error) => void;
  onConnectError: (error: Error) => void;
};

export type ConnectionHandle = {
  disconnect: () => void;
};

/**
 * Opens a connection and hands back only what the caller needs to close it.
 *
 * `useConnection` takes this as a parameter rather than importing it, so the hook's
 * reconnect behaviour can be tested without a websocket or a running database.
 */
export type Connector = (
  token: string | undefined,
  handlers: ConnectionHandlers,
) => ConnectionHandle;

export const connectToSpacetime: Connector = (token, handlers) => {
  const conn = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB_NAME)
    .withToken(token)
    .onConnect((connection, identity, newToken) => {
      handlers.onConnect(connection, identity.toHexString(), newToken);
    })
    .onDisconnect((_ctx, error) => {
      handlers.onDisconnect(error);
    })
    .onConnectError((_ctx, error) => {
      handlers.onConnectError(error);
    })
    .build();

  return {
    disconnect: () => {
      conn.disconnect();
    },
  };
};
