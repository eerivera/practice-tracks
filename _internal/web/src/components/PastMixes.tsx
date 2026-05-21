import type { SongOutputs } from '../types.js';

interface Props {
  outputs: SongOutputs[];
  getDownloadUrl: (path: string) => string;
  getSongZipUrl: (songDir: string) => string;
}

function songDisplayName(songDir: string): string {
  // "Who Else-Crowns Down (Live)-Ab-68.00bpm" → "Who Else-Crowns Down (Live)"
  return songDir.replace(/[-_][A-G][#b]?[-_][\d.]+bpm$/i, '');
}

export function PastMixes({ outputs, getDownloadUrl, getSongZipUrl }: Props) {
  if (outputs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Past Mixes</h2>
      <div className="space-y-3">
        {outputs.map((song) => (
          <div key={song.songDir} className="bg-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-medium text-white">{songDisplayName(song.songDir)}</h3>
              <a
                href={getSongZipUrl(song.songDir)}
                download
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 hover:text-white transition-colors group"
              >
                <span className="text-indigo-400 group-hover:text-indigo-300 leading-none">↓</span>
                Download all
              </a>
            </div>
            {song.variants.map((variant) => (
              <div key={variant.keyBpm}>
                <p className="text-xs text-slate-500 mb-2">{variant.keyBpm}</p>
                <div className="flex flex-wrap gap-2">
                  {variant.files.map((file) => (
                    <a
                      key={file.path}
                      href={getDownloadUrl(file.path)}
                      download
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 hover:text-white transition-colors group"
                    >
                      <span className="text-indigo-400 group-hover:text-indigo-300 text-base leading-none">↓</span>
                      {file.name}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
