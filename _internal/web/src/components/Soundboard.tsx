import { useState } from 'react';
import type { Config, StemCategory, MixDefinition, BusDefinition } from '../types.js';

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

function getBusGain(buses: BusDefinition[] | undefined, category: StemCategory): number {
  if (!buses) return 0;
  return buses.find((b) => b.contains.includes(category))?.gain_db ?? 0;
}

interface StemState {
  category: StemCategory;
  /** Offset relative to bus (track_rule or mix override). */
  offsetDb: number;
  /** bus_gain + offsetDb. */
  effectiveDb: number;
  muted: boolean;
  excluded: boolean;
}

function getStemStates(config: Config, mixIndex: number): StemState[] {
  const mix = config.mixes.at(mixIndex);
  if (mix === undefined) return [];
  return Object.keys(config.track_rules).map((category) => {
    const cat = category as StemCategory;
    const excluded =
      (mix.include_only != null && !mix.include_only.includes(cat)) ||
      (mix.exclude?.includes(cat) === true);
    const override = mix.overrides?.[cat];
    const rule = config.track_rules[cat] ?? { gain_db: 0 };
    const offsetDb = override?.gain_db ?? rule.gain_db;
    const busGain = getBusGain(config.buses, cat);
    const muted = (override?.mute ?? rule.mute ?? false) && !excluded;
    return { category: cat, offsetDb, effectiveDb: busGain + offsetDb, muted, excluded };
  });
}

// ── Shared fader track ────────────────────────────────────────────────────────
// Used by both BusChannel and StemChannel so both are pixel-identical in size.

interface FaderTrackProps {
  gainDb: number;
  active: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  title?: string;
}

function FaderTrack({ gainDb, active, onClick, title }: FaderTrackProps) {
  const pct = faderPct(gainDb);
  const zeroPct = faderPct(0);
  return (
    <div
      className={`relative w-3 h-24 rounded-full cursor-pointer ${active ? 'bg-slate-700' : 'bg-slate-800'}`}
      onClick={onClick}
      title={title}
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
  );
}

// ── Bus channel ────────────────────────────────────────────────────────────────
// Primary fader — always visible. Shows effective gain for single-stem buses,
// bus master gain for multi-stem buses.

interface BusChannelProps {
  name: string;
  /** The value shown on the fader (and returned by onGainChange). */
  displayGainDb: number;
  active: boolean;
  canExpand: boolean;
  expanded: boolean;
  onGainChange: (db: number) => void;
  onToggleExpand: () => void;
}

