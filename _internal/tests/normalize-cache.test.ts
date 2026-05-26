import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Helpers ───────────────────────────────────────────────────────────────────
// We test the cache logic by inspecting the files written to a real temp dir
// rather than importing private functions — this keeps the tests black-box and
// resilient to internal refactors.

// Re-export the private helpers under test by reading them via a dynamic import
// workaround isn't practical for private fns, so we test observable behaviour:
// run runNormalize with normalize:false (no FFmpeg needed) and verify cache
// directories are NOT created, then verify that a valid meta.json causes the
// normalize_cached event to fire.

import { runNormalize } from '../src/pipeline.js';
import type { ProgressEvent } from '../common/events.js';

const NORMALIZE_META_FILE = 'meta.json';
const NORMALIZED_DIR = 'normalized';

// Minimal config with normalize disabled (default).
function makeConfig(normalize: boolean, targetLufs = -23) {
  return {
    normalize,
    target_lufs: targetLufs,
    output_format: 'm4a' as const,
    buses: [{ name: 'Test', gain_db: 0, contains: ['stem*'] }],
    mixes: [{ name: 'full' }],
  };
}

function collectEvents(events: ProgressEvent[]) {
  return (e: ProgressEvent) => { events.push(e); };
}

describe('normalized stem cache', () => {
  let tmpSongDir: string;
  let stemsDir: string;
  let stemFile: string;

  beforeEach(() => {
    // Create a minimal song directory structure with one fake stem.
    tmpSongDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-cache-test-'));
    stemsDir = path.join(tmpSongDir, 'stems');
    fs.mkdirSync(stemsDir);
    stemFile = path.join(stemsDir, 'stem 1.wav');
    // Minimal valid WAV header (44 bytes) so the file is non-empty.
    fs.writeFileSync(stemFile, Buffer.alloc(44));
  });

  afterEach(() => {
    fs.rmSync(tmpSongDir, { recursive: true, force: true });
  });

  it('does not create a normalized/ dir when normalize is false', async () => {
    const events: ProgressEvent[] = [];
    await runNormalize(tmpSongDir, false, collectEvents(events), makeConfig(false));
    expect(fs.existsSync(path.join(tmpSongDir, NORMALIZED_DIR))).toBe(false);
    expect(events.some((e) => e.type === 'normalize_cached')).toBe(false);
    expect(events.some((e) => e.type === 'normalize_start')).toBe(false);
  });

  it('emits normalize_cached and skips FFmpeg when cache is valid', async () => {
    const targetLufs = -23;
    // Pre-populate a valid cache manually.
    const cacheDir = path.join(tmpSongDir, NORMALIZED_DIR);
    fs.mkdirSync(cacheDir);
    // The cached stem must exist as <filename>.wav in the cache dir.
    fs.writeFileSync(path.join(cacheDir, 'stem 1.wav'), Buffer.alloc(44));
    // Write the meta file with the matching LUFS target.
    fs.writeFileSync(
      path.join(cacheDir, NORMALIZE_META_FILE),
      JSON.stringify({ target_lufs: targetLufs })
    );

    const events: ProgressEvent[] = [];
    const result = await runNormalize(
      tmpSongDir, false, collectEvents(events), makeConfig(true, targetLufs)
    );

    expect(events.some((e) => e.type === 'normalize_cached')).toBe(true);
    expect(events.some((e) => e.type === 'normalize_start')).toBe(false);
    // The result should point to the cached path, not the original stem path.
    expect(result?.normalizedStems[0].path).toBe(path.join(cacheDir, 'stem 1.wav'));
  });

  it('does not emit normalize_cached when LUFS target has changed', async () => {
    // Pre-populate a cache at -23 LUFS.
    const cacheDir = path.join(tmpSongDir, NORMALIZED_DIR);
    fs.mkdirSync(cacheDir);
    fs.writeFileSync(path.join(cacheDir, 'stem 1.wav'), Buffer.alloc(44));
    fs.writeFileSync(
      path.join(cacheDir, NORMALIZE_META_FILE),
      JSON.stringify({ target_lufs: -23 })
    );

    const events: ProgressEvent[] = [];
    // Run with a DIFFERENT target — should trigger a full re-normalize.
    // (This will attempt to invoke FFmpeg on the fake WAV, which will fail.
    //  We only care that normalize_cached is NOT emitted before that happens.)
    try {
      await runNormalize(tmpSongDir, false, collectEvents(events), makeConfig(true, -14));
    } catch {
      // FFmpeg failure on the stub WAV is expected — we just check events so far.
    }

    expect(events.some((e) => e.type === 'normalize_cached')).toBe(false);
    expect(events.some((e) => e.type === 'normalize_start')).toBe(true);
  });

  it('does not emit normalize_cached when a stem is missing from the cache', async () => {
    // Pre-populate cache meta but omit the actual stem file.
    const cacheDir = path.join(tmpSongDir, NORMALIZED_DIR);
    fs.mkdirSync(cacheDir);
    fs.writeFileSync(
      path.join(cacheDir, NORMALIZE_META_FILE),
      JSON.stringify({ target_lufs: -23 })
    );
    // No stem file written — cache is incomplete.

    const events: ProgressEvent[] = [];
    try {
      await runNormalize(tmpSongDir, false, collectEvents(events), makeConfig(true, -23));
    } catch {
      // FFmpeg failure expected.
    }

    expect(events.some((e) => e.type === 'normalize_cached')).toBe(false);
    expect(events.some((e) => e.type === 'normalize_start')).toBe(true);
  });
});
