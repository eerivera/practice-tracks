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
