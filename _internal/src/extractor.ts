import { unzipSync } from 'fflate';
import { writeFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { consoleEmitter, type Emitter } from '../common/events.js';

export interface SongMetadata {
  key?: string;
  bpmRaw?: string;
}

export interface ExtractResult {
  songDir: string;
  songName: string;
  stemCount: number;
  metadata: SongMetadata;
  /** Formatted key/BPM string, e.g. "Ab-68bpm".  Empty string when not parseable. */
  keyBpm: string;
}

// Parses key signature and BPM from a Multitracks zip/folder name.
// Example: "Who Else-Crowns Down (Live)-Ab-68.00bpm" → { key: "Ab", bpmRaw: "68.00" }
export function parseSongMetadata(name: string): SongMetadata {
  const match = /[-_]([A-G][#b]?)[-_]([\d.]+)bpm$/i.exec(name);
  if (!match) return {};
  return { key: match[1], bpmRaw: match[2] };
}

// Strips the key-signature/BPM suffix to produce a human-readable title.
// "Who Else-Crowns Down (Live)-Ab-68.00bpm" → "Who Else-Crowns Down (Live)"
export function formatSongDisplayName(dirPath: string): string {
  return path.basename(dirPath).replace(/[-_][A-G][#b]?[-_][\d.]+bpm$/i, '');
}

// Formats a subdirectory name from metadata, e.g. "Ab-68bpm".
// Returns null if the metadata lacks key or BPM (e.g. manually organized folders).
export function formatOutputSubdir(meta: SongMetadata): string | null {
  if (!meta.key || !meta.bpmRaw) return null;
  const bpm = parseFloat(meta.bpmRaw).toString(); // "68.00" → "68", "142.5" → "142.5"
  return `${meta.key}-${bpm}bpm`;
}

/** Maps a logical song directory path to its physical two-level layout path.
 *
 *  Logical:  "songs/SongName-Ab-68.00bpm"
 *  Physical: "songs/SongName/Ab-68bpm"
 *
 *  When the zip name has no key/BPM suffix the song directory is left as a
 *  single-level path ("songs/ManualSong") so manually-organized folders still work.
 */
export function physicalSongPath(logicalPath: string): string {
  const dir = path.dirname(logicalPath);
  const base = path.basename(logicalPath);
  const displayName = formatSongDisplayName(base);
  const keyBpm = formatOutputSubdir(parseSongMetadata(base));
  if (!keyBpm) return path.join(dir, displayName);
  return path.join(dir, displayName, keyBpm);
}

// Extracts a Multitracks.com zip into songs/<song-name>/stems/.
// Uses fflate (pure JS) so it works on macOS, Windows, and Linux without system tools.
export function extractMultitrackZip(
  zipPath: string,
  songsDir: string,
  emit: Emitter = consoleEmitter
): ExtractResult {
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));

  // Stem files live at <TopDir>/MultiTracks/*.m4a inside the zip.
  // fflate keys are full paths; directories end with '/'.
  const stemEntries = Object.entries(entries).filter(
    ([name]) =>
      !name.endsWith('/') &&
      /[/\\]MultiTracks[/\\][^/\\]+\.(m4a|wav|aiff?)$/i.test(name)
  );
  if (stemEntries.length === 0) {
    throw new Error(
      `No stems found in ${path.basename(zipPath)}.\n` +
        `Expected audio files inside a MultiTracks/ subdirectory within the zip.`
    );
  }

  const songName = path.basename(zipPath, '.zip');
  const metadata = parseSongMetadata(songName);
  const displayName = formatSongDisplayName(songName);
  const keyBpm = formatOutputSubdir(metadata) ?? '';

  // Physical two-level layout: songs/<displayName>/<keyBpm>/ (e.g. songs/Song/Ab-68bpm/).
  // Falls back to single-level when the zip has no key/BPM suffix.
  const variantDir = keyBpm
    ? path.join(songsDir, displayName, keyBpm)
    : path.join(songsDir, displayName);
  const stemsDir = path.join(variantDir, 'stems');
  fs.mkdirSync(stemsDir, { recursive: true });

  // Logical identifier returned to the caller (used as the API key for this song).
  const songDir = path.join(songsDir, songName);

  emit({ type: 'extract_start', total: stemEntries.length });
  const extractStart = Date.now();

  for (let i = 0; i < stemEntries.length; i++) {
    const [entryPath, data] = stemEntries[i];
    const entryName = entryPath.split('/').pop();
    if (!entryName) continue;
    const t = Date.now();
    writeFileSync(path.join(stemsDir, entryName), data);
    emit({ type: 'stem_extracted', name: entryName, index: i + 1, total: stemEntries.length, timeMs: Date.now() - t });
  }

  emit({ type: 'extract_complete', total: stemEntries.length, elapsedMs: Date.now() - extractStart });

  // Copy album art into the variant directory if present.
  const albumEntry = Object.entries(entries).find(([name]) => {
    const basename = name.split('/').pop() ?? '';
    return !name.endsWith('/') && /^Album\.jpe?g$/i.test(basename);
  });
  if (albumEntry) {
    const [albumPath, albumData] = albumEntry;
    const albumName = albumPath.split('/').pop() ?? albumPath;
    writeFileSync(path.join(variantDir, albumName), albumData);
  }

  // Write per-song meta.json in StemStore-compatible format so the static
  // browser version can read server-extracted stems from a shared folder.
  const stemsForMeta = stemEntries.map(([entryPath]) => {
    const entryName = entryPath.split('/').pop() ?? entryPath;
    return {
      filename: path.basename(entryName, path.extname(entryName)),
      ext: path.extname(entryName).slice(1),
    };
  });
  writeFileSync(
    path.join(variantDir, 'meta.json'),
    JSON.stringify({ displayName, keyBpm, stems: stemsForMeta }, null, 2),
  );

  // Maintain a songs-list.json manifest at the songs root so the static
  // browser version can discover all song directories without iterating.
  // Entries are the logical zip names (e.g. "SongName-Ab-68.00bpm").
  const songsListPath = path.join(songsDir, 'songs-list.json');
  let songList: string[] = [];
  if (fs.existsSync(songsListPath)) {
    try { songList = JSON.parse(fs.readFileSync(songsListPath, 'utf-8')) as string[]; } catch { /* ignore corrupt manifest */ }
  }
  if (!songList.includes(songName)) {
    writeFileSync(songsListPath, JSON.stringify([...songList, songName], null, 2));
  }

  return { songDir, songName, stemCount: stemEntries.length, metadata, keyBpm };
}
