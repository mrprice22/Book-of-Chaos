import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  // App's concern is the connection banner; Library has its own tests, so here it
  // subscribes to an empty, settled database.
  useTable: () => [[], true],
  useReducer: () => () => Promise.resolve(),
}));

vi.mock('mermaid', () => ({
  default: {
    render: () => Promise.resolve({ svg: '<svg></svg>' }),
    initialize: () => {},
  },
}));

const IDENTITY = 'c0ffee'.padStart(64, '0');

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    sdk.state = { isActive: false, identity: undefined, connectionError: undefined };
  });

  const connected = () => {
    sdk.state = {
      isActive: true,
      identity: Identity.fromString(IDENTITY),
      connectionError: undefined,
    };
  };

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

  it('offers no navigation and no screen before the connection is up', () => {
    render(<App />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('reaches the author area only through the nav', async () => {
    connected();
    render(<App />);
    expect(screen.queryByRole('heading', { name: 'Author' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Author' }));
    expect(window.location.pathname).toBe('/author');
    expect(screen.getByRole('heading', { name: 'Author' })).toBeInTheDocument();
  });

  it('marks which section the reader is in', async () => {
    connected();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Author' }));
    expect(screen.getByRole('button', { name: 'Author' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Read' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens an author book URL directly, and refuses it — the row is not the caller’s', () => {
    connected();
    window.history.pushState({}, '', '/author/book/1');
    render(<App />);
    expect(screen.getByText(/does not exist, or is not yours/i)).toBeInTheDocument();
  });
});
