import AdmZip from 'adm-zip';
import { writeFileSync } from 'fs';
import fs from 'fs';
import path from 'path';

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

// Formats a subdirectory name from metadata, e.g. "Ab-68bpm".
// Returns null if the metadata lacks key or BPM (e.g. manually organized folders).
export function formatOutputSubdir(meta: SongMetadata): string | null {
  if (!meta.key || !meta.bpmRaw) return null;
  const bpm = parseFloat(meta.bpmRaw).toString(); // "68.00" → "68", "142.5" → "142.5"
  return `${meta.key}-${bpm}bpm`;
}

// Extracts a Multitracks.com zip into songs/<song-name>/stems/.
// Uses adm-zip (pure JS) so it works on macOS, Windows, and Linux without system tools.
export function extractMultitrackZip(zipPath: string, songsDir: string): ExtractResult {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // Stem files live at <TopDir>/MultiTracks/*.m4a inside the zip
  const stemEntries = entries.filter(
    (e) =>
      !e.isDirectory &&
      /[/\\]MultiTracks[/\\][^/\\]+\.(m4a|wav|aiff?)$/i.test(e.entryName)
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

  console.log(`Extracting ${stemEntries.length} stems...`);
  for (const entry of stemEntries) {
    process.stdout.write(`  ${entry.name}...`);
    writeFileSync(path.join(stemsDir, entry.name), entry.getData());
    process.stdout.write(' done\n');
  }

  // Copy album art if present
  const albumEntry = entries.find(
    (e) => !e.isDirectory && /^Album\.jpe?g$/i.test(e.name)
  );
  if (albumEntry) {
    writeFileSync(path.join(songDir, albumEntry.name), albumEntry.getData());
  }

  return { songDir, songName, stemCount: stemEntries.length, metadata };
}
