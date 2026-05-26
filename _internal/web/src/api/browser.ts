import { unzipSync, zipSync } from 'fflate';
import { buildMixInputs } from '@common/mixer.js';
import type { Config, StemFile, QueueStatus, SongOutputs } from '../types.js';
import type { ProcessingApi } from './interface.js';
import { FakeEventSource } from './fake-event-source.js';
import { BrowserWasmBackend } from './browser-backend.js';
import { DEFAULT_CONFIG } from './embedded-config.js';
import {
  createOpfsStore,
  createFsaStore,
  restoreFsaStore,
  isFsaSupported,
  type StemStore,
  type StorageInfo,
} from '../storage/index.js';

// ── Internal session state ────────────────────────────────────────────────────

interface BrowserStem {
  filename: string;
  ext: string;
  /** Raw audio from zip.  May be undefined for stems loaded from storage metadata
   *  only — will be loaded lazily when processing starts. */
  rawData?: Uint8Array;
  normalizedData?: Uint8Array;
}

interface BrowserSong {
  songDir: string;   // used as the "songDir" identifier throughout the UI
  displayName: string;
  stems: BrowserStem[];
}

interface BrowserSession {
  songs: BrowserSong[];
  outputs: SongOutputs[];
  // filePath → individual mix Blob URL
  fileBlobUrls: Map<string, string>;
  // variantPath → zip Blob URL (all mixes for one song)
  variantZipUrls: Map<string, string>;
}

const AUDIO_EXT_RE = /\.(wav|m4a|mp3|aiff?)$/i;

// ── BrowserApi ────────────────────────────────────────────────────────────────

export class BrowserApi implements ProcessingApi {
  private readonly backend = new BrowserWasmBackend();
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly eventSources = new Map<string, FakeEventSource>();

  // Songs loaded from persistent storage (available across sessions).
  // Keyed by songDir.  rawData is undefined until processing starts.
  private readonly loadedSongs = new Map<string, BrowserSong>();

  private stemStore: StemStore | null = null;
  private storageInfo: StorageInfo | null = null;

  // Resolved once the stem store is initialised and persisted songs are loaded.
  private readonly initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      // Prefer FSA if the user previously picked a folder and permission is
      // still granted.  Fall back to OPFS silently.
      let restored: { store: StemStore; info: StorageInfo } | null = null;
      if (isFsaSupported()) {
        restored = await restoreFsaStore();
      }

      if (restored) {
        this.stemStore = restored.store;
        this.storageInfo = restored.info;
      } else {
        this.stemStore = await createOpfsStore();
        this.storageInfo = { type: 'opfs', label: 'Browser storage' };
      }

