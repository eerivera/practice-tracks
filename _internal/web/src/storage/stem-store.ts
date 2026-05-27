/**
 * StemStore — persistent storage for browser-mode stems and normalized cache.
 *
 * Works with any FileSystemDirectoryHandle root (OPFS or File System Access API).
 * The caller is responsible for obtaining the root; this class handles all I/O.
 *
 * Layout under root:
 *   songs/<displayName>/<keyBpm>/
 *     stems/<filename>.<ext>   (raw audio extracted from zip)
 *     normalized/
 *       meta.json              → { target_lufs: number }   (LUFS target only)
 *       <filename>.wav         (normalized audio)
 *     output/
 *       <mix>.mp3              (finished mix files)
 *
 * No manifest files are written.  Songs, stems, and outputs are discovered
 * entirely by crawling the directory tree via FileSystemDirectoryHandle.entries().
 */

export interface StoredSong {
  /** Internal identifier derived from directory names: "<displayName>-<keyBpm>".
   *  Round-trips through physicalPath() to recover the correct FS path.
   *  TODO: replace with a proper (displayName, keyBpm) triple once the server-
   *  side pipeline and App.tsx identifier contract are updated (#refactor-triple). */
  songDir: string;
  displayName: string;
  /** Formatted key/BPM, e.g. "Ab-68bpm".  Empty string when not parseable. */
  keyBpm: string;
  stems: { filename: string; ext: string }[];
}

