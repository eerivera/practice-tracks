import type { AppConfig, QueueStatus } from '../types.js';

export interface ProcessingApi {
  /** Upload zip files and begin processing. Returns a session ID. */
  processZips(files: File[], sessionId: string): Promise<void>;

  /** Open an SSE stream for the given session. */
  getEventStream(sessionId: string): EventSource;

  /** Return the current default mix configuration (for the soundboard). */
  getConfig(): Promise<AppConfig>;

  /** Return the current queue state. */
  getStatus(): Promise<QueueStatus>;

  /** Return a URL that triggers download of a generated mix file. */
  getDownloadUrl(filePath: string): string;
}
