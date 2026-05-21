import { unzipSync, zipSync } from 'fflate';
import { classifyStem } from '@common/stems/classifier.js';
import { buildMixInputs } from '@common/mixer.js';
import type { Config, StemCategory, QueueStatus, SongOutputs } from '../types.js';
import type { ProcessingApi } from './interface.js';
import { FakeEventSource } from './fake-event-source.js';
import { BrowserWasmBackend } from './browser-backend.js';
import { DEFAULT_CONFIG } from './embedded-config.js';

// ── Internal session state ────────────────────────────────────────────────────

interface BrowserStem {
  filename: string;
  ext: string;
  category: StemCategory;
  index?: number;
  rawData: Uint8Array;
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
          const classified = classifyStem(entryPath);
          song.stems.push({
            filename: classified.filename,
            ext,
            category: classified.category,
            index: classified.index,
            rawData: data,
          });
        }

        if (song.stems.length > 0) {
          session.songs.push(song);
          const t = Date.now();
          es?.dispatch({ type: 'song_header', songName: displayName, stemsDir: '', outputDir: '' });
          es?.dispatch({ type: 'extract_start', total: song.stems.length });
          es?.dispatch({
            type: 'stems_classified',
            stems: song.stems.map((s) => ({ filename: s.filename, ext: s.ext, category: s.category, index: s.index })),
            total: song.stems.length,
          });
          es?.dispatch({ type: 'extract_complete', total: song.stems.length, elapsedMs: Date.now() - t });
        }
      }

      es?.dispatch({ type: 'songs_ready', songDirs: session.songs.map((s) => s.songDir) });
      es?.dispatch({ type: 'session_complete' });
    } catch (err) {
      es?.dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Step 2: normalize ────────────────────────────────────────────────────────

  async normalizeSongs(songDirs: string[], sessionId: string, _force = false): Promise<void> {
    const es = this.es(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) { es?.dispatch({ type: 'error', message: 'Session not found' }); return; }

    const config: Config = await this.getConfig();
    const songs = session.songs.filter((s) => songDirs.includes(s.songDir));
    const totalStems = songs.reduce((n, s) => n + s.stems.length, 0);

    es?.dispatch({ type: 'normalize_start', total: totalStems, concurrency: 1, targetLufs: config.target_lufs });
    const startAll = Date.now();
    let idx = 0;

    for (const song of songs) {
      for (const stem of song.stems) {
        const t = Date.now();
        stem.normalizedData = await this.backend.normalize(stem.rawData, {
          targetLufs: config.target_lufs,
          truePeak: -1.0,
        });
        es?.dispatch({ type: 'stem_normalized', name: stem.filename, index: ++idx, total: totalStems, timeMs: Date.now() - t });
      }
    }

    es?.dispatch({ type: 'normalize_complete', total: totalStems, elapsedMs: Date.now() - startAll });
    es?.dispatch({ type: 'session_complete' });
  }

  // ── Step 3: mix ──────────────────────────────────────────────────────────────

  async mixSongs(sessionId: string): Promise<void> {
    const es = this.es(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) { es?.dispatch({ type: 'error', message: 'Session not found' }); return; }

    const config: Config = await this.getConfig();
    es?.dispatch({ type: 'mix_start', total: session.songs.length * config.mixes.length });

    for (const song of session.songs) {
      // Build a map from virtual stem path → stem, for lookup after buildMixInputs.
      const stemByPath = new Map(
        song.stems
          .filter((s) => s.normalizedData !== undefined)
          .map((s) => [`${song.songDir}/${s.filename}`, s])
      );
      const classifiedStems = Array.from(stemByPath.entries()).map(([p, s]) => ({
        path: p,
        filename: s.filename,
        category: s.category,
        index: s.index,
      }));

      const songFiles: { name: string; path: string }[] = [];
      const variantZipEntries: Record<string, Uint8Array> = {};
      const startSong = Date.now();

      for (const mixDef of config.mixes) {
        const mixInputs = buildMixInputs(classifiedStems, mixDef, config);
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

        es?.dispatch({ type: 'mix_generated', name: mixDef.name, stems: mixInputs.length, timeMs: Date.now() - t });
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

  // In browser mode there is no disk persistence, so outputs never carry over.
  checkOutputs(songDirs: string[]): Promise<{ songDir: string; hasOutput: boolean }[]> {
    return Promise.resolve(songDirs.map((songDir) => ({ songDir, hasOutput: false })));
  }

  getOutputs(): Promise<SongOutputs[]> {
    // Return the most recent session that has completed mixes.
    for (const session of [...this.sessions.values()].reverse()) {
      if (session.outputs.length > 0) return Promise.resolve(session.outputs);
    }
    return Promise.resolve([]);
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
