/**
 * The answer key must not reach the browser.
 *
 * This is the load-bearing constraint of v0.2 (see
 * [v0.2-scope.md](../../docs/v0.2-scope.md#the-answer-key-must-not-reach-the-browser)):
 * a quiz whose answers ship to the reader is a "Mark as complete" button with extra
 * steps, and would leave the release exactly where v0.1 was. So it is *tested*
 * against a live database rather than argued from the table definition.
 *
 * Two independent things are asserted, because they can fail independently:
 *
 * 1. **The bindings expose no way to ask.** `spacetime generate` emits a table
 *    accessor for every table in the *client's* view of the schema. `quiz_options`
 *    gets one; `quiz_answer_key` does not. Not a stale-file check, either: the
 *    `webServer` these tests run against is `deploy.sh local`, which regenerates the
 *    bindings from the module it publishes, so `conn.db` reflects the schema that is
 *    actually running.
 *
 * 2. **The server refuses to be asked anyway.** Point 1 is about generated code, and
 *    generated code can be worked around by writing the SQL by hand. So a raw
 *    subscription naming the table is issued directly, and must be refused. The
 *    positive control is the same subscription against `quiz_options`, which must
 *    apply — without it, this test would pass just as happily if the database were
 *    down, the module unpublished, or the query malformed.
 *
 * Both were watched failing before being trusted, per M9's rule that a test which has
 * never been seen to fail is not evidence: adding `public` to the `quiz_answer_key`
 * table turns exactly these two red — the raw subscription comes back `applied` and
 * the accessor appears on `conn.db` — while both controls stay green.
 *
 * What this file does *not* yet assert is that a *populated* key stays hidden: no
 * reducer can write `quiz_answer_key` until `set_quiz` lands in M10.2, so there are
 * no rows to hide. That is a smaller gap than it sounds — visibility here is a
 * schema property, not a row property, and a table the client cannot name is one it
 * cannot name when full. M10.2 adds the row-level assertion on top.
 *
 * No browser: this drives the real SDK from Node, like `auth-reject.spec.ts`, and is
 * a Playwright test only to reuse the one `webServer` that brings the stack up.
 */
import { test, expect } from '@playwright/test';
import { DbConnection } from '../src/module_bindings';

const URI = process.env.SPACETIME_URI ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIME_DB_NAME ?? 'book-of-chaos';

/** The private table. Named as the server names it, because that is what SQL takes. */
const ANSWER_KEY_TABLE = 'quiz_answer_key';
/** Its public sibling — same shape of query, same connection kind, opposite verdict. */
const PUBLIC_TABLE = 'quiz_options';

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .onConnect((c) => resolve(c))
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(() => reject(new Error(`Timed out connecting to ${URI}/${DB_NAME}`)), 15_000);
  });
}

type Outcome =
  | { tag: 'applied' }
  | { tag: 'refused'; message: string }
  | { tag: 'timedOut' };

/**
 * Issue one raw SQL subscription and report what the server did with it.
 *
 * A fresh connection per query: a refused subscription is an error condition for the
 * connection that raised it, so sharing one would let the refusal under test
 * contaminate the control. `timedOut` is a distinct outcome rather than a thrown
 * error, so a hung server reads as "neither applied nor refused" instead of quietly
 * resembling one of them.
 */
async function subscriptionOutcome(sql: string): Promise<Outcome> {
  const conn = await connect();
  try {
    return await new Promise<Outcome>((resolve) => {
      conn
        .subscriptionBuilder()
        .onApplied(() => resolve({ tag: 'applied' }))
        .onError((ctx) => resolve({ tag: 'refused', message: ctx.event?.message ?? '' }))
        .subscribe(sql);
      setTimeout(() => resolve({ tag: 'timedOut' }), 15_000);
    });
  } finally {
    conn.disconnect();
  }
}

test('the generated bindings expose the public quiz tables', async () => {
  // The control for the assertion below: if `spacetime generate` had emitted no quiz
  // tables at all — a stale bindings directory, a failed regeneration — the absence
  // of the answer key would prove nothing.
  const conn = await connect();
  try {
    expect(Object.keys(conn.db)).toEqual(
      expect.arrayContaining(['quizConfig', 'quizQuestions', 'quizOptions']),
    );
  } finally {
    conn.disconnect();
  }
});

test('the generated bindings expose no answer-key table', async () => {
  const conn = await connect();
  try {
    expect(Object.keys(conn.db)).not.toContain('quizAnswerKey');
  } finally {
    conn.disconnect();
  }
});

test('a raw subscription to the public options table is applied', async () => {
  const outcome = await subscriptionOutcome(`SELECT * FROM ${PUBLIC_TABLE}`);
  expect(
    outcome,
    'the control must succeed, or a refusal below proves nothing about privacy',
  ).toEqual({ tag: 'applied' });
});

test('a raw subscription to the answer-key table is refused', async () => {
  const outcome = await subscriptionOutcome(`SELECT * FROM ${ANSWER_KEY_TABLE}`);
  // Asserted on the tag rather than on the message: the wording belongs to
  // SpacetimeDB and may change between versions, but "refused" is the contract.
  expect(outcome.tag, `server answered ${JSON.stringify(outcome)}`).toBe('refused');
});