      // Populate loadedSongs with metadata-only entries (no audio data yet).
      const stored = await this.stemStore.listSongs();
      for (const s of stored) {
        this.loadedSongs.set(s.songDir, {
          songDir: s.songDir,
          displayName: s.displayName,
          stems: s.stems.map((st) => ({ filename: st.filename, ext: st.ext })),
        });
      }
    } catch (err) {
      // Graceful degradation: run without persistence (in-memory only).
      console.warn('[BrowserApi] Stem storage unavailable, running in-memory only:', err);
    }
  }

  /** Switch to a user-picked FSA folder (call from a click handler). */
  async switchToFsa(): Promise<StorageInfo> {
    const result = await createFsaStore();
    this.stemStore = result.store;
    this.storageInfo = result.info;
    return result.info;
  }

  /** Returns current storage info, or null if not yet initialised. */
  getStorageInfo(): StorageInfo | null {
    return this.storageInfo;
  }

  getEventStream(sessionId: string): EventSource {
    const es = new FakeEventSource();
    this.eventSources.set(sessionId, es);
    // Cast: FakeEventSource satisfies the subset of EventSource that App.tsx uses.
    return es as unknown as EventSource;
  }

  private es(sessionId: string): FakeEventSource | undefined {
    return this.eventSources.get(sessionId);
  }

  // ── Step 1: extract ─────────────────────────────────────────────────────────

  async extractZips(files: File[], sessionId: string): Promise<void> {
    await this.initPromise;
    const es = this.es(sessionId);
    const session: BrowserSession = {
      songs: [],
      outputs: [],
      fileBlobUrls: new Map(),
      variantZipUrls: new Map(),
    };
    this.sessions.set(sessionId, session);

    try {
      for (const file of files) {
        const zipData = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(zipData);
        const displayName = file.name.replace(/\.zip$/i, '');
        const song: BrowserSong = { songDir: displayName, displayName, stems: [] };

        for (const [entryPath, data] of Object.entries(entries)) {
          if (entryPath.endsWith('/') || !AUDIO_EXT_RE.test(entryPath)) continue;
          const extMatch = AUDIO_EXT_RE.exec(entryPath);
          const ext = extMatch ? extMatch[1] : 'wav';
          const lastSegment = entryPath.replace(/\\/g, '/').split('/').pop() ?? entryPath;
          const filename = lastSegment.replace(/\.[^.]+$/, '');
          song.stems.push({ filename, ext, rawData: data });
        }

        if (song.stems.length > 0) {
          session.songs.push(song);
          const t = Date.now();
          es?.dispatch({ type: 'song_header', songName: displayName, stemsDir: '', outputDir: '' });
          es?.dispatch({ type: 'extract_start', total: song.stems.length });
          es?.dispatch({
            type: 'stems_classified',
            stems: song.stems.map((s) => ({ filename: s.filename, ext: s.ext })),
            total: song.stems.length,
          });
          es?.dispatch({ type: 'extract_complete', total: song.stems.length, elapsedMs: Date.now() - t });

          // Persist raw stems so they survive page reloads.
          if (this.stemStore) {
            const stemsWithData = song.stems.filter((s): s is BrowserStem & { rawData: Uint8Array } =>
              s.rawData !== undefined
            );
            this.stemStore.saveSong(
              song.songDir,
              song.displayName,
              stemsWithData.map((s) => ({ filename: s.filename, ext: s.ext, data: s.rawData })),
            ).catch((err: unknown) => {
              console.warn('[BrowserApi] Failed to persist stems:', err);
            });
            // Also update loadedSongs so re-mix from storage works immediately.
            this.loadedSongs.set(song.songDir, song);
          }
        }
      }

      es?.dispatch({ type: 'songs_ready', songDirs: session.songs.map((s) => s.songDir) });
      es?.dispatch({ type: 'session_complete' });
    } catch (err) {
      es?.dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Step 2: normalize ────────────────────────────────────────────────────────

  async normalizeSongs(songDirs: string[], sessionId: string, force: boolean, config: Config): Promise<void> {
    await this.initPromise;
    const es = this.es(sessionId);

    // Resolve songs from the current session OR from persisted loadedSongs.
    let session = this.sessions.get(sessionId);
    if (!session) {
      // Re-mix path: no session yet — create one from loaded songs.
      const fromStorage = songDirs
        .map((dir) => this.loadedSongs.get(dir))
        .filter((s): s is BrowserSong => s !== undefined);
      if (fromStorage.length === 0) {
        es?.dispatch({ type: 'error', message: 'Session not found and no stored songs match' });
        return;
      }
      session = { songs: fromStorage, outputs: [], fileBlobUrls: new Map(), variantZipUrls: new Map() };
      this.sessions.set(sessionId, session);
    }

    const songs = session.songs.filter((s) => songDirs.includes(s.songDir));

    // When normalization is disabled, pass raw stem data straight to the mix step.
    if (!config.normalize) {
      for (const song of songs) {
        await this.ensureRawData(song);
        for (const stem of song.stems) {
          stem.normalizedData = stem.rawData;
        }
      }
      es?.dispatch({ type: 'session_complete' });
      return;
    }

    // Check normalize cache for each song.  If all songs hit, emit normalize_cached.
    if (!force && this.stemStore) {
      let allCached = true;
      for (const song of songs) {
        const cached = await this.stemStore.loadNormalized(song.songDir, config.target_lufs);
        if (cached) {
          for (const stem of song.stems) {
            const entry = cached.find((c) => c.filename === stem.filename);
            if (entry) stem.normalizedData = entry.data;
          }
        } else {
          allCached = false;
          break;
        }
      }
      if (allCached) {
        const totalStems = songs.reduce((n, s) => n + s.stems.length, 0);
        es?.dispatch({ type: 'normalize_cached', total: totalStems, targetLufs: config.target_lufs });
        es?.dispatch({ type: 'session_complete' });
        return;
      }
    }

    // Cache miss (or force) — ensure raw data is loaded, then run FFmpeg.
    for (const song of songs) {
      await this.ensureRawData(song);
    }

    const totalStems = songs.reduce((n, s) => n + s.stems.length, 0);
    es?.dispatch({ type: 'normalize_start', total: totalStems, concurrency: 1, targetLufs: config.target_lufs });
    const startAll = Date.now();
    let idx = 0;

    for (const song of songs) {
      for (const stem of song.stems) {
        if (!stem.rawData) continue;
        const t = Date.now();
        stem.normalizedData = await this.backend.normalize(stem.rawData, {
          targetLufs: config.target_lufs,
          truePeak: -1.0,
        });
        es?.dispatch({ type: 'stem_normalized', name: stem.filename, index: ++idx, total: totalStems, timeMs: Date.now() - t });
      }

      // Persist normalized cache for this song.
      if (this.stemStore) {
        const normedStems = song.stems
          .filter((s): s is BrowserStem & { normalizedData: Uint8Array } => s.normalizedData !== undefined)
          .map((s) => ({ filename: s.filename, data: s.normalizedData }));
        this.stemStore.saveNormalized(song.songDir, config.target_lufs, normedStems).catch((err: unknown) => {
          console.warn('[BrowserApi] Failed to persist normalized cache:', err);
        });
      }
    }

    es?.dispatch({ type: 'normalize_complete', total: totalStems, elapsedMs: Date.now() - startAll });
    es?.dispatch({ type: 'session_complete' });
  }

  /** Load raw audio from storage for any stem whose rawData isn't in memory. */
  private async ensureRawData(song: BrowserSong): Promise<void> {
    const needsLoad = song.stems.some((s) => s.rawData === undefined);
    if (!needsLoad || !this.stemStore) return;
    try {
      const raw = await this.stemStore.loadRaw(song.songDir);
      for (const stem of song.stems) {
        if (stem.rawData !== undefined) continue;
        const stored = raw.find((r) => r.filename === stem.filename);
        if (stored) stem.rawData = stored.data;
      }
    } catch (err) {
      console.warn(`[BrowserApi] Could not load raw stems for ${song.songDir}:`, err);
    }
  }

  // ── Step 3: mix ──────────────────────────────────────────────────────────────

  async mixSongs(sessionId: string, config: Config): Promise<void> {
    await this.initPromise;
    const es = this.es(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) { es?.dispatch({ type: 'error', message: 'Session not found' }); return; }
    es?.dispatch({ type: 'mix_start', total: session.songs.length * config.mixes.length });

    for (const song of session.songs) {
      // Build a map from virtual stem path → stem, for lookup after buildMixInputs.
      const stemByPath = new Map(
        song.stems
          .filter((s) => s.normalizedData !== undefined)
          .map((s) => [`${song.songDir}/${s.filename}`, s])
      );
      const stemFiles: StemFile[] = Array.from(stemByPath.entries()).map(([p, s]) => ({
        path: p,
        filename: s.filename,
      }));

      const songFiles: { name: string; path: string }[] = [];
      const variantZipEntries: Record<string, Uint8Array> = {};
      // Collected for FSA persistence (only populated when stemStore is set).
      const outputsToSave: { filename: string; data: Uint8Array }[] = [];
      const startSong = Date.now();

      for (const mixDef of config.mixes) {
        const mixInputs = buildMixInputs(stemFiles, mixDef, config);
        if (mixInputs.length === 0) {
          es?.dispatch({ type: 'mix_skipped', name: mixDef.name, reason: 'no matching stems' });
          continue;
        }

        const bufferInputs = mixInputs.flatMap((inp) => {
          const stem = stemByPath.get(inp.path);
          if (!stem?.normalizedData) return [];
          return [{ data: stem.normalizedData, gainDb: inp.gainDb }];
        });

        const t = Date.now();
        const outputData = await this.backend.mix(bufferInputs, config.output_format);
        const fileName = `${mixDef.name}.${config.output_format}`;
        const filePath = `${song.songDir}/${fileName}`;

        const blob = new Blob([outputData], { type: `audio/${config.output_format}` });
        session.fileBlobUrls.set(filePath, URL.createObjectURL(blob));
        variantZipEntries[fileName] = outputData;
        songFiles.push({ name: fileName, path: filePath });
        if (this.stemStore) outputsToSave.push({ filename: fileName, data: outputData });

        es?.dispatch({ type: 'mix_generated', name: mixDef.name, stems: mixInputs.length, timeMs: Date.now() - t });
      }

      // Persist mix files to the FSA/OPFS folder so they survive page reloads.
      if (this.stemStore && outputsToSave.length > 0) {
        this.stemStore.saveOutput(song.songDir, outputsToSave).catch((err: unknown) => {
          console.warn('[BrowserApi] Failed to persist mix outputs:', err);
        });
      }

      // Create a single zip of all mixes for this song so "Download all" works.
      const variantZip = zipSync(variantZipEntries);
      const variantPath = `songs/${song.songDir}/output/${song.displayName}`;
      session.variantZipUrls.set(variantPath, URL.createObjectURL(new Blob([variantZip], { type: 'application/zip' })));

      session.outputs.push({
        songDir: song.songDir,
        variants: [{ keyBpm: song.displayName, files: songFiles }],
      });

      es?.dispatch({
        type: 'pipeline_complete',
        outputDir: song.songDir,
        elapsedMs: Date.now() - startSong,
        skipped: false,
        mixFiles: songFiles.map((f) => f.name),
      });
    }

    es?.dispatch({ type: 'session_complete' });
  }

  // ── Query methods ─────────────────────────────────────────────────────────────

  private static readonly STORAGE_KEY = 'practiceTracksConfig';

  getConfig(): Promise<Config> {
    const saved = localStorage.getItem(BrowserApi.STORAGE_KEY);
    if (saved) {
      try { return Promise.resolve(JSON.parse(saved) as Config); } catch { /* fall through */ }
    }
    return Promise.resolve(DEFAULT_CONFIG);
  }

  saveConfig(config: Config): Promise<void> {
    localStorage.setItem(BrowserApi.STORAGE_KEY, JSON.stringify(config));
    return Promise.resolve();
  }

  resetConfig(): Promise<Config> {
    localStorage.removeItem(BrowserApi.STORAGE_KEY);
    return Promise.resolve(DEFAULT_CONFIG);
  }

  getStatus(): Promise<QueueStatus> {
    return Promise.resolve({ mixQueue: [], uploadQueue: [] });
  }

  checkOutputs(songDirs: string[]): Promise<{ songDir: string; hasOutput: boolean }[]> {
    // In browser mode there is no on-disk output, so always report no output.
    return Promise.resolve(songDirs.map((songDir) => ({ songDir, hasOutput: false })));
  }

  getOutputs(): Promise<SongOutputs[]> {
    // Return the most recent session that has completed mixes.
    for (const session of [...this.sessions.values()].reverse()) {
      if (session.outputs.length > 0) return Promise.resolve(session.outputs);
    }
    return Promise.resolve([]);
  }

  async listSongs(): Promise<string[]> {
    await this.initPromise;
    // Songs from the current in-memory sessions + songs loaded from storage.
    const fromSessions = new Set<string>();
    for (const session of this.sessions.values()) {
      for (const s of session.songs) fromSessions.add(s.songDir);
    }
    const all = new Set([...this.loadedSongs.keys(), ...fromSessions]);
    return [...all];
  }

  async getNormalizeCache(songDir: string): Promise<{ target_lufs: number | null }> {
    await this.initPromise;
    if (!this.stemStore) return { target_lufs: null };
    const meta = await this.stemStore.getNormalizeMeta(songDir);
    return { target_lufs: meta?.target_lufs ?? null };
  }

  async getStems(songDir: string): Promise<StemFile[]> {
    await this.initPromise;
    // Check active sessions first.
    for (const session of [...this.sessions.values()].reverse()) {
      const song = session.songs.find((s) => s.songDir === songDir);
      if (song) {
        return song.stems.map((s) => ({ path: `${songDir}/${s.filename}`, filename: s.filename }));
      }
    }
    // Fall back to loaded storage songs (metadata-only, no audio data).
    const stored = this.loadedSongs.get(songDir);
    if (stored) {
      return stored.stems.map((s) => ({ path: `${songDir}/${s.filename}`, filename: s.filename }));
    }
    return [];
  }

  getDownloadUrl(filePath: string): string {
    for (const session of this.sessions.values()) {
      const url = session.fileBlobUrls.get(filePath);
      if (url) return url;
    }
    return '';
  }

  getVariantZipUrl(variantPath: string): string {
    for (const session of this.sessions.values()) {
      const url = session.variantZipUrls.get(variantPath);
      if (url) return url;
    }
    return '';
  }
}
