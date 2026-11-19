# 0005 — A worker is an HTTP client holding one saved SpacetimeDB token

**Task:** M14.5 · **Date:** 2026-11-19 · **Status:** decided

## Question

Can a non-browser process, Python here, which is the shape of every integration's worker,
call a reducer and run a SQL query over the HTTP API with a persistent token? Is it still
the same identity after a restart?

## Answer

**Yes, with nothing but the standard library.** A worker:

1. on its first run, mints an identity with `POST /v1/identity` and saves the token to a
   file with mode `600`;
2. on every run after that, loads the token and sends it as `Authorization: Bearer`;
3. calls reducers with `POST /v1/database/<db>/call/<reducer>` (a JSON array of arguments)
   and reads with `POST /v1/database/<db>/sql` (the SQL as the body).

That identity is what the work's owner authorizes in `work_workers` (M16.3). A worker does
not sign in through SpacetimeAuth. It is a machine, and the browser sign-in in
[0002](./0002-durable-sign-in.md) is for people.

## Evidence

`spikes/m14.5-python-worker/` holds a module with `hello(label)`, which records the caller,
and `refuse()`, which always errs. Next to it is `worker.py`, which uses `urllib` and `json`
only, and `run.sh`, which runs the worker as four separate processes.

```bash
./scripts/dev.sh run spikes/m14.5-python-worker/run.sh   # exit 0
```

Recorded run, 2026-11-19, local SpacetimeDB 2.8.0, Python 3.14: **9 of 9 probes passed.**

| Probe | Result |
|---|---|
| Run 1, no token file | mints one, saved with mode `600` |
| Run 2, a new process | reuses the file, **same identity as the server recorded it** |
| Run 3, a new process after the *database server* restarted on the same data dir | same identity |
| The token's `hex_identity` claim | agrees with what the server recorded |
| Control: run 4 with the token file deleted | a different identity, so the file is what carries it |
| `refuse` | HTTP 530, body is the reducer's own message verbatim |

The identity compared is the one the **server** wrote into the row (`ctx.sender()`, read
back over SQL), not the one the token claims. A client could misreport the second, but it
cannot misreport the first.

## Consequences

1. **A worker's token does not expire.** Tokens minted locally and on Maincloud both carry
   `iss: localhost`, `aud: ["spacetimedb"]` and **no `exp`**. That was checked on Maincloud by
   minting one and decoding its claims only. So a leaked worker token is good forever, and
   SpacetimeDB has no way to revoke it. Revocation is the owner removing that identity from
   `work_workers` (M16.3), and every worker-only reducer has to check that table on every
   call. The token file is a credential: mode `600`, never committed, never logged.
2. **A worker's token is "anonymous" by 0002's rule.** Its issuer is `localhost`, which is not
   the trusted issuer. That is correct and intended. A worker writes because it is in
   `work_workers`, not because it signed in. So M15.3's "anonymous callers write nothing"
   must be stated as *anonymous people*: the rule exempts identities a work has authorized as
   workers, for that work's worker reducers only. M15.3 and M16.3 are amended to match.
3. **Errors are legible to a worker.** A refused reducer is HTTP 530 with the module's own
   message as the body, the same message a browser toast shows. The contract (M21) documents
   530 alongside 401 (a bad token, [0002](./0002-durable-sign-in.md)) and 413 (an oversized
   call, [0003](./0003-size-limits.md)).
4. **Workers write over HTTP, so 0003's 2 MiB HTTP limit is the one that binds them.** It
   already set the caps.

## Not measured

- **A worker on Maincloud.** The calls ran locally. The HTTP API is the same one M14.3
  exercised on Maincloud, where reducer calls and SQL behaved identically. The Maincloud
  token's claims were checked, but no Maincloud database was touched for this spike.
- **Windows.** The fate worker runs there (the scope's deferred table). Nothing here is
  platform-specific beyond the file mode, which Windows does not honour. The integration
  contract should say to keep the token in a user-only location.
