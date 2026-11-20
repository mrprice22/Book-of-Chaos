// Keeping a sign-in alive past its ID token (M15.4).
//
// SpacetimeAuth's ID tokens last 900 s (docs/decisions/0002-durable-sign-in.md), and
// SpacetimeDB checks the token when a connection opens. A reconnect with a stale token
// is refused with a 401. So the token the connection builder holds is replaced before
// it expires, by spending the refresh token SpacetimeAuth issues for `offline_access`.
//
// Everything here takes its clock, store and provider as arguments, so it is tested
// without a browser or a network. `session.ts` wires it to oidc-client-ts.

import type { User } from 'oidc-client-ts';

/** The stored sign-in's fields this module reads. A narrow shape so tests need no real `User`. */
export type StoredSignIn = Pick<User, 'id_token' | 'refresh_token'>;

/**
 * Seconds of life an ID token must have left to be sent. A connection opened with a
 * token that expires in transit is refused, so a token this close to its end counts
 * as expired already.
 */
export const EXPIRY_LEEWAY_S = 30;

/** Renew this long before the ID token's expiry, so a reconnect never meets a stale one. */
export const RENEW_AHEAD_S = 60;

/** After a failed renewal, try again this soon (bounded by the token's own expiry). */
export const RENEW_RETRY_MS = 15_000;

/**
 * Pure: the ID token's own `exp`, in epoch seconds, or `undefined` if it cannot be read.
 *
 * This, not oidc-client-ts's `User.expired`, is what decides. `expired` follows the
 * *access* token's `expires_in`, and SpacetimeDB checks the *ID* token, whose lifetime
 * is 900 s on SpacetimeAuth (0002). Reading the claim from the token itself also
 * catches a refresh that returned no new ID token: the old one keeps its old `exp`.
 */
export function idTokenExpiry(idToken: string): number | undefined {
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64));
    if (typeof claims !== 'object' || claims === null || !('exp' in claims))
      return undefined;
    return typeof claims.exp === 'number' ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

/** Pure: can this ID token still open a connection at `nowS` (epoch seconds)? */
export function isLive(
  signIn: StoredSignIn | null,
  nowS: number,
): signIn is StoredSignIn {
  if (!signIn?.id_token) return false;
  const exp = idTokenExpiry(signIn.id_token);
  return exp !== undefined && exp - EXPIRY_LEEWAY_S > nowS;
}

/** Pure: is renewal worth trying? Only with a refresh token to spend. */
export function canRenew(signIn: StoredSignIn | null): boolean {
  return Boolean(signIn?.refresh_token);
}

/**
 * Pure: how long to wait before renewing an ID token that expires at `expS`.
 * Zero when the renewal point has already passed.
 */
export function renewDelayMs(expS: number, nowMs: number): number {
  return Math.max(0, (expS - RENEW_AHEAD_S) * 1000 - nowMs);
}

/** What the keeper needs from the world. */
export interface KeeperDeps {
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** The sign-in in storage, which another tab may have renewed already. */
  readonly load: () => Promise<StoredSignIn | null>;
  /** Spend the refresh token. Resolves to the renewed sign-in, or throws. */
  readonly refresh: () => Promise<StoredSignIn | null>;
  /** Run `fn` after `ms`. Returns a cancel function. */
  readonly setTimer: (fn: () => void, ms: number) => () => void;
}

/**
 * Get a sign-in with at least `RENEW_AHEAD_S` of life, or the best still-live one, or
 * `null` if there is none.
 *
 * The store is read first: if another tab renewed, its token is taken as is, and this
 * tab does not spend a refresh token the provider may already have rotated.
 */
export async function renewSignIn(deps: KeeperDeps): Promise<StoredSignIn | null> {
  const nowS = () => deps.now() / 1000;
  const stored = await deps.load().catch(() => null);
  const storedExp = stored?.id_token ? idTokenExpiry(stored.id_token) : undefined;
  if (
    isLive(stored, nowS()) &&
    storedExp !== undefined &&
    renewDelayMs(storedExp, deps.now()) > 0
  ) {
    return stored;
  }
  if (canRenew(stored)) {
    try {
      const renewed = await deps.refresh();
      if (isLive(renewed, nowS())) return renewed;
    } catch {
      // Offline, or the refresh token was revoked. Fall through to what is stored.
    }
  }
  return isLive(stored, nowS()) ? stored : null;
}

export interface SignInKeeper {
  /** Called with each new ID token, so the next connection opens with it. */
  onToken(listener: (idToken: string) => void): void;
  /**
   * Make sure the current ID token can open a connection, renewing if needed.
   * `false` means the sign-in is gone and the page must fall back to anonymous.
   */
  ensureLive(): Promise<boolean>;
  stop(): void;
}

/**
 * Renew `initial` before each expiry, for as long as the page lives.
 *
 * One renewal runs at a time: a timer and a lost connection asking at once share it.
 * A failed renewal is retried every `RENEW_RETRY_MS` while the token still has life.
 * When it has none, the keeper stops, and the next `ensureLive` reports the loss.
 */
export function createSignInKeeper(
  initial: StoredSignIn,
  deps: KeeperDeps,
): SignInKeeper {
  let current = initial;
  let cancel: (() => void) | undefined;
  let inflight: Promise<boolean> | undefined;
  let stopped = false;
  const listeners: ((idToken: string) => void)[] = [];

  function schedule(): void {
    cancel?.();
    cancel = undefined;
    if (stopped || !current.id_token) return;
    const exp = idTokenExpiry(current.id_token);
    if (exp === undefined) return;
    const delay = renewDelayMs(exp, deps.now());
    const untilDead = Math.max(0, (exp - EXPIRY_LEEWAY_S) * 1000 - deps.now());
    if (delay <= 0 && untilDead <= 0) return;
    const wait = delay > 0 ? delay : Math.min(RENEW_RETRY_MS, untilDead);
    cancel = deps.setTimer(() => void renew(), wait);
  }

  function renew(): Promise<boolean> {
    inflight ??= (async () => {
      try {
        const next = await renewSignIn(deps);
        if (!next?.id_token) return false;
        if (next.id_token !== current.id_token) {
          current = next;
          for (const listener of listeners) listener(next.id_token);
        }
        return true;
      } finally {
        inflight = undefined;
        schedule();
      }
    })();
    return inflight;
  }

  schedule();

  return {
    onToken(listener) {
      listeners.push(listener);
    },
    ensureLive() {
      if (isLive(current, deps.now() / 1000)) return Promise.resolve(true);
      return renew();
    },
    stop() {
      stopped = true;
      cancel?.();
      cancel = undefined;
    },
  };
}
