import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

export interface ExtractResult {
  songDir: string;
  songName: string;
  stemCount: number;
}

// Extracts a Multitracks.com zip into songs/<song-name>/stems/
// The zip is expected to contain a top-level folder with a MultiTracks/ subdirectory.
export async function extractMultitrackZip(
  zipPath: string,
  songsDir: string
): Promise<ExtractResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-tracks-extract-'));

  try {
    await execFileAsync('unzip', ['-q', zipPath, '-d', tmpDir]);

    const entries = fs.readdirSync(tmpDir);
    const topDirName = entries.find((e) =>
      fs.statSync(path.join(tmpDir, e)).isDirectory()
    );
    if (!topDirName) throw new Error('No directory found in zip');

    const multiTracksDir = path.join(tmpDir, topDirName, 'MultiTracks');
    if (!fs.existsSync(multiTracksDir)) {
      throw new Error(`No MultiTracks/ subdirectory found inside ${topDirName}`);
    }

    const songName = path.basename(zipPath, '.zip');
    const songDir = path.join(songsDir, songName);
    const stemsDir = path.join(songDir, 'stems');
    fs.mkdirSync(stemsDir, { recursive: true });

    const stemFiles = fs.readdirSync(multiTracksDir).filter((f) =>
      /\.(m4a|wav|aiff?)$/i.test(f)
    );
    for (const stem of stemFiles) {
      fs.copyFileSync(path.join(multiTracksDir, stem), path.join(stemsDir, stem));
    }

    const albumArt = path.join(tmpDir, topDirName, 'Album.jpg');
    if (fs.existsSync(albumArt)) {
      fs.copyFileSync(albumArt, path.join(songDir, 'Album.jpg'));
    }

    return { songDir, songName, stemCount: stemFiles.length };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
