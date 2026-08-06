import { act, renderHook } from '@testing-library/react';
import { chapterPath, navigate, useRoute } from './route';

describe('useRoute', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('starts from the address bar, so a chapter URL opens that chapter', () => {
    window.history.pushState({}, '', chapterPath(5n));
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'chapter', chapterId: 5n });
  });

  it('follows an in-app navigation', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current.name).toBe('home');

    act(() => navigate(chapterPath(9n)));
    expect(result.current).toEqual({ name: 'chapter', chapterId: 9n });
  });

  it('follows the browser back button', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate(chapterPath(9n)));

    act(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.name).toBe('home');
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useRoute());
    unmount();
    act(() => navigate(chapterPath(9n)));
    expect(result.current.name).toBe('home');
  });
});
