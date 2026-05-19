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
const CANDIDATE_STEMS_DIRS = ['stems', 'MultiTracks'];

export interface PipelineOptions {
  songDir: string;
  outputDir?: string;
  stemsDirName?: string;
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

export async function runPipeline(options: PipelineOptions): Promise<void> {
  const { songDir } = options;
  const stemsDir = findStemsDir(songDir, options.stemsDirName);

  // Derive output subdirectory from key/bpm in the folder name, e.g. "output/Ab-68bpm/"
  // Falls back to "output/" for manually organized folders without that pattern.
  const meta = parseSongMetadata(path.basename(songDir));
  const subdir = formatOutputSubdir(meta);
  const outputDir =
    options.outputDir ?? path.join(songDir, 'output', ...(subdir ? [subdir] : []));

  console.log(`Song:   ${path.basename(songDir)}`);
  console.log(`Stems:  ${stemsDir}`);
  console.log(`Output: ${outputDir}`);
  console.log('');

  fs.mkdirSync(outputDir, { recursive: true });

  const config = loadConfig(songDir);
  const backend = await createBackend();

  const stemFiles = fs
    .readdirSync(stemsDir)
    .filter((f) => AUDIO_EXTENSIONS.test(f))
    .map((f) => path.join(stemsDir, f));

  if (stemFiles.length === 0) {
    throw new Error(`No audio files found in ${stemsDir}`);
  }

  const stems = classifyStems(stemFiles);

  console.log(`Found ${stems.length} stems:`);
  for (const stem of stems) {
    const ext = path.extname(stem.path).slice(1);
    const idx = stem.index !== undefined ? ` [${stem.index}]` : '';
    console.log(`  ${stem.filename}.${ext}  →  ${stem.category}${idx}`);
  }
  console.log('');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-tracks-'));

  try {
    console.log(`Normalizing to ${config.target_lufs} LUFS...`);
    const normalizedStems: ClassifiedStem[] = [];

    for (const stem of stems) {
      const tmpPath = path.join(tmpDir, `${stem.filename}.wav`);
      process.stdout.write(`  ${stem.filename}...`);
      await backend.normalize(stem.path, tmpPath, {
        targetLufs: config.target_lufs,
        truePeak: -1,
      });
      normalizedStems.push({ ...stem, path: tmpPath });
      process.stdout.write(' done\n');
    }

    console.log('');
    console.log('Generating mixes...');

    for (const mixDef of config.mixes) {
      const inputs = buildMixInputs(normalizedStems, mixDef, config);
      if (inputs.length === 0) {
        console.log(`  [skip] ${mixDef.name} — no stems match`);
        continue;
      }
      const outputPath = path.join(outputDir, `${mixDef.name}.${config.output_format}`);
      process.stdout.write(`  ${mixDef.name} (${inputs.length} stems)...`);
      await backend.mix(inputs, outputPath, config.output_format);
      process.stdout.write(` done\n`);
    }

    console.log('');
    console.log(`All mixes written to: ${outputDir}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
