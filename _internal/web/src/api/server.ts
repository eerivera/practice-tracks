import type { AppConfig, QueueStatus } from '../types.js';
import type { ProcessingApi } from './interface.js';

export class ServerApi implements ProcessingApi {
  async processZips(files: File[], sessionId: string): Promise<void> {
    const form = new FormData();
    form.append('sessionId', sessionId);
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

  getDownloadUrl(filePath: string): string {
    const encoded = btoa(filePath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download/${encoded}`;
  }
}
