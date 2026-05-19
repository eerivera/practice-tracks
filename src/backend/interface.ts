import { type MixInput } from '../types.js';

export interface NormalizeOptions {
  targetLufs: number;
  truePeak: number;
}

export interface AudioBackend {
  normalize(inputPath: string, outputPath: string, options: NormalizeOptions): Promise<void>;
  mix(inputs: MixInput[], outputPath: string, format: string): Promise<void>;
}
