import { whenConnectionLost } from './connect';

describe('whenConnectionLost', () => {
  it('leaves the page alone when the sign-in is live or was renewed', async () => {
    const reload = vi.fn();
    await whenConnectionLost({ ensureLive: () => Promise.resolve(true) }, reload);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when the sign-in cannot be renewed, so the page settles as anonymous', async () => {
    // Retrying with a dead ID token would be refused with a 401 forever.
    const reload = vi.fn();
    await whenConnectionLost({ ensureLive: () => Promise.resolve(false) }, reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});
