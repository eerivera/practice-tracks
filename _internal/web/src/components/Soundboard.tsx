import { useState, useRef } from 'react';
import type { Config, StemCategory, MixDefinition } from '../types.js';

interface Props {
  config: Config;
  onChange: (config: Config) => void;
}

const MIN_DB = -40;
const MAX_DB = 6;

function clampDb(db: number): number {
  return Math.round(Math.max(MIN_DB, Math.min(MAX_DB, db)));
}

function faderPct(db: number): number {
  return ((clampDb(db) - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
}

function getStemStates(config: Config, mixIndex: number) {
  const mix = config.mixes.at(mixIndex);
  if (mix === undefined) return [];
  return Object.entries(config.track_rules).map(([category]) => {
    const cat = category as StemCategory;
    const excluded =
      (mix.include_only != null && !mix.include_only.includes(cat)) ||
      (mix.exclude?.includes(cat) === true);
    const override = mix.overrides?.[cat];
    const rule = config.track_rules[cat] ?? { gain_db: 0 };
    const gainDb = override?.gain_db ?? rule.gain_db;
    const muted = (override?.mute ?? rule.mute ?? false) && !excluded;
    return { category: cat, gainDb, muted, excluded };
  });
}

// ── Fader channel ─────────────────────────────────────────────────────────────

interface StemChannelProps {
  category: StemCategory;
  gainDb: number;
  muted: boolean;
  excluded: boolean;
  onGainChange: (db: number) => void;
  onMuteToggle: () => void;
  onExcludeToggle: () => void;
}

function StemChannel({ category, gainDb, muted, excluded, onGainChange, onMuteToggle, onExcludeToggle }: StemChannelProps) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const trackRef = useRef<HTMLDivElement>(null);
  const active = !excluded && !muted;

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = 1 - (e.clientY - rect.top) / rect.height;
    onGainChange(clampDb(MIN_DB + pct * (MAX_DB - MIN_DB)));
  }

  function commitEdit() {
    const n = parseFloat(editVal);
    if (!isNaN(n)) onGainChange(clampDb(n));
    setEditing(false);
  }

  const pct = faderPct(gainDb);
  const zeroPct = faderPct(0);
  const label = excluded ? '—' : muted ? 'M' : `${gainDb > 0 ? '+' : ''}${gainDb}`;

  return (
    <div className="flex flex-col items-center gap-1.5 w-14 select-none">
      {/* dB label — click to type a value */}
      {editing ? (
        <input
          autoFocus
          className="w-12 text-center text-[11px] font-mono bg-slate-700 text-white rounded px-1 py-0.5"
          value={editVal}
          onChange={(e) => { setEditVal(e.target.value); }}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <button
          className={`text-[11px] font-mono tabular-nums w-12 text-center rounded hover:bg-slate-700 transition-colors ${active ? 'text-slate-300' : 'text-slate-600'}`}
          onClick={() => { if (!excluded) { setEditVal(String(gainDb)); setEditing(true); } }}
          title="Click to set gain (dB)"
        >
          {label}
        </button>
      )}

      {/* Fader track */}
      <div
        ref={trackRef}
        className={`relative w-3 h-24 rounded-full cursor-pointer ${excluded ? 'bg-slate-800' : 'bg-slate-700'}`}
        onClick={excluded ? undefined : handleTrackClick}
        title={excluded ? undefined : 'Click to set gain'}
      >
        <div
          className={`absolute bottom-0 w-full rounded-full transition-none ${active ? 'bg-indigo-500' : 'bg-slate-600'}`}
          style={{ height: `${pct}%` }}
        />
        <div
          className="absolute w-5 h-px bg-slate-500 -left-1 pointer-events-none"
          style={{ bottom: `${zeroPct}%` }}
        />
      </div>

      {/* Category label — click to exclude/include */}
      <button
        className={`text-[11px] text-center leading-tight w-14 rounded px-0.5 transition-colors ${excluded ? 'text-slate-700 hover:text-slate-500' : 'text-slate-300 hover:text-white'}`}
        onClick={onExcludeToggle}
        title={excluded ? 'Click to include stem' : 'Click to exclude stem'}
      >
        {category}
      </button>

      {/* Mute button */}
      {!excluded && (
        <button
          className={`text-[10px] w-6 h-5 rounded font-bold transition-colors ${muted ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          onClick={onMuteToggle}
          title={muted ? 'Unmute' : 'Mute'}
        >
          M
        </button>
      )}
    </div>
  );
}

// ── Mix tab rename ────────────────────────────────────────────────────────────

interface MixTabProps {
  name: string;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  removable: boolean;
}

function MixTab({ name, selected, onSelect, onRename, onRemove, removable }: MixTabProps) {
  const [renaming, setRenaming] = useState(false);
  const [val, setVal] = useState(name);

  function commitRename() {
    const trimmed = val.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setRenaming(false);
  }

  if (renaming) {
    return (
      <input
        autoFocus
        className="px-3 py-1 rounded-md text-sm font-medium bg-indigo-700 text-white border border-indigo-400 w-32"
        value={val}
        onChange={(e) => { setVal(e.target.value); }}
        onBlur={commitRename}
        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
      />
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={onSelect}
        onDoubleClick={() => { setVal(name); setRenaming(true); }}
        className={[
          'px-3 py-1 rounded-md text-sm font-medium transition-colors',
          selected ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
        ].join(' ')}
        title="Double-click to rename"
      >
        {name}
      </button>
      {removable && (
        <button
          onClick={onRemove}
          className="text-slate-600 hover:text-red-400 text-xs leading-none px-0.5 transition-colors"
          title="Remove mix"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Main Soundboard ───────────────────────────────────────────────────────────

export function Soundboard({ config, onChange }: Props) {
  const [selected, setSelected] = useState(0);
  const stems = getStemStates(config, selected);
  const mix = config.mixes[selected];

  function updateMix(index: number, updater: (m: MixDefinition) => MixDefinition) {
    const mixes = config.mixes.map((m, i) => i === index ? updater(m) : m);
    onChange({ ...config, mixes });
  }

  function setGain(category: StemCategory, db: number) {
    updateMix(selected, (m) => ({
      ...m,
      overrides: { ...m.overrides, [category]: { ...m.overrides?.[category], gain_db: db } },
    }));
  }

  function toggleMute(category: StemCategory) {
    const current = mix.overrides?.[category]?.mute ?? config.track_rules[category]?.mute ?? false;
    updateMix(selected, (m) => ({
      ...m,
      overrides: { ...m.overrides, [category]: { ...m.overrides?.[category], mute: !current } },
    }));
  }

  function toggleExclude(category: StemCategory) {
    const currentlyExcluded = stems.find((s) => s.category === category)?.excluded ?? false;
    updateMix(selected, (m) => {
      // Convert include_only to explicit exclude list on first edit
      let exclude = m.exclude ? [...m.exclude] : [];
      if (m.include_only) {
        const allCats = Object.keys(config.track_rules) as StemCategory[];
        const includeOnly = m.include_only;
        exclude = allCats.filter((c) => !includeOnly.includes(c));
      }
      return {
        ...m,
        include_only: undefined,
        exclude: currentlyExcluded ? exclude.filter((c) => c !== category) : [...exclude, category],
      };
    });
  }

  function renameMix(index: number, name: string) {
    updateMix(index, (m) => ({ ...m, name }));
  }

  function removeMix(index: number) {
    const mixes = config.mixes.filter((_, i) => i !== index);
    onChange({ ...config, mixes });
    setSelected(Math.min(selected, mixes.length - 1));
  }

  function addMix() {
    const name = `mix-${config.mixes.length + 1}`;
    onChange({ ...config, mixes: [...config.mixes, { name }] });
    setSelected(config.mixes.length);
  }

  return (
    <div className="space-y-3">
      {/* Mix tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        {config.mixes.map((m, i) => (
          <MixTab
            key={i}
            name={m.name}
            selected={i === selected}
            onSelect={() => { setSelected(i); }}
            onRename={(name) => { renameMix(i, name); }}
            onRemove={() => { removeMix(i); }}
            removable={config.mixes.length > 1}
          />
        ))}
        <button
          onClick={addMix}
          className="px-3 py-1 rounded-md text-sm font-medium bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-dashed border-slate-600 transition-colors"
        >
          + Add mix
        </button>
      </div>

      {/* Fader grid */}
      <div className="bg-slate-800 rounded-xl p-4 overflow-x-auto">
        <div className="flex gap-3 min-w-max pb-1">
          {stems.map((stem) => (
            <StemChannel
              key={stem.category}
              category={stem.category}
              gainDb={stem.gainDb}
              muted={stem.muted}
              excluded={stem.excluded}
              onGainChange={(db) => { setGain(stem.category, db); }}
              onMuteToggle={() => { toggleMute(stem.category); }}
              onExcludeToggle={() => { toggleExclude(stem.category); }}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-slate-600">
        Click fader to set gain · Click label to exclude/include · M to mute · Double-click tab to rename
      </p>
    </div>
  );
}
