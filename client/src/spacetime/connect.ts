import { DbConnection, type DbConnectionBuilder } from '../module_bindings';
import { SPACETIME_DB_NAME, SPACETIME_URI } from './config';
import { loadToken, saveToken } from './token';

/**
 * The connection the app runs on, configured but not yet opened.
 *
 * `SpacetimeDBProvider` owns the opening, the ref-counted teardown and the
 * reconnect backoff. All this adds is identity persistence: the stored token goes
 * out with the handshake and the token that comes back is written down, which is
 * what makes a returning reader the *same* reader rather than a new anonymous one.
 */
export function buildConnection(): DbConnectionBuilder {
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB_NAME)
    .withToken(loadToken())
    .onConnect((_conn, _identity, token) => {
      saveToken(token);
    });
}
