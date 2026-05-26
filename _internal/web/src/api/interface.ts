import type { Config, StemFile, QueueStatus, SongOutputs } from '../types.js';

export interface ProcessingApi {
  /** Step 1: upload zip files and extract stems to disk. */
  extractZips(files: File[], sessionId: string): Promise<void>;

  /** Step 2: normalise stems for previously extracted song directories. */
  normalizeSongs(songDirs: string[], sessionId: string, force: boolean, config: Config): Promise<void>;

  /** Step 3: mix from the normalised stems held by a prior normalizeSongs call. */
  mixSongs(sessionId: string, config: Config): Promise<void>;

  /** Open an SSE stream for the given session. */
  getEventStream(sessionId: string): EventSource;

  /** Return the current default mix configuration (for the soundboard). */
  getConfig(): Promise<Config>;

  /** Persist config as the new default (server: writes user_mix.yaml; browser: localStorage). */
  saveConfig(config: Config): Promise<void>;

  /** Reset to factory default and return it (server: deletes user_mix.yaml; browser: clears localStorage). */
  resetConfig(): Promise<Config>;

  /** Return the current queue state. */
  getStatus(): Promise<QueueStatus>;

  /** Check which song directories already have output files (before normalize). */
  checkOutputs(songDirs: string[]): Promise<{ songDir: string; hasOutput: boolean }[]>;

  /** List all existing mix files on disk, organised by song → variant. */
  getOutputs(): Promise<SongOutputs[]>;

  /** List song directories that have extracted stems. */
  listSongs(): Promise<string[]>;

  /** Return the stem files for a given song directory. */
  getStems(songDir: string): Promise<StemFile[]>;

  /**
   * Return the normalization cache metadata for a song directory.
   * `target_lufs` is null when no cache exists yet.
   * Used to detect when the stored normalization no longer matches the active config.
   */
  getNormalizeCache(songDir: string): Promise<{ target_lufs: number | null }>;

  /** Return a URL that downloads all mixes for one key/BPM variant as a zip. */
  getVariantZipUrl(variantPath: string): string;

  /** Return a URL that triggers download of a generated mix file. */
  getDownloadUrl(filePath: string): string;

  /**
   * Browser-only.  Returns the current stem storage info (type + human label),
   * or undefined when running in server mode.
   */
  getStorageInfo?(): { type: 'opfs' | 'fsa'; label: string } | null;

  /**
   * Browser-only.  Show the OS folder picker and switch to FSA storage.
   * Must be called from a user-gesture handler.  Returns undefined in server mode.
   */
  switchToFsa?(): Promise<{ type: 'opfs' | 'fsa'; label: string }>;
}
