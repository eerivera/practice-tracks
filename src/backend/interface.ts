import { type MixInput } from '../types.js';

export interface NormalizeOptions {
  targetLufs: number;
  truePeak: number;
}

export interface AudioBackend {
  // Maximum number of normalize() calls that can safely run in parallel.
  // Native backend returns os.cpus().length; WASM returns 1 (shared VFS).
  readonly maxConcurrency: number;
  normalize(inputPath: string, outputPath: string, options: NormalizeOptions): Promise<void>;
  mix(inputs: MixInput[], outputPath: string, format: string): Promise<void>;
}
