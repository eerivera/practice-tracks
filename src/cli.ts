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

program
  .command('mix <song-dir>')
  .description('Process a song directory and generate all configured practice mixes')
  .option('-o, --output <dir>', 'output directory (default: <song-dir>/output)')
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
      const result = await extractMultitrackZip(resolved, songsDir);
      console.log(`Done! ${result.stemCount} stems extracted to:`);
      console.log(`  ${result.songDir}`);
      console.log('');
      console.log('To generate mixes:');
      console.log(`  npm run mix -- mix "${result.songDir}"`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

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
