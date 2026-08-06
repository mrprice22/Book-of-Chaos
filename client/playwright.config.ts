import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.CLIENT_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The smoke test runs against a real stack: SpacetimeDB, the published module, the
 * seeded demo book and the client. `scripts/deploy.sh local` is exactly that, so it
 * is the webServer command rather than a second, parallel way to start things that
 * could drift from the one humans use.
 *
 * `reuseExistingServer` keeps a developer's already-running `deploy.sh local` — the
 * usual state while working on a test — instead of failing on the busy port. CI has
 * nothing running, so it always starts its own.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: '../scripts/deploy.sh local',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Cold start is a wasm build plus a module publish plus the seed.
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
