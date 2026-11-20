# 0002 — Durable sign-in: OIDC ID tokens from a hosted issuer, checked by the module

**Task:** M14.2 · **Date:** 2026-11-19 · **Status:** decided. The provider is SpacetimeAuth,
approved and enabled by the human the same day, client ID `client_0350We80wbokeNK7YI9r5X`
(see the resolved M14.2 entry in [blocked.md](../blocked.md)).

## Question

How does a reader sign in so that the identity survives a cleared browser, with no mail
server run by this project? The two candidates were SpacetimeDB's OIDC token support and
a hosted identity provider. And what does an existing anonymous `users` row need, to carry
its username over?

## Answer

**The candidates are one mechanism, not two.** SpacetimeDB itself mints only anonymous
tokens (issuer `localhost` on a local server). What it supports is *accepting* an OIDC ID
token from any issuer. It verifies the signature against the issuer's JWKS and derives the
identity from `iss` + `sub`. Someone else has to issue the token, and that is the hosted
provider. The decision is therefore:

1. **The reader signs in with a hosted OIDC provider** and connects with the ID token
   (`withToken`). The identity is a pure function of `(iss, sub)`, so a cleared browser that
   signs in again is the same identity. No state on the device matters.
2. **The module, not the server, decides which issuers count.** The server accepts a valid
   token from *any* OIDC issuer. A module that does not check `iss` and `aud` lets anyone
   who runs an issuer mint any `sub` they like. Every "is this caller signed in" decision
   goes through one function that checks both.
3. **A username carries over by a two-step link** (below), not by trusting the client.

**Provider: SpacetimeAuth** (issuer `https://auth.spacetimedb.com/oidc`, client ID
`client_0350We80wbokeNK7YI9r5X`). This was recommended here and approved by the human. It is
run by SpacetimeDB's makers, it is enabled per Maincloud module from the dashboard, it
offers magic link, GitHub, Google and Discord, among others, and it sends its own mail. So it
meets "no mail server run by this project" without adding a second vendor. It is labelled
beta, and the pricing page lists it as built into Maincloud plans, but which tiers include it
could not be read reliably. That, and the dashboard setup, is why it waited on a human.

## Evidence

`spikes/m14.2-oidc/` holds a module, a mock OIDC issuer (`issuer.mjs`: discovery, JWKS and
a `/mint` endpoint) and `run.sh`, the reproduction:

```bash
./scripts/dev.sh run spikes/m14.2-oidc/run.sh                 # exit 0
./scripts/dev.sh run 'TRUST_ANY=1 spikes/m14.2-oidc/run.sh'   # negative control: exit 1
```

It runs a scratch SpacetimeDB 2.8.0 on port 3100 (module crate pinned `=2.8.0`), a trusted
issuer on 3200, and on 3201 a second, valid issuer that the module does not trust. The
mock stands in for the provider's login page, which is the part that does not involve
SpacetimeDB. Recorded run, 2026-11-19: **24 of 24 probes passed.**

| Probe | Result |
|---|---|
| A second, freshly minted token for the same `sub` (a cleared browser signing in again) | same identity |
| A different `sub` / the same `sub` at another issuer | a different identity / a different identity |
| The WebSocket path (`withToken`, as the reader would) | same identity as over HTTP |
| A token signed by a key outside the JWKS | HTTP 401, WebSocket refused |
| A token 10 minutes past `exp` | HTTP 401 |
| A token 30 s past `exp` | **accepted**: the validator allows some leeway (printed, not asserted) |
| A valid token from the issuer nobody chose | **accepted by the server**. The module's check is what refuses it |
| The right issuer, the wrong `aud` | not signed in |
| Carry-over: `begin_link` by a signed-in caller, or by one with no username | refused |
| The link code | readable by the old identity only, through a `ViewContext` view (decision [0001](./0001-owner-only-reads.md)) |
| `complete_link` by an anonymous caller, the untrusted issuer's caller, or with a wrong code | refused |
| `complete_link` by the signed-in caller | the username moves, the old identity has no row, the code is burnt |
| The same `sub` on yet another fresh token | still holds the username |

**Watched failing.** `TRUST_ANY=1` builds the module with the `iss`/`aud` check removed.
Five probes go red. Worst among them: the untrusted issuer's `carol` completes the link and
takes `ada`'s username, and the genuine sign-in is then told the link was already used. That
is the attack check 2 exists to stop, and it is not hypothetical.

## The carry-over, and what it must move

