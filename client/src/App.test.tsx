import { act, render, screen } from '@testing-library/react';
import type { DbConnection } from './module_bindings';
import type { ConnectionHandlers, Connector } from './spacetime/connect';
import { App } from './App';

describe('App', () => {
  it('renders the application shell', () => {
    render(<App connector={() => ({ disconnect: () => {} })} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('shows the connected identity once the connection lands', () => {
    let handlers: ConnectionHandlers | undefined;
    const connector: Connector = (_token, h) => {
      handlers = h;
      return { disconnect: () => {} };
    };

    render(<App connector={connector} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();

    act(() => {
      handlers?.onConnect(
        { disconnect: () => {} } as unknown as DbConnection,
        'c0ffee',
        'tok-new',
      );
    });

    expect(screen.getByText('c0ffee')).toBeInTheDocument();
  });
});
