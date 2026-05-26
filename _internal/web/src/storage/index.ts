/**
 * Storage factory — creates a StemStore backed by either OPFS (Origin Private
 * File System, always available) or the File System Access API (FSA, user picks
 * a real folder on disk; Chrome/Edge only).
 *
 * Detection:
 *   - isFsaSupported()         → 'showDirectoryPicker' in window
 *   - createOpfsStore()        → always works; files invisible to user
 *   - createFsaStore()         → requires user gesture; files visible in Finder
 *   - restoreFsaStore()        → restores a previously picked FSA handle from
 *                                IndexedDB without a new picker (if permission
 *                                is still granted)
 */

import { StemStore } from './stem-store.js';
export { StemStore } from './stem-store.js';
export type { StoredSong } from './stem-store.js';

export type StorageType = 'opfs' | 'fsa';

export interface StorageInfo {
  type: StorageType;
  /** Human-readable location: "Browser storage" (OPFS) or folder name (FSA). */
  label: string;
}

// ── OPFS ─────────────────────────────────────────────────────────────────────

/** Create a store backed by the Origin Private File System (no user gesture). */
export async function createOpfsStore(): Promise<StemStore> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('practice-tracks', { create: true });
  return new StemStore(dir);
}

// ── File System Access API ───────────────────────────────────────────────────

export function isFsaSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Show the OS folder picker, persist the handle in IndexedDB, return the store.
 * MUST be called from a user-gesture handler (click, etc.).
 */
export async function createFsaStore(): Promise<{ store: StemStore; info: StorageInfo }> {
  // showDirectoryPicker is not yet declared in TypeScript's DOM lib; access via cast.
  type PickFn = (opts: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  const pick = (window as unknown as { showDirectoryPicker: PickFn }).showDirectoryPicker;
  const handle = await pick({ mode: 'readwrite' });
  await saveFsaHandle(handle);
  return {
    store: new StemStore(handle),
    info: { type: 'fsa', label: handle.name },
  };
}

/**
 * Attempt to restore a previously configured FSA store from IndexedDB without
 * a new picker.  Returns null when no handle is stored or when permission has
 * been revoked and can only be re-granted via a user gesture.
 */
export async function restoreFsaStore(): Promise<{ store: StemStore; info: StorageInfo } | null> {
  try {
    const handle = await loadFsaHandle();
    if (!handle) return null;
    // queryPermission is in the spec but not yet in TypeScript's DOM lib;
    // cast to access it.
    const withPerm = handle as FileSystemDirectoryHandle & {
      queryPermission(desc: { mode: string }): Promise<PermissionState>;
    };
    const state = await withPerm.queryPermission({ mode: 'readwrite' });
    if (state !== 'granted') return null; // 'prompt' requires a user gesture; fall back to OPFS
    return {
      store: new StemStore(handle),
      info: { type: 'fsa', label: handle.name },
    };
  } catch {
    return null;
  }
}

// ── IndexedDB helpers (FSA handle persistence) ────────────────────────────────

const IDB_DB = 'practice-tracks-fsa';
const IDB_STORE = 'handles';
const IDB_KEY = 'rootDir';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(new Error(req.error?.message ?? 'IDB open failed')); };
  });
}

async function saveFsaHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(new Error(tx.error?.message ?? 'IDB write failed')); };
  });
  db.close();
}

async function loadFsaHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIdb();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => {
      const result = req.result as FileSystemDirectoryHandle | undefined;
      resolve(result ?? null);
      db.close();
    };
    req.onerror = () => { reject(new Error(req.error?.message ?? 'IDB read failed')); db.close(); };
  });
}
