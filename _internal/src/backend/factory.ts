import { execFile } from 'child_process';
import { promisify } from 'util';
import { type AudioBackend } from './interface.js';
import { NativeFFmpegBackend } from './native.js';
import { WasmFFmpegBackend } from './wasm.js';

const execFileAsync = promisify(execFile);

async function findFFmpegPath(): Promise<string | null> {
  if (typeof window !== 'undefined') return null;
  try {
    const { stdout } = await execFileAsync('which', ['ffmpeg']);
    const p = stdout.trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

export async function createBackend(): Promise<AudioBackend> {
  const ffmpegPath = await findFFmpegPath();
  if (ffmpegPath) {
    console.log(`Backend: native FFmpeg (${ffmpegPath})`);
    return new NativeFFmpegBackend(ffmpegPath);
  }
  console.log('Backend: WASM (FFmpeg not found in PATH — install via "brew install ffmpeg" for faster processing)');
  return new WasmFFmpegBackend();
}
