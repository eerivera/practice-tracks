import { useState, useEffect, useRef } from 'react';
import { createApi } from './api/factory.js';
import { DropZone } from './components/DropZone.js';
import { ProgressFeed } from './components/ProgressFeed.js';
import { Soundboard } from './components/Soundboard.js';
import { PastMixes } from './components/PastMixes.js';
import type { Config, ProgressEvent, SongOutputs } from './types.js';

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
  const [pastOutputs, setPastOutputs] = useState<SongOutputs[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [songDirs, setSongDirs] = useState<string[]>([]);
  const [existingOutputCount, setExistingOutputCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [showForceModal, setShowForceModal] = useState(false);
  const filesRef = useRef<File[] | null>(null);
  // One sessionId per batch — shared across all three steps so the server can
  // match normalize results to the subsequent mix request.
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
    api.getOutputs().then(setPastOutputs).catch(console.error);
  }, []);

  useEffect(() => {
    if (phase === 'normalized' && skippedCount > 0) {
      setShowForceModal(true);
    }
  }, [phase, skippedCount]);

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
    setPhase('files_selected');
  }

  function handleExtract() {
    if (!filesRef.current) return;
    setEvents([]);
    setSongDirs([]);
    setExistingOutputCount(0);
    setSkippedCount(0);
    setShowForceModal(false);
    // Generate one sessionId for this entire batch; normalize and mix reuse it.
    sessionIdRef.current = crypto.randomUUID();
    setPhase('extracting');

    const extracted: string[] = [];
    openSse(
      (event) => { if (event.type === 'songs_ready') extracted.push(...event.songDirs); },
      () => {
        setSongDirs(extracted);
        setPhase('extracted');
        // Check for existing output now that we have song titles/keys/BPMs.
        if (extracted.length > 0) {
          api.checkOutputs(extracted)
            .then((results) => setExistingOutputCount(results.filter((r) => r.hasOutput).length))
            .catch(console.error);
        }
      }
    );
    api.extractZips(filesRef.current, sessionIdRef.current).catch((err: Error) => {
      setEvents((prev) => [...prev, { type: 'error', message: err.message }]);
    });
  }

  function handleNormalize(force = false) {
    if (!songDirs.length) return;
    setSkippedCount(0);
    setShowForceModal(false);
    // Reuse the sessionId from extract — server looks up normalize results by it.
    setPhase('normalizing');

    let skips = 0;
    openSse(
      (event) => { if (event.type === 'skip') skips++; },
      () => { setSkippedCount(skips); setPhase('normalized'); }
    );
    api.normalizeSongs(songDirs, sessionIdRef.current, force).catch((err: Error) => {
      setEvents((prev) => [...prev, { type: 'error', message: err.message }]);
    });
  }

  function handleMix() {
    // Reuse the sessionId from normalize — server retrieves held stems by it.
    setPhase('mixing');

    openSse(
      () => { /* events already appended */ },
      () => {
        setPhase('complete');
        api.getOutputs().then(setPastOutputs).catch(console.error);
      }
    );
    api.mixSongs(sessionIdRef.current).catch((err: Error) => {
      setEvents((prev) => [...prev, { type: 'error', message: err.message }]);
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
  // Soundboard appears after first normalize and stays visible — dimmed while
  // mixing is in progress so it doesn't compete with the progress log.
  const showSoundboard = config && ['normalized', 'mixing', 'complete'].includes(phase);
  const soundboardDimmed = phase === 'mixing';

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
                onClick={() => setShowForceModal(false)}
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

        {/* Drop zone — idle only */}
        {phase === 'idle' && <DropZone onFiles={handleFilesDropped} />}

        {/* Files selected — waiting for Extract */}
        {phase === 'files_selected' && (
          <div className="space-y-3">
            <p className="text-slate-400 text-sm">
              {filesRef.current?.length ?? 0} zip{(filesRef.current?.length ?? 0) !== 1 ? 's' : ''} ready
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

        {/* Progress log */}
        {showLog && <ProgressFeed events={events} />}

        {/* Extracted — waiting for Normalize */}
        {phase === 'extracted' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 bg-slate-800 rounded-lg text-sm text-slate-400">
              <span className="mt-px shrink-0">ℹ</span>
              <span>Stems must be re-normalized each session — caching is coming soon.</span>
            </div>

            {existingOutputCount > 0 ? (
              <>
                <p className="text-sm text-slate-300 px-1">
                  {existingOutputCount === 1 ? '1 song' : `${existingOutputCount} songs`} already{' '}
                  {existingOutputCount === 1 ? 'has' : 'have'} mix files. Keep them or regenerate?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleNormalize(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium transition-colors"
                  >
                    Keep existing
                  </button>
                  <button
                    onClick={() => handleNormalize(true)}
                    className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                  >
                    Regenerate all
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => handleNormalize()}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                Normalize / Convert
              </button>
            )}
          </div>
        )}

        {/* Normalized — waiting for Mix (or force modal is showing) */}
        {phase === 'normalized' && !showForceModal && (
          <button
            onClick={handleMix}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            Mix Practice Tracks
          </button>
        )}

        {/* Complete */}
        {phase === 'complete' && (
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-sm"
          >
            Process More Files
          </button>
        )}

        {/* Soundboard — appears after first normalize, stays visible; dimmed during mixing */}
        {showSoundboard && (
          <div className={`space-y-2 transition-opacity ${soundboardDimmed ? 'opacity-40 pointer-events-none' : ''}`}>
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Mix Presets</h2>
            <Soundboard config={config} />
          </div>
        )}

        {/* Past mixes — always visible; links dimmed while a step is running */}
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
