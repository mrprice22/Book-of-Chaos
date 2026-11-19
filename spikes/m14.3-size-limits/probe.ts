/**
 * M14.3: find, by bisection, the largest payload each path accepts.
 *
 *   tsx probe.ts <http-base> <ws-uri> <db>
 *
 * Three limits, measured separately because they live in different places:
 *
 *   http-arg   `put` over POST /v1/database/<db>/call: a worker's path (M14.5)
 *   ws-arg     `put` over the SDK's WebSocket: a browser's path
 *   row        `put_generated`: the module builds the string itself, so no transport
 *              limit applies and what is left is the row/transaction limit
 *
 * A probe counts as accepted only when the row is read back with the right `len`, so
 * a 200 that stored nothing, or stored something truncated, is a failure. Then a fresh
 * subscriber checks that the largest accepted row actually reaches a client.
 */
import { DbConnection } from './.bindings';

const [HTTP, WS, DB] = process.argv.slice(2);
const KiB = 1024;
const MiB = 1024 * KiB;
/**
 * Past this, stop doubling. A bigger limit than this changes no design decision.
 * `run.sh maincloud` lowers it to 32 MiB: there, every probe costs the account quota.
 */
const CEILING = Number(process.env.CEILING_MIB ?? 128) * MiB;
/** Stop bisecting once the bracket is this tight. */
const RESOLUTION = 16 * KiB;

let token = '';

async function anonToken(): Promise<string> {
  const res = await fetch(`${HTTP}/v1/identity`, { method: 'POST' });
  return ((await res.json()) as { token: string }).token;
}

async function storedLen(label: string): Promise<number | undefined> {
  const res = await fetch(`${HTTP}/v1/database/${DB}/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: `SELECT len FROM blob WHERE label = '${label}'`,
  });
  if (!res.ok) return undefined;
  const rows = ((await res.json()) as { rows: unknown[][] }[])[0]?.rows ?? [];
  return rows.length === 1 ? Number(rows[0][0]) : undefined;
}

async function httpCall(reducer: string, args: unknown[]): Promise<string> {
  try {
    const res = await fetch(`${HTTP}/v1/database/${DB}/call/${reducer}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return res.ok ? 'ok' : `${res.status} ${(await res.text()).slice(0, 160)}`;
  } catch (error) {
    return `threw ${String(error).slice(0, 160)}`;
  }
}

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(WS)
      .withDatabaseName(DB)
      .onConnect((c) => resolve(c))
      .onConnectError((_ctx, e) => reject(e))
      .build();
    setTimeout(() => reject(new Error('connect timed out')), 30_000);
  });
}

/** A fresh connection per probe: an oversized frame may kill the socket it rode on. */
async function wsPut(label: string, body: string): Promise<string> {
  const conn = await connect();
  try {
    return await Promise.race([
      conn.reducers.put({ label, body }).then(
        () => 'ok',
        (e: unknown) => `rejected ${String(e).slice(0, 160)}`,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('timedOut'), 120_000)),
    ]);
  } finally {
    conn.disconnect();
  }
}

type Probe = (label: string, size: number) => Promise<string>;

const probes: Record<string, Probe> = {
  'http-arg': (label, size) => httpCall('put', [label, 'x'.repeat(size)]),
  'ws-arg': (label, size) => wsPut(label, 'x'.repeat(size)),
  row: (label, size) => httpCall('put_generated', [label, size]),
};

let seq = 0;
async function accepts(name: string, size: number): Promise<boolean> {
  const label = `${name}-${size}-${seq++}`;
  const started = Date.now();
  const outcome = await probes[name](label, size);
  const len = outcome === 'ok' ? await storedLen(label) : undefined;
  const ok = len === size;
  const why = outcome !== 'ok' ? outcome : ok ? 'stored' : `200 but stored len ${len}`;
  console.log(
    `  ${name.padEnd(8)} ${fmt(size).padStart(10)}  ${ok ? 'OK  ' : 'FAIL'}  ${Date.now() - started}ms  ${why}`,
  );
  await httpCall('clear', []);
  return ok;
}

function fmt(n: number): string {
  if (n >= MiB) return `${(n / MiB).toFixed(2)} MiB`;
  if (n >= KiB) return `${(n / KiB).toFixed(1)} KiB`;
  return `${n} B`;
}

/** Largest accepted size, or the ceiling if nothing up to it failed. */
async function limit(name: string): Promise<{ max: number; capped: boolean }> {
  let lo = 64 * KiB;
  if (!(await accepts(name, lo))) return { max: 0, capped: false };
  let hi = lo * 2;
  while (hi <= CEILING && (await accepts(name, hi))) {
    lo = hi;
    hi *= 2;
  }
  if (hi > CEILING) return { max: lo, capped: true };
  while (hi - lo > RESOLUTION) {
    const mid = Math.floor((lo + hi) / 2);
    if (await accepts(name, mid)) lo = mid;
    else hi = mid;
  }
  return { max: lo, capped: false };
}

async function delivered(size: number): Promise<string> {
  await httpCall('put_generated', ['delivery', size]);
  const conn = await connect();
  const started = Date.now();
  try {
    return await new Promise<string>((resolve) => {
      conn
        .subscriptionBuilder()
        .onApplied(() => {
          const row = [...conn.db.blob.iter()].find((r) => r.label === 'delivery');
          resolve(
            row && row.body.length === size
              ? `delivered whole in ${Date.now() - started}ms`
              : `applied, but row ${row ? `len ${row.body.length}` : 'missing'}`,
          );
        })
        .onError((ctx) => resolve(`refused: ${ctx.event?.message ?? ''}`))
        .subscribe('SELECT * FROM blob');
      setTimeout(() => resolve('timedOut'), 120_000);
    });
  } finally {
    conn.disconnect();
    await httpCall('clear', []);
  }
}

async function main(): Promise<void> {
  token = await anonToken();
  await httpCall('clear', []);
  const results: Record<string, { max: number; capped: boolean }> = {};
  for (const name of Object.keys(probes)) {
    console.log(`${name}:`);
    results[name] = await limit(name);
  }
  console.log('\nLIMITS');
  for (const [name, r] of Object.entries(results)) {
    console.log(
      `  ${name.padEnd(8)} ${r.capped ? '>=' : '~ '} ${fmt(r.max)}  (${r.max} bytes)`,
    );
  }
  const largest = Math.max(...Object.values(results).map((r) => r.max));
  console.log(`\nsubscriber receives a ${fmt(largest)} row: ${await delivered(largest)}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(2);
});
