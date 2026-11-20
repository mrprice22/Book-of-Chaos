// Carrying an anonymous reader's username, books and progress over to the identity
// they just signed in as (M15.2, docs/decisions/0002-durable-sign-in.md).
//
// Neither identity can vouch for the other in one call, so it takes two: the
// anonymous identity offers its rows to the signed-in one (`begin_link`), and the
// signed-in identity takes them (`complete_link`). This browser holds both tokens
// right after the sign-in redirect returns, so it makes both calls and the reader
// does nothing. The server decides everything; this only sequences the calls.

import { DbConnection } from '../module_bindings';
import { SPACETIME_DB_NAME, SPACETIME_URI } from './config';

/** Give up on the carry-over after this long, so a dead network cannot hold the page. */
export const CARRY_OVER_TIMEOUT_MS = 10_000;

/** The refusal the server gives an anonymous reader with no books, progress or username. */
const NOTHING_TO_CARRY = 'nothing to carry over';

/**
 * Pure: is this page load the moment to carry over? Only right after a sign-in
 * completes, and only when this browser has an anonymous identity to carry from.
 * Not on later loads: once carried, the anonymous identity holds nothing, and before
 * that the signed-in one may have rows of its own.
 */
export function shouldCarryOver(
  justSignedIn: boolean,
  signedIn: boolean,
  anonymousToken: string | undefined,
): anonymousToken is string {
  return justSignedIn && signedIn && Boolean(anonymousToken);
}

/** Pure: is this refusal the ordinary "nothing to carry" case, not worth a warning? */
export function isNothingToCarry(message: string): boolean {
  return message.includes(NOTHING_TO_CARRY);
}

type Connected = { conn: DbConnection; identity: NonNullable<DbConnection['identity']> };

/** Open a connection, recording it in `opened` at once so a timeout still closes it. */
function open(token: string, opened: DbConnection[]): Promise<Connected> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(SPACETIME_URI)
      .withDatabaseName(SPACETIME_DB_NAME)
      .withToken(token)
      .onConnect((connected, identity) => resolve({ conn: connected, identity }))
      .onConnectError((_ctx, error) => reject(error))
      .build();
    opened.push(conn);
  });
}

function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(`Carry-over timed out after ${ms} ms`)), ms),
  );
}

/**
 * Offer the anonymous identity's rows to the signed-in one, and take them.
 *
 * Never throws: a carry-over that fails leaves the reader signed in with a fresh
 * account, which is a working state. The rows stay with the anonymous identity, so
 * nothing is lost. The common refusal, an anonymous reader with nothing to carry,
 * is expected and stays quiet. Anything else is logged.
 */
export async function carryOver(anonymousToken: string, idToken: string): Promise<void> {
  const opened: DbConnection[] = [];
  const attempt = async () => {
    const anonymous = await open(anonymousToken, opened);
    const signedIn = await open(idToken, opened);
    await anonymous.conn.reducers.beginLink({ target: signedIn.identity });
    await signedIn.conn.reducers.completeLink({ from: anonymous.identity });
  };
  try {
    await Promise.race([attempt(), timeout(CARRY_OVER_TIMEOUT_MS)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isNothingToCarry(message)) console.warn('Carry-over did not happen:', message);
  } finally {
    for (const conn of opened) conn.disconnect();
  }
}
