import fs from 'fs';
import path from 'path';
import { createBackend } from './backend/factory.js';
import { loadConfig } from './config/loader.js';
import { findStemBus, buildMixInputs } from '../common/mixer.js';
import { formatSongDisplayName, physicalSongPath, parseSongMetadata } from './extractor.js';
import { consoleEmitter, type Emitter } from '../common/events.js';
import { type StemFile, type AudioBackend, type Config } from '../common/types.js';
import { normalizeKey, semitonesBetween, ALL_KEYS, type KeyName } from '../common/keys.js';

const AUDIO_EXTENSIONS = /\.(m4a|wav|mp3|aiff?)$/i;
const CANDIDATE_STEMS_DIRS = ['stems', 'MultiTracks'];

// ── Normalized stem cache ─────────────────────────────────────────────────────
// Normalized stems are persisted to songs/<name>/normalized/ so they can be
// reused across runs without re-invoking FFmpeg.  A meta.json sidecar tracks
// the LUFS target used; if it changes the cache is treated as stale.

const NORMALIZED_DIR = 'normalized';
const NORMALIZE_META_FILE = 'meta.json';

interface NormalizeCacheMeta {
  target_lufs: number;
}

function normalizedCacheDir(songDir: string): string {
  return path.join(songDir, NORMALIZED_DIR);
}

function readNormalizeCacheMeta(songDir: string): NormalizeCacheMeta | null {
  const metaPath = path.join(normalizedCacheDir(songDir), NORMALIZE_META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as NormalizeCacheMeta;
  } catch {
    return null;
  }
}

// Public accessor used by the HTTP server to expose cache state to the frontend.
// Accepts the logical songDir; resolves to physical path internally.
export function getNormalizeCacheMeta(songDir: string): NormalizeCacheMeta | null {
  return readNormalizeCacheMeta(physicalSongPath(songDir));
}

// Returns true when every expected normalized stem file exists on disk and the
// cached LUFS target matches the one currently in config.
function isCacheValid(songDir: string, targetLufs: number, rawStems: StemFile[]): boolean {
  const meta = readNormalizeCacheMeta(songDir);
  if (meta?.target_lufs !== targetLufs) return false;
  const cacheDir = normalizedCacheDir(songDir);
  return rawStems.every((s) => fs.existsSync(path.join(cacheDir, `${s.filename}.wav`)));
}

export interface PipelineOptions {
  songDir: string;
  outputDir?: string;
  stemsDirName?: string;
  archive?: boolean;
  force?: boolean;
  /**
   * When set, transpose all stems to this key before mixing.
   * The transposed stems are written to a sibling output directory keyed by
   * the target key+bpm so the original output directory is left untouched.
   * Accepts any key name (flats or sharps); normalised internally.
   * Mutually exclusive with semitones.
   */
  targetKey?: string;
  /**
   * Alternative to targetKey: transpose by a fixed semitone offset.
   * The target key is derived by applying this offset to the source key
   * extracted from the song directory name.
   * Mutually exclusive with targetKey.
   */
  semitones?: number;
}

export interface PipelineResult {
  skipped: boolean;
  outputDir: string;
  mixFiles: string[];
}

// Holds normalization output between the normalize and mix steps.
// The server stores this between HTTP requests; runPipeline uses it internally.
// When config.normalize is false, normalizedStems point to the original stem
// paths.  When true, they point to the on-disk cache (songs/<name>/normalized/).
export interface NormalizeResult {
  songDir: string;
  outputDir: string;
  normalizedStems: StemFile[];
  config: Config;
  backend: AudioBackend;
  pipelineStartMs: number;
}

// ── Step 1.5: transpose ───────────────────────────────────────────────────────
// Pitch-shifts all normalised stems to the target key.
// Returns a modified NormalizeResult pointing to the transposed stems and the
// new output directory (alongside the original key's output dir).

