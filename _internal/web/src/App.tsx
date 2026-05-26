import { useState, useEffect, useRef } from 'react';
import yaml from 'js-yaml';
import { createApi } from './api/factory.js';
import { DropZone } from './components/DropZone.js';
import { ProgressFeed } from './components/ProgressFeed.js';
import { Soundboard } from './components/Soundboard.js';
import { PastMixes } from './components/PastMixes.js';
import type { Config, StemFile, ProgressEvent, SongOutputs } from './types.js';

const api = createApi();

// Each phase is a distinct user-triggered step.
type Phase =
  | 'idle'
  | 'files_selected'
  | 'extracting'
  | 'extracted'
  | 'normalizing'
  | 'normalized'
  | 'mixing'
  | 'complete';

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [pastOutputs, setPastOutputs] = useState<SongOutputs[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [songDirs, setSongDirs] = useState<string[]>([]);
  // stems[songDir] — populated after extraction and on song select
  const [stemsBySong, setStemsBySong] = useState<Partial<Record<string, StemFile[]>>>({});
  const [selectedSongDir, setSelectedSongDir] = useState<string | null>(null);
  const [availableSongs, setAvailableSongs] = useState<string[]>([]);
  const [existingOutputCount, setExistingOutputCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [showForceModal, setShowForceModal] = useState(false);
  // null = not yet fetched; { target_lufs: null } = fetched, no cache exists
  const [normalizeCache, setNormalizeCache] = useState<{ target_lufs: number | null } | null>(null);
  // Incrementing this triggers a re-fetch of normalizeCache after normalization.
  const [cacheRefetchTick, setCacheRefetchTick] = useState(0);
  const filesRef = useRef<File[] | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
    api.getOutputs().then(setPastOutputs).catch(console.error);
    // Load previously extracted songs on startup (server mode only — browser
    // returns empty until a zip is extracted).
    api.listSongs().then((dirs) => {
      setAvailableSongs(dirs);
      if (dirs.length > 0) setSelectedSongDir(dirs[dirs.length - 1]);
    }).catch(console.error);
  }, []);

  // Fetch stems whenever the selected song changes.
  useEffect(() => {
    if (!selectedSongDir) return;
    if (stemsBySong[selectedSongDir]) return; // already loaded
    api.getStems(selectedSongDir).then((s) => {
      setStemsBySong((prev) => ({ ...prev, [selectedSongDir]: s }));
    }).catch(console.error);
  }, [selectedSongDir, stemsBySong]);

  // Fetch normalize cache metadata whenever the selected song changes or after
  // a normalization run completes (cacheRefetchTick increments then).
  useEffect(() => {
    if (!selectedSongDir) return;
    api.getNormalizeCache(selectedSongDir)
      .then((result) => { setNormalizeCache(result); })
      .catch(() => { setNormalizeCache({ target_lufs: null }); });
  }, [selectedSongDir, cacheRefetchTick]);

  const currentStems: StemFile[] = (selectedSongDir ? stemsBySong[selectedSongDir] : null) ?? [];

  // ── Config editing ────────────────────────────────────────────────────────────

  function handleConfigChange(newConfig: Config) {
    setConfig(newConfig);
    setConfigDirty(true);
  }

  async function handleSaveConfig() {
    if (!config) return;
    await api.saveConfig(config);
    setConfigDirty(false);
  }

  async function handleResetConfig() {
    const defaultConfig = await api.resetConfig();
    setConfig(defaultConfig);
    setConfigDirty(false);
  }

  function handleDownloadConfig() {
    if (!config) return;
    const text = yaml.dump(config, { lineWidth: 120 });
    const blob = new Blob([text], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'practice-tracks-config.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleUploadConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = yaml.load(ev.target?.result as string) as Config;
        setConfig(parsed);
        setConfigDirty(true);
      } catch {
        alert('Could not parse config file. Make sure it is a valid YAML config.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── SSE helpers ─────────────────────────────────────────────────────────────

  function openSse(onEvent: (e: ProgressEvent) => void, onDone: () => void): void {
    esRef.current?.close();
    const es = api.getEventStream(sessionIdRef.current);
    esRef.current = es;
    es.onmessage = (raw: MessageEvent) => {
      const event = JSON.parse(raw.data as string) as ProgressEvent;
      setEvents((prev) => [...prev, event]);
      onEvent(event);
      if (event.type === 'session_complete' || event.type === 'error') {
        es.close();
        esRef.current = null;
        onDone();
      }
    };
    es.onerror = () => { es.close(); esRef.current = null; onDone(); };
  }

  // ── Step handlers ────────────────────────────────────────────────────────────

  function handleFilesDropped(files: File[]) {
    filesRef.current = files;
    setFileCount(files.length);
    setPhase('files_selected');
  }

  function handleExtract() {
    if (!filesRef.current) return;
    setEvents([]);
    setSongDirs([]);
    setExistingOutputCount(0);
    setSkippedCount(0);
    setShowForceModal(false);
    sessionIdRef.current = crypto.randomUUID();
    setPhase('extracting');

    const extracted: string[] = [];
    openSse(
      (event) => { if (event.type === 'songs_ready') extracted.push(...event.songDirs); },
      () => {
        setSongDirs(extracted);
        setPhase('extracted');

        // Add newly extracted songs to the available list, select the most recent.
        if (extracted.length > 0) {
          setAvailableSongs((prev) => {
            const merged = [...new Set([...prev, ...extracted])];
            return merged;
          });
          setSelectedSongDir(extracted[extracted.length - 1]);

          // Pre-fetch stems for the extracted songs.
          for (const dir of extracted) {
            api.getStems(dir).then((s) => {
              setStemsBySong((prev) => ({ ...prev, [dir]: s }));
            }).catch(console.error);
          }

          api.checkOutputs(extracted)
            .then((results) => { setExistingOutputCount(results.filter((r) => r.hasOutput).length); })
            .catch(console.error);
        }
      }
    );
    api.extractZips(filesRef.current, sessionIdRef.current).catch((err: unknown) => {
      setEvents((prev) => [...prev, { type: 'error', message: err instanceof Error ? err.message : String(err) }]);
    });
  }

  function handleNormalize(force = false) {
    if (!songDirs.length || !config) return;
    setSkippedCount(0);
    setShowForceModal(false);
    setPhase('normalizing');

    const skipToMix = !config.normalize;

    let skips = 0;
    openSse(
      (event) => { if (event.type === 'skip') skips++; },
      () => {
        // Re-fetch normalize cache so the LUFS staleness banner reflects the
        // result of this normalization run immediately.
        setCacheRefetchTick((t) => t + 1);

        setSkippedCount(skips);
        const allSkipped = songDirs.length > 0 && skips >= songDirs.length;
        if (allSkipped) {
          // All songs already had output and were skipped — nothing to mix.
          // Go directly to complete so the UI doesn't grey out indefinitely.
          setPhase('complete');
          api.getOutputs().then(setPastOutputs).catch(console.error);
        } else if (skips > 0) {
          setPhase('normalized');
          setShowForceModal(true);
        } else if (skipToMix) {
          handleMix();
        } else {
          setPhase('normalized');
        }
      }
    );
    api.normalizeSongs(songDirs, sessionIdRef.current, force, config).catch((err: unknown) => {
      setEvents((prev) => [...prev, { type: 'error', message: err instanceof Error ? err.message : String(err) }]);
    });
  }

  function handleMix() {
    if (!config) return;
    setPhase('mixing');
    openSse(
      () => { /* events already appended */ },
      () => {
        setPhase('complete');
        api.getOutputs().then(setPastOutputs).catch(console.error);
      }
    );
    api.mixSongs(sessionIdRef.current, config).catch((err: unknown) => {
      setEvents((prev) => [...prev, { type: 'error', message: err instanceof Error ? err.message : String(err) }]);
    });
  }

  function handleForceReprocess() {
    setShowForceModal(false);
    handleNormalize(true);
  }

  function handleReset() {
    esRef.current?.close();
    esRef.current = null;
    setEvents([]);
    setSongDirs([]);
    setExistingOutputCount(0);
    setSkippedCount(0);
    setShowForceModal(false);
    filesRef.current = null;
    setPhase('idle');
  }

  // ── Derived UI state ─────────────────────────────────────────────────────────

  const isProcessing = ['extracting', 'normalizing', 'mixing'].includes(phase);
  const showLog = phase !== 'idle' && phase !== 'files_selected';
  const soundboardDimmed = phase === 'mixing';
  const showSoundboard = config != null && currentStems.length > 0;

  // Display name for a song directory (strip the full path prefix).
  function songDisplayName(dir: string): string {
    return dir.split('/').pop() ?? dir;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Force reprocess modal */}
      {showForceModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl p-6 max-w-sm mx-4 space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-white">
              {skippedCount === 1 ? '1 song was skipped' : `${skippedCount} songs were skipped`}
            </h3>
            <p className="text-slate-300 text-sm">
              Mix files already exist for {skippedCount === 1 ? 'this song' : 'these songs'}.
              Reprocess to overwrite them?
            </p>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => { setShowForceModal(false); }}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
              >
                Keep existing
              </button>
              <button
                onClick={handleForceReprocess}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
              >
                Reprocess
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-white">Practice Tracks</h1>
          <p className="text-slate-400 text-sm mt-1">Drop your Multitracks zips to generate rehearsal mixes</p>
        </header>

        {phase === 'idle' && <DropZone onFiles={handleFilesDropped} />}

        {phase === 'files_selected' && (
          <div className="space-y-3">
            <p className="text-slate-400 text-sm">
              {fileCount} zip{fileCount !== 1 ? 's' : ''} ready
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExtract}
                className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                Extract Stems
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showLog && <ProgressFeed events={events} />}

        {phase === 'extracted' && (
          <div className="space-y-3">
            {existingOutputCount > 0 ? (
              <>
                <p className="text-sm text-slate-300 px-1">
                  {existingOutputCount === 1 ? '1 song' : `${existingOutputCount} songs`} already{' '}
                  {existingOutputCount === 1 ? 'has' : 'have'} mix files. Keep them or regenerate?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { handleNormalize(false); }}
                    className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium transition-colors"
                  >
                    Keep existing
                  </button>
                  <button
                    onClick={() => { handleNormalize(true); }}
                    className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                  >
                    Regenerate all
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => { handleNormalize(); }}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                {config?.normalize ? 'Normalize Stems' : 'Mix Practice Tracks'}
              </button>
            )}
          </div>
        )}

        {phase === 'normalized' && !showForceModal && (
          <button
            onClick={handleMix}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            Mix Practice Tracks
          </button>
        )}

        {phase === 'complete' && (
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-sm"
          >
            Process More Files
          </button>
        )}

        {/* Global config controls — normalize settings + config file actions.
            Shown as soon as config is loaded, above the song-specific mixer.
            TODO: promote to a proper labelled "Config" section once per-song
            overrides land and there are two distinct scopes to distinguish. */}
        {config && (
          <div className={`space-y-2 transition-opacity ${soundboardDimmed || isProcessing ? 'opacity-40 pointer-events-none' : ''}`}>
            {/* Row 1: normalize toggle + LUFS target + Save (right-aligned) */}
            <div className="flex items-center gap-3 flex-wrap">
              <label
                className="flex items-center gap-1.5 text-xs text-slate-400 select-none cursor-pointer"
                title="When on, each stem is loudness-normalized before mixing. Off by default — use the gain faders to balance stems manually."
              >
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={config.normalize ?? false}
                  onChange={(e) => { handleConfigChange({ ...config, normalize: e.target.checked }); }}
                />
                Normalize stems
              </label>
              {config.normalize && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Target:</span>
                  <input
                    type="number"
                    min={-40}
                    max={0}
                    step={1}
                    value={config.target_lufs}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!isNaN(n)) {
                        handleConfigChange({ ...config, target_lufs: Math.max(-40, Math.min(0, Math.round(n))) });
                      }
                    }}
                    className="w-14 text-center text-xs font-mono bg-slate-700 text-white rounded px-1 py-0.5 border border-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  <span>LUFS</span>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {configDirty && <span className="text-[11px] text-amber-400">● unsaved</span>}
                <button
                  onClick={() => { void handleSaveConfig(); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${configDirty ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-slate-700 text-slate-500 cursor-default'}`}
                  disabled={!configDirty}
                  title="Save as new default (persists across sessions)"
                >
                  Save
                </button>
              </div>
            </div>

            {/* LUFS staleness banner — shown when the stored normalization cache was
                built with a different target than the one currently in config. */}
            {config.normalize &&
              normalizeCache !== null &&
              normalizeCache.target_lufs !== null &&
              normalizeCache.target_lufs !== config.target_lufs && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/30 border border-amber-700/40 rounded-lg text-xs text-amber-300">
                <span className="shrink-0">⚠</span>
                <span>
                  Cached at {normalizeCache.target_lufs} LUFS — current target is {config.target_lufs} LUFS.
                </span>
                {songDirs.length > 0 && !isProcessing && (
                  <button
                    onClick={() => { handleNormalize(true); }}
                    className="ml-auto px-2.5 py-0.5 rounded text-xs bg-amber-700/50 hover:bg-amber-600/50 text-amber-100 shrink-0 transition-colors"
                  >
                    Re-normalize
                  </button>
                )}
              </div>
            )}

            {/* Row 2: config file actions */}
            <div className="flex gap-2 flex-wrap">
              <input
                ref={uploadInputRef}
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={handleUploadConfig}
              />
              <button
                onClick={() => { uploadInputRef.current?.click(); }}
                className="px-2.5 py-1 rounded-md text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                title="Upload a saved config file"
              >
                Upload config
              </button>
              <button
                onClick={handleDownloadConfig}
                className="px-2.5 py-1 rounded-md text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                title="Download current config as YAML"
              >
                Download config
              </button>
              <button
                onClick={() => { void handleResetConfig(); }}
                className="px-2.5 py-1 rounded-md text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                title="Restore factory defaults"
              >
                Restore defaults
              </button>
            </div>
          </div>
        )}

        {/* Mix presets — only shown when a song is loaded */}
        {showSoundboard && (
          <div className={`space-y-3 transition-opacity ${soundboardDimmed || isProcessing ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Mix Presets</h2>
              {availableSongs.length > 1 && (
                <select
                  value={selectedSongDir ?? ''}
                  onChange={(e) => { setSelectedSongDir(e.target.value); }}
                  className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-1 border border-slate-600 focus:outline-none focus:border-indigo-500"
                >
                  {availableSongs.map((dir) => (
                    <option key={dir} value={dir}>{songDisplayName(dir)}</option>
                  ))}
                </select>
              )}
              {availableSongs.length === 1 && selectedSongDir && (
                <span className="text-xs text-slate-500">{songDisplayName(selectedSongDir)}</span>
              )}
            </div>
            <Soundboard config={config} stems={currentStems} onChange={handleConfigChange} />
          </div>
        )}

        {/* When config is loaded but no song selected yet */}
        {config && !showSoundboard && availableSongs.length === 0 && phase === 'idle' && (
          <p className="text-sm text-slate-600 text-center py-4">
            Drop a zip above to load stems and configure your mixes.
          </p>
        )}

        {/* Past mixes */}
        <div className={`transition-opacity ${isProcessing ? 'opacity-40 pointer-events-none' : ''}`}>
          <PastMixes
            outputs={pastOutputs}
            getDownloadUrl={(p) => api.getDownloadUrl(p)}
            getVariantZipUrl={(p) => api.getVariantZipUrl(p)}
          />
        </div>
      </div>
    </div>
  );
}
