// A stem file on disk (or in-memory in the browser).
export interface StemFile {
  path: string;
  filename: string;
}

// A bus groups stems by filename pattern and provides a master gain fader.
// contains: list of exact filenames or glob patterns ending with '*'.
// e.g. "EG*" matches "EG 1", "EG 2", "EG 3"; "Bass" matches only "Bass".
export interface BusDefinition {
  name: string;
  gain_db: number;
  contains: string[];
}

export interface MixDefinition {
  name: string;
  // Both operate on bus names (not stem filenames).
  exclude?: string[];
  include_only?: string[];
  // Per-mix gain offsets applied on top of the global bus/stem gains.
  bus_gains?: Record<string, number>;
  stem_gains?: Record<string, number>;
}

export interface Config {
  // When false (the default), stems are mixed at their original recorded levels.
  // When true, each stem is loudness-normalized to target_lufs before mixing.
  normalize?: boolean;
  target_lufs: number;
  output_format: 'm4a' | 'mp3' | 'wav';
  // 0 or undefined → auto (backend.maxConcurrency, capped at 8 for native FFmpeg)
  normalization_concurrency?: number;
  // One bus per stem family. Stems not matched by any bus are included at 0 dB
  // with a warning. Use glob patterns (e.g. "EG*") or exact names.
  buses: BusDefinition[];
  // Global per-stem gain defaults (keyed by stem filename). These are the base
  // values; per-mix stem_gains in MixDefinition override them.
  stem_gains?: Record<string, number>;
  mixes: MixDefinition[];
}

export interface MixInput {
  path: string;
  gainDb: number;
}

// ── Audio backend interface ───────────────────────────────────────────────────
// Implemented by NativeFFmpegBackend (Node.js) and WasmFFmpegBackend (browser).

export interface NormalizeOptions {
  targetLufs: number;
  truePeak: number;
}

export interface TransposeOptions {
  /** Semitone offset (positive = up, negative = down). */
  semitones: number;
}

export interface AudioBackend {
  // Maximum number of normalize() calls that can safely run in parallel.
  // Native backend returns os.cpus().length; WASM returns 1 (shared VFS).
  readonly maxConcurrency: number;
  normalize(inputPath: string, outputPath: string, options: NormalizeOptions): Promise<void>;
  mix(inputs: MixInput[], outputPath: string, format: string): Promise<void>;
  /**
   * Pitch-shift a single audio file by the given semitone offset.
   * Native: uses rubberband filter if available, falls back to asetrate+atempo.
   * WASM: always uses asetrate+atempo (no rubberband in standard @ffmpeg/core build).
   */
  transpose(inputPath: string, outputPath: string, options: TransposeOptions): Promise<void>;
  /** True when the backend supports transposition (always true for both backends). */
  supportsTranspose(): boolean;
}
