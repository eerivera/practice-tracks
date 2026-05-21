// Stub — will run the full pipeline in-browser via WASM when implemented.
// Swap in by building with VITE_BACKEND=browser.
import type { Config, QueueStatus, SongOutputs } from '../types.js';
import type { ProcessingApi } from './interface.js';

export class BrowserApi implements ProcessingApi {
  processZips(_files: File[], _sessionId: string, _force?: boolean): Promise<void> {
    return Promise.reject(new Error('Browser API not yet implemented'));
  }

  getEventStream(_sessionId: string): EventSource {
    throw new Error('Browser API not yet implemented');
  }

  getConfig(): Promise<Config> {
    return Promise.reject(new Error('Browser API not yet implemented'));
  }

  getStatus(): Promise<QueueStatus> {
    return Promise.reject(new Error('Browser API not yet implemented'));
  }

  getOutputs(): Promise<SongOutputs[]> {
    return Promise.reject(new Error('Browser API not yet implemented'));
  }

  getVariantZipUrl(_variantPath: string): string {
    throw new Error('Browser API not yet implemented');
  }

  getDownloadUrl(_filePath: string): string {
    throw new Error('Browser API not yet implemented');
  }
}
