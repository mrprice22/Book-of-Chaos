// Copy lives outside JSX per CLAUDE.md. M4.4 replaces this constant with the
// `t()` lookup into `src/i18n/en-US.ts`.
const APP_TITLE = 'Book of Chaos';

export function App() {
  return (
    <main className="app">
      <h1>{APP_TITLE}</h1>
    </main>
  );
}
