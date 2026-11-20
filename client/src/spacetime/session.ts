// Who this browser connects as: a signed-in reader, or an anonymous one.
//
// Sign-in is an OIDC ID token from SpacetimeAuth, sent as the connection token.
// SpacetimeDB derives the identity from the token's `iss` + `sub`, so a reader who
// clears their browser and signs in again is the same identity
// (docs/decisions/0002-durable-sign-in.md). Anonymous readers keep the token
// SpacetimeDB mints for them, in localStorage, as before. That token is kept even
// while signed in, because M15.2's username carry-over needs it.
//
// `oidc-client-ts` does the redirect flow (PKCE, state and nonce checks).

import { createContext, useContext } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { SPACETIMEAUTH_AUTHORITY, SPACETIMEAUTH_CLIENT_ID } from './config';
import { loadToken } from './token';

export interface Session {
  /** The token the connection opens with. `undefined` asks SpacetimeDB for a new identity. */
  readonly token: string | undefined;
  readonly signedIn: boolean;
}

/** The ID token's fields this module reads. A narrow shape so tests need no real `User`. */
export type StoredSignIn = Pick<User, 'id_token' | 'expired'>;

/**
 * Pure: which token to connect with.
 *
 * An expired ID token is not used. SpacetimeDB would refuse it with a 401 and the
 * connection would retry forever, so the reader falls back to anonymous and is
 * offered "Sign in" again.
 */
export function chooseSession(
  signIn: StoredSignIn | null,
  anonymousToken: string | undefined,
): Session {
  if (signIn?.id_token && signIn.expired !== true) {
    return { token: signIn.id_token, signedIn: true };
  }
  return { token: anonymousToken, signedIn: false };
}

/** Pure: is this page load the provider redirecting back after a sign-in? */
export function isSignInCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

/** Pure: only a same-site path is a valid place to return to after sign-in. */
export function returnPath(state: unknown): string {
  return typeof state === 'string' && state.startsWith('/') && !state.startsWith('//')
    ? state
    : '/';
}

let manager: UserManager | undefined;

/** Built on first use, so importing this module in a test touches no browser API. */
function userManager(): UserManager {
  manager ??= new UserManager({
    authority: SPACETIMEAUTH_AUTHORITY,
    client_id: SPACETIMEAUTH_CLIENT_ID,
    redirect_uri: `${window.location.origin}/`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: 'code',
    // offline_access asks for a refresh token, so a sign-in can outlive its ID token.
    scope: 'openid profile email offline_access',
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
  return manager;
}

/**
 * Resolve the session before the app renders: finish a sign-in redirect if this is
 * one, then read whatever sign-in is stored.
 *
 * A failed callback (a stale or replayed `state`, or the reader cancelling at the
 * provider) is not fatal. The reader simply stays anonymous. Either way the
 * `code`/`state` query is removed, so a reload does not replay it.
 */
export async function startSession(): Promise<Session> {
  let signIn: StoredSignIn | null = null;
  try {
    if (isSignInCallback(window.location.search)) {
      try {
        const user = await userManager().signinRedirectCallback();
        window.history.replaceState(null, '', returnPath(user.state));
      } catch (error) {
        console.warn('Sign-in did not complete:', error);
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    signIn = await userManager().getUser();
  } catch (error) {
    // Storage blocked, or the provider unreachable: browse anonymously.
    console.warn('Could not read the stored sign-in:', error);
  }
  return chooseSession(signIn, loadToken());
}

export function signIn(): Promise<void> {
  const here = window.location.pathname + window.location.search;
  return userManager().signinRedirect({ state: here });
}

/**
 * Sign out at the provider too, so the next "Sign in" asks again. If the provider
 * cannot be reached, forget the sign-in locally, which is enough to browse anonymously.
 */
export async function signOut(): Promise<void> {
  try {
    await userManager().signoutRedirect();
  } catch (error) {
    console.warn('Provider sign-out failed; signing out locally:', error);
    await userManager().removeUser();
    window.location.reload();
  }
}

export interface SessionControls extends Session {
  readonly signIn: () => void;
  readonly signOut: () => void;
}

const noop = () => {};

export const SessionContext = createContext<SessionControls>({
  token: undefined,
  signedIn: false,
  signIn: noop,
  signOut: noop,
});

export function useSession(): SessionControls {
  return useContext(SessionContext);
}
