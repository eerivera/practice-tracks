import type { FFmpeg } from '@ffmpeg/ffmpeg';

interface NormalizeOptions {
  targetLufs: number;
  truePeak: number;
}

interface MixInput {
  data: Uint8Array;
  gainDb: number;
}

function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}

// In-browser WASM audio backend. Wraps @ffmpeg/ffmpeg with Uint8Array I/O
// instead of real file paths so BrowserApi never touches the filesystem.
export class BrowserWasmBackend {
  private ffmpegInstance: FFmpeg | null = null;
  private callCount = 0;

  private async getFFmpeg(): Promise<FFmpeg> {
    if (this.ffmpegInstance) return this.ffmpegInstance;
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();
    // new URL() lets Vite resolve these at build time directly from node_modules,
    // copy them to dist/assets/, and return the correct URL — no manual file copying.
    // ESM version (not UMD) is required: the Worker's importScripts fallback uses
    // import().default, which only works when the module has an actual default export.
    const coreURL = await toBlobURL(
      new URL('../../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url).href,
      'text/javascript',
    );
    const wasmURL = await toBlobURL(
      new URL('../../../../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm', import.meta.url).href,
      'application/wasm',
    );
    await ffmpeg.load({ coreURL, wasmURL });
    this.ffmpegInstance = ffmpeg;
    return ffmpeg;
  }

  async normalize(data: Uint8Array, options: NormalizeOptions): Promise<Uint8Array> {
    const ffmpeg = await this.getFFmpeg();
    const id = this.callCount++;
    const inName = `norm_in_${id}.wav`;
    const outName = `norm_out_${id}.wav`;

    await ffmpeg.writeFile(inName, data);
    await ffmpeg.exec([
      '-i', inName,
      '-af', `loudnorm=I=${options.targetLufs}:TP=${options.truePeak}:LRA=11:linear=true`,
      '-ar', '44100',
      '-y', outName,
    ]);
    const result = await ffmpeg.readFile(outName) as Uint8Array;
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
    return result;
  }

  async mix(inputs: MixInput[], format: string): Promise<Uint8Array> {
    if (inputs.length === 0) throw new Error('No stems to mix');
    const ffmpeg = await this.getFFmpeg();
    const id = this.callCount++;
    const inNames = inputs.map((_, i) => `mix_in_${id}_${i}.wav`);
    const outName = `mix_out_${id}.${format}`;

    for (let i = 0; i < inputs.length; i++) {
      // slice() creates a fresh copy — writeFile transfers the underlying ArrayBuffer
      // to the Worker (detaching it), so we must not pass the original directly or
      // it will be unusable by subsequent mix calls for other variants.
      await ffmpeg.writeFile(inNames[i], inputs[i].data.slice());
    }

    const args: string[] = [];
    for (const name of inNames) args.push('-i', name);

    const volumeFilters = inputs.map((inp, i) => {
      const amp = dbToAmplitude(inp.gainDb);
      return `[${i}:a]volume=${amp.toFixed(6)}[a${i}]`;
    });
    const mixLabels = inputs.map((_, i) => `[a${i}]`).join('');
    const filterComplex = [
      ...volumeFilters,
      `${mixLabels}amix=inputs=${inputs.length}:normalize=0[out]`,
    ].join(';');

    args.push('-filter_complex', filterComplex, '-map', '[out]', '-y', outName);
    await ffmpeg.exec(args);

    const result = await ffmpeg.readFile(outName) as Uint8Array;
    for (const name of inNames) await ffmpeg.deleteFile(name);
    await ffmpeg.deleteFile(outName);
    return result;
  }
}
