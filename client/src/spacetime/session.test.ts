import { jwt } from './jwt.fixture';
import { chooseSession, isSignInCallback, returnPath } from './session';

const NOW_S = 1_800_000_000;

describe('chooseSession', () => {
  it('connects with a live ID token when signed in', () => {
    const live = jwt({ exp: NOW_S + 600 });
    expect(chooseSession({ id_token: live }, 'anon-tok', NOW_S)).toEqual({
      token: live,
      signedIn: true,
    });
  });

  it('falls back to the anonymous token when the ID token has expired', () => {
    // An expired token would be refused with a 401 and the connection would retry
    // forever; anonymous is the recoverable state.
    expect(
      chooseSession({ id_token: jwt({ exp: NOW_S - 1 }) }, 'anon-tok', NOW_S),
    ).toEqual({
      token: 'anon-tok',
      signedIn: false,
    });
  });

  it('judges by the ID token, so a refresh token alone does not sign anyone in', () => {
    expect(
      chooseSession(
        { id_token: jwt({ exp: NOW_S - 1 }), refresh_token: 'r' },
        'anon',
        NOW_S,
      ).signedIn,
    ).toBe(false);
  });

  it('falls back to the anonymous token with no stored sign-in', () => {
    expect(chooseSession(null, 'anon-tok', NOW_S)).toEqual({
      token: 'anon-tok',
      signedIn: false,
    });
  });

  it('asks for a fresh identity when there is neither', () => {
    expect(chooseSession(null, undefined, NOW_S)).toEqual({
      token: undefined,
      signedIn: false,
    });
  });

  it('is not signed in when the stored sign-in carries no ID token', () => {
    expect(chooseSession({ id_token: undefined }, 'anon-tok', NOW_S).signedIn).toBe(
      false,
    );
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
