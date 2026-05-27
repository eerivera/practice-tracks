import { Command } from 'commander';
import { createInterface } from 'readline/promises';
import path from 'path';
import fs from 'fs';
import { runPipeline } from './pipeline.js';
import { extractMultitrackZip, parseSongMetadata, formatOutputSubdir } from './extractor.js';
import { consoleEmitter } from '../common/events.js';
import { findStemBus } from '../common/mixer.js';
import { loadConfig } from './config/loader.js';
import {
  getMixQueue,
  getUploadQueue,
  upsertMixQueue,
  upsertUploadQueue,
  removeFromMixQueue,
  removeFromUploadQueue,
} from './queue.js';
import {
  validateCredentials,
  searchSongs,
  getArrangements,
  getKeys,
  loadPcoLink,
  savePcoLink,
  uploadMixFile,
  attachmentExists,
} from './pco.js';
import { loadEnv, loadPcoCredentials } from './env.js';

loadEnv();

const QUEUE_ZIPS_DIR = 'queue-zips';
const PROCESSED_ZIPS_DIR = 'processed-zips';
const SONGS_DIR = 'songs';

const program = new Command();

program
  .name('practice-mix')
  .description('Generate rehearsal mixes from Multitracks stems')
  .version('0.1.0');

// ─── Shared helpers ───────────────────────────────────────────────────────────

function resolvedPath(p: string): string {
  return path.resolve(p);
}

function moveZipToProcessed(zipPath: string): void {
  const resolved = path.resolve(zipPath);
  if (!fs.existsSync(resolved)) return;
  fs.mkdirSync(PROCESSED_ZIPS_DIR, { recursive: true });
  fs.renameSync(resolved, path.join(PROCESSED_ZIPS_DIR, path.basename(resolved)));
}

// Runs the pipeline for a single entry from to-mix.json, updates all queues,
// and moves the zip to processed-zips/ on success.
interface TransposeOpt {
  targetKey?: string;
  semitones?: number;
}

