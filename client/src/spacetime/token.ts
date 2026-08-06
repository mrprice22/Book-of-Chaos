// The identity token SpacetimeDB hands back on first connect. Persisting it is what
// makes a returning reader the *same* reader — without it every reload is a new
// anonymous identity and all their progress disappears.

const TOKEN_KEY = 'boc.identity_token';

// localStorage throws rather than returning null in a few real situations: Safari
// private browsing, storage disabled by policy, and quota exhaustion. None of them
// should take the app down — an unauthenticated connection still works, the reader
// just gets a fresh identity.
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadToken(): string | undefined {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(token: string): void {
  try {
    storage()?.setItem(TOKEN_KEY, token);
  } catch {
    // Nothing useful to do: the connection is already live.
  }
}

export function clearToken(): void {
  try {
    storage()?.removeItem(TOKEN_KEY);
  } catch {
    // As above.
  }
}
