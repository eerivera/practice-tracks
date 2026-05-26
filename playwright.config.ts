import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '_internal/tests/e2e',
  fullyParallel: true,
  // Fail the build on CI if any test has a `.only` — avoids accidentally
  // shipping a suite that only runs one test.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Builds the frontend then starts the server.  In local dev, if a server is
    // already running at port 3000 (e.g. from `npm run web:dev`), Playwright
    // reuses it instead of starting a new one.
    command: 'npm run web',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
