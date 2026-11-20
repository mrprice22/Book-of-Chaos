import {
  completedIds,
  EMPTY,
  parseProgress,
  readGradeResult,
  verdictFor,
  withCompleted,
  withVerdict,
} from './localProgress';

const pass = {
  scorePercent: 100,
  passed: true,
  results: [{ questionId: 7n, isCorrect: true }],
};
const fail = {
  scorePercent: 0,
  passed: false,
  results: [{ questionId: 7n, isCorrect: false }],
};

describe('local progress', () => {
  it('records a completed block once', () => {
    const once = withCompleted(EMPTY, 5n);
    expect(withCompleted(once, 5n)).toBe(once);
    expect(completedIds(once)).toEqual(new Set([5n]));
  });

  it('keeps the latest verdict, and a pass completes the block', () => {
    const p = withVerdict(withVerdict(EMPTY, 9n, fail), 9n, pass);
    expect(verdictFor(p, 9n)).toEqual(pass);
    expect(completedIds(p).has(9n)).toBe(true);
  });

  it('does not take a completion away when a later attempt fails', () => {
    const p = withVerdict(withVerdict(EMPTY, 9n, pass), 9n, fail);
    expect(verdictFor(p, 9n)?.passed).toBe(false);
    expect(completedIds(p).has(9n)).toBe(true);
  });

  it('a failure alone completes nothing', () => {
    expect(completedIds(withVerdict(EMPTY, 9n, fail)).size).toBe(0);
  });

  it('round-trips through storage, bigints included', () => {
    const p = withVerdict(withCompleted(EMPTY, 12345678901234567890n), 9n, pass);
    const back = parseProgress(JSON.stringify(p));
    expect(completedIds(back)).toEqual(new Set([12345678901234567890n, 9n]));
    expect(verdictFor(back, 9n)).toEqual(pass);
  });

  it('reads anything unreadable as nothing stored', () => {
    expect(parseProgress(null)).toEqual(EMPTY);
    expect(parseProgress('not json')).toEqual(EMPTY);
    expect(parseProgress('[]')).toEqual(EMPTY);
    expect(parseProgress('{"completed": 3, "verdicts": {}}')).toEqual(EMPTY);
  });

  it('drops a malformed verdict and keeps the rest', () => {
    const raw = JSON.stringify({
      completed: ['1', 2],
      verdicts: { '9': { scorePercent: 'x', passed: true, results: [] } },
    });
    expect(parseProgress(raw)).toEqual({ completed: ['1'], verdicts: {} });
  });
});

describe('readGradeResult', () => {
  const verdict = {
    scorePercent: 50,
    passed: false,
    results: [{ questionId: 3n, isCorrect: true }],
  };

  it('reads the { ok } shape the server sends', () => {
    expect(readGradeResult({ ok: verdict })).toEqual({ verdict });
  });

  it('reads the { err } shape as a refusal', () => {
    expect(readGradeResult({ err: 'That block no longer exists.' })).toEqual({
      refusal: 'That block no longer exists.',
    });
  });

  it('also reads the untagged shape the generated type declares', () => {
    expect(readGradeResult(verdict)).toEqual({ verdict });
    expect(readGradeResult('No.')).toEqual({ refusal: 'No.' });
  });

  it('treats anything else as a refusal, never as a verdict', () => {
    expect(readGradeResult(undefined)).toHaveProperty('refusal');
    expect(readGradeResult({ ok: { passed: true } })).toHaveProperty('refusal');
    expect(
      readGradeResult({
        ok: { ...verdict, results: [{ questionId: '3', isCorrect: true }] },
      }),
    ).toHaveProperty('refusal');
  });
});
