import type { MixOutput } from '../types.js';

interface Props {
  outputs: MixOutput[];
}

export function OutputPanel({ outputs }: Props) {
  if (outputs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Downloads</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {outputs.map((output) => (
          <a
            key={output.downloadUrl}
            href={output.downloadUrl}
            download
            className="flex items-center gap-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors group"
          >
            <span className="text-indigo-400 group-hover:text-indigo-300 text-lg leading-none">↓</span>
            <span className="text-sm text-slate-300 group-hover:text-white truncate">{output.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
