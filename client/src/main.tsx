import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { App } from './App';
import { buildConnection } from './spacetime/connect';
import { SessionContext, signIn, signOut, startSession } from './spacetime/session';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  // Fail loudly rather than reaching for a non-null assertion; `strict: true`
  // and the no-`!` rule in CLAUDE.md both point here.
  throw new Error('Root element #root is missing from index.html');
}

// The session is settled before the first render: a sign-in redirect has to finish,
// and the stored sign-in has to be read, before we know which token to connect with.
void startSession().then((session) => {
  const controls = {
    ...session,
    signIn: () => void signIn(),
    signOut: () => void signOut(),
  };
  createRoot(root).render(
    <StrictMode>
      <SessionContext.Provider value={controls}>
        <SpacetimeDBProvider connectionBuilder={buildConnection(session)}>
          <App />
        </SpacetimeDBProvider>
      </SessionContext.Provider>
    </StrictMode>,
  );
});
