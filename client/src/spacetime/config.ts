// Where the module lives. Defaults target the local standalone instance that
// `spacetime start` brings up, so a clean clone needs no .env to run.

export const SPACETIME_URI: string =
  import.meta.env.VITE_SPACETIME_URI ?? 'ws://localhost:3000';

export const SPACETIME_DB_NAME: string =
  import.meta.env.VITE_SPACETIME_DB_NAME ?? 'book-of-chaos';

// Sign-in (docs/decisions/0002-durable-sign-in.md). The client ID is public by design:
// it ships in every page and identifies the app to the provider, not the reader.
export const SPACETIMEAUTH_AUTHORITY: string =
  import.meta.env.VITE_SPACETIMEAUTH_AUTHORITY ?? 'https://auth.spacetimedb.com/oidc';

export const SPACETIMEAUTH_CLIENT_ID: string =
  import.meta.env.VITE_SPACETIMEAUTH_CLIENT_ID ?? 'client_0350We80wbokeNK7YI9r5X';
