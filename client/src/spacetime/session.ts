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
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { SPACETIMEAUTH_AUTHORITY, SPACETIMEAUTH_CLIENT_ID } from './config';
import { loadToken } from './token';
import { rememberedEmail, saveLastAccount } from './lastAccount';
import {
  createSignInKeeper,
  isLive,
  renewSignIn,
  type SignInKeeper,
  type StoredSignIn,
} from './renewal';

export type { StoredSignIn } from './renewal';

export interface Session {
  /** The token the connection opens with. `undefined` asks SpacetimeDB for a new identity. */
  readonly token: string | undefined;
  readonly signedIn: boolean;
}

/**
 * Pure: which token to connect with.
 *
 * An expired ID token is not used. SpacetimeDB would refuse it with a 401 and the
 * connection would retry forever, so the reader falls back to anonymous and is
 * offered "Sign in" again. `startSession` tries a renewal before it gets here.
 */
export function chooseSession(
  signIn: StoredSignIn | null,
  anonymousToken: string | undefined,
  nowS: number,
): Session {
  if (isLive(signIn, nowS) && signIn.id_token) {
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
    // Off: it times renewal by the access token's expiry, not the ID token's. This
    // module schedules renewal itself, from the ID token's `exp` (`createSignInKeeper`).
    automaticSilentRenew: false,
  });
  return manager;
}

export interface StartedSession {
  readonly session: Session;
  /** Present only when signed in: renews the ID token for as long as the page lives. */
  readonly keeper: SignInKeeper | undefined;
  /** This load finished a sign-in redirect: the moment to carry an anonymous identity over. */
  readonly justSignedIn: boolean;
}

/** The keeper's view of the world: the real clock, timers, store and provider. */
function browserDeps() {
  return {
    now: () => Date.now(),
    load: () => userManager().getUser(),
    refresh: () => userManager().signinSilent(),
    setTimer: (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
  };
}

/**
 * Resolve the session before the app renders: finish a sign-in redirect if this is
 * one, then read whatever sign-in is stored, renewing it if its ID token has expired.
 * Only when that renewal fails does the reader fall back to anonymous.
 *
 * A failed callback (a stale or replayed `state`, or the reader cancelling at the
 * provider) is not fatal. The reader simply stays anonymous. Either way the
 * `code`/`state` query is removed, so a reload does not replay it.
 */
export async function startSession(): Promise<StartedSession> {
  let signIn: StoredSignIn | null = null;
  let justSignedIn = false;
  const deps = browserDeps();
  try {
    if (isSignInCallback(window.location.search)) {
      try {
        const user = await userManager().signinRedirectCallback();
        justSignedIn = true;
        window.history.replaceState(null, '', returnPath(user.state));
      } catch (error) {
        console.warn('Sign-in did not complete:', error);
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    const user = await userManager().getUser();
    signIn = user;
    // Kept for "Continue as" once this reader signs out (M15.5).
    const email = user ? rememberedEmail(user.profile) : undefined;
    if (email) saveLastAccount(email);
    if (signIn && !isLive(signIn, deps.now() / 1000)) {
      signIn = await renewSignIn(deps);
    }
  } catch (error) {
    // Storage blocked, or the provider unreachable: browse anonymously.
    console.warn('Could not read the stored sign-in:', error);
  }
  const session = chooseSession(signIn, loadToken(), deps.now() / 1000);
  const keeper =
    session.signedIn && signIn ? createSignInKeeper(signIn, deps) : undefined;
  return { session, keeper, justSignedIn };
}

/**
 * How a signed-out reader asked to sign in (M15.5). `continue` reuses the provider's
 * own session if it still has one, so it can be one click. `another` makes the
 * provider ask for an email whatever it remembers.
 */
export type SignInChoice = 'continue' | 'another';

/**
 * Pure: the extra authorization-request parameters for a choice.
 *
 * `another` sends `prompt=login`, which SpacetimeAuth accepts. It refuses
 * `select_account` (both checked against its authorize endpoint, 2026-11-20), so
 * there is no provider-side account picker to hand this to.
 *
 * `continue` sends nothing extra, deliberately. The first build sent the remembered
 * email as `login_hint`, and the human saw SpacetimeAuth ask for an email anyway.
 * The same request without the hint had signed them straight back in.
 */
export function signInRequest(choice: SignInChoice): { prompt?: 'login' } {
  return choice === 'another' ? { prompt: 'login' } : {};
}

export function signIn(choice: SignInChoice): Promise<void> {
  const here = window.location.pathname + window.location.search;
  return userManager().signinRedirect({ state: here, ...signInRequest(choice) });
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
  /** The email this browser last signed in with, for "Continue as" (M15.5). */
  readonly lastAccount: string | undefined;
  readonly signIn: (choice: SignInChoice) => void;
  readonly signOut: () => void;
}

const noop = () => {};

export const SessionContext = createContext<SessionControls>({
  token: undefined,
  signedIn: false,
  lastAccount: undefined,
  signIn: noop,
  signOut: noop,
});

export function useSession(): SessionControls {
  return useContext(SessionContext);
}