Neither identity can vouch for the other inside one reducer call, because a call has one
caller. So:

1. The **anonymous** identity calls `begin_link`. The server stores a random one-time code in
   a private table, readable only by that identity.
2. The browser still holds the anonymous token in localStorage when the sign-in redirect
   returns. It reads the code with that token, then calls `complete_link(code)` with the new
   one. To the user it is one click.
3. `complete_link` requires a trusted signed-in caller with no username of its own, and a
   fresh, unused code. Then it moves the row and burns the code.

The spike moves only `users`. **The real module has four identity-keyed tables:**
`users.identity`, `books.owner`, `reader_progress.identity` and `quiz_attempts.identity`.
A link that moved only the username would leave a returning author locked out of their own
books. So M15.2's `complete_link` rewrites all four in the same transaction, refuses if the
new identity already owns rows in any of them, and is tested on each.

## Consequences for later work

- **Trusted issuers are per build.** The trusted issuer and client id cannot be one constant.
  The hosted module needs SpacetimeAuth's, while the e2e stages need a mock issuer like this
  spike's, because no CI run can click through a login page. This record first proposed an
  operator-only reducer, with `init` recording the publisher. That does not work. SpacetimeDB
  2.8 gives a module no way to learn its database owner, and the hosted database's `init` ran
  long before this existed. So the pairs are build-time configuration (`option_env!`), set by
  `deploy.sh` per target (M15.3). The client id is public by design (it ships in the page), so
  committing it is fine.
- **M15.3.** "Anonymous" means *not signed in by the module's rule*, which is wider than
  "the token's issuer is `localhost`". A valid token from an untrusted issuer is anonymous
  too. The rejection test per writing reducer should use one of each.
- **Expiry.** ID tokens expire (the mock used an hour). The client must refresh, or send the
  user back through sign-in, before reconnecting with a stale token. Otherwise a reconnect
  fails with 401.

## SpacetimeAuth's own anonymous login

The project's login page offers an **anonymous** option beside the magic link. A token from
it carries SpacetimeAuth's issuer and this project's client ID, so it passes check 2 as the
spike wrote it. "Signed in" for v0.3 means a reader who can come back as the same person.
An anonymous SpacetimeAuth login is not that, and it must not be able to claim a username
through `complete_link` or fork (M15.3).

The human has ruled that anonymous login **stays on**. An anonymous reader gets read-only
access to the books enabled for anonymous access (the scope's second 2026-11-19 amendment).
So turning it off in the dashboard is not an option. The module has to tell an anonymous
SpacetimeAuth token from a signed-in one by a claim. Which claim marks it is not documented
in what was read, so M15.1 starts by signing in both ways and reading the two payloads
(`raw_payload()`). M15.3's rejection tests then include a token shaped like the anonymous
one.

## Not measured

- **`login_method` is *not* the anonymous marker. `email_verified` is.** This record said
  `login_method` would tell the two apart. Both real tokens read on 2026-11-20 carry
  `login_method: "magic_link"`, the magic-link sign-in *and* SpacetimeAuth's anonymous
  login. What differs: the magic-link token has `email` and `email_verified: true`, and the
  anonymous one has neither, plus `name: "Anonymous User"`. So the module's rule is that
  **signed in = trusted `iss`, our `aud`, and `email_verified == true`**. Matching on the
  name would break the day SpacetimeAuth rewords it. If another login method is enabled
  later (GitHub, say), check its token for `email_verified` before relying on this rule.
  The anonymous login reporting `magic_link` looks like a SpacetimeAuth bug and may be
  fixed, so nothing here depends on that value either way.
- **ID tokens last 15 minutes** (`exp − iat = 900` on that token). A durable identity is not
  a durable session, so M15.4 adds renewal. A refresh token **is** issued when the client
  asks for `offline_access`: the stored sign-in held one on the human's check, 2026-11-20.
- **A real SpacetimeAuth token.** The project exists and its discovery document, client ID
  and redirect URIs were checked (blocked.md, resolved M14.2). But no one has signed in, so
  no real token has been through a module yet. That is M15.1's first live run.
- **Maincloud's anonymous issuer.** The local server's anonymous tokens say `localhost`.
  Maincloud's were not looked at, and the design does not rely on the value: anything that
  fails the trusted-issuer check is anonymous.
- **Whether a self-hosted server can validate SpacetimeAuth tokens.** The local dev server
  would fetch its JWKS over the public internet. That is expected to work, but it is
  undocumented and the CI design above does not need it.
