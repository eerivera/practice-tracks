import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the static browser build (VITE_BACKEND=browser).
 * Tests run against a Vite dev server on port 5174.
 *
 * Only Chromium is used: OPFS and the File System Access API require a full
 * Chromium implementation (Firefox/Safari support is partial or absent).
 *
 * Run with:  npm run test:e2e:browser
 */
export default defineConfig({
  testDir: '_internal/tests/e2e-browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'playwright-results-browser',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'VITE_BACKEND=browser npx vite _internal/web --port 5174',
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
