import { loadLastAccount, rememberedEmail, saveLastAccount } from './lastAccount';

describe('rememberedEmail', () => {
  it('remembers a verified email', () => {
    expect(rememberedEmail({ email: 'ada@example.com', email_verified: true })).toBe(
      'ada@example.com',
    );
  });

  it('remembers nothing from SpacetimeAuth’s anonymous login, which has no email', () => {
    expect(
      rememberedEmail({ name: 'Anonymous User', login_method: 'magic_link' }),
    ).toBeUndefined();
  });

  it('remembers nothing unverified, or oddly typed', () => {
    expect(
      rememberedEmail({ email: 'ada@example.com', email_verified: false }),
    ).toBeUndefined();
    expect(
      rememberedEmail({ email: 'ada@example.com', email_verified: 'true' }),
    ).toBeUndefined();
    expect(rememberedEmail({ email: 42, email_verified: true })).toBeUndefined();
    expect(rememberedEmail({ email: '', email_verified: true })).toBeUndefined();
  });
});

describe('the stored last account', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips through this browser’s storage', () => {
    expect(loadLastAccount()).toBeUndefined();
    saveLastAccount('ada@example.com');
    expect(loadLastAccount()).toBe('ada@example.com');
  });

  it('reads as nothing when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLastAccount()).toBeUndefined();
    spy.mockRestore();
  });
});
