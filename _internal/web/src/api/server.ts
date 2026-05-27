import type { Config, StemFile, QueueStatus, SongOutputs } from '../types.js';
import type { ProcessingApi } from './interface.js';

/** Re-implements the server's physicalSongPath logic for the browser client.
 *  "songs/<zipName>/output" → "songs/<displayName>/<keyBpm>/output"
 *  Leaves the path unchanged when no key/BPM suffix is found. */
const KEY_BPM_RE = /[-_]([A-G][#b]?)[-_]([\d.]+)bpm$/i;
function resolvePhysicalVariantPath(variantPath: string): string {
  // Expected form: "songs/<zipName>/<suffix...>"
  const slashIdx = variantPath.indexOf('/');
  const secondSlashIdx = variantPath.indexOf('/', slashIdx + 1);
  if (slashIdx < 0 || secondSlashIdx < 0) return variantPath;
  const prefix = variantPath.slice(0, slashIdx);          // "songs"
  const zipName = variantPath.slice(slashIdx + 1, secondSlashIdx); // "SongName-Ab-68.00bpm"
  const suffix = variantPath.slice(secondSlashIdx);               // "/output"
  const match = KEY_BPM_RE.exec(zipName);
  if (!match) return variantPath;
  const displayName = zipName.slice(0, match.index);
  const bpm = parseFloat(match[2]).toString();
  const keyBpm = `${match[1]}-${bpm}bpm`;
  return `${prefix}/${displayName}/${keyBpm}${suffix}`;
}

export class ServerApi implements ProcessingApi {
  async extractZips(files: File[], sessionId: string): Promise<void> {
    const form = new FormData();
    form.append('sessionId', sessionId);
    for (const file of files) form.append('zips', file, file.name);
    const res = await fetch('/api/extract', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Extract failed: ${res.statusText}`);
  }

  async normalizeSongs(songDirs: string[], sessionId: string, force: boolean, config: Config): Promise<void> {
    const res = await fetch('/api/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, songDirs, force, config }),
    });
    if (!res.ok) throw new Error(`Normalize failed: ${res.statusText}`);
  }

  async mixSongs(sessionId: string, _config: Config, targetKey?: string): Promise<void> {
    // config is carried through the server-side NormalizeResult from the prior
    // /api/normalize call; nothing extra needs to be sent here.
    const body: { sessionId: string; targetKey?: string } = { sessionId };
    if (targetKey) body.targetKey = targetKey;
    const res = await fetch('/api/mix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Mix failed: ${res.statusText}`);
  }

  supportsTranspose(): boolean {
    return true;
  }

  getEventStream(sessionId: string): EventSource {
    return new EventSource(`/api/events/${sessionId}`);
  }

  async getConfig(): Promise<Config> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load config');
    return res.json() as Promise<Config>;
  }

  async saveConfig(config: Config): Promise<void> {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to save config');
  }

  async resetConfig(): Promise<Config> {
    const res = await fetch('/api/config', { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to reset config');
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

  async listSongs(): Promise<string[]> {
    const res = await fetch('/api/songs');
    if (!res.ok) throw new Error('Failed to list songs');
    return res.json() as Promise<string[]>;
  }

  async getStems(songDir: string): Promise<StemFile[]> {
    const encoded = btoa(songDir).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch(`/api/stems/${encoded}`);
    if (!res.ok) throw new Error('Failed to get stems');
    return res.json() as Promise<StemFile[]>;
  }

  async getNormalizeCache(songDir: string): Promise<{ target_lufs: number | null }> {
    const encoded = btoa(songDir).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch(`/api/normalize-cache/${encoded}`);
    if (!res.ok) return { target_lufs: null };
    return res.json() as Promise<{ target_lufs: number | null }>;
  }

  async getOutputs(): Promise<SongOutputs[]> {
    const res = await fetch('/api/outputs');
    if (!res.ok) throw new Error('Failed to load outputs');
    return res.json() as Promise<SongOutputs[]>;
  }

  getVariantZipUrl(variantPath: string): string {
    // variantPath is "songs/<zipName>/output" (logical).
    // Map to the physical two-level path "songs/<displayName>/<keyBpm>/output"
    // so the server can read the actual files on disk.
    const physicalPath = resolvePhysicalVariantPath(variantPath);
    const encoded = btoa(physicalPath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download-zip/${encoded}`;
  }

  getDownloadUrl(filePath: string): string {
    const encoded = btoa(filePath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `/api/download/${encoded}`;
  }
}
