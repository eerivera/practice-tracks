import fs from 'fs';
import path from 'path';
import os from 'os';
import { createBackend } from './backend/factory.js';
import { loadConfig } from './config/loader.js';
import { classifyStems } from '../common/stems/classifier.js';
import { buildMixInputs } from '../common/mixer.js';
import { parseSongMetadata, formatOutputSubdir, formatSongDisplayName } from './extractor.js';
import { consoleEmitter, type Emitter } from '../common/events.js';
import { type ClassifiedStem, type AudioBackend, type Config } from '../common/types.js';

const AUDIO_EXTENSIONS = /\.(m4a|wav|mp3|aiff?)$/i;
const CANDIDATE_STEMS_DIRS = ['stems', 'MultiTracks'];

export interface PipelineOptions {
  songDir: string;
  outputDir?: string;
  stemsDirName?: string;
  archive?: boolean;
  force?: boolean;
}

export interface PipelineResult {
  skipped: boolean;
  outputDir: string;
  mixFiles: string[];
}

// Holds normalization output between the normalize and mix steps.
// The server stores this between HTTP requests; runPipeline uses it internally.
export interface NormalizeResult {
  songDir: string;
  outputDir: string;
  tmpDir: string;
  normalizedStems: ClassifiedStem[];
  config: Config;
  backend: AudioBackend;
  pipelineStartMs: number;
}

function mixFilename(songTitle: string, mixName: string, format: string): string {
  return `${songTitle} - ${mixName}.${format}`;
}

function outputAlreadyExists(outputDir: string, songTitle: string, mixNames: string[], format: string): boolean {
  if (!fs.existsSync(outputDir)) return false;
  return mixNames.every((name) =>
    fs.existsSync(path.join(outputDir, mixFilename(songTitle, name, format)))
  );
}

function findStemsDir(songDir: string, preferred?: string): string {
  const candidates = preferred ? [preferred, ...CANDIDATE_STEMS_DIRS] : CANDIDATE_STEMS_DIRS;
  for (const name of candidates) {
    const p = path.join(songDir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `No stems directory found in ${songDir}.\n` +
      `Expected one of: ${CANDIDATE_STEMS_DIRS.join(', ')}\n` +
      `Run "npm run mix -- extract <zip>" to prepare a song from a Multitracks zip.`
  );
}

function archiveTimestamp(): string {
  return new Date().toISOString().replace('T', '-').replace(/:/g, '').slice(0, 17);
}

function archiveExistingOutput(outputDir: string, emit: Emitter): void {
  if (!fs.existsSync(outputDir)) return;
  const existing = fs.readdirSync(outputDir).filter(
    (f) => !fs.statSync(path.join(outputDir, f)).isDirectory()
  );
  if (existing.length === 0) return;

  const archiveDir = path.join(outputDir, 'archive', archiveTimestamp());
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const file of existing) {
    fs.copyFileSync(path.join(outputDir, file), path.join(archiveDir, file));
  }
  emit({ type: 'archive', count: existing.length, archivePath: path.relative(process.cwd(), archiveDir) });
}

// Returns true if all expected mix files already exist for the given song directory.
// Used by the server to inform the client before the normalize step begins.
export function hasExistingOutput(songDir: string): boolean {
  try {
    const meta = parseSongMetadata(path.basename(songDir));
    const subdir = formatOutputSubdir(meta);
    const outputDir = path.join(songDir, 'output', ...(subdir ? [subdir] : []));
    const config = loadConfig(songDir);
    const songTitle = formatSongDisplayName(songDir);
    const mixNames = config.mixes.map((m) => m.name);
    return outputAlreadyExists(outputDir, songTitle, mixNames, config.output_format);
  } catch {
    return false;
  }
}

// ── Step 1: normalize ─────────────────────────────────────────────────────────
// Classifies stems, normalises to a temp directory, and returns the result for
// the mix step. Returns null and emits a skip event if output already exists.

