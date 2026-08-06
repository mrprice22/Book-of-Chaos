// Where the module lives. Defaults target the local standalone instance that
// `spacetime start` brings up, so a clean clone needs no .env to run.

export const SPACETIME_URI: string =
  import.meta.env.VITE_SPACETIME_URI ?? 'ws://localhost:3000';

export const SPACETIME_DB_NAME: string =
  import.meta.env.VITE_SPACETIME_DB_NAME ?? 'book-of-chaos';
