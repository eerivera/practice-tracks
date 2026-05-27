/**
 * Helpers for browser-mode Playwright tests.
 *
 * These tests run against the VITE_BACKEND=browser static build and exercise
 * BrowserApi + StemStore + OPFS directly in a real Chromium context.
 */
import type { Page } from '@playwright/test';

// ── Seed data layout ──────────────────────────────────────────────────────────
// Mirrors the manifest-free StemStore layout:
//
//   songs/<displayName>/<keyBpm>/
//     stems/<filename>.<ext>     ← minimal placeholder bytes
//     output/<mix>.mp3           ← minimal placeholder bytes
//
// No songs-list.json or meta.json is written.  StemStore discovers songs
// by crawling the directory tree via entries().

export interface SeedSongParams {
  /** Full zip name used as the logical identifier, e.g. "TestSong-Ab-68.00bpm" */
  zipName: string;
  /** Human-readable title with key/BPM stripped, e.g. "TestSong" */
  displayName: string;
  /** Formatted key/BPM variant, e.g. "Ab-68bpm" */
  keyBpm: string;
  /** Mix output filenames to create under output/, e.g. ["TestSong - Full Mix.mp3"] */
  outputFilenames: readonly string[];
  /** Optional stems to create under stems/ — filename without extension + ext */
  stems?: readonly { filename: string; ext: string }[];
}

// ── FSA mock helpers ──────────────────────────────────────────────────────────

/**
 * Sets up a mock FSA folder pre-seeded with a song's outputs, then overrides
 * window.showDirectoryPicker to return that folder.  Call after page.goto().
 */
export async function mockFsaFolderWithSong(page: Page, opts: SeedSongParams): Promise<void> {
  await page.evaluate(async (params) => {
    async function writeBytes(
      dir: FileSystemDirectoryHandle,
      name: string,
      bytes: number[],
    ): Promise<void> {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
    }

    // Create an OPFS subdirectory to act as the mock FSA root.
    const root = await navigator.storage.getDirectory();
    const mockDir = await root.getDirectoryHandle('mock-fsa', { create: true });

    // songs/<displayName>/<keyBpm>/stems/ + output/
    const songs = await mockDir.getDirectoryHandle('songs', { create: true });
    const nameDir = await songs.getDirectoryHandle(params.displayName, { create: true });
    const variantDir = await nameDir.getDirectoryHandle(params.keyBpm, { create: true });

    if (params.stems && params.stems.length > 0) {
      const stemsDir = await variantDir.getDirectoryHandle('stems', { create: true });
      for (const stem of params.stems) {
        await writeBytes(stemsDir, `${stem.filename}.${stem.ext}`, [0xFF, 0xFB, 0x90, 0x00]);
      }
    }

    const outputDir = await variantDir.getDirectoryHandle('output', { create: true });
    for (const filename of params.outputFilenames) {
      await writeBytes(outputDir, filename, [0xFF, 0xFB, 0x90, 0x00]);
    }

    // Override the picker so switchToFsa() gets this handle without a dialog.
    type PickFn = (opts: unknown) => Promise<FileSystemDirectoryHandle>;
    (window as unknown as { showDirectoryPicker: PickFn }).showDirectoryPicker =
      () => Promise.resolve(mockDir);
  }, opts);
}

/**
 * Same as mockFsaFolderWithSong but also writes a `practice-tracks-config.yaml`
 * file to the folder root so tests can verify that config is read from FSA.
 * `configYaml` is a raw YAML string (e.g. "normalize: true\ntarget_lufs: -16\n").
 */
export async function mockFsaFolderWithConfig(
  page: Page,
  opts: SeedSongParams,
  configYaml: string,
): Promise<void> {
  await page.evaluate(async ({ params, yamlText }) => {
    async function writeBytes(
      dir: FileSystemDirectoryHandle,
      name: string,
      bytes: number[],
    ): Promise<void> {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
    }

    async function writeText(
      dir: FileSystemDirectoryHandle,
      name: string,
      text: string,
    ): Promise<void> {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    }

    const root = await navigator.storage.getDirectory();
    const mockDir = await root.getDirectoryHandle('mock-fsa', { create: true });

    // Write the config YAML to the folder root.
    await writeText(mockDir, 'practice-tracks-config.yaml', yamlText);

    // Seed song outputs.
    const songs = await mockDir.getDirectoryHandle('songs', { create: true });
    const nameDir = await songs.getDirectoryHandle(params.displayName, { create: true });
    const variantDir = await nameDir.getDirectoryHandle(params.keyBpm, { create: true });

    if (params.stems && params.stems.length > 0) {
      const stemsDir = await variantDir.getDirectoryHandle('stems', { create: true });
      for (const stem of params.stems) {
        await writeBytes(stemsDir, `${stem.filename}.${stem.ext}`, [0xFF, 0xFB, 0x90, 0x00]);
      }
    }

    const outputDir = await variantDir.getDirectoryHandle('output', { create: true });
    for (const filename of params.outputFilenames) {
      await writeBytes(outputDir, filename, [0xFF, 0xFB, 0x90, 0x00]);
    }

    // Override picker to return this directory without a dialog.
    type PickFn = (opts: unknown) => Promise<FileSystemDirectoryHandle>;
    (window as unknown as { showDirectoryPicker: PickFn }).showDirectoryPicker =
      () => Promise.resolve(mockDir);
  }, { params: opts, yamlText: configYaml });
}

// ── OPFS seed helpers ─────────────────────────────────────────────────────────

/**
 * Seeds OPFS with a song's stems and output files.
 * Must be called AFTER page.goto() so the browser context exists.
 * The page should then be reloaded so BrowserApi.init() picks up the data.
 */
export async function seedOpfsOutputs(page: Page, opts: SeedSongParams): Promise<void> {
  await page.evaluate(async (params) => {
    async function writeBytes(
      dir: FileSystemDirectoryHandle,
      name: string,
      bytes: number[],
    ): Promise<void> {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
    }

    const root = await navigator.storage.getDirectory();
    // StemStore uses a 'practice-tracks' sub-directory inside the OPFS root.
    const pt = await root.getDirectoryHandle('practice-tracks', { create: true });

    // songs/<displayName>/<keyBpm>/stems/ + output/
    const songs = await pt.getDirectoryHandle('songs', { create: true });
    const nameDir = await songs.getDirectoryHandle(params.displayName, { create: true });
    const variantDir = await nameDir.getDirectoryHandle(params.keyBpm, { create: true });

    if (params.stems && params.stems.length > 0) {
      const stemsDir = await variantDir.getDirectoryHandle('stems', { create: true });
      for (const stem of params.stems) {
        await writeBytes(stemsDir, `${stem.filename}.${stem.ext}`, [0xFF, 0xFB, 0x90, 0x00]);
      }
    }

    // Minimal MPEG frame header so the output file is non-empty and identifiable.
    const outputDir = await variantDir.getDirectoryHandle('output', { create: true });
    for (const filename of params.outputFilenames) {
      await writeBytes(outputDir, filename, [0xFF, 0xFB, 0x90, 0x00]);
    }
  }, opts);
}