export async function runNormalize(
  songDir: string,
  force: boolean,
  emit: Emitter = consoleEmitter
): Promise<NormalizeResult | null> {
  const stemsDir = findStemsDir(songDir);
  const meta = parseSongMetadata(path.basename(songDir));
  const subdir = formatOutputSubdir(meta);
  const outputDir = path.join(songDir, 'output', ...(subdir ? [subdir] : []));
  const config = loadConfig(songDir);
  const songTitle = formatSongDisplayName(songDir);
  const mixNames = config.mixes.map((m) => m.name);

  if (!force && outputAlreadyExists(outputDir, songTitle, mixNames, config.output_format)) {
    emit({
      type: 'skip',
      songName: path.basename(songDir),
      reason: `output already exists at ${path.relative(process.cwd(), outputDir)}`,
    });
    return null;
  }

  emit({ type: 'song_header', songName: path.basename(songDir), stemsDir, outputDir });

  const stemFiles = fs
    .readdirSync(stemsDir)
    .filter((f) => AUDIO_EXTENSIONS.test(f))
    .map((f) => path.join(stemsDir, f));

  if (stemFiles.length === 0) throw new Error(`No audio files found in ${stemsDir}`);

  const stems = classifyStems(stemFiles);

  const unknownStems = stems.filter((s) => s.category === 'unknown');
  if (unknownStems.length > 0) {
    emit({
      type: 'warn',
      message:
        `Warning: ${unknownStems.length} stem(s) could not be classified and will be included at 0 dB:\n` +
        unknownStems
          .map((s) => `  ${s.filename}${path.extname(s.path)} — add a rule in config or rename the file`)
          .join('\n') +
        '\n',
    });
  }

  emit({
    type: 'stems_classified',
    total: stems.length,
    stems: stems.map((s) => ({
      filename: s.filename,
      ext: path.extname(s.path).slice(1),
      category: s.category,
      index: s.index,
    })),
  });

  const backend = await createBackend(emit);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-tracks-'));
  const pipelineStartMs = Date.now();

  const configured = config.normalization_concurrency ?? 0;
  const concurrency = Math.min(
    configured > 0 ? configured : backend.maxConcurrency,
    backend.maxConcurrency,
    stems.length
  );

  emit({ type: 'normalize_start', total: stems.length, concurrency, targetLufs: config.target_lufs });
  const normalizeStart = Date.now();

  const normalizedStems: ClassifiedStem[] = new Array<ClassifiedStem>(stems.length);
  let completed = 0;
  const queue = stems.map((stem, i) => ({ stem, i }));

  async function normalizeWorker(): Promise<void> {
    let next = queue.shift();
    while (next !== undefined) {
      const { stem, i } = next;
      const tmpPath = path.join(tmpDir, `${stem.filename}.wav`);
      const t = Date.now();
      await backend.normalize(stem.path, tmpPath, { targetLufs: config.target_lufs, truePeak: -1 });
      normalizedStems[i] = { ...stem, path: tmpPath };
      completed++;
      emit({ type: 'stem_normalized', name: stem.filename, index: completed, total: stems.length, timeMs: Date.now() - t });
      next = queue.shift();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, normalizeWorker));
  emit({ type: 'normalize_complete', total: stems.length, elapsedMs: Date.now() - normalizeStart });

  return { songDir, outputDir, tmpDir, normalizedStems, config, backend, pipelineStartMs };
}

// ── Step 2: mix ───────────────────────────────────────────────────────────────
// Builds and writes mix files from normalised stems. Does NOT clean up tmpDir —
// the caller is responsible for that (allows error-safe cleanup in a finally block).

export async function runMix(
  result: NormalizeResult,
  emit: Emitter = consoleEmitter
): Promise<PipelineResult> {
  const { songDir, outputDir, normalizedStems, config, backend, pipelineStartMs } = result;
  const songTitle = formatSongDisplayName(songDir);

  fs.mkdirSync(outputDir, { recursive: true });
  emit({ type: 'mix_start', total: config.mixes.length });
  const mixFiles: string[] = [];

  for (const mixDef of config.mixes) {
    const inputs = buildMixInputs(normalizedStems, mixDef, config);
    if (inputs.length === 0) {
      emit({ type: 'mix_skipped', name: mixDef.name, reason: 'no stems match' });
      continue;
    }
    const outputPath = path.join(outputDir, mixFilename(songTitle, mixDef.name, config.output_format));
    const t = Date.now();
    await backend.mix(inputs, outputPath, config.output_format);
    emit({ type: 'mix_generated', name: mixDef.name, stems: inputs.length, timeMs: Date.now() - t });
    mixFiles.push(outputPath);
  }

  emit({ type: 'pipeline_complete', outputDir, elapsedMs: Date.now() - pipelineStartMs, skipped: false, mixFiles });
  return { skipped: false, outputDir, mixFiles };
}

// ── Full pipeline (CLI) ───────────────────────────────────────────────────────
// Runs normalize → mix in sequence and cleans up the temp directory.
// Supports the archive and custom outputDir options used by the CLI.

export async function runPipeline(
  options: PipelineOptions,
  emit: Emitter = consoleEmitter
): Promise<PipelineResult> {
  const normalizeResult = await runNormalize(options.songDir, options.force ?? false, emit);
  if (!normalizeResult) {
    const meta = parseSongMetadata(path.basename(options.songDir));
    const subdir = formatOutputSubdir(meta);
    const outputDir = options.outputDir ?? path.join(options.songDir, 'output', ...(subdir ? [subdir] : []));
    return { skipped: true, outputDir, mixFiles: [] };
  }

  if (options.archive) {
    archiveExistingOutput(normalizeResult.outputDir, emit);
  }

  try {
    return await runMix(normalizeResult, emit);
  } finally {
    fs.rmSync(normalizeResult.tmpDir, { recursive: true, force: true });
  }
}
