/**
 * Regression tests for bugs fixed in PR #14 (normalized stem cache).
 *
 * Each test is named after the bug it guards against.  A failing test here
 * means a specific broken behaviour has been reintroduced.
 */
import { test, expect } from '@playwright/test';
import { setupBaseMocks, mockSseSequence } from './helpers.js';

// ── Bug 1: Stale "re-normalize each session" banner ───────────────────────────
// The banner was removed in PR #14 because the on-disk cache makes it obsolete.
// Regression: if the text reappears in any phase, this test fails.

test('no "re-normalized each session" banner exists anywhere on the page', async ({ page }) => {
  await setupBaseMocks(page);
  await page.goto('/');
  // Banner text must not appear regardless of phase — check the whole DOM.
  await expect(
    page.getByText('Stems must be re-normalized each session', { exact: false })
  ).not.toBeAttached();
});

// ── Bug 2: All-skipped greyout ────────────────────────────────────────────────
// When every song in a normalize batch is skipped (existing output, force=false),
// the phase previously stuck at "mixing" with the whole UI greyed out.
// Fix: allSkipped → phase goes directly to "complete".

test('all songs skipped → reaches complete, "Process More Files" is visible', async ({ page }) => {
  // Serve different SSE streams for extract vs normalize calls, in order.
  await mockSseSequence(page, [
    // Call 1 — extract: one song found, then done.
    [
      { type: 'song_header', songName: 'test-song', stemsDir: '', outputDir: '' },
      { type: 'songs_ready', songDirs: ['songs/test-song'] },
      { type: 'session_complete' },
    ],
    // Call 2 — normalize: the song is skipped (output already exists), then done.
    [
      { type: 'skip', songName: 'test-song', reason: 'output already exists' },
      { type: 'session_complete' },
    ],
  ]);

  await setupBaseMocks(page);

  // check-outputs: the extracted song already has output → triggers the
  // "1 song already has mix files. Keep them or overwrite?" prompt.
  await page.route('/api/check-outputs', (r) =>
    r.fulfill({ json: [{ songDir: 'songs/test-song', hasOutput: true }] })
  );
  await page.route('/api/extract', (r) =>
    r.fulfill({ json: { status: 'extracting', count: 1 } })
  );
  await page.route('/api/normalize', (r) =>
    r.fulfill({ json: { status: 'normalizing', count: 1 } })
  );
  // getOutputs is called when reaching complete phase.
  await page.route('/api/outputs', (r) => r.fulfill({ json: [] }));

  await page.goto('/');

  // Select a fake zip via the hidden file input (avoids needing drag-and-drop).
  const fileInput = page.locator('input[type="file"][accept=".zip"]');
  await fileInput.setInputFiles({
    name: 'test-song.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04'), // minimal zip magic bytes
  });

  // Confirm extraction.
  await page.getByRole('button', { name: 'Extract Stems' }).click();

  // After extraction, the "existing output" prompt should appear.
  await expect(page.getByRole('button', { name: 'Keep existing' })).toBeVisible();

  // Click "Keep existing" — this triggers a normalize call where every song is
  // skipped.  Previously the UI would hang at "mixing" with pointer-events-none.
  await page.getByRole('button', { name: 'Keep existing' }).click();

  // The phase must reach "complete" — "Process More Files" is the complete-phase
  // button.  A 5 s timeout is generous; the mock responds immediately.
  await expect(
    page.getByRole('button', { name: 'Process More Files' })
  ).toBeVisible({ timeout: 5000 });

  // Verify the button is actually interactive (not greyed out / pointer-events-none).
  await expect(
    page.getByRole('button', { name: 'Process More Files' })
  ).toBeEnabled();
});

// ── Bug 3: LUFS staleness not detected ───────────────────────────────────────
// When the on-disk normalize cache was built at a different LUFS target than the
// one currently in config, the UI previously gave no indication.
// Fix: amber banner + inline "Cached: X LUFS" indicator.

test('amber banner appears when cached LUFS differs from active target', async ({ page }) => {
  // Base mocks first (lowest priority — Playwright matches most-recent-first).
  await setupBaseMocks(page, { normalize: true, target_lufs: -20 });
  // Specific overrides registered last so they take precedence.
  // Song already on disk so selectedSongDir is set on load (triggers cache fetch).
  await page.route('/api/songs', (r) =>
    r.fulfill({ json: ['songs/test-song'] })
  );
  // Cache was built at -23 LUFS; config targets -20.
  await page.route('/api/normalize-cache/**', (r) =>
    r.fulfill({ json: { target_lufs: -23 } })
  );

  await page.goto('/');

  // Amber banner must appear with the exact cached and current values.
  await expect(
    page.getByText('Cached at -23 LUFS', { exact: false })
  ).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByText('current target is -20 LUFS', { exact: false })
  ).toBeVisible();
});

test('amber banner disappears when LUFS target is updated to match cache', async ({ page }) => {
  // Base mocks first, specific overrides last (highest priority).
  // Start with target = -20 (mismatched → banner shown).
  await setupBaseMocks(page, { normalize: true, target_lufs: -20 });
  await page.route('/api/songs', (r) =>
    r.fulfill({ json: ['songs/test-song'] })
  );
  await page.route('/api/normalize-cache/**', (r) =>
    r.fulfill({ json: { target_lufs: -23 } })
  );

  await page.goto('/');

  // Confirm the banner is initially visible.
  await expect(
    page.getByText('Cached at -23 LUFS', { exact: false })
  ).toBeVisible({ timeout: 5000 });

  // Change the LUFS target input to -23 (now matches the cache).
  const lufsInput = page.locator('input[type="number"]');
  await lufsInput.fill('-23');
  await lufsInput.press('Tab'); // commit the change

  // Banner must disappear and the emerald "Cached: -23 LUFS" indicator appears.
  await expect(
    page.getByText('Cached at -23 LUFS', { exact: false })
  ).not.toBeVisible();
  await expect(
    page.getByText('Cached: -23 LUFS', { exact: false })
  ).toBeVisible();
});
