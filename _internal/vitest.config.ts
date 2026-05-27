import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Exclude Playwright E2E specs — they use @playwright/test, not vitest.
    exclude: ['**/e2e/**', '**/e2e-browser/**', '**/node_modules/**'],
  },
});
