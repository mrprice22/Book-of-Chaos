/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPACETIME_URI?: string;
  readonly VITE_SPACETIME_DB_NAME?: string;
  readonly VITE_SPACETIMEAUTH_AUTHORITY?: string;
  readonly VITE_SPACETIMEAUTH_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
