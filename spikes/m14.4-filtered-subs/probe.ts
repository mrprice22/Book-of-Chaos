/**
 * M14.4: how many rows does a client receive, unfiltered and filtered?
 *
 *   tsx probe.ts <ws-uri> <db>
 *
 * The queries are built with the generated query builder and sent as `query.toSql()`,
 * which is exactly what `useTable` from `spacetimedb/react` does: it subscribes with
 * `toSql(query)` and then filters the shared client cache by the same `where`. So the
 * client cache measured here is what a React page using that hook would hold.
 *
 * Counts are read from the connection's client cache (`conn.db.<table>.count()`), which
 * holds every row the server sent for the connection's subscriptions. They are not read
 * from a filtered `iter()`, which would hide an unfiltered transfer.
 */
import { DbConnection, tables } from './.bindings';

const [WS, DB] = process.argv.slice(2);
const WORKS = 5;
const BRANCHES = 4;
const NODES = 50;

let failures = 0;
function check(label: string, want: number, got: number): void {
  if (want !== got) failures++;
  console.log(`${want === got ? 'PASS' : 'FAIL'}  ${label}  (want ${want}, got ${got})`);
}

function connect(): Promise<{ conn: DbConnection; hex: string }> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(WS)
      .withDatabaseName(DB)
      .onConnect((conn, identity) => resolve({ conn, hex: identity.toHexString() }))
      .onConnectError((_ctx, e) => reject(e))
      .build();
    setTimeout(() => reject(new Error('connect timed out')), 15_000);
  });
}

function subscribe(conn: DbConnection, sql: string) {
  return new Promise<{ unsubscribe: () => void }>((resolve, reject) => {
    const handle = conn
      .subscriptionBuilder()
      .onApplied(() => resolve(handle))
      .onError((ctx) => reject(new Error(`refused: ${sql}: ${ctx.event?.message ?? ''}`)))
      .subscribe(sql);
    setTimeout(() => reject(new Error(`timed out: ${sql}`)), 15_000);
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 750));

/** One fresh connection, one subscription, the client-cache count of one table. */
async function countFor(
  sql: string,
  table: 'pubNodes' | 'visibleNodes',
  as?: DbConnection,
) {
  const conn = as ?? (await connect()).conn;
  const handle = await subscribe(conn, sql);
  const n = conn.db[table].count();
  handle.unsubscribe();
  if (!as) conn.disconnect();
  return Number(n);
}

async function main(): Promise<void> {
  const { conn: seeder } = await connect();
  await seeder.reducers.seed({ works: 5n, branchesPerWork: 4n, nodesPerBranch: 50n });

  const total = WORKS * BRANCHES * NODES;
  const perWork = BRANCHES * NODES;
  const publicPerWork = (BRANCHES - 1) * NODES;

  const all = tables.pubNodes.toSql();
  const work2 = tables.pubNodes.where((r) => r.workId.eq(2n)).toSql();
  const branch202 = tables.pubNodes
    .where((r) => r.workId.eq(2n).and(r.branchId.eq(202n)))
    .toSql();
  console.log(`SQL the hook would send:\n  ${all}\n  ${work2}\n  ${branch202}`);

  console.log('\npublic table');
  check('unfiltered: every work, every node', total, await countFor(all, 'pubNodes'));
  check('WHERE work_id = 2', perWork, await countFor(work2, 'pubNodes'));
  check(
    'WHERE work_id = 2 AND branch_id = 202',
    NODES,
    await countFor(branch202, 'pubNodes'),
  );

  console.log('\nlive updates on a filtered subscription');
  const { conn: viewer } = await connect();
  const live = await subscribe(viewer, branch202);
  await seeder.reducers.append({ workId: 3n, branchId: 301n, body: 'elsewhere' });
  await seeder.reducers.append({ workId: 2n, branchId: 203n, body: 'sibling branch' });
  await settle();
  check(
    'a node on another work or branch never arrives',
    NODES,
    Number(viewer.db.pubNodes.count()),
  );
  await seeder.reducers.append({ workId: 2n, branchId: 202n, body: 'on this branch' });
  await settle();
  check(
    'a node on this branch arrives live',
    NODES + 1,
    Number(viewer.db.pubNodes.count()),
  );

  console.log('\nnavigating: unsubscribe one branch, subscribe another');
  const next = await subscribe(
    viewer,
    tables.pubNodes.where((r) => r.branchId.eq(301n)).toSql(),
  );
  live.unsubscribe();
  await settle();
  const rows = [...viewer.db.pubNodes.iter()];
  check('the cache holds only the new branch', NODES + 1, rows.length);
  check(
    'none of the old branch is left behind',
    0,
    rows.filter((r) => r.branchId === 202n).length,
  );
  next.unsubscribe();
  viewer.disconnect();

  console.log('\nview over a private table (private branches hidden)');
  const vAll = tables.visibleNodes.toSql();
  const vWork2 = tables.visibleNodes.where((r) => r.workId.eq(2n)).toSql();
  const vPrivate = tables.visibleNodes.where((r) => r.branchId.eq(204n)).toSql();
  // The appends above added one node each to branches 301, 203 and 202, all public.
  check(
    'stranger, unfiltered: public branches only',
    WORKS * publicPerWork + 3,
    await countFor(vAll, 'visibleNodes'),
  );
  check(
    'stranger, WHERE work_id = 2',
    publicPerWork + 2,
    await countFor(vWork2, 'visibleNodes'),
  );
  check(
    'stranger, WHERE branch_id = <a private branch>',
    0,
    await countFor(vPrivate, 'visibleNodes'),
  );
  check(
    'owner, WHERE work_id = 2: their private branch too',
    perWork + 2,
    await countFor(vWork2, 'visibleNodes', seeder),
  );
  check(
    'owner, WHERE branch_id = <their private branch>',
    NODES,
    await countFor(vPrivate, 'visibleNodes', seeder),
  );

  seeder.disconnect();
  console.log(
    failures === 0
      ? '\nSPIKE: every probe passed'
      : `\nSPIKE: ${failures} probe(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(2);
});
