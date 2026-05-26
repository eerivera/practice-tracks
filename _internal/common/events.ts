export interface StemInfo {
  filename: string;
  ext: string;
  busName?: string; // undefined if no bus matched
}

export type ProgressEvent =
  | { type: 'backend'; kind: 'native' | 'wasm'; ffmpegPath?: string }
  | { type: 'song_header'; songName: string; stemsDir: string; outputDir: string }
  | { type: 'skip'; songName: string; reason: string }
  | { type: 'warn'; message: string }
  | { type: 'archive'; count: number; archivePath: string }
  | { type: 'stems_classified'; stems: StemInfo[]; total: number }
  | { type: 'extract_start'; total: number }
  | { type: 'stem_extracted'; name: string; index: number; total: number; timeMs: number }
  | { type: 'extract_complete'; total: number; elapsedMs: number }
  | { type: 'normalize_start'; total: number; concurrency: number; targetLufs: number }
  | { type: 'stem_normalized'; name: string; index: number; total: number; timeMs: number }
  | { type: 'normalize_complete'; total: number; elapsedMs: number }
  | { type: 'mix_start'; total: number }
  | { type: 'mix_generated'; name: string; stems: number; timeMs: number }
  | { type: 'mix_skipped'; name: string; reason: string }
  | { type: 'pipeline_complete'; outputDir: string; elapsedMs: number; skipped: boolean; mixFiles: string[] }
  | { type: 'error'; message: string }
  | { type: 'session_complete' }
  // Fired after all zips in an extract step have been processed.
  // Carries the server-side song directories for subsequent normalize/mix calls.
  | { type: 'songs_ready'; songDirs: string[] };

export type Emitter = (event: ProgressEvent) => void;

export const noopEmitter: Emitter = () => {};

function fmtMs(ms: number): string {
  return ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
}

export const consoleEmitter: Emitter = (event) => {
  switch (event.type) {
    case 'backend':
      if (event.kind === 'native') {
        console.log(`Backend: native FFmpeg (${event.ffmpegPath})`);
      } else {
        console.log('Backend: WASM (FFmpeg not found — install via "brew install ffmpeg" for faster processing)');
      }
      break;
    case 'song_header':
      console.log(`Song:   ${event.songName}`);
      console.log(`Stems:  ${event.stemsDir}`);
      console.log(`Output: ${event.outputDir}`);
      console.log('');
      break;
    case 'skip':
      console.log(`[skip] ${event.songName} — ${event.reason}`);
      console.log('       Set "force": true in queues/to-mix.json, or pass --force to override.\n');
      break;
    case 'warn':
      console.warn(event.message);
      break;
    case 'archive':
      console.log(`Archived ${event.count} previous mix(es) to ${event.archivePath}`);
      break;
    case 'stems_classified':
      console.log(`Found ${event.total} stems:`);
      for (const s of event.stems) {
        const bus = s.busName ? `→  ${s.busName}` : '→  (unmatched)';
        console.log(`  ${s.filename}.${s.ext.padEnd(4)}  ${bus}`);
      }
      console.log('');
      break;
    case 'extract_start':
      console.log(`Extracting ${event.total} stems...`);
      break;
    case 'stem_extracted':
      console.log(`  ${event.name}... done (${(event.timeMs / 1000).toFixed(1)}s)`);
      break;
    case 'extract_complete':
      console.log(`Extraction complete (${(event.elapsedMs / 1000).toFixed(1)}s total)`);
      break;
    case 'normalize_start': {
      const note = event.concurrency > 1 ? ` (${event.concurrency} at a time)` : '';
      console.log(`Normalizing ${event.total} stems to ${event.targetLufs} LUFS${note}...`);
      break;
    }
    case 'stem_normalized':
      console.log(`  [${event.index}/${event.total}] ${event.name} (${(event.timeMs / 1000).toFixed(1)}s)`);
      break;
    case 'normalize_complete':
      console.log(`Normalization complete (${fmtMs(event.elapsedMs)} total)\n`);
      break;
    case 'mix_start':
      console.log('Generating mixes...');
      break;
    case 'mix_generated':
      console.log(`  ${event.name} (${event.stems} stems)... done (${(event.timeMs / 1000).toFixed(1)}s)`);
      break;
    case 'mix_skipped':
      console.log(`  [skip] ${event.name} — ${event.reason}`);
      break;
    case 'pipeline_complete':
      if (!event.skipped) {
        console.log(`\nAll mixes written to: ${event.outputDir}`);
        console.log(`Total time: ${fmtMs(event.elapsedMs)}`);
      }
      break;
    case 'error':
      console.error(`Error: ${event.message}`);
      break;
    // session_complete is server-only — no console representation
    default:
      break;
  }
};