async function mixOne(
  songDir: string,
  zipPath: string | null,
  entryForce: boolean,
  globalForce: boolean,
  archive: boolean,
  transpose?: TransposeOpt
): Promise<'mixed' | 'skipped' | 'failed'> {
  const force = globalForce || entryForce;
  try {
    const result = await runPipeline({ songDir, force, archive, ...transpose }, consoleEmitter);
    if (result.skipped) return 'skipped';

    upsertUploadQueue({ songDir, outputDir: result.outputDir });
    removeFromMixQueue(songDir);
    if (zipPath) moveZipToProcessed(zipPath);
    return 'mixed';
  } catch (err) {
    console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
}

// Runs upload for a single entry from to-upload.json.
async function uploadOne(
  entry: ReturnType<typeof getUploadQueue>[number],
  globalForce: boolean
): Promise<'uploaded' | 'skipped' | 'no-link' | 'failed'> {
  const link = loadPcoLink(entry.songDir);
  if (!link) return 'no-link';

  const creds = loadPcoCredentials();
  if (!creds) {
    console.error('  PCO credentials not found. Add PCO_APP_ID and PCO_SECRET to .env');
    return 'failed';
  }

  const force = globalForce || entry.force;
  const meta = parseSongMetadata(path.basename(entry.songDir));
  const keySignature = meta.key ?? path.basename(entry.outputDir).split('-')[0];
  const mixFiles = fs.readdirSync(entry.outputDir).filter((f) => !fs.statSync(path.join(entry.outputDir, f)).isDirectory());

  try {
    let uploaded = 0;
    for (const file of mixFiles) {
      const filePath = path.join(entry.outputDir, file);
      const exists = !force && await attachmentExists(link, keySignature, file, creds);
      if (exists) {
        console.log(`  [skip] ${file} — already in PCO`);
        continue;
      }
      await uploadMixFile(link, keySignature, filePath, creds);
      console.log(`  Uploaded: ${file}`);
      uploaded++;
    }
    if (uploaded > 0) removeFromUploadQueue(entry.songDir);
    return 'uploaded';
  } catch (err) {
    console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
}

// ─── extract [<zip-path>] ─────────────────────────────────────────────────────

program
  .command('extract [zip-path]')
  .description(
    'Extract a Multitracks zip into songs/<name>/stems/ and add to the mix queue.\n' +
    'With no argument, extracts all zips in queue-zips/ not already queued.'
  )
  .option('-d, --songs-dir <dir>', 'parent directory for song folders', SONGS_DIR)
  .action((zipArg: string | undefined, options: { songsDir: string }) => {
    const songsDir = resolvedPath(options.songsDir);

    const zipsToProcess: string[] = zipArg
      ? [resolvedPath(zipArg)]
      : fs
          .readdirSync(QUEUE_ZIPS_DIR)
          .filter((f) => /\.zip$/i.test(f))
          .map((f) => path.join(QUEUE_ZIPS_DIR, f));

    if (zipsToProcess.length === 0) {
      console.log('No zips to extract.');
      return;
    }

    const already = new Set(getMixQueue().map((e) => e.zipPath));

    for (const zipPath of zipsToProcess) {
      if (already.has(path.resolve(zipPath))) {
        console.log(`[skip] ${path.basename(zipPath)} — already in mix queue`);
        continue;
      }
      if (!fs.existsSync(zipPath)) {
        console.error(`File not found: ${zipPath}`);
        continue;
      }
      try {
        const result = extractMultitrackZip(zipPath, songsDir, consoleEmitter);
        upsertMixQueue({ songDir: result.songDir, zipPath: path.resolve(zipPath) });
        console.log(`\nQueued for mixing: ${result.songDir}\n`);
      } catch (err) {
        console.error(`Error extracting ${path.basename(zipPath)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

// ─── mix [<song-dir>] ─────────────────────────────────────────────────────────

program
  .command('mix [song-dir]')
  .description(
    'Mix a song directory and add to the upload queue.\n' +
    'With no argument, mixes all songs in the mix queue (queues/to-mix.json).'
  )
  .option('--force', 're-mix even if output already exists')
  .option('--archive', 'archive existing output before overwriting')
  .option('--to-key <key>', 'transpose to a different key before mixing (e.g. --to-key Bb)')
  .option('--semitones <n>', 'transpose by a fixed semitone offset instead of naming a target key (e.g. --semitones -2)', parseInt)
  .action(
    async (songDirArg: string | undefined, options: { force?: boolean; archive?: boolean; toKey?: string; semitones?: number }) => {
      const globalForce = options.force ?? false;
      const archive = options.archive ?? false;

      if (options.semitones !== undefined && options.toKey !== undefined) {
        console.error('Error: --to-key and --semitones cannot be used together. Use one or the other.');
        process.exit(1);
      }

      const transpose: TransposeOpt | undefined =
        options.toKey !== undefined ? { targetKey: options.toKey } :
        options.semitones !== undefined ? { semitones: options.semitones } :
        undefined;

      if (songDirArg) {
        // Single-song mode: mix this directory regardless of queue state
        const songDir = resolvedPath(songDirArg);
        const existing = getMixQueue().find((e) => e.songDir === songDir);
        await mixOne(songDir, existing?.zipPath ?? null, existing?.force ?? false, globalForce, archive, transpose);
      } else {
        // Batch mode: process the to-mix queue
        const queue = getMixQueue();
        if (queue.length === 0) {
          console.log('Mix queue is empty. Run `extract` first.');
          return;
        }
        console.log(`Mix queue: ${queue.length} song(s)\n`);
        let mixed = 0, skipped = 0, failed = 0;
        for (const entry of queue) {
          const outcome = await mixOne(entry.songDir, entry.zipPath, entry.force, globalForce, archive, transpose);
          if (outcome === 'mixed') mixed++;
          else if (outcome === 'skipped') skipped++;
          else failed++;
        }
        console.log(`Mix complete: ${mixed} mixed, ${skipped} skipped, ${failed} failed`);
        if (failed > 0) process.exit(1);
      }
    }
  );

// ─── upload [<song-dir>] ──────────────────────────────────────────────────────

program
  .command('upload [song-dir]')
  .description(
    'Upload mixes to Planning Center. With no argument, uploads all in the upload queue.\n' +
    'Requires PCO_APP_ID and PCO_SECRET in .env. Songs must be linked first via pco-link.'
  )
  .option('--force', 're-upload even if the file already exists in PCO')
  .action(async (songDirArg: string | undefined, options: { force?: boolean }) => {
    const globalForce = options.force ?? false;
    const creds = loadPcoCredentials();
    if (!creds) {
      console.error('PCO credentials not found. Add PCO_APP_ID and PCO_SECRET to .env');
      console.error('See .env.example for setup instructions.');
      process.exit(1);
    }

    const entries = songDirArg
      ? ((): ReturnType<typeof getUploadQueue> => {
          const songDir = resolvedPath(songDirArg);
          const q = getUploadQueue();
          const found = q.find((e) => e.songDir === songDir);
          if (!found) {
            console.error(`${songDir} is not in the upload queue. Run \`mix\` first.`);
            process.exit(1);
          }
          return [found];
        })()
      : getUploadQueue();

    if (entries.length === 0) {
      console.log('Upload queue is empty.');
      return;
    }

    console.log(`Upload queue: ${entries.length} song(s)\n`);
    let uploaded = 0, skipped = 0, noLink = 0, failed = 0;
    for (const entry of entries) {
      console.log(`Uploading: ${path.basename(entry.songDir)}`);
      const outcome = await uploadOne(entry, globalForce);
      if (outcome === 'uploaded') uploaded++;
      else if (outcome === 'skipped') skipped++;
      else if (outcome === 'no-link') {
        console.log(`  [skip] Not linked to PCO — run: npm run mix -- pco-link "${entry.songDir}"`);
        noLink++;
      } else failed++;
    }
    console.log(`\nUpload complete: ${uploaded} uploaded, ${skipped} skipped, ${noLink} not linked, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });

// ─── run ──────────────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Full pipeline: extract all queue-zips → mix all to-mix → upload all to-upload')
  .option('--force', 'force re-mix and re-upload for all entries')
  .option('--archive', 'archive existing output before overwriting')
  .option('--mix-only', 'skip the upload step')
  .option('-d, --songs-dir <dir>', 'parent directory for song folders', SONGS_DIR)
  .action(
    async (options: { force?: boolean; archive?: boolean; mixOnly?: boolean; songsDir: string }) => {
      const globalForce = options.force ?? false;
      const archive = options.archive ?? false;
      const songsDir = resolvedPath(options.songsDir);
      const runStart = Date.now();
      const elapsedRun = (): string => {
        const ms = Date.now() - runStart;
        return ms >= 60_000
          ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
          : `${(ms / 1000).toFixed(1)}s`;
      };

      // ── Step 1: extract new zips ──────────────────────────────────────────
      if (fs.existsSync(QUEUE_ZIPS_DIR)) {
        const newZips = fs
          .readdirSync(QUEUE_ZIPS_DIR)
          .filter((f) => /\.zip$/i.test(f));
        const alreadyQueued = new Set(getMixQueue().map((e) => e.zipPath));
        const toExtract = newZips.filter((f) => !alreadyQueued.has(path.resolve(path.join(QUEUE_ZIPS_DIR, f))));

        if (toExtract.length > 0) {
          console.log(`Extracting ${toExtract.length} new zip(s)...\n`);
          for (const file of toExtract) {
            const zipPath = path.join(QUEUE_ZIPS_DIR, file);
            try {
              const result = extractMultitrackZip(zipPath, songsDir, consoleEmitter);
              upsertMixQueue({ songDir: result.songDir, zipPath: path.resolve(zipPath) });
              console.log(`Queued: ${result.songDir}\n`);
            } catch (err) {
              console.error(`Failed to extract ${file}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }

      // ── Step 2: mix all in to-mix queue ───────────────────────────────────
      const mixQueue = getMixQueue();
      if (mixQueue.length > 0) {
        console.log('─'.repeat(60));
        console.log(`Mix queue: ${mixQueue.length} song(s)\n`);
        let mixed = 0, skipped = 0, failed = 0;
        for (const entry of mixQueue) {
          const outcome = await mixOne(entry.songDir, entry.zipPath, entry.force, globalForce, archive);
          if (outcome === 'mixed') mixed++;
          else if (outcome === 'skipped') skipped++;
          else failed++;
        }
        console.log(`Mix complete: ${mixed} mixed, ${skipped} skipped, ${failed} failed\n`);
      } else {
        console.log('Mix queue empty — nothing to mix.\n');
      }

      if (options.mixOnly) return;

      // ── Step 3: upload all in to-upload queue ─────────────────────────────
      const uploadQueue = getUploadQueue();
      if (uploadQueue.length > 0) {
        const creds = loadPcoCredentials();
        if (!creds) {
          console.log('PCO credentials not set — skipping upload step.');
          console.log(`Add PCO_APP_ID and PCO_SECRET to .env to enable uploads.\n`);
          return;
        }
        console.log('─'.repeat(60));
        console.log(`Upload queue: ${uploadQueue.length} song(s)\n`);
        let uploaded = 0, skipped = 0, noLink = 0, failed = 0;
        for (const entry of uploadQueue) {
          console.log(`Uploading: ${path.basename(entry.songDir)}`);
          const outcome = await uploadOne(entry, globalForce);
          if (outcome === 'uploaded') uploaded++;
          else if (outcome === 'skipped') skipped++;
          else if (outcome === 'no-link') {
            console.log(`  [skip] run: npm run mix -- pco-link "${entry.songDir}"`);
            noLink++;
          } else failed++;
        }
        console.log(`\nUpload complete: ${uploaded} uploaded, ${skipped} skipped, ${noLink} not linked, ${failed} failed`);
      } else {
        console.log('Upload queue empty — nothing to upload.');
      }

      console.log(`\nRun complete in ${elapsedRun()}.`);
    }
  );

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show the current state of all queues')
  .action(() => {
    console.log('Practice Tracks Status');
    console.log('─'.repeat(50));
    console.log('');

    // Zips waiting to be extracted
    const pendingZips = fs.existsSync(QUEUE_ZIPS_DIR)
      ? fs.readdirSync(QUEUE_ZIPS_DIR).filter((f) => /\.zip$/i.test(f))
      : [];
    const alreadyQueued = new Set(getMixQueue().map((e) => e.zipPath && path.basename(e.zipPath)));
    const unextracted = pendingZips.filter((f) => !alreadyQueued.has(f));

    console.log(`queue-zips/  ${unextracted.length} zip(s) waiting to be extracted`);
    for (const f of unextracted) console.log(`  ${f}`);
    if (unextracted.length > 0) console.log('');

    // Mix queue
    const mixQueue = getMixQueue();
    console.log(`to-mix       ${mixQueue.length} song(s) waiting to be mixed`);
    for (const e of mixQueue) {
      const forceTag = e.force ? ' [force: true]' : '';
      console.log(`  ${path.basename(e.songDir)}${forceTag}`);
    }
    if (mixQueue.length > 0) console.log('');

    // Upload queue
    const uploadQueue = getUploadQueue();
    console.log(`to-upload    ${uploadQueue.length} song(s) waiting to be uploaded`);
    for (const e of uploadQueue) {
      const link = loadPcoLink(e.songDir);
      const linkTag = link ? ' [PCO linked ✓]' : ' [not linked — run: pco-link]';
      const forceTag = e.force ? ' [force: true]' : '';
      console.log(`  ${path.basename(e.songDir)}${linkTag}${forceTag}`);
    }

    const hasPco = !!loadPcoCredentials();
    console.log('');
    console.log(`PCO credentials: ${hasPco ? 'loaded from .env ✓' : 'not set (add PCO_APP_ID + PCO_SECRET to .env)'}`);
  });

// ─── pco-link <song-dir> ──────────────────────────────────────────────────────

program
  .command('pco-link <song-dir>')
  .description('Interactively link a song directory to its Planning Center song record')
  .action(async (songDirArg: string) => {
    const songDir = resolvedPath(songDirArg);
    const creds = loadPcoCredentials();
    if (!creds) {
      console.error('PCO credentials not found. Add PCO_APP_ID and PCO_SECRET to .env');
      process.exit(1);
    }

    console.log('Validating PCO credentials...');
    const valid = await validateCredentials(creds);
    if (!valid) {
      console.error('PCO credentials are invalid. Check PCO_APP_ID and PCO_SECRET in .env');
      process.exit(1);
    }
    console.log('Credentials valid.\n');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => rl.question(q);

    try {
      // Parse song title by stripping key+bpm from the directory name
      const dirName = path.basename(songDir);
      const meta = parseSongMetadata(dirName);
      const strippedSuffix = meta.key && meta.bpmRaw
        ? `-${meta.key}-${meta.bpmRaw}bpm`
        : '';
      const searchTitle = dirName.replace(strippedSuffix, '');

      console.log(`Searching PCO for: "${searchTitle}"`);
      const songs = await searchSongs(searchTitle, creds);

      if (songs.length === 0) {
        console.log('No matching songs found in PCO. Try a shorter title.');
        rl.close();
        return;
      }

      console.log('\nMatching songs:');
      songs.forEach((s, i) => { console.log(`  ${i + 1}. ${s.title} (id: ${s.id})`); });
      const songChoice = parseInt(await ask('\nSelect a song [number]: '), 10) - 1;
      if (isNaN(songChoice) || songChoice < 0 || songChoice >= songs.length) {
        console.error('Invalid selection.');
        rl.close();
        return;
      }
      const chosenSong = songs[songChoice];

      const arrangements = await getArrangements(chosenSong.id, creds);
      console.log('\nArrangements:');
      arrangements.forEach((a, i) => { console.log(`  ${i + 1}. ${a.name} (id: ${a.id})`); });
      const arrChoice = parseInt(await ask('Select an arrangement [number]: '), 10) - 1;
      if (isNaN(arrChoice) || arrChoice < 0 || arrChoice >= arrangements.length) {
        console.error('Invalid selection.');
        rl.close();
        return;
      }
      const chosenArr = arrangements[arrChoice];

      const keys = await getKeys(chosenSong.id, chosenArr.id, creds);
      console.log('\nKeys in this arrangement:');
      keys.forEach((k, i) => { console.log(`  ${i + 1}. ${k.name || k.startingKey} (id: ${k.id})`); });

      const keyMap: Record<string, string> = {};
      for (const k of keys) {
        const keyName = k.name || k.startingKey;
        const answer = await ask(`Map key "${keyName}" to a local key signature (e.g. Ab), or press Enter to skip: `);
        if (answer.trim()) keyMap[answer.trim()] = k.id;
      }

      const link = { songId: chosenSong.id, arrangementId: chosenArr.id, keys: keyMap };
      savePcoLink(songDir, link);
      console.log(`\nSaved to ${path.join(songDir, 'pco.json')}`);
      console.log(JSON.stringify(link, null, 2));
    } finally {
      rl.close();
    }
  });

// ─── process <zip-path> ───────────────────────────────────────────────────────

program
  .command('process <zip-path>')
  .description('Shortcut: extract a zip and immediately mix it (updates all queues)')
  .option('-d, --songs-dir <dir>', 'parent directory for song folders', SONGS_DIR)
  .option('--force', 're-mix even if output already exists')
  .option('--archive', 'archive existing output before overwriting')
  .action(
    async (zipPath: string, options: { songsDir: string; force?: boolean; archive?: boolean }) => {
      const resolved = resolvedPath(zipPath);
      if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
      }
      const songsDir = resolvedPath(options.songsDir);

      try {
        const result = extractMultitrackZip(resolved, songsDir, consoleEmitter);
        console.log(`\nExtracted to: ${result.songDir}\n`);
        await mixOne(result.songDir, resolved, false, options.force ?? false, options.archive ?? false);
      } catch (err) {
        console.error('\nError:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  );

// ─── list-stems <song-dir> ────────────────────────────────────────────────────

program
  .command('list-stems <song-dir>')
  .description('List stems and their bus assignments without processing (dry run)')
  .option('-s, --stems <subdir>', 'stems subdirectory name', 'stems')
  .action((songDirArg: string, options: { stems: string }) => {
    const songDir = resolvedPath(songDirArg);
    const stemsDir = path.join(songDir, options.stems);
    if (!fs.existsSync(stemsDir)) {
      console.error(`Stems directory not found: ${stemsDir}`);
      process.exit(1);
    }
    const config = loadConfig(songDir);
    const files = fs
      .readdirSync(stemsDir)
      .filter((f) => /\.(m4a|wav|mp3|aiff?)$/i.test(f));

    console.log(`${files.length} stems in ${stemsDir}:\n`);
    for (const file of files) {
      const filename = path.basename(file, path.extname(file));
      const ext = path.extname(file).slice(1).padEnd(4);
      const bus = findStemBus(config.buses, filename);
      const busLabel = bus ? `→  ${bus.name}` : '→  (unmatched — add to a bus in config)';
      console.log(`  ${filename}.${ext}  ${busLabel}`);
    }
  });

// ─── clean ────────────────────────────────────────────────────────────────────

program
  .command('clean')
  .description(
    'Remove generated output and reset queue state.\n' +
    'With --full, also removes extracted stems and returns zips to queue-zips/.'
  )
  .option('--full', 'also remove stems and move processed zips back to queue-zips/')
  .action((options: { full?: boolean }) => {
    let removedDirs = 0;

    // Remove output subdirectories from all song folders
    if (fs.existsSync(SONGS_DIR)) {
      for (const entry of fs.readdirSync(SONGS_DIR)) {
        const songDir = path.join(SONGS_DIR, entry);
        if (!fs.statSync(songDir).isDirectory()) continue;

        const outputDir = path.join(songDir, 'output');
        if (fs.existsSync(outputDir)) {
          fs.rmSync(outputDir, { recursive: true, force: true });
          removedDirs++;
        }

        if (options.full) {
          const stemsDir = path.join(songDir, 'stems');
          if (fs.existsSync(stemsDir)) {
            fs.rmSync(stemsDir, { recursive: true, force: true });
          }
          const multiTracksDir = path.join(songDir, 'MultiTracks');
          if (fs.existsSync(multiTracksDir)) {
            fs.rmSync(multiTracksDir, { recursive: true, force: true });
          }
        }
      }
    }

    // Reset queue files
    const queueFiles = [
      path.join('queues', 'to-mix.json'),
      path.join('queues', 'to-upload.json'),
    ];
    for (const f of queueFiles) {
      if (fs.existsSync(f)) fs.writeFileSync(f, '[]\n');
    }

    // Move processed zips back to queue-zips/ for a full reset
    let movedZips = 0;
    if (options.full && fs.existsSync(PROCESSED_ZIPS_DIR)) {
      fs.mkdirSync(QUEUE_ZIPS_DIR, { recursive: true });
      for (const file of fs.readdirSync(PROCESSED_ZIPS_DIR).filter((f) => /\.zip$/i.test(f))) {
        fs.renameSync(
          path.join(PROCESSED_ZIPS_DIR, file),
          path.join(QUEUE_ZIPS_DIR, file)
        );
        movedZips++;
      }
    }

    console.log(`Removed output from ${removedDirs} song(s), reset queues.`);
    if (options.full && movedZips > 0) {
      console.log(`Moved ${movedZips} zip(s) back to queue-zips/.`);
    }
  });

// ─── Suppress unused import warnings on stubbed pco functions ─────────────────
// These are imported for future CLI wiring — they will be used when the upload
// command is fully hooked up after PAT acquisition.
void formatOutputSubdir;
void uploadMixFile;
void attachmentExists;

program.parse();
