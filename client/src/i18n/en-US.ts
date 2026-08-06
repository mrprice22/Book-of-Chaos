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
} as const;
