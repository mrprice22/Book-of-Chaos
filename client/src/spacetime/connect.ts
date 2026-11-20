import { DbConnection, type DbConnectionBuilder } from '../module_bindings';
import { SPACETIME_DB_NAME, SPACETIME_URI } from './config';
import type { SignInKeeper } from './renewal';
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
 * and the anonymous token is left as it was, for when they sign out.
 *
 * A signed-in reader's token is replaced on the builder each time the keeper renews
 * it. The provider rebuilds every reconnect from this same builder, so a reconnect
 * opens with the current token, not the one the page loaded with (M15.4). If the
 * connection drops and the sign-in cannot be renewed, the page reloads, and
 * `startSession` settles it as anonymous with "Sign in" on offer.
 */
/**
 * A signed-in connection dropped or was refused. Renew if the token needs it, so the
 * provider's next retry opens with a live one. If the sign-in is gone, reload.
 */
export async function whenConnectionLost(
  keeper: Pick<SignInKeeper, 'ensureLive'>,
  reload: () => void,
): Promise<void> {
  if (!(await keeper.ensureLive())) reload();
}

export function buildConnection(
  session: Session,
  keeper: SignInKeeper | undefined,
  reload: () => void = () => window.location.reload(),
): DbConnectionBuilder {
  const builder = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB_NAME)
    .withToken(session.token)
    .onConnect((_conn, _identity, token) => {
      if (!session.signedIn) saveToken(token);
    });
  if (keeper) {
    keeper.onToken((idToken) => builder.withToken(idToken));
    const onLost = () => void whenConnectionLost(keeper, reload);
    builder.onDisconnect(onLost).onConnectError(onLost);
  }
  return builder;
}
