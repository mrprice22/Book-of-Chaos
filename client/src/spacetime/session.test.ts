import { chooseSession, isSignInCallback, returnPath } from './session';

describe('chooseSession', () => {
  it('connects with a live ID token when signed in', () => {
    expect(chooseSession({ id_token: 'id-tok', expired: false }, 'anon-tok')).toEqual({
      token: 'id-tok',
      signedIn: true,
    });
  });

  it('treats an unknown expiry as live, as oidc-client-ts reports no expires_at', () => {
    expect(
      chooseSession({ id_token: 'id-tok', expired: undefined }, 'anon-tok').signedIn,
    ).toBe(true);
  });

  it('falls back to the anonymous token when the ID token has expired', () => {
    // An expired token would be refused with a 401 and the connection would retry
    // forever; anonymous is the recoverable state.
    expect(chooseSession({ id_token: 'id-tok', expired: true }, 'anon-tok')).toEqual({
      token: 'anon-tok',
      signedIn: false,
    });
  });

  it('falls back to the anonymous token with no stored sign-in', () => {
    expect(chooseSession(null, 'anon-tok')).toEqual({
      token: 'anon-tok',
      signedIn: false,
    });
  });

  it('asks for a fresh identity when there is neither', () => {
    expect(chooseSession(null, undefined)).toEqual({ token: undefined, signedIn: false });
  });

  it('is not signed in when the stored sign-in carries no ID token', () => {
    expect(
      chooseSession({ id_token: undefined, expired: false }, 'anon-tok').signedIn,
    ).toBe(false);
  });
});

describe('isSignInCallback', () => {
  it('recognises the provider returning a code', () => {
    expect(isSignInCallback('?code=abc&state=xyz')).toBe(true);
  });

  it('recognises the provider returning an error', () => {
    expect(isSignInCallback('?error=access_denied&state=xyz')).toBe(true);
  });

  it('ignores an ordinary page load', () => {
    expect(isSignInCallback('')).toBe(false);
    expect(isSignInCallback('?chapter=3')).toBe(false);
  });

  it('ignores a code without state, which is not ours to redeem', () => {
    expect(isSignInCallback('?code=abc')).toBe(false);
  });
});

describe('returnPath', () => {
  it('returns to a same-site path', () => {
    expect(returnPath('/chapter/3')).toBe('/chapter/3');
  });

  it('refuses a protocol-relative URL, which would leave the site', () => {
    expect(returnPath('//evil.example/')).toBe('/');
  });

  it('refuses an absolute URL and anything that is not a string', () => {
    expect(returnPath('https://evil.example/')).toBe('/');
    expect(returnPath(undefined)).toBe('/');
    expect(returnPath(42)).toBe('/');
  });
});
