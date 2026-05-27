/**
 * Regression tests — one test per bug, named after the broken behaviour.
 * A failing test here means a specific broken behaviour has been reintroduced.
 *
 * PR references are inline above each test group.
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

// ── Bug: Re-mix button ignores normalize cache (PR #19) ───────────────────────
// handleRemix previously set normalizeCache=null then relied on a useEffect to
// fetch the cache asynchronously.  Because the 'extracted' phase rendered before
// the fetch resolved, normalizeCacheIsValid was always false → button always
// showed "Normalize Stems" even when the cache was valid.
// Fix: handleRemix now awaits the cache fetch before setting phase.

const REMIX_SONG_DIR = 'test-song';
const REMIX_SONG_PATH = `songs/${REMIX_SONG_DIR}`;

// Helper: mock a song with outputs so the Past Mixes Re-mix button is visible.
async function setupRemixScene(
  page: Parameters<typeof setupBaseMocks>[0],
  configOverride: Record<string, unknown>,
  cacheTargetLufs: number | null,
): Promise<void> {
  await setupBaseMocks(page, configOverride);
  // Song exists on disk (so handleRemix can find a full path).
  await page.route('/api/songs', (r) => r.fulfill({ json: [REMIX_SONG_PATH] }));
  // Song has prior output so it appears in Past Mixes with a Re-mix button.
  await page.route('/api/outputs', (r) =>
    r.fulfill({
      json: [{
        songDir: REMIX_SONG_DIR,
        variants: [{ keyBpm: 'Ab-68bpm', files: [{ name: 'full', path: `${REMIX_SONG_PATH}/output/Ab-68bpm/full.m4a` }] }],
      }],
    })
  );
  // Normalize cache for this song (overrides the null default in setupBaseMocks).
  await page.route('/api/normalize-cache/**', (r) =>
    r.fulfill({ json: { target_lufs: cacheTargetLufs } })
  );
}

test('Re-mix with valid cache shows "Mix Practice Tracks" immediately', async ({ page }) => {
  // normalize=true, config target=-23, cache also at -23 → cache is valid.
  await setupRemixScene(page, { normalize: true, target_lufs: -23 }, -23);
  await page.goto('/');

  await page.getByRole('button', { name: 'Re-mix' }).click();

  // Button must read "Mix Practice Tracks" — not "Normalize Stems" — because the
  // cache is valid and no FFmpeg run is needed.
  await expect(
    page.getByRole('button', { name: 'Mix Practice Tracks' })
  ).toBeVisible({ timeout: 5000 });
});

test('Re-mix with stale cache shows "Normalize Stems"', async ({ page }) => {
  // normalize=true, config target=-20, cache at -23 → cache is stale.
  await setupRemixScene(page, { normalize: true, target_lufs: -20 }, -23);
  await page.goto('/');

  await page.getByRole('button', { name: 'Re-mix' }).click();

  await expect(
    page.getByRole('button', { name: 'Normalize Stems' })
  ).toBeVisible({ timeout: 5000 });
});

test('Re-mix with normalize disabled shows "Mix Practice Tracks"', async ({ page }) => {
  // normalize=false → cache is irrelevant, always goes straight to mix.
  await setupRemixScene(page, { normalize: false }, null);
  await page.goto('/');

  await page.getByRole('button', { name: 'Re-mix' }).click();

  await expect(
    page.getByRole('button', { name: 'Mix Practice Tracks' })
  ).toBeVisible({ timeout: 5000 });
});

// ── Bug: "All done" appears in ProgressFeed for unrecognised sessions ──────────
// When normalize is disabled, normalizeSongs() dispatches session_complete with
// no preceding normalize_start/cached event.  ProgressFeed previously showed
// "── All done ──" as a fallback label.  Fix: return null instead.

test('"All done" never appears in the progress feed', async ({ page }) => {
  await mockSseSequence(page, [
    // Extract: one song, then done.
    [
      { type: 'song_header', songName: 'test-song', stemsDir: '', outputDir: '' },
      { type: 'songs_ready', songDirs: ['songs/test-song'] },
      { type: 'session_complete' },
    ],
    // Normalize with normalize=false: bare session_complete, no normalize_start.
    [{ type: 'session_complete' }],
    // Mix: a real mix event followed by completion.
    [
      { type: 'mix_start', total: 1 },
      { type: 'mix_generated', name: 'full', stems: 2, timeMs: 100 },
      { type: 'pipeline_complete', outputDir: 'songs/test-song/output', elapsedMs: 200, skipped: false, mixFiles: [] },
      { type: 'session_complete' },
    ],
  ]);

  await setupBaseMocks(page, { normalize: false });
  await page.route('/api/check-outputs', (r) =>
    r.fulfill({ json: [{ songDir: 'songs/test-song', hasOutput: false }] })
  );
  await page.route('/api/extract', (r) =>
    r.fulfill({ json: { status: 'extracting', count: 1 } })
  );
  await page.route('/api/normalize', (r) =>
    r.fulfill({ json: { status: 'normalizing', count: 1 } })
  );
  await page.route('/api/mix', (r) =>
    r.fulfill({ json: { status: 'mixing', count: 1 } })
  );
  await page.route('/api/outputs', (r) => r.fulfill({ json: [] }));

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".zip"]');
  await fileInput.setInputFiles({
    name: 'test-song.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04'),
  });
  await page.getByRole('button', { name: 'Extract Stems' }).click();
  await page.getByRole('button', { name: 'Mix Practice Tracks' }).click();

  // Wait for the mix to reach complete phase.
  await expect(
    page.getByRole('button', { name: 'Process More Files' })
  ).toBeVisible({ timeout: 5000 });

  // "All done" must never appear anywhere in the feed.
  await expect(
    page.getByText('── All done ──', { exact: true })
  ).not.toBeAttached();
});

// ── Transposition: key selector visible in server mode ────────────────────────
// After extraction the "Transpose to key:" dropdown must appear in server mode
// (ServerApi.supportsTranspose() === true).  If it is absent the user cannot
// choose a target key and the feature is silently unavailable.

test('key selector appears after extraction in server mode', async ({ page }) => {
  await mockSseSequence(page, [
    // Extract: one song extracted, then done.
    [
      { type: 'song_header', songName: 'test-song', stemsDir: '', outputDir: '' },
      { type: 'songs_ready', songDirs: ['songs/test-song'] },
      { type: 'session_complete' },
    ],
  ]);

  await setupBaseMocks(page);
  await page.route('/api/check-outputs', (r) =>
    r.fulfill({ json: [{ songDir: 'songs/test-song', hasOutput: false }] })
  );
  await page.route('/api/extract', (r) =>
    r.fulfill({ json: { status: 'extracting', count: 1 } })
  );

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".zip"]');
  await fileInput.setInputFiles({
    name: 'test-song.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04'),
  });
  await page.getByRole('button', { name: 'Extract Stems' }).click();

  // After extraction the key selector should be visible.
  await expect(page.getByText('Transpose to key:', { exact: false })).toBeVisible({ timeout: 5000 });
  // The dropdown must include all 12 chromatic keys.
  const select = page.locator('select').filter({ hasText: 'original key' });
  await expect(select).toBeVisible();
  await expect(select.locator('option[value="Bb"]')).toHaveCount(0); // Bb not in ALL_KEYS (A# is)
  await expect(select.locator('option[value="A#"]')).toHaveCount(1);
  await expect(select.locator('option[value="C"]')).toHaveCount(1);
  await expect(select.locator('option[value="B"]')).toHaveCount(1);
});
