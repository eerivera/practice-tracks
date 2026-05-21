import { useState, useEffect, useRef } from 'react';
import { createApi } from './api/factory.js';
import { DropZone } from './components/DropZone.js';
import { ProgressFeed } from './components/ProgressFeed.js';
import { Soundboard } from './components/Soundboard.js';
import { OutputPanel } from './components/OutputPanel.js';
import { PastMixes } from './components/PastMixes.js';
import type { Config, MixOutput, ProgressEvent, SongOutputs } from './types.js';

const api = createApi();

type Phase = 'idle' | 'processing' | 'complete';

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [pastOutputs, setPastOutputs] = useState<SongOutputs[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [outputs, setOutputs] = useState<MixOutput[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [showForceModal, setShowForceModal] = useState(false);
  const filesRef = useRef<File[] | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
    api.getOutputs().then(setPastOutputs).catch(console.error);
  }, []);

  // Auto-show force modal when processing completes with skips
  useEffect(() => {
    if (phase === 'complete' && skippedCount > 0 && filesRef.current) {
      setShowForceModal(true);
    }
  }, [phase, skippedCount]);

  function handleFiles(files: File[], force = false) {
    filesRef.current = files;
    setEvents([]);
    setOutputs([]);
    setSkippedCount(0);
    setShowForceModal(false);
    setPhase('processing');

    const sessionId = crypto.randomUUID();
    const es = api.getEventStream(sessionId);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as ProgressEvent;
      setEvents((prev) => [...prev, event]);

      if (event.type === 'skip') {
        setSkippedCount((c) => c + 1);
      }

      if (event.type === 'pipeline_complete' && !event.skipped) {
        const newOutputs: MixOutput[] = event.mixFiles.map((filePath) => ({
          name: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? filePath,
          downloadUrl: api.getDownloadUrl(filePath),
        }));
        setOutputs((prev) => [...prev, ...newOutputs]);
      }

      if (event.type === 'session_complete' || event.type === 'error') {
        es.close();
        esRef.current = null;
        setPhase('complete');
        api.getOutputs().then(setPastOutputs).catch(console.error);
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setPhase('complete');
    };

    api.processZips(files, sessionId, force).catch((err: Error) => {
      setEvents((prev) => [...prev, { type: 'error', message: err.message }]);
      es.close();
      esRef.current = null;
      setPhase('complete');
    });
  }

  function handleForceReprocess() {
    if (!filesRef.current) return;
    setShowForceModal(false);
    handleFiles(filesRef.current, true);
  }

  function handleReset() {
    esRef.current?.close();
    esRef.current = null;
    setEvents([]);
    setOutputs([]);
    setSkippedCount(0);
    setShowForceModal(false);
    setPhase('idle');
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
              Reprocess to overwrite them with fresh mixes?
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

        {phase === 'idle' && (
          <DropZone onFiles={handleFiles} />
        )}

        {phase !== 'idle' && (
          <ProgressFeed events={events} />
        )}

        {phase === 'complete' && outputs.length > 0 && (
          <OutputPanel outputs={outputs} />
        )}

        {config && (phase === 'idle' || phase === 'complete') && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Mix Presets</h2>
            <Soundboard config={config} />
          </div>
        )}

        {phase !== 'processing' && (
          <PastMixes
            outputs={pastOutputs}
            getDownloadUrl={(p) => api.getDownloadUrl(p)}
            getVariantZipUrl={(p) => api.getVariantZipUrl(p)}
          />
        )}

        {phase === 'complete' && (
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-sm"
          >
            Process More Files
          </button>
        )}
      </div>
    </div>
  );
}
