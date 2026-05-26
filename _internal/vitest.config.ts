import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Exclude Playwright E2E specs — they use @playwright/test, not vitest.
    exclude: ['**/e2e/**', '**/node_modules/**'],
  },
});
