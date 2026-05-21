import type { SongOutputs } from '../types.js';

interface Props {
  outputs: SongOutputs[];
  getDownloadUrl: (path: string) => string;
  getVariantZipUrl: (variantPath: string) => string;
}

function songDisplayName(songDir: string): string {
  // "Who Else-Crowns Down (Live)-Ab-68.00bpm" → "Who Else-Crowns Down (Live)"
  return songDir.replace(/[-_][A-G][#b]?[-_][\d.]+bpm$/i, '');
}

export function PastMixes({ outputs, getDownloadUrl, getVariantZipUrl }: Props) {
  if (outputs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Past Mixes</h2>
      <div className="space-y-3">
        {outputs.map((song) => (
          <div key={song.songDir} className="bg-slate-800 rounded-xl p-4 space-y-4">
            <h3 className="font-medium text-white">{songDisplayName(song.songDir)}</h3>
            {song.variants.map((variant) => (
              <div key={variant.keyBpm}>
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-xs text-slate-500">{variant.keyBpm}</p>
                  <a
                    href={getVariantZipUrl(`songs/${song.songDir}/output/${variant.keyBpm}`)}
                    download={`${songDisplayName(song.songDir)} - ${variant.keyBpm}.zip`}
                    className="flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded-md text-xs text-slate-300 hover:text-white transition-colors group"
                  >
                    <span className="text-indigo-400 group-hover:text-indigo-300 leading-none">↓</span>
                    Download all
                  </a>
                </div>
                <div className="flex flex-wrap gap-2">
                  {variant.files.map((file) => (
                    <a
                      key={file.path}
                      href={getDownloadUrl(file.path)}
                      download={file.name}
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
