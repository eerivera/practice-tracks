import { useEffect, useRef } from 'react';
import type { ProgressEvent } from '../types.js';

interface Props {
  events: ProgressEvent[];
}

function fmtMs(ms: number): string {
  return ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
}

function eventToLine(e: ProgressEvent): string | null {
  switch (e.type) {
    case 'backend':
      return e.kind === 'native'
        ? `⚡ Native FFmpeg (${e.ffmpegPath})`
        : '🔄 WASM backend (slower — install FFmpeg for full speed)';
    case 'song_header':
      return `🎵 ${e.songName}`;
    case 'skip':
      return `⏭ Skipped: ${e.reason}`;
    case 'warn':
      return `⚠ ${e.message.trim()}`;
    case 'extract_start':
      return `📂 Extracting ${e.total} stems…`;
    case 'stem_extracted':
      return `  [${e.index}/${e.total}] ${e.name} (${(e.timeMs / 1000).toFixed(1)}s)`;
    case 'extract_complete':
      return `✓ Extraction complete (${(e.elapsedMs / 1000).toFixed(1)}s)`;
    case 'normalize_start':
      return `🎚 Normalizing ${e.total} stems to ${e.targetLufs} LUFS${e.concurrency > 1 ? ` (${e.concurrency} at a time)` : ''}…`;
    case 'stem_normalized':
      return `  [${e.index}/${e.total}] ${e.name} (${(e.timeMs / 1000).toFixed(1)}s)`;
    case 'normalize_complete':
      return `✓ Normalization complete (${fmtMs(e.elapsedMs)})`;
    case 'mix_start':
      return '🎛 Generating mixes…';
    case 'mix_generated':
      return `  ✓ ${e.name} (${e.stems} stems, ${(e.timeMs / 1000).toFixed(1)}s)`;
    case 'mix_skipped':
      return `  ⏭ ${e.name} — ${e.reason}`;
    case 'pipeline_complete':
      return e.skipped ? null : `✅ Done (${fmtMs(e.elapsedMs)})`;
    case 'info':
      return `ℹ ${e.message}`;
    case 'error':
      return `❌ Error: ${e.message}`;
    case 'session_complete':
      return '── All done ──';
    default:
      return null;
  }
}

function progressFromEvents(events: ProgressEvent[]): { done: number; total: number } | null {
  let total = 0;
  let done = 0;
  for (const e of events) {
    if (e.type === 'normalize_start') total = e.total;
    if (e.type === 'stem_normalized') done = e.index;
  }
  return total > 0 ? { done, total } : null;
}

export function ProgressFeed({ events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const progress = progressFromEvents(events);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const lines = events.map(eventToLine).filter(Boolean) as string[];

  return (
    <div className="space-y-3">
      {progress && (
        <div>
          <div className="flex justify-between text-sm text-slate-400 mb-1">
            <span>Normalizing stems</span>
            <span>{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="bg-slate-950 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
        {lines.map((line, i) => (
          <div key={i} className="text-slate-300 leading-relaxed whitespace-pre-wrap">
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
