import type { Config, QueueStatus, SongOutputs } from '../types.js';

export interface ProcessingApi {
  /** Upload zip files and begin processing. */
  processZips(files: File[], sessionId: string, force?: boolean): Promise<void>;

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
