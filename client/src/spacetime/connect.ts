import { DbConnection, type DbConnectionBuilder } from '../module_bindings';
import { SPACETIME_DB_NAME, SPACETIME_URI } from './config';
import type { Session } from './session';
import { saveToken } from './token';

/**
 * The connection the app runs on, configured but not yet opened.
 *
 * `SpacetimeDBProvider` owns the opening, the ref-counted teardown and the
 * reconnect backoff. All this adds is identity: the session's token goes out with
 * the handshake. For an anonymous reader, the token that comes back is written
 * down, which is what makes a returning reader the *same* reader rather than a new
 * anonymous one. A signed-in reader's identity comes from their ID token instead,
 * and the anonymous token is left as it was, for the username carry-over (M15.2).
 */
export function buildConnection(session: Session): DbConnectionBuilder {
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB_NAME)
    .withToken(session.token)
    .onConnect((_conn, _identity, token) => {
      if (!session.signedIn) saveToken(token);
    });
}
