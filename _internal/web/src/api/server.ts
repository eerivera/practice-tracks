import type { Config, QueueStatus, SongOutputs } from '../types.js';
import type { ProcessingApi } from './interface.js';

export class ServerApi implements ProcessingApi {
  async extractZips(files: File[], sessionId: string): Promise<void> {
    const form = new FormData();
    form.append('sessionId', sessionId);
    for (const file of files) form.append('zips', file, file.name);
    const res = await fetch('/api/extract', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Extract failed: ${res.statusText}`);
  }

  async normalizeSongs(songDirs: string[], sessionId: string, force?: boolean): Promise<void> {
    const res = await fetch('/api/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, songDirs, force: force ?? false }),
    });
    if (!res.ok) throw new Error(`Normalize failed: ${res.statusText}`);
  }

  async mixSongs(sessionId: string): Promise<void> {
    const res = await fetch('/api/mix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) throw new Error(`Mix failed: ${res.statusText}`);
  }

  getEventStream(sessionId: string): EventSource {
    return new EventSource(`/api/events/${sessionId}`);
  }

  async getConfig(): Promise<Config> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load config');
    return res.json() as Promise<Config>;
  }

  async getStatus(): Promise<QueueStatus> {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Failed to load status');
    return res.json() as Promise<QueueStatus>;
  }

  async checkOutputs(songDirs: string[]): Promise<{ songDir: string; hasOutput: boolean }[]> {
    const res = await fetch('/api/check-outputs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songDirs }),
    });
    if (!res.ok) throw new Error('Failed to check outputs');
    return res.json() as Promise<{ songDir: string; hasOutput: boolean }[]>;
  }

  async getOutputs(): Promise<SongOutputs[]> {
    const res = await fetch('/api/outputs');
    if (!res.ok) throw new Error('Failed to load outputs');
    return res.json() as Promise<SongOutputs[]>;
  }

  getVariantZipUrl(variantPath: string): string {
    const encoded = btoa(variantPath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download-zip/${encoded}`;
  }

  getDownloadUrl(filePath: string): string {
    const encoded = btoa(filePath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download/${encoded}`;
  }
}
