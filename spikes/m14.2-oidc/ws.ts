/**
 * M14.2, the browser's path: open a WebSocket with an OIDC ID token, the way the
 * reader would after a sign-in redirect, and print the identity the server assigns.
 * run.sh compares it with the identity the HTTP probes saw for the same `sub`.
 *
 *   tsx ws.ts <token>
 */
import { DbConnection } from './.bindings';

const URI = process.env.SPIKE_URI ?? 'ws://127.0.0.1:3100';
const DB = process.env.SPIKE_DB ?? 'oidc-spike';
const token = process.argv[2];

DbConnection.builder()
  .withUri(URI)
  .withDatabaseName(DB)
  .withToken(token)
  .onConnect((conn, identity) => {
    console.log(identity.toHexString());
    conn.disconnect();
    process.exit(0);
  })
  .onConnectError((_ctx, error) => {
    console.log(`refused: ${String(error)}`);
    process.exit(0);
  })
  .build();
setTimeout(() => {
  console.log('timedOut');
  process.exit(0);
}, 15_000);
