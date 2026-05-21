import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import open from 'open';
import AdmZip from 'adm-zip';
import { runPipeline } from './pipeline.js';
import { extractMultitrackZip } from './extractor.js';
import { loadConfig } from './config/loader.js';
import { getMixQueue, getUploadQueue } from './queue.js';
import { consoleEmitter, type Emitter, type ProgressEvent } from './events.js';
import { loadEnv } from './env.js';

loadEnv();

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const WEB_DIST = path.resolve('_internal/web/dist');
const SONGS_DIR = 'songs';

// ─── SSE session registry ─────────────────────────────────────────────────────

const sessions = new Map<string, Response>();

function sseEmitter(sessionId: string): Emitter {
  return (event: ProgressEvent) => {
    consoleEmitter(event); // always mirror to terminal
    const res = sessions.get(sessionId);
    if (res) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
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
  // Load the default project config (no per-song overrides)
  const config = loadConfig('.');
  res.json(config);
});

// SSE stream — client opens this before uploading to receive progress events
app.get('/api/events/:sessionId', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = req.params['sessionId'] as string;
  sessions.set(sessionId, res);
  req.on('close', () => sessions.delete(sessionId));
});

// Upload one or more zips — process sequentially, stream progress via SSE
app.post(
  '/api/process',
  upload.array('zips'),
  async (req: Request, res: Response) => {
    const { sessionId, force: forceRaw } = req.body as { sessionId: string; force?: string };
    const files = req.files as Express.Multer.File[];
    const force = forceRaw === 'true';

    if (!sessionId || !files?.length) {
      res.status(400).json({ error: 'sessionId and at least one zip file are required' });
      return;
    }

    // Respond immediately so the client knows processing has started
    res.json({ status: 'processing', count: files.length });

    const emit = sseEmitter(sessionId);

    for (const file of files) {
      // Multer stores files with a random name; restore the original so
      // extractMultitrackZip can derive the song name from it.
      const originalPath = path.join(os.tmpdir(), file.originalname);
      fs.renameSync(file.path, originalPath);

      try {
        const extracted = extractMultitrackZip(originalPath, SONGS_DIR, emit);
        const result = await runPipeline({ songDir: extracted.songDir, force }, emit);

        if (!result.skipped) {
          emit({
            type: 'pipeline_complete',
            outputDir: result.outputDir,
            elapsedMs: 0,
            skipped: false,
            mixFiles: result.mixFiles,
          });
        }
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
      }
    }

    emit({ type: 'session_complete' });
  }
);

// List all existing mix files, organised by song → key/BPM variant → mix name.
app.get('/api/outputs', (_req: Request, res: Response) => {
  if (!fs.existsSync(SONGS_DIR)) {
    res.json([]);
    return;
  }

  const AUDIO_RE = /\.(m4a|mp3|wav|aiff?)$/i;
  const result: Array<{
    songDir: string;
    variants: Array<{ keyBpm: string; files: Array<{ name: string; path: string }> }>;
  }> = [];

  for (const songName of fs.readdirSync(SONGS_DIR)) {
    const outputDir = path.join(SONGS_DIR, songName, 'output');
    if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) continue;

    const variants: Array<{ keyBpm: string; files: Array<{ name: string; path: string }> }> = [];

    for (const variantName of fs.readdirSync(outputDir)) {
      const variantDir = path.join(outputDir, variantName);
      if (!fs.statSync(variantDir).isDirectory()) continue;

      const files = fs.readdirSync(variantDir)
        .filter((f) => AUDIO_RE.test(f))
        .map((f) => ({
          name: path.basename(f, path.extname(f)),
          path: path.join(SONGS_DIR, songName, 'output', variantName, f),
        }));

      if (files.length > 0) variants.push({ keyBpm: variantName, files });
    }

    if (variants.length > 0) result.push({ songDir: songName, variants });
  }

  res.json(result);
});

// Zip all mix files in a single key/BPM variant directory.
// Encoded path is songs/<songDir>/output/<keyBpm> — same base64url scheme as /api/download.
app.get('/api/download-zip/:encodedVariantDir', (req: Request, res: Response) => {
  const decoded = Buffer.from(req.params['encodedVariantDir'] as string, 'base64url').toString('utf8');
  const resolved = path.resolve(decoded);
  const songsRoot = path.resolve(SONGS_DIR);

  if (!resolved.startsWith(songsRoot)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const AUDIO_RE = /\.(m4a|mp3|wav|aiff?)$/i;
  const zip = new AdmZip();
  for (const file of fs.readdirSync(resolved)) {
    if (AUDIO_RE.test(file)) zip.addLocalFile(path.join(resolved, file));
  }

  // "songs/Who Else-Ab-68.00bpm/output/Ab-68bpm" → "Who Else - Ab-68bpm.zip"
  const parts = decoded.split('/');
  const songPart = (parts[1] ?? '').replace(/[-_][A-G][#b]?[-_][\d.]+bpm$/i, '');
  const variantPart = parts[3] ?? '';
  const displayName = variantPart ? `${songPart} - ${variantPart}` : songPart;

  res.setHeader('Content-Disposition', `attachment; filename="${displayName}.zip"`);
  res.setHeader('Content-Type', 'application/zip');
  res.send(zip.toBuffer());
});

// Serve a generated mix file for download.
// The path is passed as a base64url-encoded string to keep URLs simple and
// prevent path traversal — we validate it stays inside songs/ before serving.
app.get('/api/download/:encodedPath', (req: Request, res: Response) => {
  const decoded = Buffer.from(req.params['encodedPath'] as string, 'base64url').toString('utf8');
  const resolved = path.resolve(decoded);
  const songsRoot = path.resolve(SONGS_DIR);

  if (!resolved.startsWith(songsRoot)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(resolved);
});

// SPA fallback — all non-API routes serve index.html
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Practice Tracks web interface running at ${url}`);
  void open(url);
});
