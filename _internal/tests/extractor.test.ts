import { describe, it, expect } from 'vitest';
import { physicalSongPath, parseSongMetadata, formatOutputSubdir, formatSongDisplayName } from '../src/extractor.js';

describe('physicalSongPath', () => {
  it('maps a typical zip name to two-level path', () => {
    expect(physicalSongPath('songs/Who Else-Crowns Down (Live)-Ab-68.00bpm'))
      .toBe('songs/Who Else-Crowns Down (Live)/Ab-68bpm');
  });

  it('normalises fractional BPM', () => {
    expect(physicalSongPath('songs/Amazing Grace-G-72.50bpm'))
      .toBe('songs/Amazing Grace/G-72.5bpm');
  });

  it('normalises integer-looking BPM (removes trailing .00)', () => {
    expect(physicalSongPath('songs/Song-F#-140.00bpm'))
      .toBe('songs/Song/F#-140bpm');
  });

  it('returns single-level path when there is no key/BPM suffix', () => {
    expect(physicalSongPath('songs/ManualSong'))
      .toBe('songs/ManualSong');
  });

  it('works with a bare name (no songs/ prefix)', () => {
    // dirname('SongName-Bb-95.00bpm') === '.' → path.join('.', 'SongName', 'Bb-95bpm')
    // = 'SongName/Bb-95bpm' (Node strips the leading dot).
    expect(physicalSongPath('SongName-Bb-95.00bpm'))
      .toBe('SongName/Bb-95bpm');
  });

  it('round-trips through parseSongMetadata + formatOutputSubdir', () => {
    const zipName = 'Praise-C-120.00bpm';
    const meta = parseSongMetadata(zipName);
    const keyBpm = formatOutputSubdir(meta);
    const displayName = formatSongDisplayName(zipName);
    expect(physicalSongPath(`songs/${zipName}`)).toBe(`songs/${displayName}/${keyBpm}`);
  });
});
