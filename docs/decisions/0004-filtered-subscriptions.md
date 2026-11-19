# 0004 — Filtered subscriptions: `useTable(tables.x.where(...))`, never an unfiltered one

**Task:** M14.4 · **Date:** 2026-11-19 · **Status:** decided

## Question

Can the React client subscribe to one work's nodes, or one branch's, so that it never
receives every work's every node? And how many rows does it receive before and after?

## Answer

**Yes, and the filter runs on the server.** `useTable` from `spacetimedb/react` takes a
query-builder expression and subscribes with `toSql(query)`, so a `where` on `work_id` or
`branch_id` becomes a `WHERE` in the subscription itself. It then filters the shared client
cache by the same expression. That second step is the caveat below. Filtering works on a
plain public table **and on a `ViewContext` view**, which is the shape private branches need
(M17.2 with [0001](./0001-owner-only-reads.md)).

v0.3's screens subscribe like this:

```tsx
const [nodes] = useTable(tables.visibleNodes.where((r) => r.branchId.eq(branchId)));
```

## Evidence

`spikes/m14.4-filtered-subs/` seeds 5 works × 4 branches × 50 nodes = 1000 nodes into a
public table (`pub_nodes`), and the same 1000 into a private table behind the view
`visible_nodes`. The view shows public branches plus the caller's own, and the last branch
of every work is private. `probe.ts` builds each query with the generated query builder and
sends `query.toSql()`, the hook's own path. It counts rows from the connection's **raw
client cache** (`conn.db.<table>.count()`), which holds everything the server sent. A
filter applied only on the client would therefore show up as the unfiltered count.

```bash
./scripts/dev.sh run spikes/m14.4-filtered-subs/run.sh   # exit 0
```

Recorded run, 2026-11-19, local SpacetimeDB 2.8.0: **12 of 12 probes passed.** The SQL the
hook sends:

```sql
SELECT * FROM "pub_nodes" WHERE ("pub_nodes"."work_id" = 2) AND ("pub_nodes"."branch_id" = 202)
```

| Subscription | Rows the client received |
|---|---|
| `pub_nodes`, unfiltered | **1000** (every work, every node) |
| `pub_nodes` WHERE `work_id = 2` | **200** |
| `pub_nodes` WHERE `work_id = 2 AND branch_id = 202` | **50** |
| …then a node is appended to work 3, and one to work 2's sibling branch | still 50: neither arrived |
| …then a node is appended to branch 202 | 51, live |
| Switch: subscribe to branch 301, then unsubscribe 202 | 51 rows, all from 301, none left from 202 |
| `visible_nodes` as a stranger, unfiltered | 753 (public branches only) |
| `visible_nodes` as a stranger, WHERE `work_id = 2` | 152 |
| `visible_nodes` as a stranger, WHERE `branch_id` = a private branch | **0** |
| `visible_nodes` as the owner, WHERE `work_id = 2` | 202 (their private branch included) |
| `visible_nodes` as the owner, WHERE `branch_id` = their private branch | 50 |

The unfiltered row is the control. The same cache that holds 50 under a filter holds 1000
without one, so the smaller counts are rows the server did not send. They are not rows the
client hid.

## Consequences

1. **One unfiltered `useTable` undoes the rest.** The client cache is shared per table. The
   hook narrows its own result by `where`, but if any component anywhere subscribes to
   `tables.visibleNodes` unfiltered, every visible node crosses the wire. v0.2's screens
   subscribe to `books`, `chapters` and `knowledge_blocks` unfiltered, which is fine at
   their size. v0.3's work and node tables must never be subscribed unfiltered. M20.4 carries
   this as a rule, with a test that the routes' subscriptions all carry a `WHERE`.
2. **Navigating is subscribe-then-unsubscribe.** Rows from the old branch leave the cache
   when its subscription goes, and `useTable` does this itself when its query changes. No
   manual cleanup is needed.
3. **A filter on a view saves bandwidth, not server work.** The server evaluates the whole
   view for the caller (753 rows here) and then applies the `WHERE`. That is fine at this
   size. If one caller's visible set across all works ever gets large, the fix is a view
   that takes the work as an argument. It was not needed, so it was not measured.

## Not measured

- **A real browser rendering the hook.** The probe drove the same SDK and sent the same SQL
  the hook builds (`toSql`, then `subscribe(querySql)`, read off
  `spacetimedb/dist/react/index.mjs`). It did not render React. The first M20.4 route is
  where a real page is counted.
- **Maincloud.** Run locally only. Filtering is query semantics, not configuration, and M14.3
  found Maincloud and local alike where they could be compared.
- **Bytes and latency.** Row counts were asked for and measured. Wire bytes were not.
