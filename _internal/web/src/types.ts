// Common types (shared with Node.js side) are imported from @common.
// Re-export the ones web components use so they have a single local import path.
export type { Config, StemFile, MixDefinition, BusDefinition } from '@common/types.js';
export type { ProgressEvent, StemInfo, Emitter } from '@common/events.js';

// ── Web-only types ────────────────────────────────────────────────────────────

export interface MixOutput {
  name: string;
  downloadUrl: string;
}

export interface SongOutputFile {
  name: string;
  path: string;
}

export interface SongOutputVariant {
  keyBpm: string;
  files: SongOutputFile[];
}

export interface SongOutputs {
  songDir: string;
  variants: SongOutputVariant[];
}

export interface QueueStatus {
  mixQueue: { songDir: string; force: boolean }[];
  uploadQueue: { songDir: string; outputDir: string; force: boolean }[];
}
