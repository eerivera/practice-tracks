import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import open from 'open';
import { zipSync } from 'fflate';
import { runNormalize, runMix, runTranspose, hasExistingOutput, listStemFiles, getNormalizeCacheMeta, type NormalizeResult } from './pipeline.js';
import { normalizeKey } from '../common/keys.js';
import type { Config } from '../common/types.js';
import { extractMultitrackZip, parseSongMetadata, formatOutputSubdir, formatSongDisplayName, physicalSongPath } from './extractor.js';
import { loadBaseConfig, saveBaseConfig, resetBaseConfig } from './config/loader.js';
import { getMixQueue, getUploadQueue } from './queue.js';
import { consoleEmitter, type Emitter, type ProgressEvent } from '../common/events.js';
import { loadEnv } from './env.js';

loadEnv();

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const WEB_DIST = path.resolve('_internal/web/dist');
const SONGS_DIR = 'songs';
const SONGS_ROOT = path.resolve(SONGS_DIR);

// ─── SSE session registry ─────────────────────────────────────────────────────

const sessions = new Map<string, Response>();

function sseEmitter(sessionId: string): Emitter {
  return (event: ProgressEvent) => {
    consoleEmitter(event);
    const res = sessions.get(sessionId);
    if (res) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

// ─── Normalize result registry ────────────────────────────────────────────────
// Holds in-memory normalization output between the /api/normalize and /api/mix
// requests for a given session. Cleared in /api/mix (success or error).
// Normalized stems are persisted to disk (songs/<name>/normalized/) so no
// temporary files need to be cleaned up here.

const normalizedResults = new Map<string, NormalizeResult[]>();

function clearNormalizedResults(sessionId: string): void {
  normalizedResults.delete(sessionId);
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

if (!fs.existsSync(WEB_DIST)) {
  console.error('Web frontend not built. Run: npm run web:build');
  process.exit(1);
}
app.use(express.static(WEB_DIST));

const upload = multer({ dest: os.tmpdir() });

// ─── API routes ───────────────────────────────────────────────────────────────

app.get('/api/status', (_req: Request, res: Response) => {
  res.json({ mixQueue: getMixQueue(), uploadQueue: getUploadQueue() });
});

app.get('/api/config', (_req: Request, res: Response) => {
  res.json(loadBaseConfig());
});

app.post('/api/config', (req: Request, res: Response) => {
  try {
    saveBaseConfig(req.body as Parameters<typeof saveBaseConfig>[0]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/config', (_req: Request, res: Response) => {
  res.json(resetBaseConfig());
});

// SSE stream — client opens this before each step to receive progress events
app.get('/api/events/:sessionId', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = req.params.sessionId as string;
  sessions.set(sessionId, res);
  req.on('close', () => sessions.delete(sessionId));
});

// Step 1: extract zips → stems on disk
// Emits extract events then a songs_ready event with the resulting songDirs.
app.post(
  '/api/extract',
  upload.array('zips'),
  (req: Request, res: Response) => {
    const { sessionId } = req.body as { sessionId: string };
    const files = req.files as Express.Multer.File[] | undefined;

    if (!sessionId || !files?.length) {
      res.status(400).json({ error: 'sessionId and at least one zip file are required' });
      return;
    }

    res.json({ status: 'extracting', count: files.length });

    const emit = sseEmitter(sessionId);
    const songDirs: string[] = [];

    for (const file of files) {
      const originalPath = path.join(os.tmpdir(), file.originalname);
      fs.renameSync(file.path, originalPath);
      try {
        const extracted = extractMultitrackZip(originalPath, SONGS_DIR, emit);
        songDirs.push(extracted.songDir);
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
      }
    }

    emit({ type: 'songs_ready', songDirs });
    emit({ type: 'session_complete' });
  }
);

// Step 2: normalize stems for a set of song directories.
// Holds results in memory keyed by sessionId for the subsequent mix step.
// If called again with the same sessionId (e.g. force reprocess), existing
// tmpDirs are cleaned up first.
app.post('/api/normalize', async (req: Request, res: Response) => {
  const { sessionId, songDirs, force: forceRaw, config: baseConfig } = req.body as {
    sessionId: string;
    songDirs: string[];
    force?: boolean;
    config?: Config;
  };
  const force = forceRaw === true;

  if (!sessionId || !Array.isArray(songDirs) || songDirs.length === 0) {
    res.status(400).json({ error: 'sessionId and songDirs are required' });
    return;
  }

  // Validate all paths stay within songs/
  for (const songDir of songDirs) {
    if (!path.resolve(songDir).startsWith(SONGS_ROOT)) {
      res.status(403).json({ error: 'Invalid song directory' });
      return;
    }
  }

  // Clean up any stale results from a previous normalize for this session
  clearNormalizedResults(sessionId);

  res.json({ status: 'normalizing', count: songDirs.length });

  const emit = sseEmitter(sessionId);
  const results: NormalizeResult[] = [];

  for (const songDir of songDirs) {
    try {
      const result = await runNormalize(songDir, force, emit, baseConfig);
      if (result) results.push(result);
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  normalizedResults.set(sessionId, results);
  emit({ type: 'session_complete' });
});

// Step 3: mix from the normalised stems held by a previous /api/normalize call.
// Optional targetKey causes a transpose step before mixing.
// Cleans up tmpDirs on completion or error.
app.post('/api/mix', async (req: Request, res: Response) => {
  const { sessionId, targetKey } = req.body as { sessionId: string; targetKey?: string };

  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  // Validate targetKey if provided
  if (targetKey !== undefined) {
    const resolved = normalizeKey(targetKey);
    if (!resolved) {
      res.status(400).json({ error: `Unrecognised target key "${targetKey}". Use a key name like C, C#, Db, D, …` });
      return;
    }
  }

  const results = normalizedResults.get(sessionId);
  if (!results?.length) {
    res.status(400).json({ error: 'No normalized stems found for this session. Run /api/normalize first.' });
    return;
  }

  res.json({ status: 'mixing', count: results.length });

  const emit = sseEmitter(sessionId);

  try {
    for (const result of results) {
      try {
        // Transpose before mixing when a target key is requested.
        // normalizeKey(targetKey) was validated above, so the cast is safe.
        const resolvedTarget = targetKey ? normalizeKey(targetKey) : undefined;
        const mixResult = resolvedTarget
          ? await runTranspose(result, resolvedTarget, emit)
          : result;
        await runMix(mixResult, emit);
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    clearNormalizedResults(sessionId);
    emit({ type: 'session_complete' });
  }
});

// List all song directories that have an extracted stems folder.
// Source of truth is songs-list.json (written by the extractor); each entry is
// a logical zip name.  The physical two-level path is resolved via physicalSongPath.
app.get('/api/songs', (_req: Request, res: Response) => {
  if (!fs.existsSync(SONGS_DIR)) { res.json([]); return; }
  const listPath = path.join(SONGS_DIR, 'songs-list.json');
  if (!fs.existsSync(listPath)) { res.json([]); return; }
  let songNames: string[];
  try {
    songNames = JSON.parse(fs.readFileSync(listPath, 'utf-8')) as string[];
  } catch { res.json([]); return; }

  const songs: string[] = [];
  for (const songName of songNames) {
    const logicalDir = path.join(SONGS_DIR, songName);
    const physDir = physicalSongPath(logicalDir);
    const hasStemsDir = ['stems', 'MultiTracks'].some((d) => fs.existsSync(path.join(physDir, d)));
    if (hasStemsDir) songs.push(logicalDir);
  }
  res.json(songs);
});

// Return the stem files (path + filename) for a given song directory.
app.get('/api/stems/:encodedSongDir', (req: Request, res: Response) => {
  const songDir = Buffer.from(req.params.encodedSongDir as string, 'base64url').toString('utf8');
  if (!path.resolve(songDir).startsWith(SONGS_ROOT)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    res.json(listStemFiles(songDir));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Return the normalize cache metadata (target LUFS) for a song directory.
// The client uses this to detect when the cached normalization target no longer
// matches the active config so it can prompt the user to re-normalize.
app.get('/api/normalize-cache/:encodedSongDir', (req: Request, res: Response) => {
  const songDir = Buffer.from(req.params.encodedSongDir as string, 'base64url').toString('utf8');
  if (!path.resolve(songDir).startsWith(SONGS_ROOT)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const meta = getNormalizeCacheMeta(songDir);
  res.json({ target_lufs: meta?.target_lufs ?? null });
});

// Check whether output files already exist for a set of song directories.
// Called by the client right after extraction so it can warn before normalize.
app.post('/api/check-outputs', (req: Request, res: Response) => {
  const { songDirs } = req.body as { songDirs: string[] };
  if (!Array.isArray(songDirs)) {
    res.status(400).json({ error: 'songDirs required' });
    return;
  }
  res.json(songDirs.map((songDir) => ({ songDir, hasOutput: hasExistingOutput(songDir) })));
});

// List all existing mix files, organised by song → key/BPM variant → mix name.
// Reads songs-list.json to enumerate songs; each entry is a logical zip name.
// Physical output files live at songs/<displayName>/<keyBpm>/output/.
app.get('/api/outputs', (_req: Request, res: Response) => {
  if (!fs.existsSync(SONGS_DIR)) { res.json([]); return; }

  const listPath = path.join(SONGS_DIR, 'songs-list.json');
  let songNames: string[] = [];
  if (fs.existsSync(listPath)) {
    try { songNames = JSON.parse(fs.readFileSync(listPath, 'utf-8')) as string[]; } catch { /* corrupt manifest */ }
  }

  const AUDIO_RE = /\.(m4a|mp3|wav|aiff?)$/i;
  const result: { songDir: string; variants: { keyBpm: string; files: { name: string; path: string }[] }[] }[] = [];

  for (const songName of songNames) {
    const logicalDir = path.join(SONGS_DIR, songName);
    const physDir = physicalSongPath(logicalDir);
    const outputDir = path.join(physDir, 'output');
    if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) continue;

    const songTitle = formatSongDisplayName(songName);
    const filePrefix = `${songTitle} - `;
    const keyBpm = formatOutputSubdir(parseSongMetadata(songName)) ?? '';

    const files = fs.readdirSync(outputDir)
      .filter((f) => {
        const fPath = path.join(outputDir, f);
        return AUDIO_RE.test(f) && !fs.statSync(fPath).isDirectory();
      })
      .map((f) => {
        const baseName = path.basename(f, path.extname(f));
        return {
          // Strip the "<SongTitle> - " prefix so PastMixes shows just the mix name.
          name: baseName.startsWith(filePrefix) ? baseName.slice(filePrefix.length) : baseName,
          path: path.join(physDir, 'output', f),
        };
      });

    if (files.length > 0) result.push({ songDir: songName, variants: [{ keyBpm, files }] });
  }

  res.json(result);
});

// Zip all mix files in a single key/BPM variant directory.
app.get('/api/download-zip/:encodedVariantDir', (req: Request, res: Response) => {
  const decoded = Buffer.from(req.params.encodedVariantDir as string, 'base64url').toString('utf8');
  const resolved = path.resolve(decoded);

  if (!resolved.startsWith(SONGS_ROOT)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const AUDIO_RE = /\.(m4a|mp3|wav|aiff?)$/i;
  const zipFiles: Record<string, Uint8Array> = {};
  for (const file of fs.readdirSync(resolved)) {
    if (AUDIO_RE.test(file)) zipFiles[file] = new Uint8Array(fs.readFileSync(path.join(resolved, file)));
  }

  // New layout: songs/<displayName>/<keyBpm>/output
  // parts[1] = display name, parts[2] = key/BPM variant (or 'output' in legacy flat layout)
  const parts = decoded.split('/');
  const songPart = parts[1] ?? '';
  const keyBpmPart = parts[2] !== 'output' ? (parts[2] ?? '') : '';
  const displayName = keyBpmPart ? `${songPart} - ${keyBpmPart}` : songPart;

  res.setHeader('Content-Disposition', `attachment; filename="${displayName}.zip"`);
  res.setHeader('Content-Type', 'application/zip');
  res.send(Buffer.from(zipSync(zipFiles)));
});

// Serve a generated mix file for download.
app.get('/api/download/:encodedPath', (req: Request, res: Response) => {
  const decoded = Buffer.from(req.params.encodedPath as string, 'base64url').toString('utf8');
  const resolved = path.resolve(decoded);

  if (!resolved.startsWith(SONGS_ROOT)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(resolved);
});

// SPA fallback
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Practice Tracks web interface running at ${url}`);
  if (!process.env.NO_OPEN) void open(url);
});
