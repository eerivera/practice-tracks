/**
 * Helpers for browser-mode Playwright tests.
 *
 * These tests run against the VITE_BACKEND=browser static build and exercise
 * BrowserApi + StemStore + OPFS directly in a real Chromium context.
 */
import type { Page } from '@playwright/test';

// ── OPFS seed helpers ─────────────────────────────────────────────────────────
// Writes the exact directory structure that StemStore reads, so tests can
// start with pre-existing data without running the full extract → mix pipeline.
//
// Layout (mirrors StemStore's physicalSongPath mapping):
//   practice-tracks/
//     songs-list.json            ← ["zipName", ...]
//     songs/
//       <displayName>/
//         <keyBpm>/
//           meta.json            ← { displayName, keyBpm, stems }
//           output/
//             <mix>.mp3          ← minimal placeholder bytes

export interface SeedSongParams {
  /** Full zip name used as the logical identifier, e.g. "TestSong-Ab-68.00bpm" */
  zipName: string;
  /** Human-readable title with key/BPM stripped, e.g. "TestSong" */
  displayName: string;
  /** Formatted key/BPM variant, e.g. "Ab-68bpm" */
  keyBpm: string;
  /** Mix output filenames to create under output/, e.g. ["TestSong - Full Mix.mp3"] */
  outputFilenames: readonly string[];
  /** Optional stem metadata to include in meta.json (default: []) */
  stems?: { filename: string; ext: string }[];
}

/**
 * Seeds OPFS with a song's metadata and output files.
 * Must be called AFTER page.goto() so the browser context exists.
 * The page should then be reloaded so BrowserApi.init() picks up the data.
 */
export async function seedOpfsOutputs(page: Page, opts: SeedSongParams): Promise<void> {
  await page.evaluate(async (params) => {
    async function writeText(
      dir: FileSystemDirectoryHandle,
      name: string,
      content: string,
    ): Promise<void> {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(content);
      await w.close();
    }

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

    // Append to songs-list.json (or create it).
    let existing: string[] = [];
    try {
      const h = await pt.getFileHandle('songs-list.json');
      const f = await h.getFile();
      existing = JSON.parse(await f.text()) as string[];
    } catch { /* first song */ }
    if (!existing.includes(params.zipName)) {
      await writeText(pt, 'songs-list.json', JSON.stringify([...existing, params.zipName]));
    }

    // songs/<displayName>/<keyBpm>/meta.json
    const songs = await pt.getDirectoryHandle('songs', { create: true });
    const nameDir = await songs.getDirectoryHandle(params.displayName, { create: true });
    const variantDir = await nameDir.getDirectoryHandle(params.keyBpm, { create: true });
    await writeText(variantDir, 'meta.json', JSON.stringify({
      displayName: params.displayName,
      keyBpm: params.keyBpm,
      stems: params.stems ?? [],
    }));

    // songs/<displayName>/<keyBpm>/output/<filename>
    const outputDir = await variantDir.getDirectoryHandle('output', { create: true });
    for (const filename of params.outputFilenames) {
      // Minimal MPEG frame header so the file is non-empty and identifiable.
      await writeBytes(outputDir, filename, [0xFF, 0xFB, 0x90, 0x00]);
    }
  }, opts);
}
