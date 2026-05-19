import fs from 'fs';
import path from 'path';
import os from 'os';
import { createBackend } from './backend/factory.js';
import { loadConfig } from './config/loader.js';
import { classifyStems } from './stems/classifier.js';
import { buildMixInputs } from './mixer.js';
import { parseSongMetadata, formatOutputSubdir } from './extractor.js';
import { type ClassifiedStem } from './types.js';

const AUDIO_EXTENSIONS = /\.(m4a|wav|mp3|aiff?)$/i;

function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  return ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
}
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
}

function outputAlreadyExists(outputDir: string, mixNames: string[], format: string): boolean {
  if (!fs.existsSync(outputDir)) return false;
  return mixNames.every((name) => fs.existsSync(path.join(outputDir, `${name}.${format}`)));
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
  // "2026-05-19-133042"
  return new Date().toISOString().replace('T', '-').replace(/:/g, '').slice(0, 17);
}

function archiveExistingOutput(outputDir: string): void {
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
  console.log(`Archived ${existing.length} previous mix(es) to ${path.relative(process.cwd(), archiveDir)}`);
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { songDir } = options;
  const stemsDir = findStemsDir(songDir, options.stemsDirName);

  // Derive output subdirectory from key/bpm in the folder name, e.g. "output/Ab-68bpm/"
  // Falls back to "output/" for manually organized folders without that pattern.
  const meta = parseSongMetadata(path.basename(songDir));
  const subdir = formatOutputSubdir(meta);
  const outputDir =
    options.outputDir ?? path.join(songDir, 'output', ...(subdir ? [subdir] : []));

  const config = loadConfig(songDir);
  const mixNames = config.mixes.map((m) => m.name);

  if (!options.force && outputAlreadyExists(outputDir, mixNames, config.output_format)) {
    console.log(`[skip] ${path.basename(songDir)} — output already exists at ${path.relative(process.cwd(), outputDir)}`);
    console.log(`       Set "force": true in queues/to-mix.json, or pass --force to override.\n`);
    return { skipped: true, outputDir };
  }

  console.log(`Song:   ${path.basename(songDir)}`);
  console.log(`Stems:  ${stemsDir}`);
  console.log(`Output: ${outputDir}`);
  console.log('');

  if (options.archive) {
    archiveExistingOutput(outputDir);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const backend = await createBackend();

  const stemFiles = fs
    .readdirSync(stemsDir)
    .filter((f) => AUDIO_EXTENSIONS.test(f))
    .map((f) => path.join(stemsDir, f));

  if (stemFiles.length === 0) {
    throw new Error(`No audio files found in ${stemsDir}`);
  }

  const stems = classifyStems(stemFiles);

  const unknownStems = stems.filter((s) => s.category === 'unknown');
  if (unknownStems.length > 0) {
    console.warn(
      `Warning: ${unknownStems.length} stem(s) could not be classified and will be included at 0 dB:`
    );
    for (const s of unknownStems) {
      console.warn(`  ${s.filename}${path.extname(s.path)} — add a rule in config or rename the file`);
    }
    console.warn('');
  }

  console.log(`Found ${stems.length} stems:`);
  for (const stem of stems) {
    const ext = path.extname(stem.path).slice(1);
    const idx = stem.index !== undefined ? ` [${stem.index}]` : '';
    console.log(`  ${stem.filename}.${ext}  →  ${stem.category}${idx}`);
  }
  console.log('');

  const pipelineStart = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-tracks-'));

  try {
    console.log(`Normalizing to ${config.target_lufs} LUFS...`);
    const normalizeStart = Date.now();
    const normalizedStems: ClassifiedStem[] = [];

    for (const stem of stems) {
      const tmpPath = path.join(tmpDir, `${stem.filename}.wav`);
      const t = Date.now();
      process.stdout.write(`  ${stem.filename}...`);
      await backend.normalize(stem.path, tmpPath, {
        targetLufs: config.target_lufs,
        truePeak: -1,
      });
      normalizedStems.push({ ...stem, path: tmpPath });
      process.stdout.write(` done (${elapsed(t)})\n`);
    }
    console.log(`Normalization complete (${elapsed(normalizeStart)} total)\n`);

    console.log('Generating mixes...');
    for (const mixDef of config.mixes) {
      const inputs = buildMixInputs(normalizedStems, mixDef, config);
      if (inputs.length === 0) {
        console.log(`  [skip] ${mixDef.name} — no stems match`);
        continue;
      }
      const outputPath = path.join(outputDir, `${mixDef.name}.${config.output_format}`);
      const t = Date.now();
      process.stdout.write(`  ${mixDef.name} (${inputs.length} stems)...`);
      await backend.mix(inputs, outputPath, config.output_format);
      process.stdout.write(` done (${elapsed(t)})\n`);
    }

    console.log('');
    console.log(`All mixes written to: ${outputDir}`);
    console.log(`Total time: ${elapsed(pipelineStart)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { skipped: false, outputDir };
}
