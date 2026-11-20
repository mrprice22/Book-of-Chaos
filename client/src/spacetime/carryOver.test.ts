import { isNothingToCarry, shouldCarryOver } from './carryOver';

describe('shouldCarryOver', () => {
  it('carries over right after a sign-in, from the anonymous identity this browser held', () => {
    expect(shouldCarryOver(true, true, 'anon-tok')).toBe(true);
  });

  it('does not carry over on a later page load', () => {
    // Afterwards the signed-in identity may have rows of its own, and the anonymous
    // one has nothing left; the server would refuse, but there is no reason to ask.
    expect(shouldCarryOver(false, true, 'anon-tok')).toBe(false);
  });

  it('does not carry over when the sign-in did not stick', () => {
    expect(shouldCarryOver(true, false, 'anon-tok')).toBe(false);
  });

  it('does not carry over from a browser with no anonymous identity', () => {
    expect(shouldCarryOver(true, true, undefined)).toBe(false);
    expect(shouldCarryOver(true, true, '')).toBe(false);
  });
});

describe('isNothingToCarry', () => {
  it('recognises the server refusing an identity that never claimed a username', () => {
    // The exact text of rules::can_begin_link's refusal.
    expect(isNothingToCarry('This browser has no username to carry over.')).toBe(true);
  });

  it('does not hide any other refusal', () => {
    expect(isNothingToCarry('Sign in before carrying a username over.')).toBe(false);
    expect(isNothingToCarry('Carry-over timed out after 10000 ms')).toBe(false);
  });
});
