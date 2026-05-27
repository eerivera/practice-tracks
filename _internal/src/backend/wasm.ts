import { writeFileSync } from 'fs';
import { type MixInput, type AudioBackend, type NormalizeOptions, type TransposeOptions } from '../../common/types.js';
import { buildTransposeFilter } from '../../common/keys.js';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

// NOTE: This backend is intended for browser use (no FFmpeg installation required).
// It also works in Node.js as a fallback when FFmpeg is not installed, but is
// significantly slower than NativeFFmpegBackend. For local use, prefer installing
// FFmpeg: brew install ffmpeg
//
// Browser I/O adaptation needed before web deploy: replace writeFileSync calls
// with Blob URL creation and trigger a file download, and replace fetchFile paths
// with File/FileList inputs from a drag-drop or file picker.

function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}

async function resolveCoreConfig(): Promise<{ coreURL: string; wasmURL: string }> {
  if (typeof window !== 'undefined') {
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    return { coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` };
  }

  // Node.js: resolve wasm binary from the optional @ffmpeg/core package
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  try {
    const corePath = require.resolve('@ffmpeg/core/dist/umd/ffmpeg-core.js');
    const wasmPath = require.resolve('@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
    return { coreURL: `file://${corePath}`, wasmURL: `file://${wasmPath}` };
  } catch {
    throw new Error(
      'WASM backend requires the @ffmpeg/core package.\n' +
      'Run: npm install @ffmpeg/core\n' +
      'Or install FFmpeg for faster processing: brew install ffmpeg'
    );
  }
}

export class WasmFFmpegBackend implements AudioBackend {
  // WASM uses a single shared FFmpeg instance with one virtual filesystem,
  // so normalize() calls must be serialized to avoid filename collisions.
  readonly maxConcurrency = 1;

  private ffmpegInstance: FFmpeg | null = null;
  private normalizeCallCount = 0;

  private async getFFmpeg(): Promise<FFmpeg> {
    if (this.ffmpegInstance) return this.ffmpegInstance;

    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    const coreConfig = await resolveCoreConfig();
    await ffmpeg.load(coreConfig);
    this.ffmpegInstance = ffmpeg;
    return ffmpeg;
  }

  async normalize(
    inputPath: string,
    outputPath: string,
    options: NormalizeOptions
  ): Promise<void> {
    const { fetchFile } = await import('@ffmpeg/util');
    const ffmpeg = await this.getFFmpeg();
    const id = this.normalizeCallCount++;
    const inName = `norm_in_${id}.m4a`;
    const outName = `norm_out_${id}.wav`;

    await ffmpeg.writeFile(inName, await fetchFile(inputPath));
    await ffmpeg.exec([
      '-i', inName,
      '-af', `loudnorm=I=${options.targetLufs}:TP=${options.truePeak}:LRA=11:linear=true`,
      '-ar', '44100',
      '-y', outName,
    ]);

    const data = await ffmpeg.readFile(outName) as Uint8Array;
    writeFileSync(outputPath, data);
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
  }

  supportsTranspose(): boolean {
    return true;
  }

  transposeMethod(): Promise<'asetrate'> {
    return Promise.resolve('asetrate');
  }

  /**
   * Transpose using asetrate+atempo (rubberband not available in standard
   * @ffmpeg/core builds).  PR 2 will probe for rubberband in the loaded WASM
   * instance and switch buildTransposeFilter to useRubberband=true when found.
   */
  async transpose(inputPath: string, outputPath: string, options: TransposeOptions): Promise<void> {
    const { fetchFile } = await import('@ffmpeg/util');
    const ffmpeg = await this.getFFmpeg();
    const id = this.normalizeCallCount++;
    const inName = `xpose_in_${id}.wav`;
    const outName = `xpose_out_${id}.wav`;

    await ffmpeg.writeFile(inName, await fetchFile(inputPath));
    await ffmpeg.exec([
      '-i', inName,
      '-af', buildTransposeFilter(options.semitones, false /* PR 2: detect rubberband */),
      '-y', outName,
    ]);

    const data = await ffmpeg.readFile(outName) as Uint8Array;
    writeFileSync(outputPath, data);
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
  }

  async mix(inputs: MixInput[], outputPath: string, format: string): Promise<void> {
    if (inputs.length === 0) throw new Error('No stems to mix');

    const { fetchFile } = await import('@ffmpeg/util');
    const ffmpeg = await this.getFFmpeg();
    const inNames = inputs.map((_, i) => `mix_in_${i}.wav`);
    const outName = `mix_out.${format}`;

    for (let i = 0; i < inputs.length; i++) {
      await ffmpeg.writeFile(inNames[i], await fetchFile(inputs[i].path));
    }

    const args: string[] = [];
    for (const name of inNames) args.push('-i', name);

    const volumeFilters = inputs.map((input, i) => {
      const amp = dbToAmplitude(input.gainDb);
      return `[${i}:a]volume=${amp.toFixed(6)}[a${i}]`;
    });
    const mixLabels = inputs.map((_, i) => `[a${i}]`).join('');
    const filterComplex = [
      ...volumeFilters,
      `${mixLabels}amix=inputs=${inputs.length}:normalize=0[out]`,
    ].join(';');

    args.push('-filter_complex', filterComplex, '-map', '[out]', '-y', outName);
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outName) as Uint8Array;
    writeFileSync(outputPath, data);
    for (const name of inNames) await ffmpeg.deleteFile(name);
    await ffmpeg.deleteFile(outName);
  }
}
