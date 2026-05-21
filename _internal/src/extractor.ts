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
  const songDir = path.join(songsDir, songName);
  const stemsDir = path.join(songDir, 'stems');
  fs.mkdirSync(stemsDir, { recursive: true });

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

  // Copy album art if present
  const albumEntry = Object.entries(entries).find(([name]) => {
    const basename = name.split('/').pop() ?? '';
    return !name.endsWith('/') && /^Album\.jpe?g$/i.test(basename);
  });
  if (albumEntry) {
    const [albumPath, albumData] = albumEntry;
    const albumName = albumPath.split('/').pop() ?? albumPath;
    writeFileSync(path.join(songDir, albumName), albumData);
  }

  return { songDir, songName, stemCount: stemEntries.length, metadata };
}
