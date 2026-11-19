/**
 * M14.1, the subscription half: what each identity's live WebSocket subscription to
 * `my_vault` holds, step by step, as the owner writes, grants and revokes.
 *
 * HTTP SQL answers "can a caller read it once". A viewer reads through a
 * subscription, so this is the path that matters, and it also answers whether a
 * view re-evaluates when a *different* table (`vault_grant`) changes.
 *
 * Every assertion is printed as PASS/FAIL and the process exits non-zero on any
 * FAIL, so `run.sh`'s transcript is the record.
 */
import { DbConnection } from './.bindings';

const URI = process.env.SPIKE_URI ?? 'ws://127.0.0.1:3100';
const DB = process.env.SPIKE_DB ?? 'm14-owner-view';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
}

interface Who {
  name: string;
  conn: DbConnection;
  hex: string;
}

function connect(name: string): Promise<Who> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((conn, identity) => resolve({ name, conn, hex: identity.toHexString() }))
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(() => reject(new Error(`timed out connecting as ${name}`)), 15_000);
  });
}

type Outcome = 'applied' | 'refused' | 'timedOut';

function subscribe(who: Who, sql: string): Promise<Outcome> {
  return new Promise((resolve) => {
    who.conn
      .subscriptionBuilder()
      .onApplied(() => resolve('applied'))
      .onError(() => resolve('refused'))
      .subscribe(sql);
    setTimeout(() => resolve('timedOut'), 15_000);
  });
}

const bodies = (who: Who): string[] =>
  [...who.conn.db.myVault.iter()].map((r) => r.body).sort();

/** Give the server's push a moment to land after a reducer returns. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 750));

async function main(): Promise<void> {
  const owner = await connect('owner');
  const worker = await connect('worker');
  const stranger = await connect('stranger');

  check(
    'the bindings expose the view and the public control, not the private table',
    'myVault' in owner.conn.db &&
      'notice' in owner.conn.db &&
      !('vault' in owner.conn.db),
    `conn.db keys: ${Object.keys(owner.conn.db).join(', ')}`,
  );

  // Positive control first: without it, a refusal below could mean "server down".
  const control = await subscribe(await connect('control'), 'SELECT * FROM notice');
  check(
    'a subscription to the public control table is applied',
    control === 'applied',
    control,
  );
  const raw = await subscribe(await connect('raw'), 'SELECT * FROM vault');
  check('a raw subscription to the private table is refused', raw === 'refused', raw);
  const rawGrant = await subscribe(
    await connect('rawGrant'),
    'SELECT * FROM vault_grant',
  );
  check(
    'a raw subscription to the private grant table is refused',
    rawGrant === 'refused',
    rawGrant,
  );

  for (const who of [owner, worker, stranger]) {
    const outcome = await subscribe(who, 'SELECT * FROM my_vault');
    check(`${who.name} may subscribe to the view`, outcome === 'applied', outcome);
  }

  // The stranger also owns a row, so "the view returns nothing" cannot pass for
  // "the view works": it must return exactly the caller's own.
  await stranger.conn.reducers.put({ body: 'stranger S' });
  await owner.conn.reducers.put({ body: 'owner A' });
  await settle();
  check(
    'owner sees their own row',
    bodies(owner).join() === 'owner A',
    bodies(owner).join(),
  );
  check(
    'ungranted worker sees nothing',
    bodies(worker).length === 0,
    bodies(worker).join(),
  );
  check(
    'stranger sees only their own row',
    bodies(stranger).join() === 'stranger S',
    bodies(stranger).join(),
  );

  await owner.conn.reducers.grant({ workerHex: worker.hex });
  await settle();
  check(
    'a grant is pushed to the worker live, with no resubscribe',
    bodies(worker).join() === 'owner A',
    bodies(worker).join(),
  );
  check(
    'the grant does not reach the stranger',
    bodies(stranger).join() === 'stranger S',
    bodies(stranger).join(),
  );

  await owner.conn.reducers.put({ body: 'owner B' });
  await settle();
  check(
    'a new owner row reaches the granted worker live',
    bodies(worker).join() === 'owner A,owner B',
    bodies(worker).join(),
  );
  check(
    'the new row does not reach the stranger',
    bodies(stranger).join() === 'stranger S',
    bodies(stranger).join(),
  );

  await owner.conn.reducers.revoke({ workerHex: worker.hex });
  await settle();
  check(
    'a revoke removes the rows from the worker live',
    bodies(worker).length === 0,
    bodies(worker).join(),
  );
  check(
    'the owner still sees both rows',
    bodies(owner).join() === 'owner A,owner B',
    bodies(owner).join(),
  );

  for (const who of [owner, worker, stranger]) who.conn.disconnect();
  console.log(
    failures === 0
      ? 'SUBSCRIPTION PROBES: all passed'
      : `SUBSCRIPTION PROBES: ${failures} failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
