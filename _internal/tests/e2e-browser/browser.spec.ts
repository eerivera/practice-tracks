/**
 * Browser-mode E2E tests (VITE_BACKEND=browser).
 *
 * These run against the static build in a real Chromium context and exercise
 * BrowserApi + StemStore + OPFS directly.  Each test gets an isolated browser
 * context, so OPFS starts empty every time.
 */
import { test, expect } from '@playwright/test';
import { seedOpfsOutputs, mockFsaFolderWithSong } from './helpers.js';

const SONG = {
  zipName: 'TestSong-Ab-68.00bpm',
  displayName: 'TestSong',
  keyBpm: 'Ab-68bpm',
  outputFilenames: ['TestSong - Full Mix.mp3', 'TestSong - No Click.mp3'],
} as const;

// ── Storage notice ────────────────────────────────────────────────────────────
// When no FSA folder has been chosen the app defaults to OPFS and should
// display an amber warning telling the user their files may be cleared.

test('OPFS amber warning appears on first load', async ({ page }) => {
  await page.goto('/');
  // The warning appears after BrowserApi.init() resolves (chained off listSongs).
  await expect(
    page.getByText('may be cleared by the browser', { exact: false })
  ).toBeVisible({ timeout: 5000 });
});

// ── Past Mixes reload (regression: PR #22) ────────────────────────────────────
// Bug: getOutputs() was called on mount before BrowserApi.init() resolved,
// so persistedOutputs was always empty and Past Mixes showed nothing on reload.
// Fix: getOutputs() now awaits initPromise.

test('Past Mixes reconstructed from OPFS on page reload', async ({ page }) => {
  // First load — OPFS is empty, no Past Mixes.
  await page.goto('/');

  // Seed OPFS to simulate a previous mix session.
  await seedOpfsOutputs(page, SONG);

  // Reload so BrowserApi.init() picks up the seeded data.
  await page.reload();

  // Past Mixes section must show the song title heading.
  await expect(page.getByRole('heading', { name: SONG.displayName })).toBeVisible({ timeout: 5000 });

  // Both mix files must appear as download links with blob: URLs.
  for (const filename of SONG.outputFilenames) {
    const link = page.getByRole('link', { name: filename });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^blob:/);
  }
});

test('"Download all" zip link exists after reload', async ({ page }) => {
  await page.goto('/');
  await seedOpfsOutputs(page, SONG);
  await page.reload();

  // The "Download all" anchor must have a blob: href too.
  await expect(page.getByRole('heading', { name: SONG.displayName })).toBeVisible({ timeout: 5000 });
  const zipLink = page.getByRole('link', { name: 'Download all' });
  await expect(zipLink).toBeVisible();
  const href = await zipLink.getAttribute('href');
  expect(href).toMatch(/^blob:/);
});

// ── Re-mix button ─────────────────────────────────────────────────────────────
// Songs with seeded outputs should show a Re-mix button in Past Mixes.

test('Re-mix button visible for songs loaded from OPFS', async ({ page }) => {
  await page.goto('/');
  await seedOpfsOutputs(page, SONG);
  await page.reload();

  await expect(page.getByRole('heading', { name: SONG.displayName })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Re-mix' })).toBeVisible();
});

// ── Multiple songs ────────────────────────────────────────────────────────────

test('Past Mixes shows all seeded songs after reload', async ({ page }) => {
  await page.goto('/');
  await seedOpfsOutputs(page, SONG);
  await seedOpfsOutputs(page, {
    zipName: 'AnotherSong-G-72.00bpm',
    displayName: 'AnotherSong',
    keyBpm: 'G-72bpm',
    outputFilenames: ['AnotherSong - Full Mix.mp3'],
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: SONG.displayName })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'AnotherSong' })).toBeVisible();
});

// ── Switch folder ─────────────────────────────────────────────────────────────
// The FSA info bar (shown when a folder is active) must have a "Switch folder"
// button.  Switching should reload Past Mixes from the new location without a
// page reload and must not show songs from the previous location.

const FSA_SONG = {
  zipName: 'FsaSong-D-90.00bpm',
  displayName: 'FsaSong',
  keyBpm: 'D-90bpm',
  outputFilenames: ['FsaSong - Full Mix.mp3'],
} as const;

test('"Switch folder" button appears after switching from OPFS to FSA', async ({ page }) => {
  await page.goto('/');
  await mockFsaFolderWithSong(page, FSA_SONG);

  // OPFS amber warning includes "saving to a folder instead" link.
  await expect(page.getByRole('button', { name: 'saving to a folder instead' })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'saving to a folder instead' }).click();

  // After switching, the FSA info bar must show "Switch folder".
  await expect(page.getByRole('button', { name: 'Switch folder' })).toBeVisible({ timeout: 5000 });
});

test('switching to a folder loads its songs into Past Mixes', async ({ page }) => {
  await page.goto('/');
  await mockFsaFolderWithSong(page, FSA_SONG);

  await page.getByRole('button', { name: 'saving to a folder instead' }).click();

  // Past Mixes must show the song seeded into the mock FSA folder — no reload needed.
  await expect(page.getByRole('heading', { name: FSA_SONG.displayName })).toBeVisible({ timeout: 5000 });
  const link = page.getByRole('link', { name: FSA_SONG.outputFilenames[0] });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^blob:/);
});

test('switching folders clears Past Mixes from the previous folder', async ({ page }) => {
  // Start with an OPFS song loaded.
  await page.goto('/');
  await seedOpfsOutputs(page, SONG);
  await page.reload();
  await expect(page.getByRole('heading', { name: SONG.displayName })).toBeVisible({ timeout: 5000 });

  // Switch to a mock FSA folder that contains a different song.
  await mockFsaFolderWithSong(page, FSA_SONG);
  await page.getByRole('button', { name: 'saving to a folder instead' }).click();

  // New song must appear; old OPFS song must not.
  await expect(page.getByRole('heading', { name: FSA_SONG.displayName })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: SONG.displayName })).not.toBeVisible();
});

