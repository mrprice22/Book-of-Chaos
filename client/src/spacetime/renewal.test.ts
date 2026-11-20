import { jwt } from './jwt.fixture';
import {
  createSignInKeeper,
  EXPIRY_LEEWAY_S,
  idTokenExpiry,
  isLive,
  isVerified,
  RENEW_AHEAD_S,
  RENEW_RETRY_MS,
  renewDelayMs,
  renewSignIn,
  type KeeperDeps,
  type StoredSignIn,
} from './renewal';

const T0_S = 1_800_000_000;
const LIFETIME_S = 900;

function signInExpiringAt(expS: number, refresh = 'refresh-tok'): StoredSignIn {
  return { id_token: jwt({ exp: expS, sub: 'reader' }), refresh_token: refresh };
}

/** A clock, a timer queue, a store and a provider, all under the test's hand. */
function world(initial: StoredSignIn | null) {
  let nowMs = T0_S * 1000;
  let stored = initial;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const refresh = vi.fn<() => Promise<StoredSignIn | null>>(() => {
    const renewed = signInExpiringAt(nowMs / 1000 + LIFETIME_S);
    stored = renewed;
    return Promise.resolve(renewed);
  });
  const deps: KeeperDeps = {
    now: () => nowMs,
    load: () => Promise.resolve(stored),
    refresh,
    setTimer: (fn, ms) => {
      const timer = { at: nowMs + ms, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return {
    deps,
    refresh,
    setStored: (value: StoredSignIn | null) => {
      stored = value;
    },
    nowS: () => nowMs / 1000,
    /** Move the clock forward, firing each timer that comes due, and let promises settle. */
    advance: async (ms: number) => {
      const end = nowMs + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.cancelled = true;
        nowMs = Math.max(nowMs, due.at);
        due.fn();
        await flush();
      }
      nowMs = end;
      await flush();
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('idTokenExpiry', () => {
  it('reads exp from the token itself', () => {
    expect(idTokenExpiry(jwt({ exp: 1234 }))).toBe(1234);
  });

  it('reads exp when the payload has base64url characters and no padding', () => {
    const token = jwt({ exp: 1234, name: '??>>~~ü' });
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(idTokenExpiry(token)).toBe(1234);
  });

  it('is undefined for anything that is not a JWT carrying a numeric exp', () => {
    expect(idTokenExpiry('opaque')).toBeUndefined();
    expect(idTokenExpiry('a.!!!.c')).toBeUndefined();
    expect(idTokenExpiry(jwt({ sub: 'x' }))).toBeUndefined();
    expect(idTokenExpiry(jwt({ exp: '1234' }))).toBeUndefined();
  });
});

describe('isVerified', () => {
  it('is true only for email_verified: true', () => {
    expect(isVerified(jwt({ exp: 1, email_verified: true }))).toBe(true);
  });

  it('is false for the anonymous login, which carries no email claim', () => {
    expect(isVerified(jwt({ exp: 1, login_method: 'magic_link' }))).toBe(false);
  });

  it('is false for a false or non-boolean claim, and for anything unreadable', () => {
    expect(isVerified(jwt({ email_verified: false }))).toBe(false);
    expect(isVerified(jwt({ email_verified: 'true' }))).toBe(false);
    expect(isVerified('opaque')).toBe(false);
  });
});

describe('isLive', () => {
  it('is live with more than the leeway left', () => {
    expect(isLive(signInExpiringAt(T0_S + EXPIRY_LEEWAY_S + 1), T0_S)).toBe(true);
  });

  it('is not live inside the leeway, as the token could expire in transit', () => {
    expect(isLive(signInExpiringAt(T0_S + EXPIRY_LEEWAY_S), T0_S)).toBe(false);
  });

  it('is not live with no ID token, or one whose expiry cannot be read', () => {
    expect(isLive(null, T0_S)).toBe(false);
    expect(isLive({ id_token: undefined, refresh_token: 'r' }, T0_S)).toBe(false);
    expect(isLive({ id_token: 'opaque' }, T0_S)).toBe(false);
  });
});

describe('renewDelayMs', () => {
  it('waits until a minute before expiry', () => {
    expect(renewDelayMs(T0_S + LIFETIME_S, T0_S * 1000)).toBe(
      (LIFETIME_S - RENEW_AHEAD_S) * 1000,
    );
  });

  it('is zero once the renewal point has passed', () => {
    expect(renewDelayMs(T0_S + 10, T0_S * 1000)).toBe(0);
    expect(renewDelayMs(T0_S - 100, T0_S * 1000)).toBe(0);
  });
});

describe('renewSignIn', () => {
  it('renews an expired sign-in with its refresh token, as a page load does', async () => {
    const w = world(signInExpiringAt(T0_S - 3600));
    const renewed = await renewSignIn(w.deps);
    expect(w.refresh).toHaveBeenCalledOnce();
    expect(isLive(renewed, w.nowS())).toBe(true);
  });

  it('takes a token another tab already renewed, without spending the refresh token', async () => {
    const w = world(signInExpiringAt(T0_S + LIFETIME_S));
    await renewSignIn(w.deps);
    expect(w.refresh).not.toHaveBeenCalled();
  });

  it('gives up with no refresh token to spend', async () => {
    const w = world({ id_token: jwt({ exp: T0_S - 1 }) });
    expect(await renewSignIn(w.deps)).toBeNull();
    expect(w.refresh).not.toHaveBeenCalled();
  });

  it('gives up when the provider refuses the refresh token', async () => {
    const w = world(signInExpiringAt(T0_S - 1));
    w.refresh.mockRejectedValueOnce(new Error('invalid_grant'));
    expect(await renewSignIn(w.deps)).toBeNull();
  });

  it('rejects a refresh that kept the old, expired ID token', async () => {
    // A refresh response without an id_token leaves oidc-client-ts holding the old one.
    const stale = signInExpiringAt(T0_S - 1);
    const w = world(stale);
    w.refresh.mockResolvedValueOnce(stale);
    expect(await renewSignIn(w.deps)).toBeNull();
  });

  it('keeps a still-live token when a renewal ahead of expiry fails', async () => {
    const soon = signInExpiringAt(T0_S + RENEW_AHEAD_S - 1);
    const w = world(soon);
    w.refresh.mockRejectedValueOnce(new Error('offline'));
    expect(await renewSignIn(w.deps)).toBe(soon);
  });

  it('gives up when storage cannot be read', async () => {
    const w = world(null);
    const deps = { ...w.deps, load: () => Promise.reject(new Error('blocked')) };
    expect(await renewSignIn(deps)).toBeNull();
  });
});

describe('createSignInKeeper', () => {
  it('hands over a new token a minute before each expiry, past 20 minutes', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    const keeper = createSignInKeeper(initial, w.deps);
    const tokens: string[] = [];
    keeper.onToken((token) => tokens.push(token));

    await w.advance((LIFETIME_S - RENEW_AHEAD_S) * 1000 - 1);
    expect(tokens).toHaveLength(0);
    await w.advance(1);
    expect(tokens).toHaveLength(1);

    await w.advance(20 * 60 * 1000);
    expect(tokens).toHaveLength(2);
    expect(await keeper.ensureLive()).toBe(true);
    expect(isLive({ id_token: tokens.at(-1) }, w.nowS())).toBe(true);
    keeper.stop();
  });

  it('retries a failed renewal while the token has life, then reports it lost', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    w.refresh.mockRejectedValue(new Error('offline'));
    const keeper = createSignInKeeper(initial, w.deps);

    await w.advance((LIFETIME_S - RENEW_AHEAD_S) * 1000);
    expect(w.refresh).toHaveBeenCalledTimes(1);
    await w.advance(RENEW_RETRY_MS);
    expect(w.refresh).toHaveBeenCalledTimes(2);

    await w.advance(RENEW_AHEAD_S * 1000);
    const calls = w.refresh.mock.calls.length;
    expect(await keeper.ensureLive()).toBe(false);
    // Past expiry it stops trying on a timer: nothing is left pending.
    await w.advance(10 * 60 * 1000);
    expect(w.refresh.mock.calls.length).toBe(calls + 1);
    keeper.stop();
  });

  it('recovers when the network returns before the token expires', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    w.refresh.mockRejectedValueOnce(new Error('offline'));
    const keeper = createSignInKeeper(initial, w.deps);
    const tokens: string[] = [];
    keeper.onToken((token) => tokens.push(token));

    await w.advance((LIFETIME_S - RENEW_AHEAD_S) * 1000 + RENEW_RETRY_MS);
    expect(tokens).toHaveLength(1);
    keeper.stop();
  });

  it('renews on demand when a reconnect finds the token expired (a sleeping tab)', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    const keeper = createSignInKeeper(initial, w.deps);
    keeper.stop(); // as if its timers never ran
    const tokens: string[] = [];
    keeper.onToken((token) => tokens.push(token));

    await w.advance(2 * 3600 * 1000);
    expect(await keeper.ensureLive()).toBe(true);
    expect(tokens).toHaveLength(1);
  });

  it('shares one renewal between two lost connections asking at once', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    const keeper = createSignInKeeper(initial, w.deps);
    keeper.stop();
    await w.advance(3600 * 1000);
    await Promise.all([keeper.ensureLive(), keeper.ensureLive()]);
    expect(w.refresh).toHaveBeenCalledOnce();
  });

  it('does not ask for a renewal while the token is live', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    const keeper = createSignInKeeper(initial, w.deps);
    expect(await keeper.ensureLive()).toBe(true);
    expect(w.refresh).not.toHaveBeenCalled();
    keeper.stop();
  });

  it('stops scheduling once stopped', async () => {
    const initial = signInExpiringAt(T0_S + LIFETIME_S);
    const w = world(initial);
    const keeper = createSignInKeeper(initial, w.deps);
    keeper.stop();
    await w.advance(3 * 3600 * 1000);
    expect(w.refresh).not.toHaveBeenCalled();
  });
});
