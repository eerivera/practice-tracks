import type { Config, QueueStatus, SongOutputs } from '../types.js';

export interface ProcessingApi {
  /** Step 1: upload zip files and extract stems to disk. */
  extractZips(files: File[], sessionId: string): Promise<void>;

  /** Step 2: normalise stems for previously extracted song directories. */
  normalizeSongs(songDirs: string[], sessionId: string, force?: boolean): Promise<void>;

  /** Step 3: mix from the normalised stems held by a prior normalizeSongs call. */
  mixSongs(sessionId: string): Promise<void>;

  /** Open an SSE stream for the given session. */
  getEventStream(sessionId: string): EventSource;

  /** Return the current default mix configuration (for the soundboard). */
  getConfig(): Promise<Config>;

  /** Return the current queue state. */
  getStatus(): Promise<QueueStatus>;

  /** List all existing mix files on disk, organised by song → variant. */
  getOutputs(): Promise<SongOutputs[]>;

  /** Return a URL that downloads all mixes for one key/BPM variant as a zip. */
  getVariantZipUrl(variantPath: string): string;

  /** Return a URL that triggers download of a generated mix file. */
  getDownloadUrl(filePath: string): string;
}
