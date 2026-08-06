import { clearToken, loadToken, saveToken } from './token';

describe('identity token persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a token', () => {
    expect(loadToken()).toBeUndefined();
    saveToken('tok-123');
    expect(loadToken()).toBe('tok-123');
  });

  it('clears a token', () => {
    saveToken('tok-123');
    clearToken();
    expect(loadToken()).toBeUndefined();
  });

  it('returns undefined instead of throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadToken()).toBeUndefined();
  });

  it('swallows a write failure so a full quota cannot break a live connection', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveToken('tok-123')).not.toThrow();
  });
});
