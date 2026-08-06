import { useSpacetimeDB } from 'spacetimedb/react';

export type ConnectionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected'; readonly identity: string }
  | { readonly kind: 'reconnecting'; readonly reason: string };

/**
 * The connection state, narrowed to the three cases the UI distinguishes.
 *
 * The SDK reports "not active, with an error" for both a first attempt that failed
 * and a live connection that dropped — from the reader's side those are the same
 * situation (we are trying again), so they collapse into `reconnecting`.
 */
export function useConnectionStatus(): ConnectionStatus {
  const state = useSpacetimeDB();

  if (state.isActive && state.identity) {
    return { kind: 'connected', identity: state.identity.toHexString() };
  }
  if (state.connectionError) {
    return { kind: 'reconnecting', reason: state.connectionError.message };
  }
  return { kind: 'connecting' };
}
