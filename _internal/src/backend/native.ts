import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import {
  type MixInput,
  type AudioBackend,
  type NormalizeOptions,
  type TransposeMethod,
  type TransposeOptions,
} from '../../common/types.js';
import { buildTransposeFilter } from '../../common/keys.js';

const execFileAsync = promisify(execFile);

function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}

export class NativeFFmpegBackend implements AudioBackend {
  constructor(private readonly ffmpegPath: string) {}

  /**
   * Cached rubberband probe result.
   * undefined = not yet checked; true/false = result of the probe.
   *
   * Both NativeFFmpegBackend and WasmFFmpegBackend share the same filter-string
   * builder (buildTransposeFilter in common/keys.ts); the only thing that differs
   * is this probe — native runs `ffmpeg -filters`, WASM will use `ffmpeg.exec`.
   * When PR 2 adds rubberband to the WASM backend, it follows the same pattern.
   */
  private rubberbandSupported: boolean | undefined = undefined;

  private async probeRubberband(): Promise<boolean> {
    if (this.rubberbandSupported !== undefined) return this.rubberbandSupported;
    try {
      const { stdout } = await execFileAsync(this.ffmpegPath, ['-filters'], { encoding: 'utf8' });
      this.rubberbandSupported = stdout.includes('rubberband');
    } catch {
      this.rubberbandSupported = false;
    }
    return this.rubberbandSupported;
  }

  async transposeMethod(): Promise<TransposeMethod> {
    return (await this.probeRubberband()) ? 'rubberband' : 'asetrate';
  }

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

  supportsTranspose(): boolean {
    return true;
  }

  async transpose(inputPath: string, outputPath: string, options: TransposeOptions): Promise<void> {
    const useRubberband = (await this.transposeMethod()) === 'rubberband';
    const filter = buildTransposeFilter(options.semitones, useRubberband);
    await execFileAsync(this.ffmpegPath, [
      '-i', inputPath,
      '-af', filter,
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
