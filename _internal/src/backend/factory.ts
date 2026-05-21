import { execFile } from 'child_process';
import { promisify } from 'util';
import { type AudioBackend } from '../../common/types.js';
import { NativeFFmpegBackend } from './native.js';
import { WasmFFmpegBackend } from './wasm.js';
import { consoleEmitter, type Emitter } from '../../common/events.js';

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

export async function createBackend(emit: Emitter = consoleEmitter): Promise<AudioBackend> {
  const ffmpegPath = await findFFmpegPath();
  if (ffmpegPath) {
    emit({ type: 'backend', kind: 'native', ffmpegPath });
    return new NativeFFmpegBackend(ffmpegPath);
  }
  emit({ type: 'backend', kind: 'wasm' });
  return new WasmFFmpegBackend();
}
