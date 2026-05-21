import { useState } from 'react';
import type { Config, StemCategory } from '../types.js';

interface Props {
  config: Config;
}

interface StemState {
  category: string;
  gainDb: number;
  muted: boolean;
  excluded: boolean;
}

const MIN_DB = -40;
const MAX_DB = 6;

function faderPct(gainDb: number): number {
  return ((Math.min(MAX_DB, Math.max(MIN_DB, gainDb)) - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
}

function getStemStates(config: Config, mixIndex: number): StemState[] {
  const mix = config.mixes.at(mixIndex);
  if (mix === undefined) return [];

  return Object.entries(config.track_rules).map(([category, rule]) => {
    const cat = category as StemCategory;
    const excluded =
      (mix.include_only != null && !mix.include_only.includes(cat)) ||
      (mix.exclude?.includes(cat) === true);

    const override = mix.overrides?.[cat];
    return {
      category,
      gainDb: override?.gain_db ?? rule.gain_db,
      muted: (override?.mute ?? rule.mute ?? false) && !excluded,
      excluded,
    };
  });
}

function FaderChannel({ stem }: { stem: StemState }) {
  const active = !stem.excluded && !stem.muted;
  const pct = faderPercent(stem.gainDb);
  const zeroPct = faderPercent(0);
  const gainLabel = stem.excluded ? '—' : stem.muted ? 'M' : `${stem.gainDb > 0 ? '+' : ''}${stem.gainDb}`;

  return (
    <div className="flex flex-col items-center gap-1.5 w-14">
      <span className={`text-[11px] font-mono tabular-nums ${active ? 'text-slate-300' : 'text-slate-600'}`}>
        {gainLabel}
      </span>

      <div className="relative w-3 h-24 bg-slate-700 rounded-full">
        <div
          className={`absolute bottom-0 w-full rounded-full ${active ? 'bg-indigo-500' : 'bg-slate-600'}`}
          style={{ height: `${pct}%` }}
        />
        <div
          className="absolute w-5 h-px bg-slate-500 -left-1 pointer-events-none"
          style={{ bottom: `${zeroPct}%` }}
        />
      </div>

      <span
        className={`text-[11px] text-center leading-tight ${active ? 'text-slate-300' : 'text-slate-600'}`}
        title={stem.category}
      >
        {stem.category}
      </span>
    </div>
  );
}

// Extracted so faderPercent is defined before FaderChannel uses it
function faderPercent(gainDb: number): number {
  return faderPct(gainDb);
}

export function Soundboard({ config }: Props) {
  const [selected, setSelected] = useState(0);
  const stems = getStemStates(config, selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {config.mixes.map((mix, i) => (
          <button
            key={mix.name}
            onClick={() => { setSelected(i); }}
            className={[
              'px-3 py-1 rounded-md text-sm font-medium transition-colors',
              i === selected
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
            ].join(' ')}
          >
            {mix.name}
          </button>
        ))}
      </div>

      <div className="bg-slate-800 rounded-xl p-4 overflow-x-auto">
        <div className="flex gap-3 min-w-max pb-1">
          {stems.map((stem) => (
            <FaderChannel key={stem.category} stem={stem} />
          ))}
        </div>
      </div>
    </div>
  );
}
