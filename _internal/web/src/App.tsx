import { useState, useEffect, useRef } from 'react';
import { createApi } from './api/factory.js';
import { DropZone } from './components/DropZone.js';
import { ProgressFeed } from './components/ProgressFeed.js';
import { Soundboard } from './components/Soundboard.js';
import { OutputPanel } from './components/OutputPanel.js';
import type { AppConfig, MixOutput, ProgressEvent } from './types.js';

const api = createApi();

type Phase = 'idle' | 'processing' | 'complete';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [outputs, setOutputs] = useState<MixOutput[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
  }, []);

  function handleFiles(files: File[]) {
    const sessionId = crypto.randomUUID();
    setEvents([]);
    setOutputs([]);
    setPhase('processing');

    const es = api.getEventStream(sessionId);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as ProgressEvent;
      setEvents((prev) => [...prev, event]);

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
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setPhase('complete');
    };

    api.processZips(files, sessionId).catch((err: Error) => {
      setEvents((prev) => [...prev, { type: 'error', message: err.message }]);
      es.close();
      esRef.current = null;
      setPhase('complete');
    });
  }

  function handleReset() {
    esRef.current?.close();
    esRef.current = null;
    setEvents([]);
    setOutputs([]);
    setPhase('idle');
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
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
