import { useEffect, useState } from 'react';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'chapter'; readonly chapterId: bigint }
  | { readonly name: 'author' }
  | { readonly name: 'authorBook'; readonly bookId: bigint };

export const HOME_PATH = '/';
export const AUTHOR_PATH = '/author';

export function chapterPath(chapterId: bigint): string {
  return `/chapter/${chapterId}`;
}

export function authorBookPath(bookId: bigint): string {
  return `/author/book/${bookId}`;
}

/**
 * Turn a pathname into a route.
 *
 * Anything unrecognised — including `/chapter/abc` and a negative id — is `home`
 * rather than an error page. v0.1 has a handful of screens; a 404 screen is a screen
 * we would have to design, and landing on the book is a fine answer for a broken
 * link.
 */
export function parseRoute(pathname: string): Route {
  const chapter = /^\/chapter\/(\d+)\/?$/.exec(pathname);
  if (chapter?.[1] !== undefined) {
    return { name: 'chapter', chapterId: BigInt(chapter[1]) };
  }

  const authorBook = /^\/author\/book\/(\d+)\/?$/.exec(pathname);
  if (authorBook?.[1] !== undefined) {
    return { name: 'authorBook', bookId: BigInt(authorBook[1]) };
  }

  if (/^\/author\/?$/.test(pathname)) return { name: 'author' };

  return { name: 'home' };
}

/** Push a new path and re-render. `popstate` does not fire for pushState. */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The current route, kept in sync with the address bar.
 *
 * Hand-rolled rather than react-router: v0.1 has four routes and no nesting, and the
 * whole surface is the functions above.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}
