import type { Page } from '@playwright/test';

// ── Minimal mock config ───────────────────────────────────────────────────────
// A valid Config object used as the default API stub.  Individual tests can
// override specific fields by passing a partial to setupBaseMocks().

export const MOCK_CONFIG = {
  normalize: false,
  normalization_concurrency: 0,
  target_lufs: -23,
  output_format: 'm4a',
  buses: [
    { name: 'Click', gain_db: 0, contains: ['Click*'] },
    { name: 'Drums', gain_db: 0, contains: ['Drums*'] },
  ],
  mixes: [{ name: 'full' }, { name: 'no-click', exclude: ['Click'] }],
};

// ── Base route stubs ──────────────────────────────────────────────────────────
// Stubs all API endpoints that are called on page load.  Pass a partial config
// override to change specific fields (e.g. { normalize: true }).
// Individual tests layer additional mocks on top of these.
//
// ⚠ ROUTE PRIORITY: Playwright matches routes most-recently-registered first.
// Always call setupBaseMocks() BEFORE registering test-specific overrides so
// that the specific mocks take precedence.

export async function setupBaseMocks(
  page: Page,
  configOverride: Record<string, unknown> = {}
): Promise<void> {
  await page.route('/api/config', (r) =>
    r.fulfill({ json: { ...MOCK_CONFIG, ...configOverride } })
  );
  await page.route('/api/outputs', (r) => r.fulfill({ json: [] }));
  await page.route('/api/songs', (r) => r.fulfill({ json: [] }));
  await page.route('/api/status', (r) =>
    r.fulfill({ json: { mixQueue: [], uploadQueue: [] } })
  );
  await page.route('/api/stems/**', (r) => r.fulfill({ json: [] }));
  await page.route('/api/normalize-cache/**', (r) =>
    r.fulfill({ json: { target_lufs: null } })
  );
}

// ── SSE helper ────────────────────────────────────────────────────────────────
// Builds a static SSE response body from an array of ProgressEvent objects.
// Playwright's route.fulfill() delivers the whole body at once; the browser's
// EventSource still parses individual data: frames correctly.

export function sseBody(events: Record<string, unknown>[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

// Registers a mock for /api/events/* that serves successive SSE responses for
// each call in order (first call → responses[0], second → responses[1], …).
// Calls beyond the array length receive a bare session_complete.
export async function mockSseSequence(
  page: Page,
  responses: Record<string, unknown>[][]
): Promise<void> {
  let callIndex = 0;
  await page.route('/api/events/**', async (route) => {
    const events = responses[callIndex++] ?? [{ type: 'session_complete' }];
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: sseBody(events),
    });
  });
}
