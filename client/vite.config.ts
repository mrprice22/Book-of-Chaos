import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config lives here rather than in a second file so there is one place
// where "how the client builds" is described.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Unit tests only. Vitest's default pattern also matches e2e/*.spec.ts, which is
    // Playwright's — those need a browser and a running stack, and fail instantly
    // under jsdom.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
