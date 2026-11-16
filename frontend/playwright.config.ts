import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the local dev stack (API :5050, web :5173, docker services).
 * Existing servers are reused; otherwise they are started. Set E2E_BASE_URL when the web app runs
 * on another port (e.g. http://localhost:5174 when 5173 is taken by another project).
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE_URL, viewport: { width: 1600, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
  webServer: [
    { command: 'npm --prefix ../backend run dev', url: 'http://localhost:5050/api/v1/health', reuseExistingServer: true, timeout: 60_000 },
    { command: `npx vite --port ${new URL(BASE_URL).port || 5173} --strictPort`, url: BASE_URL, reuseExistingServer: true, timeout: 60_000 },
  ],
});
