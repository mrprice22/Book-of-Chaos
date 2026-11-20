/**
 * Signed-in and anonymous callers for the e2e stages, against the live module.
 *
 * Since M15.3 a caller who is not signed in reads only the books open to anonymous
 * readers, and calls no writing reducer. So every stage that writes, or reads another
 * identity's book, connects signed in: a verified email at the mock issuer that
 * `deploy.sh local` builds the module to trust (`support/mockIssuer.ts`).
 */
import { DbConnection } from '../../src/module_bindings';
import { startIssuer, type MintOptions, type MockIssuer } from './mockIssuer';

export const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
export const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

/** Must match `MOCK_ISSUER_CLIENT` in scripts/deploy.sh. */
export const TRUSTED_PORT = 3200;
export const CLIENT_ID = 'boc-e2e';

export interface Caller {
  readonly conn: DbConnection;
  readonly identity: NonNullable<DbConnection['identity']>;
}

/** Open a connection: with `token`, as its identity, and without one, as a new anonymous one. */
export function connectAs(token?: string): Promise<Caller> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .withToken(token)
      .onConnect((conn, identity) => resolve({ conn, identity }))
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(() => reject(new Error(`Timed out connecting to ${URI}/${DB_NAME}`)), 15_000);
  });
}

/** The trusted issuer. SpacetimeDB fetches its keys when a token arrives, so start it first. */
export function startTrustedIssuer(): Promise<MockIssuer> {
  return startIssuer(TRUSTED_PORT);
}

const run = Date.now().toString(36);
let counter = 0;

/** A subject no earlier run or caller has used, so each caller is a new identity. */
export function uniqueSub(label: string): string {
  counter += 1;
  return `${label}-${run}-${counter}`;
}

/** A token for a new signed-in identity: a verified email at the trusted issuer. */
export function signedInToken(issuer: MockIssuer, overrides: Partial<MintOptions> = {}): string {
  return issuer.mint({ sub: uniqueSub('caller'), aud: CLIENT_ID, emailVerified: true, ...overrides });
}

/** A connection as a new signed-in identity. */
export function connectSignedIn(issuer: MockIssuer, overrides: Partial<MintOptions> = {}): Promise<Caller> {
  return connectAs(signedInToken(issuer, overrides));
}
