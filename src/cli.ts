import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { runPipeline } from './pipeline.js';
import { extractMultitrackZip } from './extractor.js';
import { classifyStems } from './stems/classifier.js';

const program = new Command();

program
  .name('practice-mix')
  .description('Generate rehearsal mixes from Multitracks stems')
  .version('0.1.0');

// ─── mix ──────────────────────────────────────────────────────────────────────

program
  .command('mix <song-dir>')
  .description('Process a song directory and generate all configured practice mixes')
  .option('-o, --output <dir>', 'output directory (default: <song-dir>/output/<key>-<bpm>bpm/)')
  .option('-s, --stems <subdir>', 'stems subdirectory name (auto-detected if omitted)')
  .action(async (songDir: string, options: { output?: string; stems?: string }) => {
    try {
      await runPipeline({
        songDir: path.resolve(songDir),
        outputDir: options.output ? path.resolve(options.output) : undefined,
        stemsDirName: options.stems,
      });
    } catch (err) {
      console.error('\nError:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── extract ──────────────────────────────────────────────────────────────────

program
  .command('extract <zip-path>')
  .description('Extract a Multitracks zip into songs/<song-name>/stems/')
  .option('-d, --songs-dir <dir>', 'parent directory for song folders', 'songs')
  .action(async (zipPath: string, options: { songsDir: string }) => {
    try {
      const resolved = path.resolve(zipPath);
      if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
      }
      const songsDir = path.resolve(options.songsDir);
      console.log(`Extracting ${path.basename(resolved)}...`);
      const result = extractMultitrackZip(resolved, songsDir);
      console.log(`Done! ${result.stemCount} stems extracted to:`);
      console.log(`  ${result.songDir}`);
      console.log('');
      console.log('To generate mixes, run:');
      console.log(`  npm run mix -- mix "${result.songDir}"`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── process (extract + mix in one step) ──────────────────────────────────────

program
  .command('process <zip-path>')
  .description('Extract a Multitracks zip and immediately generate all practice mixes')
  .option('-d, --songs-dir <dir>', 'parent directory for song folders', 'songs')
  .option('-o, --output <dir>', 'override output directory')
  .action(async (zipPath: string, options: { songsDir: string; output?: string }) => {
    try {
      const resolved = path.resolve(zipPath);
      if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
      }
      const songsDir = path.resolve(options.songsDir);

      console.log(`Extracting ${path.basename(resolved)}...`);
      const result = extractMultitrackZip(resolved, songsDir);
      console.log(`Extracted ${result.stemCount} stems to ${result.songDir}\n`);

      await runPipeline({
        songDir: result.songDir,
        outputDir: options.output ? path.resolve(options.output) : undefined,
      });
    } catch (err) {
      console.error('\nError:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── process-queue ────────────────────────────────────────────────────────────

program
  .command('process-queue')
  .description('Extract and mix every zip in the queue directory, then move each to processed/')
  .option('-q, --queue-dir <dir>', 'directory to watch for zip files', 'queue')
  .option('-p, --processed-dir <dir>', 'directory to move completed zips into', 'processed')
  .option('-d, --songs-dir <dir>', 'parent directory for song folders', 'songs')
  .action(
    async (options: { queueDir: string; processedDir: string; songsDir: string }) => {
      const queueDir = path.resolve(options.queueDir);
      const processedDir = path.resolve(options.processedDir);
      const songsDir = path.resolve(options.songsDir);

      if (!fs.existsSync(queueDir)) {
        console.error(`Queue directory not found: ${queueDir}`);
        process.exit(1);
      }

      const zips = fs.readdirSync(queueDir).filter((f) => /\.zip$/i.test(f));
      if (zips.length === 0) {
        console.log(`No zip files found in ${queueDir}`);
        return;
      }

      console.log(`Found ${zips.length} zip(s) in queue\n`);
      fs.mkdirSync(processedDir, { recursive: true });

      let passed = 0;
      let failed = 0;

      for (const zipFile of zips) {
        const zipPath = path.join(queueDir, zipFile);
        console.log(`${'─'.repeat(60)}`);
        console.log(`Processing: ${zipFile}`);

        try {
          const result = extractMultitrackZip(zipPath, songsDir);
          console.log(`Extracted ${result.stemCount} stems\n`);
          await runPipeline({ songDir: result.songDir });
          fs.renameSync(zipPath, path.join(processedDir, zipFile));
          console.log(`Moved to processed/`);
          passed++;
        } catch (err) {
          console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
          failed++;
        }
        console.log('');
      }

      console.log(`${'─'.repeat(60)}`);
      console.log(`Queue complete: ${passed} succeeded, ${failed} failed`);
      if (failed > 0) process.exit(1);
    }
  );

// ─── list-stems ───────────────────────────────────────────────────────────────

program
  .command('list-stems <song-dir>')
  .description('Classify and list stems without processing (dry run)')
  .option('-s, --stems <subdir>', 'stems subdirectory name', 'stems')
  .action(async (songDir: string, options: { stems: string }) => {
    const stemsDir = path.join(path.resolve(songDir), options.stems);
    if (!fs.existsSync(stemsDir)) {
      console.error(`Stems directory not found: ${stemsDir}`);
      process.exit(1);
    }
    const files = fs
      .readdirSync(stemsDir)
      .filter((f: string) => /\.(m4a|wav|mp3|aiff?)$/i.test(f))
      .map((f: string) => path.join(stemsDir, f));

    const stems = classifyStems(files);
    console.log(`${stems.length} stems in ${stemsDir}:\n`);
    for (const stem of stems) {
      const ext = path.extname(stem.path).slice(1).padEnd(4);
      const idx = stem.index !== undefined ? ` [${stem.index}]` : '';
      console.log(`  ${stem.filename}.${ext}  →  ${stem.category}${idx}`);
    }
  });

program.parse();
