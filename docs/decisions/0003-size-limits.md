# 0003 — Size limits, and the caps they set

**Task:** M14.3 · **Date:** 2026-11-19 · **Status:** decided

## Question

What are the largest row and the largest reducer argument that SpacetimeDB accepts, on
Maincloud as well as locally? They set the caps for documents, schemas, view manifests and
journal payloads, and how a journal is chunked.

## Answer

**The binding limit is the HTTP request body: about 2 MiB, on both targets.** A worker
calls reducers over HTTP (M14.5), so everything a worker writes has to fit in one HTTP call.
The WebSocket allows more, and rows allow far more. So the caps below are set against
2 MiB, with room for JSON escaping.

| Cap | Value | Where it is enforced |
|---|---|---|
| A document's `body_json` (M18.1) | **256 KiB** | the reducer, and the client before it sends |
| A schema's JSON Schema (M16.5) | **64 KiB** | the reducer |
| A view manifest (M16.5) | **64 KiB** | `rules.rs`, as the "oversized manifest" case |
| One journal or checkpoint chunk (M18.3) | **256 KiB**, more is split across rows | the reducer |
| Any one string argument, the general rule | 256 KiB of UTF-8 | every reducer that takes free text |

Why 256 KiB: these values travel as JSON strings inside a JSON request. Escaping can grow a
string up to 6× in the worst case (a control character becomes `\u00XX`), and
256 KiB × 6 = 1.5 MiB. That still fits under 1.98 MiB with room for the other arguments. A
typical document grows by well under 1.5×, so the cap is not tight in practice. The point is
that no input, however odd, can turn into a 413.

## Evidence

`spikes/m14.3-size-limits/` has a module with `put(label, body)` (the payload *is* the
argument), `put_generated(label, len)` (the module builds the string itself, so no
transport limit applies) and `clear`. `probe.ts` bisects each path to 16 KiB and counts a
probe as accepted only when the row reads back with the right length.

```bash
./scripts/dev.sh run 'spikes/m14.3-size-limits/run.sh local'
./scripts/dev.sh run 'spikes/m14.3-size-limits/run.sh maincloud'   # needs the account owner's go-ahead
```

Recorded runs, 2026-11-19, SpacetimeDB 2.8.0. Locally the probes went up to 128 MiB. On
Maincloud they stopped at 32 MiB, to spare the account's quota. The Maincloud run used the
throwaway database `boc-m14-3-limits-666ba612`, which was deleted on exit, and
`spacetime list` afterwards shows only `book-of-chaos-83i7y`.

| Path | Local | Maincloud | Past the limit |
|---|---|---|---|
| Reducer argument over HTTP (JSON body) | 1.98 MiB ok, 2.00 MiB refused | 1.98 MiB ok, 2.00 MiB refused | `413 Failed to buffer the request body: length limit exceeded` |
| Reducer argument over the SDK's WebSocket | 31.98 MiB ok, 32 MiB refused | ≥ 23.08 MiB (see below) | **no error: the call never settles** |
| Row, built in the module | ≥ 128 MiB | ≥ 32 MiB | not reached |
| Largest row reaching a fresh subscriber | 128 MiB, whole, in 3.7 s | 32 MiB, whole, in 0.7 s | — |

**The Maincloud WebSocket figure is a timeout, not a limit.** Every probe there that
"failed" hit the probe's 120 s timeout, and the largest success (23.08 MiB) took 118 s. The
uplink from this machine ran at roughly 0.2 MiB/s. Locally the same path failed at exactly
32 MiB while 31.98 MiB took 1.3 s, which is a real frame limit. Nothing in the caps depends
on which of the two Maincloud has, because both are an order of magnitude above 2 MiB.

## Consequences

1. **An oversized WebSocket call hangs instead of failing.** The SDK's reducer promise
   neither resolves nor rejects. A browser that sent one would show a spinner forever. So
   the client checks every cap *before* sending. The reducer checks it again, because the
   trust boundary is the reducer.
2. **A journal is chunked by the worker, not the server.** M18.3 stores the journal and its
   checkpoints as ordered chunks of at most 256 KiB under the node they belong to. The
   worker splits them, and the reader of the owner-only view joins them.
3. **Rows are not the constraint.** A 32 MiB row was stored and delivered on Maincloud, so
   the caps are about what one call can carry. Storage is not what limits them.
4. **The integration contract states these numbers** (M21). An integration needs them before
   it writes a byte. The contract should cite this record, not restate a guess.

## Not measured

- **Many rows in one transaction.** Only one row per call was measured. A reducer that writes
  many chunks at once is bounded by the same 2 MiB of argument, so it was not needed.
- **Throughput and cost.** The Maincloud timings measure this machine's uplink. The energy a
  large write costs on Maincloud was not read off the dashboard.
- **SpacetimeDB versions after 2.8.0.** These are configuration-shaped limits (an HTTP
  body cap, a WebSocket frame cap), and an upgrade could move them. Re-run `run.sh local`
  when the pin changes.