function BusChannel({ name, displayGainDb, active, canExpand, expanded, onGainChange, onToggleExpand }: BusChannelProps) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');

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

  const label = `${displayGainDb > 0 ? '+' : ''}${displayGainDb}`;

  return (
    <div className="flex flex-col items-center gap-1.5 w-14 select-none">
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
          onClick={() => { setEditVal(String(displayGainDb)); setEditing(true); }}
          title="Click to set gain (dB)"
        >
          {label}
        </button>
      )}

      <FaderTrack gainDb={displayGainDb} active={active} onClick={handleTrackClick} />

      <span className={`text-[11px] text-center leading-tight w-14 break-words px-0.5 ${active ? 'text-slate-200' : 'text-slate-600'}`}>
        {name}
      </span>

      {/* Expand toggle — shown for multi-stem buses, spacer otherwise */}
      {canExpand ? (
        <button
          onClick={onToggleExpand}
          className={`text-[9px] w-6 h-5 rounded transition-colors ${
            expanded ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
          title={expanded ? 'Collapse' : 'Show individual stems'}
        >
          {expanded ? '▴' : '▾'}
        </button>
      ) : (
        <div className="h-5" />
      )}
    </div>
  );
}

// ── Stem channel ──────────────────────────────────────────────────────────────
// Secondary fader — shown in the expanded detail panel. Displays offset from bus.

interface StemChannelProps {
  category: StemCategory;
  offsetDb: number;
  effectiveDb: number;
  busGain: number;
  muted: boolean;
  excluded: boolean;
  onGainChange: (db: number) => void;
  onMuteToggle: () => void;
  onExcludeToggle: () => void;
}

function StemChannel({ category, offsetDb, effectiveDb, busGain, muted, excluded, onGainChange, onMuteToggle, onExcludeToggle }: StemChannelProps) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
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

  const label = excluded ? '—' : muted ? 'M' : `${offsetDb > 0 ? '+' : ''}${offsetDb}`;
  const hasBusOffset = busGain !== 0;
  const title = excluded ? undefined
    : hasBusOffset
      ? `Offset from bus · effective: ${effectiveDb > 0 ? '+' : ''}${effectiveDb} dB · click to set`
      : 'Click to set gain (dB)';

  return (
    <div className="flex flex-col items-center gap-1.5 w-14 select-none">
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
          onClick={() => { if (!excluded) { setEditVal(String(offsetDb)); setEditing(true); } }}
          title={title}
        >
          {label}
        </button>
      )}

      <FaderTrack gainDb={offsetDb} active={active} onClick={excluded ? () => {} : handleTrackClick} title={title} />

      <button
        className={`text-[11px] text-center leading-tight w-14 break-words rounded px-0.5 transition-colors ${excluded ? 'text-slate-700 hover:text-slate-500' : 'text-slate-300 hover:text-white'}`}
        onClick={onExcludeToggle}
        title={excluded ? 'Click to include stem' : 'Click to exclude stem'}
      >
        {category.replace(/_/g, ' ')}
      </button>

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

// ── Mix tab ───────────────────────────────────────────────────────────────────

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
  const [expandedBusIdx, setExpandedBusIdx] = useState<number | null>(null);
  const stems = getStemStates(config, selected);
  const mix = config.mixes[selected];
  const buses = config.buses ?? [];

  // ── Mix mutations ─────────────────────────────────────────────────────────

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

  // ── Bus mutations ─────────────────────────────────────────────────────────

  function setBusGain(busIndex: number, newBusGain: number) {
    const newBuses = buses.map((b, i) => i === busIndex ? { ...b, gain_db: newBusGain } : b);
    onChange({ ...config, buses: newBuses });
  }

  // ── Mix-level mutations ───────────────────────────────────────────────────

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

  // ── Layout data ───────────────────────────────────────────────────────────

  const assignedCategories = new Set(buses.flatMap((b) => b.contains));
  const ungroupedStems = stems.filter((s) => !assignedCategories.has(s.category));

  // Per-bus computed values for BusChannel rendering.
  const busRows = buses.map((bus, busIdx) => {
    const busStems = stems.filter((s) => bus.contains.includes(s.category));
    const isMulti = bus.contains.length > 1;
    const allExcluded = busStems.length > 0 && busStems.every((s) => s.excluded);

    // Single-stem: show effective gain so the fader reads as the actual level.
    // Moving it adjusts bus.gain_db such that effective stays = fader value.
    const singleOffset = !isMulti && busStems.length === 1 ? busStems[0].offsetDb : 0;
    const displayGainDb = isMulti ? bus.gain_db : bus.gain_db + singleOffset;

    function handleBusGainChange(newDisplay: number) {
      const newBusGain = isMulti ? newDisplay : newDisplay - singleOffset;
      setBusGain(busIdx, newBusGain);
    }

    return { bus, busIdx, busStems, isMulti, allExcluded, displayGainDb, handleBusGainChange };
  });

  const expandedBus = expandedBusIdx !== null ? busRows[expandedBusIdx] : null;

  return (
    <div className="space-y-3">
      {/* Mix tabs */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
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

      {/* Fader panel */}
      <div className="bg-slate-800 rounded-xl p-4 space-y-4">
        {/* Primary: bus fader row */}
        <div className="overflow-x-auto">
          <div className="flex gap-4 min-w-max">
            {busRows.map(({ bus, busIdx, isMulti, allExcluded, displayGainDb, handleBusGainChange }) => (
              <BusChannel
                key={bus.name}
                name={bus.name}
                displayGainDb={displayGainDb}
                active={!allExcluded}
                canExpand={isMulti}
                expanded={expandedBusIdx === busIdx}
                onGainChange={handleBusGainChange}
                onToggleExpand={() => { setExpandedBusIdx(expandedBusIdx === busIdx ? null : busIdx); }}
              />
            ))}

            {/* Ungrouped stems shown as individual channels at the end */}
            {ungroupedStems.length > 0 && (
              <>
                {buses.length > 0 && (
                  <div className="w-px bg-slate-700 self-stretch mx-1" />
                )}
                {ungroupedStems.map((stem) => (
                  <StemChannel
                    key={stem.category}
                    category={stem.category}
                    offsetDb={stem.offsetDb}
                    effectiveDb={stem.effectiveDb}
                    busGain={0}
                    muted={stem.muted}
                    excluded={stem.excluded}
                    onGainChange={(db) => { setGain(stem.category, db); }}
                    onMuteToggle={() => { toggleMute(stem.category); }}
                    onExcludeToggle={() => { toggleExclude(stem.category); }}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Secondary: individual stem detail for expanded bus */}
        {expandedBus && (
          <div className="border-t border-slate-700 pt-4">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
              {expandedBus.bus.name} — individual stems
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {expandedBus.busStems.map((stem) => (
                <StemChannel
                  key={stem.category}
                  category={stem.category}
                  offsetDb={stem.offsetDb}
                  effectiveDb={stem.effectiveDb}
                  busGain={expandedBus.bus.gain_db}
                  muted={stem.muted}
                  excluded={stem.excluded}
                  onGainChange={(db) => { setGain(stem.category, db); }}
                  onMuteToggle={() => { toggleMute(stem.category); }}
                  onExcludeToggle={() => { toggleExclude(stem.category); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-600">
        {expandedBus
          ? `${expandedBus.bus.name}: click fader to set offset · click label to exclude/include · M to mute · ▴ to collapse`
          : 'Click fader to set group level · ▾ to show individual stems · Double-click preset to rename'}
      </p>
    </div>
  );
}
