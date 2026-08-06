import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { App } from './App';
import { buildConnection } from './spacetime/connect';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  // Fail loudly rather than reaching for a non-null assertion; `strict: true`
  // and the no-`!` rule in CLAUDE.md both point here.
  throw new Error('Root element #root is missing from index.html');
}

createRoot(root).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={buildConnection()}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
