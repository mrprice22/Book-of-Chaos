import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { App } from './App';
import { carryOver, shouldCarryOver } from './spacetime/carryOver';
import { buildConnection } from './spacetime/connect';
import {
  SessionContext,
  signIn,
  signOut,
  startSession,
  type SignInChoice,
} from './spacetime/session';
import { loadLastAccount } from './spacetime/lastAccount';
import { loadToken } from './spacetime/token';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  // Fail loudly rather than reaching for a non-null assertion; `strict: true`
  // and the no-`!` rule in CLAUDE.md both point here.
  throw new Error('Root element #root is missing from index.html');
}

// The session is settled before the first render: a sign-in redirect has to finish,
// and the stored sign-in has to be read (and renewed if it expired), before we know
// which token to connect with.
void startSession().then(async ({ session, keeper, justSignedIn }) => {
  // Before the app connects, so its first subscription already sees the rows carried
  // over from this browser's anonymous identity (M15.2).
  const anonymousToken = loadToken();
  if (shouldCarryOver(justSignedIn, session.signedIn, anonymousToken) && session.token) {
    await carryOver(anonymousToken, session.token);
  }
  const lastAccount = loadLastAccount();
  const controls = {
    ...session,
    lastAccount,
    signIn: (choice: SignInChoice) => void signIn(choice, lastAccount),
    signOut: () => void signOut(),
  };
  createRoot(root).render(
    <StrictMode>
      <SessionContext.Provider value={controls}>
        <SpacetimeDBProvider connectionBuilder={buildConnection(session, keeper)}>
          <App />
        </SpacetimeDBProvider>
      </SessionContext.Provider>
    </StrictMode>,
  );
});
