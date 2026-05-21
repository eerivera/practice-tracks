import type { AppConfig, QueueStatus, SongOutputs } from '../types.js';
import type { ProcessingApi } from './interface.js';

export class ServerApi implements ProcessingApi {
  async processZips(files: File[], sessionId: string, force?: boolean): Promise<void> {
    const form = new FormData();
    form.append('sessionId', sessionId);
    form.append('force', String(force ?? false));
    for (const file of files) {
      form.append('zips', file, file.name);
    }
    const res = await fetch('/api/process', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  }

  getEventStream(sessionId: string): EventSource {
    return new EventSource(`/api/events/${sessionId}`);
  }

  async getConfig(): Promise<AppConfig> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load config');
    return res.json() as Promise<AppConfig>;
  }

  async getStatus(): Promise<QueueStatus> {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Failed to load status');
    return res.json() as Promise<QueueStatus>;
  }

  async getOutputs(): Promise<SongOutputs[]> {
    const res = await fetch('/api/outputs');
    if (!res.ok) throw new Error('Failed to load outputs');
    return res.json() as Promise<SongOutputs[]>;
  }

  getSongZipUrl(songDir: string): string {
    const encoded = btoa(`songs/${songDir}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download-zip/${encoded}`;
  }

  getDownloadUrl(filePath: string): string {
    const encoded = btoa(filePath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download/${encoded}`;
  }
}
