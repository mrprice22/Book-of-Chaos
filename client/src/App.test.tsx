import { render, screen } from '@testing-library/react';
import { Identity } from 'spacetimedb';
import { App } from './App';

// `spacetimedb/react` does not export its context, so the SDK's hook is the seam.
// Everything below it — App, useConnectionStatus, t() — is the real thing.
const sdk = vi.hoisted(() => ({
  state: {
    isActive: false,
    identity: undefined as Identity | undefined,
    connectionError: undefined as Error | undefined,
  },
}));

vi.mock('spacetimedb/react', () => ({
  useSpacetimeDB: () => sdk.state,
}));

const IDENTITY = 'c0ffee'.padStart(64, '0');

describe('App', () => {
  beforeEach(() => {
    sdk.state = { isActive: false, identity: undefined, connectionError: undefined };
  });

  it('reports that it is connecting before the handshake completes', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('shows the identity once connected', () => {
    sdk.state = {
      isActive: true,
      identity: Identity.fromString(IDENTITY),
      connectionError: undefined,
    };
    render(<App />);
    expect(screen.getByText(IDENTITY)).toBeInTheDocument();
  });

  it('tells the reader it is retrying after a drop', () => {
    sdk.state = {
      isActive: false,
      identity: undefined,
      connectionError: new Error('socket closed'),
    };
    render(<App />);
    expect(screen.getByText(/retrying/i)).toBeInTheDocument();
  });
});
