import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { type MixInput, type AudioBackend, type NormalizeOptions } from '../../common/types.js';

const execFileAsync = promisify(execFile);

function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}

export class NativeFFmpegBackend implements AudioBackend {
  constructor(private readonly ffmpegPath: string) {}

  get maxConcurrency(): number {
    // Cap at 8 — above that, disk I/O becomes the bottleneck before CPU does.
    return Math.min(os.cpus().length, 8);
  }

  async normalize(
    inputPath: string,
    outputPath: string,
    options: NormalizeOptions
  ): Promise<void> {
    const { targetLufs, truePeak } = options;
    await execFileAsync(this.ffmpegPath, [
      '-i', inputPath,
      '-af', `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=11:linear=true`,
      '-ar', '44100',
      '-y',
      outputPath,
    ]);
  }

  async mix(inputs: MixInput[], outputPath: string, _format: string): Promise<void> {
    if (inputs.length === 0) throw new Error('No stems to mix');

    const args: string[] = [];
    for (const input of inputs) {
      args.push('-i', input.path);
    }

    const volumeFilters = inputs.map((input, i) => {
      const amp = dbToAmplitude(input.gainDb);
      return `[${i}:a]volume=${amp.toFixed(6)}[a${i}]`;
    });
    const mixLabels = inputs.map((_, i) => `[a${i}]`).join('');
    const filterComplex = [
      ...volumeFilters,
      `${mixLabels}amix=inputs=${inputs.length}:normalize=0[out]`,
    ].join(';');

    args.push('-filter_complex', filterComplex, '-map', '[out]', '-y', outputPath);

    await execFileAsync(this.ffmpegPath, args);
  }
}