export async function runTranspose(
  result: NormalizeResult,
  targetKey: KeyName,
  emit: Emitter = consoleEmitter
): Promise<NormalizeResult> {
  const { songDir, normalizedStems, backend, pipelineStartMs } = result;

  // Determine the source key from the songDir name.
  const meta = parseSongMetadata(path.basename(songDir));
  const sourceKeyRaw = meta.key;
  if (!sourceKeyRaw) {
    throw new Error(
      `Cannot determine source key from song directory "${path.basename(songDir)}". ` +
      'Key must be part of the directory name (e.g. "SongName-Ab-68.00bpm").'
    );
  }
  const sourceKey = normalizeKey(sourceKeyRaw);
  if (!sourceKey) {
    throw new Error(`Unrecognised source key "${sourceKeyRaw}" in directory "${path.basename(songDir)}".`);
  }

  const semitones = semitonesBetween(sourceKey, targetKey);

  // If no transposition needed, return result unchanged.
  if (semitones === 0) return result;

  // Determine the method used so the event is informative.
  // Probe rubberband on native backends; WASM always uses asetrate for now.
  let method: 'rubberband' | 'asetrate' = 'asetrate';
  if ('probeRubberband' in backend) {
    // NativeFFmpegBackend exposes the probe; check it.
    const native = backend as typeof backend & { probeRubberband(): Promise<boolean> };
    method = (await native.probeRubberband()) ? 'rubberband' : 'asetrate';
  }

  emit({
    type: 'transpose_start',
    total: normalizedStems.length,
    semitones,
    method,
  });
  const transposeStart = Date.now();

  // Transposed stems go into a sibling directory named after the target key+bpm.
  const physDir = physicalSongPath(songDir);
  const bpmSuffix = meta.bpmRaw ? `${meta.bpmRaw}bpm` : 'unknownbpm';
  const targetDirName = `${targetKey}-${bpmSuffix}`;
  const transposeDir = path.join(path.dirname(physDir), targetDirName, 'transposed');
  fs.mkdirSync(transposeDir, { recursive: true });

  const transposedStems: StemFile[] = [];
  let completed = 0;

  for (const stem of normalizedStems) {
    const outPath = path.join(transposeDir, `${stem.filename}.wav`);
    const t = Date.now();
    await backend.transpose(stem.path, outPath, { semitones });
    transposedStems.push({ ...stem, path: outPath });
    completed++;
    emit({
      type: 'stem_transposed',
      name: stem.filename,
      index: completed,
      total: normalizedStems.length,
      timeMs: Date.now() - t,
    });
  }

  emit({ type: 'transpose_complete', total: normalizedStems.length, elapsedMs: Date.now() - transposeStart });

  // New output dir lives next to the source key's output dir.
  const newOutputDir = path.join(path.dirname(physDir), targetDirName, 'output');

  return {
    ...result,
    outputDir: newOutputDir,
    normalizedStems: transposedStems,
    pipelineStartMs,
  };
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

export function findStemsDir(songDir: string, preferred?: string): string {
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
// Accepts the logical songDir; resolves to physical path internally.
export function hasExistingOutput(songDir: string): boolean {
  try {
    const physDir = physicalSongPath(songDir);
    const outputDir = path.join(physDir, 'output');
    const config = loadConfig(physDir);
    const songTitle = formatSongDisplayName(path.basename(songDir));
    const mixNames = config.mixes.map((m) => m.name);
    return outputAlreadyExists(outputDir, songTitle, mixNames, config.output_format);
  } catch {
    return false;
  }
}

// Lists all StemFile entries for a song directory (reads the stems dir).
// Accepts the logical songDir; resolves to physical path internally.
export function listStemFiles(songDir: string, stemsDirName?: string): StemFile[] {
  const physDir = physicalSongPath(songDir);
  const stemsDir = findStemsDir(physDir, stemsDirName);
  return fs
    .readdirSync(stemsDir)
    .filter((f) => AUDIO_EXTENSIONS.test(f))
    .map((f) => ({
      path: path.join(stemsDir, f),
      filename: path.basename(f, path.extname(f)),
    }));
}

// ── Step 1: normalize ─────────────────────────────────────────────────────────
// Loads stems from disk, warns on unmatched buses, normalises to a temp
// directory, and returns the result for the mix step.
// Returns null and emits a skip event if output already exists.

export async function runNormalize(
  songDir: string,
  force: boolean,
  emit: Emitter = consoleEmitter,
  baseConfig?: Config
): Promise<NormalizeResult | null> {
  // songDir is the logical identifier (e.g. "songs/SongName-Ab-68.00bpm").
  // physDir is the actual on-disk path (e.g. "songs/SongName/Ab-68bpm").
  const physDir = physicalSongPath(songDir);
  const stemsDir = findStemsDir(physDir);
  const outputDir = path.join(physDir, 'output');
  // When called from the web API, baseConfig carries the user's current in-memory
  // config (always up to date). When called from the CLI, baseConfig is absent and
  // we fall back to loadConfig which does the full 3-layer YAML merge.
  const config = baseConfig ?? loadConfig(physDir);
  const songTitle = formatSongDisplayName(path.basename(songDir));
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

  const stems: StemFile[] = stemFiles.map((f) => ({
    path: f,
    filename: path.basename(f, path.extname(f)),
  }));

  // Warn about stems that don't match any bus.
  const unmatchedStems = stems.filter((s) => !findStemBus(config.buses, s.filename));
  if (unmatchedStems.length > 0) {
    emit({
      type: 'warn',
      message:
        `Warning: ${unmatchedStems.length} stem(s) not assigned to any bus (included at 0 dB):\n` +
        unmatchedStems
          .map((s) => `  ${s.filename} — add it to a bus in config or create a new bus`)
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
      busName: findStemBus(config.buses, s.filename)?.name,
    })),
  });

  const backend = await createBackend(emit);
  const pipelineStartMs = Date.now();

  // When normalization is disabled, skip ffmpeg processing and use the original
  // stem paths directly.
  if (!config.normalize) {
    return { songDir, outputDir, normalizedStems: stems, config, backend, pipelineStartMs };
  }

  const cacheDir = normalizedCacheDir(physDir);

  // Cache hit — all expected normalized files exist at the current LUFS target.
  if (isCacheValid(physDir, config.target_lufs, stems)) {
    const normalizedStems = stems.map((s) => ({
      ...s,
      path: path.join(cacheDir, `${s.filename}.wav`),
    }));
    emit({ type: 'normalize_cached', total: stems.length, targetLufs: config.target_lufs });
    return { songDir, outputDir, normalizedStems, config, backend, pipelineStartMs };
  }

  // Cache miss or stale LUFS — (re-)normalize and persist to cache dir.
  fs.mkdirSync(cacheDir, { recursive: true });

  const configured = config.normalization_concurrency ?? 0;
  const concurrency = Math.min(
    configured > 0 ? configured : backend.maxConcurrency,
    backend.maxConcurrency,
    stems.length
  );

  emit({ type: 'normalize_start', total: stems.length, concurrency, targetLufs: config.target_lufs });
  const normalizeStart = Date.now();

  const normalizedStems: StemFile[] = new Array<StemFile>(stems.length);
  let completed = 0;
  const queue = stems.map((stem, i) => ({ stem, i }));

  async function normalizeWorker(): Promise<void> {
    let next = queue.shift();
    while (next !== undefined) {
      const { stem, i } = next;
      const cachedPath = path.join(cacheDir, `${stem.filename}.wav`);
      const t = Date.now();
      await backend.normalize(stem.path, cachedPath, { targetLufs: config.target_lufs, truePeak: -1 });
      normalizedStems[i] = { ...stem, path: cachedPath };
      completed++;
      emit({ type: 'stem_normalized', name: stem.filename, index: completed, total: stems.length, timeMs: Date.now() - t });
      next = queue.shift();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, normalizeWorker));
  emit({ type: 'normalize_complete', total: stems.length, elapsedMs: Date.now() - normalizeStart });

  // Persist cache metadata so future runs can validate the LUFS target.
  const cacheMeta: NormalizeCacheMeta = { target_lufs: config.target_lufs };
  fs.writeFileSync(path.join(cacheDir, NORMALIZE_META_FILE), JSON.stringify(cacheMeta, null, 2));

  return { songDir, outputDir, normalizedStems, config, backend, pipelineStartMs };
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
    const outputDir = options.outputDir ?? path.join(options.songDir, 'output');
    return { skipped: true, outputDir, mixFiles: [] };
  }

  // Transpose step: pitch-shift all stems to the target key before mixing.
  let mixResult = normalizeResult;
  if (options.targetKey !== undefined || options.semitones !== undefined) {
    let targetKey: KeyName;
    if (options.targetKey !== undefined) {
      const resolved = normalizeKey(options.targetKey);
      if (!resolved) {
        throw new Error(`Unrecognised target key "${options.targetKey}". Use a key name like C, C#, Db, D, Eb, E, F, F#, Gb, G, Ab, A, Bb, B.`);
      }
      targetKey = resolved;
    } else {
      // semitones mode: derive target key from source key + offset
      const meta = parseSongMetadata(path.basename(options.songDir));
      const sourceKey = meta.key ? normalizeKey(meta.key) : undefined;
      if (!sourceKey) {
        throw new Error(
          `--semitones requires the song directory to encode a key (e.g. "SongName-Ab-68.00bpm"). ` +
          `Use --to-key instead to name the target key explicitly.`
        );
      }
      // options.semitones is defined here (we're in the else branch and the
      // outer guard checked `options.semitones !== undefined`).  TypeScript
      // doesn't narrow it through the OR condition, so we extract it first.
      const semitones = options.semitones ?? 0;
      const idx = ALL_KEYS.indexOf(sourceKey);
      // keyIdx is always 0–11 so the array access is always defined.
      const keyIdx = ((idx + semitones) % 12 + 12) % 12;
      targetKey = ALL_KEYS[keyIdx];
    }
    mixResult = await runTranspose(normalizeResult, targetKey, emit);
  }

  if (options.archive) {
    archiveExistingOutput(mixResult.outputDir, emit);
  }

  return runMix(mixResult, emit);
}
