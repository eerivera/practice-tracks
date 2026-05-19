import { writeFileSync } from 'fs';
import { type MixInput } from '../types.js';
import { type AudioBackend, type NormalizeOptions } from './interface.js';

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
    const corePath = require.resolve('@ffmpeg/core/dist/umd/ffmpeg-core.js') as string;
    const wasmPath = require.resolve('@ffmpeg/core/dist/umd/ffmpeg-core.wasm') as string;
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
  private ffmpegInstance: import('@ffmpeg/ffmpeg').FFmpeg | null = null;

  private async getFFmpeg(): Promise<import('@ffmpeg/ffmpeg').FFmpeg> {
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
    const inName = 'norm_in.m4a';
    const outName = 'norm_out.wav';

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
