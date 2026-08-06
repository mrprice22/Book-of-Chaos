import { chapterPath, parseRoute } from './route';

describe('parseRoute', () => {
  it.each([
    ['/', 'home'],
    ['', 'home'],
    ['/chapter', 'home'],
    ['/chapter/', 'home'],
    ['/chapter/abc', 'home'],
    ['/chapter/-1', 'home'],
    ['/chapter/1/extra', 'home'],
    ['/books/1', 'home'],
  ])('reads %j as the %s route', (path, name) => {
    expect(parseRoute(path).name).toBe(name);
  });

  it('reads a chapter id', () => {
    expect(parseRoute('/chapter/42')).toEqual({ name: 'chapter', chapterId: 42n });
  });

  it('tolerates a trailing slash on a chapter', () => {
    expect(parseRoute('/chapter/42/')).toEqual({ name: 'chapter', chapterId: 42n });
  });

  it('handles an id beyond Number.MAX_SAFE_INTEGER, since chapter_id is u64', () => {
    const big = 9007199254740993n;
    expect(parseRoute(`/chapter/${big}`)).toEqual({ name: 'chapter', chapterId: big });
  });

  it('round-trips through chapterPath', () => {
    expect(parseRoute(chapterPath(7n))).toEqual({ name: 'chapter', chapterId: 7n });
  });
});
