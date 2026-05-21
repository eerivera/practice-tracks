// Mirror of the server-side ProgressEvent — kept in sync manually.
// These are what the SSE stream delivers to the browser.
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
  | { type: 'session_complete' };

export interface StemInfo {
  filename: string;
  ext: string;
  category: string;
  index?: number;
}

// Matches the server-side Config shape returned by GET /api/config
export interface AppConfig {
  target_lufs: number;
  output_format: string;
  normalization_concurrency?: number;
  track_rules: Record<string, { gain_db: number; mute?: boolean }>;
  mixes: Array<{
    name: string;
    exclude?: string[];
    include_only?: string[];
    overrides?: Record<string, { gain_db: number; mute?: boolean }>;
  }>;
}

export interface QueueStatus {
  mixQueue: Array<{ songDir: string; force: boolean }>;
  uploadQueue: Array<{ songDir: string; outputDir: string; force: boolean }>;
}

export interface MixOutput {
  name: string;
  downloadUrl: string;
}

export interface SongOutputFile {
  name: string;
  path: string;
}

export interface SongOutputVariant {
  keyBpm: string;
  files: SongOutputFile[];
}

export interface SongOutputs {
  songDir: string;
  variants: SongOutputVariant[];
}
