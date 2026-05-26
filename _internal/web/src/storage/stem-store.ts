/**
 * StemStore — persistent storage for browser-mode stems and normalized cache.
 *
 * Works with any FileSystemDirectoryHandle root (OPFS or File System Access API).
 * The caller is responsible for obtaining the root; this class handles all I/O.
 *
 * Layout under root:
 *   songs-list.json            → string[]  (names of all saved song directories)
 *   songs/<songDir>/
 *     meta.json                → { displayName, stems: [{filename, ext}] }
 *     stems/<filename>.<ext>   (raw audio extracted from zip)
 *     normalized/
 *       meta.json              → { target_lufs: number }
 *       <filename>.wav         (normalized audio; paired with meta.json)
 *
 * No directory iteration is used anywhere — all reads are by known filename.
 * This avoids the missing FileSystemDirectoryHandle.entries() type in TypeScript's
 * DOM lib (the method exists in browsers but isn't declared in lib.dom.d.ts yet).
 */

export interface StoredSong {
  songDir: string;
  displayName: string;
  stems: { filename: string; ext: string }[];
}

export class StemStore {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async getSongDir(
    songDir: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    const songs = await this.root.getDirectoryHandle('songs', { create });
    return songs.getDirectoryHandle(songDir, { create });
  }

  // ── Song-list manifest ────────────────────────────────────────────────────────
  // We maintain a root-level songs-list.json rather than iterating the songs/
  // directory (FileSystemDirectoryHandle.entries() is not in TypeScript's DOM lib).

  private async readSongList(): Promise<string[]> {
    try {
      return await readJson<string[]>(this.root, 'songs-list.json');
    } catch {
      return [];
    }
  }

  private async appendToSongList(songDir: string): Promise<void> {
    const existing = await this.readSongList();
    if (!existing.includes(songDir)) {
      await writeJson(this.root, 'songs-list.json', [...existing, songDir]);
    }
  }

  // ── Raw stem storage ─────────────────────────────────────────────────────────

  async saveSong(
    songDir: string,
    displayName: string,
    stems: { filename: string; ext: string; data: Uint8Array }[],
  ): Promise<void> {
    const dir = await this.getSongDir(songDir, true);
    await writeJson(dir, 'meta.json', {
      displayName,
      stems: stems.map((s) => ({ filename: s.filename, ext: s.ext })),
    });
    const stemsDir = await dir.getDirectoryHandle('stems', { create: true });
    for (const stem of stems) {
      await writeFile(stemsDir, `${stem.filename}.${stem.ext}`, stem.data);
    }
    await this.appendToSongList(songDir);
  }

  async listSongs(): Promise<StoredSong[]> {
    const songDirs = await this.readSongList();
    const results: StoredSong[] = [];
    for (const songDir of songDirs) {
      try {
        const dir = await this.getSongDir(songDir, false);
        const meta = await readJson<{ displayName: string; stems: { filename: string; ext: string }[] }>(
          dir,
          'meta.json',
        );
        results.push({ songDir, displayName: meta.displayName, stems: meta.stems });
      } catch { /* skip corrupt or deleted entries */ }
    }
    return results;
  }

  async loadRaw(
    songDir: string,
  ): Promise<{ filename: string; ext: string; data: Uint8Array }[]> {
    const dir = await this.getSongDir(songDir, false);
    const meta = await readJson<{ stems: { filename: string; ext: string }[] }>(dir, 'meta.json');
    const stemsDir = await dir.getDirectoryHandle('stems');
    return Promise.all(
      meta.stems.map(async (stem) => {
        const handle = await stemsDir.getFileHandle(`${stem.filename}.${stem.ext}`);
        const file = await handle.getFile();
        return { filename: stem.filename, ext: stem.ext, data: new Uint8Array(await file.arrayBuffer()) };
      }),
    );
  }

  // ── Mix output ───────────────────────────────────────────────────────────────

  /**
   * Persist finished mix files under songs/<songDir>/output/.
   * Called after mixSongs completes for a song.
   */
  async saveOutput(
    songDir: string,
    files: { filename: string; data: Uint8Array }[],
  ): Promise<void> {
    const dir = await this.getSongDir(songDir, true);
    const outputDir = await dir.getDirectoryHandle('output', { create: true });
    for (const file of files) {
      await writeFile(outputDir, file.filename, file.data);
    }
  }

  // ── Normalized cache ─────────────────────────────────────────────────────────

  async saveNormalized(
    songDir: string,
    targetLufs: number,
    stems: { filename: string; data: Uint8Array }[],
  ): Promise<void> {
    const dir = await this.getSongDir(songDir, true);
    const normDir = await dir.getDirectoryHandle('normalized', { create: true });
    await writeJson(normDir, 'meta.json', { target_lufs: targetLufs });
    for (const stem of stems) {
      await writeFile(normDir, `${stem.filename}.wav`, stem.data);
    }
  }

  async getNormalizeMeta(songDir: string): Promise<{ target_lufs: number } | null> {
    try {
      const dir = await this.getSongDir(songDir, false);
      const normDir = await dir.getDirectoryHandle('normalized');
      return await readJson<{ target_lufs: number }>(normDir, 'meta.json');
    } catch {
      return null;
    }
  }

  async loadNormalized(
    songDir: string,
    targetLufs: number,
  ): Promise<{ filename: string; data: Uint8Array }[] | null> {
    const normMeta = await this.getNormalizeMeta(songDir);
    if (normMeta?.target_lufs !== targetLufs) return null;
    try {
      // Load stem names from the song meta (avoids directory iteration).
      const dir = await this.getSongDir(songDir, false);
      const songMeta = await readJson<{ stems: { filename: string }[] }>(dir, 'meta.json');
      const normDir = await dir.getDirectoryHandle('normalized');
      const results: { filename: string; data: Uint8Array }[] = [];
      for (const stem of songMeta.stems) {
        try {
          const handle = await normDir.getFileHandle(`${stem.filename}.wav`);
          const file = await handle.getFile();
          results.push({ filename: stem.filename, data: new Uint8Array(await file.arrayBuffer()) });
        } catch { /* stem not yet normalized; skip */ }
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }
}

// ── File I/O primitives ───────────────────────────────────────────────────────

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Uint8Array,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function writeJson(
  dir: FileSystemDirectoryHandle,
  name: string,
  value: unknown,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value));
  await writable.close();
}

async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T> {
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return JSON.parse(await file.text()) as T;
}