// ── Upload/Download config visibility ─────────────────────────────────────────
// Upload config and Download config are only meaningful once a song is loaded
// (there's a Soundboard to preview the effect).  Before stems are available
// the buttons must be hidden to reduce clutter.

const SONG_WITH_STEMS = {
  ...SONG,
  stems: [
    { filename: 'Drums.wav', ext: 'wav' },
    { filename: 'Bass.wav', ext: 'wav' },
  ],
} as const;

test('Upload/Download config hidden before stems loaded, visible after', async ({ page }) => {
  await page.goto('/');
  // Wait for init (amber OPFS warning confirms BrowserApi.init() resolved and
  // config was fetched — the earliest moment these buttons could appear).
  await expect(
    page.getByText('may be cleared by the browser', { exact: false })
  ).toBeVisible({ timeout: 5000 });

  // No song loaded — buttons must be absent.
  await expect(page.getByRole('button', { name: 'Upload config' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Download config' })).not.toBeVisible();

  // Seed a song WITH stem metadata so getStems() returns a non-empty list.
  await seedOpfsOutputs(page, SONG_WITH_STEMS);
  await page.reload();

  // Wait for the song to appear in Past Mixes (confirms stems are also loaded).
  await expect(page.getByRole('heading', { name: SONG_WITH_STEMS.displayName })).toBeVisible({ timeout: 5000 });

  // Both buttons must now be visible.
  await expect(page.getByRole('button', { name: 'Upload config' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download config' })).toBeVisible();
});

// ── Add more zips ─────────────────────────────────────────────────────────────
// Once files are queued the user can append additional zips without cancelling.

test('"Add more zips" appends files and updates the count', async ({ page }) => {
  await page.goto('/');

  // A minimal valid-ish zip end-of-central-directory record (22 bytes).
  const fakeZipBytes = Buffer.from([
    0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  // Trigger the DropZone hidden input to reach files_selected phase.
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track1.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('1 zip ready')).toBeVisible({ timeout: 3000 });

  // The DropZone is now gone; the add-more input is the only .zip input on the page.
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track2.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('2 zips ready')).toBeVisible({ timeout: 3000 });
});

test('"Add more zips" silently skips duplicate filenames', async ({ page }) => {
  await page.goto('/');

  const fakeZipBytes = Buffer.from([
    0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  // Queue track1.zip via the DropZone.
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track1.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('1 zip ready')).toBeVisible({ timeout: 3000 });

  // Attempt to add track1.zip again via the add-more input — must be rejected.
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track1.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('1 zip ready')).toBeVisible({ timeout: 3000 });
});

// ── Folder switch confirmation ─────────────────────────────────────────────────
// Switching storage while a session is active must show a confirmation modal
// so the user doesn't lose work accidentally.  Idle → no modal, just switches.

const fakeZipBytes = Buffer.from([
  0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
]);

test('switching folder from idle phase needs no confirmation', async ({ page }) => {
  await page.goto('/');
  await mockFsaFolderWithSong(page, FSA_SONG);

  // From idle (home screen), clicking the OPFS link should switch immediately.
  await expect(
    page.getByRole('button', { name: 'saving to a folder instead' })
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'saving to a folder instead' }).click();

  // No confirmation modal — should go straight to FSA state.
  await expect(page.getByRole('button', { name: 'Switch folder' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Switch storage folder?' })).not.toBeVisible();
});

test('switching folder mid-session shows confirmation modal', async ({ page }) => {
  await page.goto('/');

  // Reach files_selected phase.
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('1 zip ready')).toBeVisible({ timeout: 3000 });

  // Clicking switch should now show the confirmation modal.
  await page.getByRole('button', { name: 'saving to a folder instead' }).click();
  await expect(
    page.getByRole('heading', { name: 'Switch storage folder?' })
  ).toBeVisible({ timeout: 3000 });
});

test('cancelling the confirmation keeps the session intact', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('1 zip ready')).toBeVisible({ timeout: 3000 });

  await page.getByRole('button', { name: 'saving to a folder instead' }).click();
  await expect(page.getByRole('heading', { name: 'Switch storage folder?' })).toBeVisible({ timeout: 3000 });

  // Cancel — modal closes, session is unchanged.
  // Scope to the fixed overlay so we don't hit the files_selected "Cancel" button too.
  await page.locator('.fixed.inset-0').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Switch storage folder?' })).not.toBeVisible();
  await expect(page.getByText('1 zip ready')).toBeVisible();
});

test('confirming the switch resets to the home screen', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: 'track.zip',
    mimeType: 'application/zip',
    buffer: fakeZipBytes,
  });
  await expect(page.getByText('1 zip ready')).toBeVisible({ timeout: 3000 });

  // Set up the mock FSA folder before confirming (showDirectoryPicker will be called).
  await mockFsaFolderWithSong(page, FSA_SONG);
  await page.getByRole('button', { name: 'saving to a folder instead' }).click();
  await expect(page.getByRole('heading', { name: 'Switch storage folder?' })).toBeVisible({ timeout: 3000 });

  // Confirm — the modal's "Switch folder" button (not the header one).
  await page.getByRole('button', { name: 'Switch folder' }).click();

  // Should return to home screen (DropZone visible) and show the new folder's songs.
  await expect(page.getByText('Drop Multitracks zips here')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: FSA_SONG.displayName })).toBeVisible();
});
