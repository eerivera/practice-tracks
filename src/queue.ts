import fs from 'fs';
import path from 'path';

const QUEUES_DIR = 'queues';
export const TO_MIX_PATH = path.join(QUEUES_DIR, 'to-mix.json');
export const TO_UPLOAD_PATH = path.join(QUEUES_DIR, 'to-upload.json');

export interface ToMixEntry {
  songDir: string;
  zipPath: string | null; // null when stems were organized manually (no zip)
  addedAt: string;
  force: boolean;
}

export interface ToUploadEntry {
  songDir: string;
  outputDir: string;
  addedAt: string;
  force: boolean;
}

function ensureQueuesDir(): void {
  fs.mkdirSync(QUEUES_DIR, { recursive: true });
}

function readQueue<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T[];
  } catch {
    return [];
  }
}

function writeQueue(filePath: string, data: unknown): void {
  ensureQueuesDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function getMixQueue(): ToMixEntry[] {
  return readQueue<ToMixEntry>(TO_MIX_PATH);
}

export function getUploadQueue(): ToUploadEntry[] {
  return readQueue<ToUploadEntry>(TO_UPLOAD_PATH);
}

// Upserts an entry into to-mix.json, preserving any existing force flag.
export function upsertMixQueue(entry: Omit<ToMixEntry, 'addedAt' | 'force'>): void {
  const queue = getMixQueue();
  const idx = queue.findIndex((e) => e.songDir === entry.songDir);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], ...entry };
  } else {
    queue.push({ ...entry, addedAt: new Date().toISOString(), force: false });
  }
  writeQueue(TO_MIX_PATH, queue);
}

// Upserts an entry into to-upload.json, preserving any existing force flag.
export function upsertUploadQueue(entry: Omit<ToUploadEntry, 'addedAt' | 'force'>): void {
  const queue = getUploadQueue();
  const idx = queue.findIndex((e) => e.songDir === entry.songDir);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], ...entry };
  } else {
    queue.push({ ...entry, addedAt: new Date().toISOString(), force: false });
  }
  writeQueue(TO_UPLOAD_PATH, queue);
}

export function removeFromMixQueue(songDir: string): void {
  writeQueue(
    TO_MIX_PATH,
    getMixQueue().filter((e) => e.songDir !== songDir)
  );
}

export function removeFromUploadQueue(songDir: string): void {
  writeQueue(
    TO_UPLOAD_PATH,
    getUploadQueue().filter((e) => e.songDir !== songDir)
  );
}

// After a forced entry processes successfully, reset its flag so it won't
// force again on the next run.
export function clearForceInMixQueue(songDir: string): void {
  writeQueue(
    TO_MIX_PATH,
    getMixQueue().map((e) => (e.songDir === songDir ? { ...e, force: false } : e))
  );
}

export function clearForceInUploadQueue(songDir: string): void {
  writeQueue(
    TO_UPLOAD_PATH,
    getUploadQueue().map((e) => (e.songDir === songDir ? { ...e, force: false } : e))
  );
}