export class StemStore {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Parse the two-level physical directory components from a logical songDir.
   *  "SongName-Ab-68.00bpm" → { displayName: "SongName", keyBpm: "Ab-68bpm" }
   *  Returns an empty keyBpm when the zip name has no key/BPM suffix. */
  private static readonly KEY_BPM_RE = /[-_]([A-G][#b]?)[-_]([\d.]+)bpm$/i;
  private static physicalPath(songDir: string): { displayName: string; keyBpm: string } {
    const match = StemStore.KEY_BPM_RE.exec(songDir);
    if (!match) return { displayName: songDir, keyBpm: '' };
    const bpm = parseFloat(match[2]).toString();
    return { displayName: songDir.slice(0, match.index), keyBpm: `${match[1]}-${bpm}bpm` };
  }

  /** Navigate (or create) songs/<displayName>/<keyBpm>/ in the OPFS/FSA root. */
  private async getSongDir(
    songDir: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    const { displayName, keyBpm } = StemStore.physicalPath(songDir);
    const songs = await this.root.getDirectoryHandle('songs', { create });
    const songNameDir = await songs.getDirectoryHandle(displayName, { create });
    if (!keyBpm) return songNameDir;
    return songNameDir.getDirectoryHandle(keyBpm, { create });
  }

  // ── Raw stem storage ─────────────────────────────────────────────────────────

  async saveSong(
    songDir: string,
    _displayName: string,
    _keyBpm: string,
    stems: { filename: string; ext: string; data: Uint8Array }[],
  ): Promise<void> {
    const dir = await this.getSongDir(songDir, true);
    const stemsDir = await dir.getDirectoryHandle('stems', { create: true });
    for (const stem of stems) {
      await writeFile(stemsDir, `${stem.filename}.${stem.ext}`, stem.data);
    }
    // No meta.json or songs-list.json written — songs are discovered by
    // crawling the directory tree on load.
  }

  async listSongs(): Promise<StoredSong[]> {
    const results: StoredSong[] = [];
    let songsDir: FileSystemDirectoryHandle;
    try {
      songsDir = await this.root.getDirectoryHandle('songs');
    } catch {
      return []; // songs/ not yet created — that's fine
    }

    for await (const [displayName, nameHandle] of entriesOf(songsDir)) {
      if (nameHandle.kind !== 'directory') continue;
      const nameDir = nameHandle as FileSystemDirectoryHandle;

      // Two-level: songs/<displayName>/<keyBpm>/
      // Any subdirectory that is not a known data directory is treated as a
      // key/BPM variant.  Known data directories (stems/, output/, normalized/)
      // belong to the one-level (no key/BPM) structure only.
      const DATA_DIRS = new Set(['stems', 'output', 'normalized']);
      let foundVariant = false;
      for await (const [keyBpm, variantHandle] of entriesOf(nameDir)) {
        if (variantHandle.kind !== 'directory' || DATA_DIRS.has(keyBpm)) continue;
        const variantDir = variantHandle as FileSystemDirectoryHandle;
        // Any non-data-dir subdirectory is a valid key/BPM variant — stems may be
        // absent if only output files exist (e.g. a song loaded via Re-mix).
        const stems = await readStemsDir(variantDir);
        results.push({
          songDir: `${displayName}-${keyBpm}`,
          displayName,
          keyBpm,
          stems: stems ?? [],
        });
        foundVariant = true;
      }

      // One-level fallback: songs/<displayName>/stems/ (no key/BPM suffix)
      if (!foundVariant) {
        const stems = await readStemsDir(nameDir);
        results.push({ songDir: displayName, displayName, keyBpm: '', stems: stems ?? [] });
      }
    }

    return results;
  }

  async loadRaw(
    songDir: string,
  ): Promise<{ filename: string; ext: string; data: Uint8Array }[]> {
    const dir = await this.getSongDir(songDir, false);
    const stemsDir = await dir.getDirectoryHandle('stems');
    const results: { filename: string; ext: string; data: Uint8Array }[] = [];
    for await (const [name, handle] of entriesOf(stemsDir)) {
      if (handle.kind !== 'file') continue;
      const dot = name.lastIndexOf('.');
      if (dot < 0) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      results.push({
        filename: name.slice(0, dot),
        ext: name.slice(dot + 1),
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }
    return results;
  }

  // ── Mix output ───────────────────────────────────────────────────────────────

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

  async loadAllOutputs(songDir: string): Promise<{ filename: string; data: Uint8Array }[]> {
    try {
      const dir = await this.getSongDir(songDir, false);
      const outputDir = await dir.getDirectoryHandle('output');
      const AUDIO_RE = /\.(m4a|mp3|wav|aiff?)$/i;
      const results: { filename: string; data: Uint8Array }[] = [];
      for await (const [name, handle] of entriesOf(outputDir)) {
        if (handle.kind !== 'file' || !AUDIO_RE.test(name)) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        results.push({ filename: name, data: new Uint8Array(await file.arrayBuffer()) });
      }
      return results;
    } catch {
      return [];
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
      const dir = await this.getSongDir(songDir, false);
      const normDir = await dir.getDirectoryHandle('normalized');
      const results: { filename: string; data: Uint8Array }[] = [];
      for await (const [name, handle] of entriesOf(normDir)) {
        if (handle.kind !== 'file' || name === 'meta.json' || !/\.wav$/i.test(name)) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        const dot = name.lastIndexOf('.');
        results.push({ filename: name.slice(0, dot), data: new Uint8Array(await file.arrayBuffer()) });
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

/**
 * Thin wrapper over FileSystemDirectoryHandle.entries(), which browsers support
 * but TypeScript's lib.dom.d.ts does not yet declare.
 */
function entriesOf(
  dir: FileSystemDirectoryHandle,
): AsyncIterable<[string, FileSystemHandle]> {
  type IterableDir = FileSystemDirectoryHandle & {
    entries(): AsyncIterable<[string, FileSystemHandle]>;
  };
  return (dir as unknown as IterableDir).entries();
}

/**
 * Reads all files in a stems/ subdirectory and returns their name+ext pairs.
 * Returns null when the stems/ directory doesn't exist (caller should skip).
 */
async function readStemsDir(
  songVariantDir: FileSystemDirectoryHandle,
): Promise<{ filename: string; ext: string }[] | null> {
  let stemsDir: FileSystemDirectoryHandle;
  try {
    stemsDir = await songVariantDir.getDirectoryHandle('stems');
  } catch {
    return null; // no stems/ directory — not a fully-saved song
  }
  const stems: { filename: string; ext: string }[] = [];
  for await (const [name, handle] of entriesOf(stemsDir)) {
    if (handle.kind !== 'file') continue;
    const dot = name.lastIndexOf('.');
    if (dot < 0) continue;
    stems.push({ filename: name.slice(0, dot), ext: name.slice(dot + 1) });
  }
  return stems;
}
