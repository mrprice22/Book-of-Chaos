// The account this browser last signed in with, so a signed-out reader can choose
// between it and another one (M15.5). Only the email is kept, and only in this
// browser's localStorage. It is the reader's own address, shown back to them.

const LAST_ACCOUNT_KEY = 'boc.last_account';

/**
 * Pure: the email worth remembering from an ID token's claims, if any.
 *
 * Only a verified email counts. SpacetimeAuth's anonymous login carries none, and a
 * "Continue as" for an unverified address would name an account nobody proved.
 */
export function rememberedEmail(
  claims: Readonly<Record<string, unknown>>,
): string | undefined {
  const { email, email_verified: verified } = claims;
  return verified === true && typeof email === 'string' && email.length > 0
    ? email
    : undefined;
}

// Storage can throw (private browsing, policy, quota), as in token.ts. Remembering
// the account is a convenience, so a failure just means "Sign in" without a choice.
export function loadLastAccount(): string | undefined {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveLastAccount(email: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, email);
  } catch {
    // Nothing to do: the choice is a convenience.
  }
}
