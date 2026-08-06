// Every user-facing string in the client. One flat object, keys namespaced by
// surface — no i18n library in v0.1 (see docs/mvp-scope.md, "Carried forward").
//
// Adding a locale later means adding a sibling file with the same keys; `MessageKey`
// is derived from this one, so a missing key is a type error rather than a blank
// screen.

export const enUS = {
  'app.title': 'Book of Chaos',
  'connection.connecting': 'Connecting…',
  'connection.reconnecting': 'Connection lost — retrying…',
  'connection.connectedAs': 'Connected as',
  'book.loading': 'Loading the library…',
  'book.none': 'No book has been published yet.',
  'book.chapterCount.one': '1 chapter',
  'book.chapterCount.other': '{count} chapters',
  'book.readTime': 'About {minutes} min read',
  'book.readTime.empty': 'No content yet',
  'chapter.notFound': 'That chapter does not exist.',
  'chapter.backToBook': 'Back to the book',
  'chapter.empty': 'This chapter has no blocks yet.',
  'chapter.optional': 'Optional',
  'block.markComplete': 'Mark as complete',
  'block.completed': 'Completed',
  'block.openResource': 'Open resource',
  'block.completeFailed': 'Could not mark that complete: {reason}',
} as const;
