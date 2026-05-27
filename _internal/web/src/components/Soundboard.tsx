import { useState, useRef } from 'react';
import type { Config, StemFile, MixDefinition, BusDefinition } from '../types.js';
import { findStemBus, stemMatchesPattern } from '@common/mixer.js';

interface Props {
  config: Config;
  stems: StemFile[];
  onChange: (config: Config) => void;
}

const MIN_DB = -40;
const MAX_DB = 6;
const MUTE_DB = -120;

function clampDb(db: number): number {
  return Math.round(Math.max(MIN_DB, Math.min(MAX_DB, db)));
}

function faderPct(db: number): number {
  return ((Math.max(MIN_DB, Math.min(MAX_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
}

function isMuted(db: number): boolean {
  return db <= MUTE_DB;
}

// Returns stems that belong to this bus.
function stemsForBus(stems: StemFile[], bus: BusDefinition): StemFile[] {
  return stems.filter((s) => bus.contains.some((pat) => stemMatchesPattern(s.filename, pat)));
}

// ── Shared fader track ────────────────────────────────────────────────────────

interface FaderTrackProps {
  gainDb: number;
  active: boolean;
  muted?: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  title?: string;
}

function FaderTrack({ gainDb, active, muted, onClick, title }: FaderTrackProps) {
  const pct = faderPct(gainDb);
  const zeroPct = faderPct(0);
  const barColor = muted ? 'bg-amber-600' : active ? 'bg-indigo-500' : 'bg-slate-600';
  return (
    <div
      className={`relative w-3 h-24 rounded-full cursor-pointer ${active ? 'bg-slate-700' : 'bg-slate-800'}`}
      onClick={onClick}
      title={title}
    >
      <div
        className={`absolute bottom-0 w-full rounded-full transition-none ${barColor}`}
        style={{ height: `${pct}%` }}
      />
      <div
        className="absolute w-5 h-px bg-slate-500 -left-1 pointer-events-none"
        style={{ bottom: `${zeroPct}%` }}
      />
    </div>
  );
}

// ── Gain display / edit widget ────────────────────────────────────────────────

interface GainLabelProps {
  gainDb: number;
  active: boolean;
  muted: boolean;
  excluded: boolean;
  onEdit: (val: number) => void;
}

function GainLabel({ gainDb, active, muted, excluded, onEdit }: GainLabelProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Synchronous flag set before blur() so onBlur can distinguish Escape from Enter/click-away.
  const escaping = useRef(false);

  function commit() {
    if (draft !== null && !escaping.current) {
      const n = parseFloat(draft);
      if (!isNaN(n)) onEdit(clampDb(n));
    }
    setDraft(null);
    escaping.current = false;
  }

  // Non-interactive labels for excluded/muted states.
  if (excluded) {
    return <span className="text-[11px] font-mono tabular-nums w-12 text-center text-slate-600">—</span>;
  }
  if (muted) {
    return <span className="text-[11px] font-mono tabular-nums w-12 text-center text-slate-600">M</span>;
  }

  // Active input — always rendered so Tab focuses it immediately without a prior click.
  // draft=null → show formatted gainDb; draft=string → show raw user input.
  const displayVal = draft ?? `${gainDb > 0 ? '+' : ''}${gainDb}`;

  return (
    <input
      type="text"
      className={`text-[11px] font-mono tabular-nums w-12 text-center rounded bg-transparent hover:bg-slate-700 focus:bg-slate-700 focus:outline-none cursor-default focus:cursor-text transition-colors ${active ? 'text-slate-300' : 'text-slate-600'}`}
      value={displayVal}
      onChange={(e) => { setDraft(e.target.value); }}
      onFocus={(e) => { setDraft(String(gainDb)); e.target.select(); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { escaping.current = true; e.currentTarget.blur(); }
      }}
      title="Click or tab to set gain (dB)"
    />
  );
}

// ── Bus channel ───────────────────────────────────────────────────────────────

interface BusChannelProps {
  name: string;
  displayGainDb: number;
  active: boolean;
  muted: boolean;
  canExpand: boolean;
  expanded: boolean;
  /** True when no actual stems in the current song match this bus. */
  unmatched: boolean;
  onGainChange: (db: number) => void;
  onMuteToggle: () => void;
  onToggleExpand: () => void;
}

function BusChannel({
  name, displayGainDb, active, muted, canExpand, expanded, unmatched,
  onGainChange, onMuteToggle, onToggleExpand,
}: BusChannelProps) {
  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (unmatched) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = 1 - (e.clientY - rect.top) / rect.height;
    onGainChange(clampDb(MIN_DB + pct * (MAX_DB - MIN_DB)));
  }

  return (
    <div className={`flex flex-col items-center gap-1.5 w-14 select-none ${unmatched ? 'opacity-40' : ''}`}>
      {/* Fixed-height zone above fader — same height regardless of matched/unmatched
          so all fader tracks start at the same vertical position. */}
      <div className="h-[22px] flex items-center justify-center w-full">
        {unmatched ? (
          <div
            className="text-[9px] text-amber-400 font-bold leading-none"
            title="No stems in this song match this bus. Check your bus config or stem filenames."
          >
            ⚠
          </div>
        ) : (
          <GainLabel
            gainDb={displayGainDb}
            active={active}
            muted={muted}
            excluded={false}
            onEdit={onGainChange}
          />
        )}
      </div>

      <FaderTrack
        gainDb={isMuted(displayGainDb) ? 0 : displayGainDb}
        active={active && !unmatched}
        muted={muted}
        onClick={handleTrackClick}
      />

      <span
        className={`text-[11px] text-center leading-tight w-14 break-words px-0.5 ${active && !unmatched ? 'text-slate-200' : 'text-slate-600'}`}
        title={unmatched ? 'No stems matched — see bus config' : undefined}
      >
        {name}
      </span>

      {/* Fixed-height mute slot — always the same height whether button is present or not */}
      <div className="h-5 flex items-center justify-center">
        {!unmatched && (
          <button
            className={`text-[10px] w-6 h-5 rounded font-bold transition-colors ${muted ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
            onClick={onMuteToggle}
            title={muted ? 'Unmute bus' : 'Mute bus'}
          >
            M
          </button>
        )}
      </div>

      {/* Fixed-height expand slot — always the same height whether button is present or not */}
      <div className="h-6 flex items-center justify-center">
        {canExpand && (
          <button
            onClick={onToggleExpand}
            className={`text-sm w-7 h-6 rounded transition-colors ${
              expanded ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
            title={expanded ? 'Collapse' : 'Show individual stems'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Stem channel ──────────────────────────────────────────────────────────────

interface StemChannelProps {
  filename: string;
  stemGainDb: number;    // mix.stem_gains[filename] ?? 0
  effectiveDb: number;   // bus (with mix offset) + stem gain
  busDisplayDb: number;  // just for tooltip context
  muted: boolean;
  excluded: boolean;
  onGainChange: (db: number) => void;
  onMuteToggle: () => void;
}

function StemChannel({ filename, stemGainDb, effectiveDb, busDisplayDb, muted, excluded, onGainChange, onMuteToggle }: StemChannelProps) {
  const active = !excluded && !muted;

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (excluded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = 1 - (e.clientY - rect.top) / rect.height;
    onGainChange(clampDb(MIN_DB + pct * (MAX_DB - MIN_DB)));
  }

  const busLabel = busDisplayDb !== 0 ? ` · bus: ${busDisplayDb > 0 ? '+' : ''}${busDisplayDb} dB` : '';
  const title = excluded ? undefined : `Offset from bus · effective: ${effectiveDb > 0 ? '+' : ''}${effectiveDb} dB${busLabel}`;

  return (
    <div className="flex flex-col items-center gap-1.5 w-14 select-none">
      <GainLabel
        gainDb={muted ? MUTE_DB : stemGainDb}
        active={active}
        muted={muted}
        excluded={excluded}
        onEdit={onGainChange}
      />

      <FaderTrack
        gainDb={muted ? 0 : stemGainDb}
        active={active}
        muted={muted}
        onClick={excluded ? () => {} : handleTrackClick}
        title={title}
      />

      <span
        className={`text-[11px] text-center leading-tight w-14 break-words px-0.5 ${active ? 'text-slate-300' : 'text-slate-600'}`}
        title={filename}
      >
        {filename}
      </span>

      {!excluded && (
        <button
          className={`text-[10px] w-6 h-5 rounded font-bold transition-colors ${muted ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          onClick={onMuteToggle}
          title={muted ? 'Unmute stem' : 'Mute stem'}
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

  // Renaming: inline input inside the active-tab shell.
  if (renaming) {
    return (
      <div className="shrink-0 relative -mb-px flex items-center px-3 py-1.5 rounded-t-lg bg-slate-800 border border-slate-700 border-b-slate-800">
        <input
          autoFocus
          className="w-24 bg-transparent text-sm font-medium text-white focus:outline-none"
          value={val}
          onChange={(e) => { setVal(e.target.value); }}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
        />
      </div>
    );
  }

  // Active tab: -mb-px covers the strip's border-b so the tab reads as
  // connected to the fader panel below.
  if (selected) {
    return (
      <div className="shrink-0 relative -mb-px flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg bg-slate-800 border border-slate-700 border-b-slate-800">
        <button
          onClick={onSelect}
          onDoubleClick={() => { setVal(name); setRenaming(true); }}
          className="text-sm font-medium text-white"
          title="Double-click to rename"
        >
          {name}
        </button>
        {removable && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-slate-500 hover:text-slate-200 text-xs leading-none transition-colors"
            title="Remove mix"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  // Inactive tab — border on top/left/right only; border-b-0 lets the
  // strip's bottom border show through.
  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg border border-slate-700/60 border-b-0 bg-slate-800/30 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer transition-colors"
      onClick={onSelect}
      onDoubleClick={() => { setVal(name); setRenaming(true); }}
      title="Double-click to rename"
    >
      <span className="text-sm font-medium">{name}</span>
      {removable && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-slate-600 hover:text-red-400 text-xs leading-none transition-colors"
          title="Remove mix"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Main Soundboard ───────────────────────────────────────────────────────────

export function Soundboard({ config, stems, onChange }: Props) {
  const [selected, setSelected] = useState(0);
  const [expandedBusIdx, setExpandedBusIdx] = useState<number | null>(null);
  const mix = config.mixes[selected] as MixDefinition | undefined;

  // ── Mix mutations ─────────────────────────────────────────────────────────

  function updateMix(index: number, updater: (m: MixDefinition) => MixDefinition) {
    const mixes = config.mixes.map((m, i) => i === index ? updater(m) : m);
    onChange({ ...config, mixes });
  }

  function setBusGainForMix(busName: string, db: number) {
    updateMix(selected, (m) => ({
      ...m,
      bus_gains: { ...m.bus_gains, [busName]: db },
    }));
  }

  function setStemGainForMix(filename: string, db: number) {
    updateMix(selected, (m) => ({
      ...m,
      stem_gains: { ...m.stem_gains, [filename]: db },
    }));
  }

  function toggleBusMute(busName: string, currentGain: number) {
    const alreadyMuted = isMuted(currentGain);
    // When muting: store current gain in a side-channel so we can restore it.
    // We use a convention: gain -120 = muted; restoration recalculates from stored value.
    // For simplicity, unmute restores to 0 (the user can re-set if needed).
    setBusGainForMix(busName, alreadyMuted ? 0 : MUTE_DB);
  }

  function toggleStemMute(filename: string, currentGain: number) {
    const alreadyMuted = isMuted(currentGain);
    setStemGainForMix(filename, alreadyMuted ? 0 : MUTE_DB);
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

  // ── Per-bus computed layout ───────────────────────────────────────────────

  const busRows = config.buses.map((bus, busIdx) => {
    const busStems = stemsForBus(stems, bus);
    const unmatched = busStems.length === 0;
    const canExpand = busStems.length > 1;

    const busName = bus.name;
    const mixBusOffset = mix?.bus_gains?.[busName] ?? 0;
    const displayGainDb = bus.gain_db + mixBusOffset;
    const muted = isMuted(displayGainDb);

    const allExcluded = !unmatched && mix != null && (
      (mix.include_only != null && !mix.include_only.includes(busName)) ||
      (mix.exclude?.includes(busName) === true)
    );

    const stemRows = busStems.map((stem) => {
      const stemMixGain = mix?.stem_gains?.[stem.filename];
      const stemGlobalGain = config.stem_gains?.[stem.filename] ?? 0;
      const stemGainDb = stemMixGain ?? stemGlobalGain;
      const effectiveDb = displayGainDb + stemGainDb;
      const stemMuted = isMuted(stemGainDb) || muted;
      return { stem, stemGainDb, effectiveDb, stemMuted };
    });

    return { bus, busIdx, busStems, unmatched, canExpand, displayGainDb, muted, allExcluded, stemRows };
  });

  const expandedBus = expandedBusIdx !== null ? busRows[expandedBusIdx] : null;

  // Stems not matched by any bus — shown flat with a warning.
  const unmatchedStems = stems.filter((s) => !findStemBus(config.buses, s.filename));

  return (
    <div>
      {/* Mix tabs strip.
          Outer wrapper: border-b + items-end alignment; no overflow set here so the
          "+ Add mix" button is always visible and never scrolls away.
          Inner scrollable: overflow-x-auto + [overflow-y:clip] (CSS spec only converts
          'visible→auto', not 'clip', so y stays clipped while x scrolls).
          pb-[2px] -mb-[2px]: gives the active tab's -mb-px 2 px of headroom inside the
          clip boundary so it renders above the border without any gap.
          Each tab is shrink-0 to prevent compression; flex-1 min-w-0 lets the inner
          div shrink and scroll rather than pushing the button off-screen. */}
      <div className="flex items-end gap-0.5 border-b border-slate-700">
        <div className="flex items-end gap-0.5 overflow-x-auto [overflow-y:clip] pb-[2px] -mb-[2px] flex-1 min-w-0">
          {config.mixes.map((m, i) => (
            <MixTab
              key={i}
              name={m.name}
              selected={i === selected}
              onSelect={() => { setSelected(i); setExpandedBusIdx(null); }}
              onRename={(name) => { renameMix(i, name); }}
              onRemove={() => { removeMix(i); }}
              removable={config.mixes.length > 1}
            />
          ))}
        </div>
        <button
          onClick={addMix}
          className="shrink-0 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          + Add mix
        </button>
      </div>

      {/* Fader panel — rounded bottom only so it reads as a single unit with the tab strip */}
      <div className="bg-slate-800 rounded-b-xl p-4 space-y-4">
        {/* Primary row: one channel per bus */}
        <div className="overflow-x-auto">
          <div className="flex gap-4 min-w-max items-start">
            {busRows.map(({ bus, busIdx, unmatched, canExpand, displayGainDb, muted, allExcluded }) => (
              <BusChannel
                key={bus.name}
                name={bus.name}
                displayGainDb={displayGainDb}
                active={!allExcluded && !unmatched}
                muted={muted}
                canExpand={canExpand}
                expanded={expandedBusIdx === busIdx}
                unmatched={unmatched}
                onGainChange={(db) => { setBusGainForMix(bus.name, db - bus.gain_db); }}
                onMuteToggle={() => { toggleBusMute(bus.name, displayGainDb); }}
                onToggleExpand={() => { setExpandedBusIdx(expandedBusIdx === busIdx ? null : busIdx); }}
              />
            ))}

            {/* Unmatched stems — shown flat with amber warning */}
            {unmatchedStems.length > 0 && (
              <>
                {config.buses.length > 0 && (
                  <div className="w-px bg-slate-700 self-stretch mx-1" />
                )}
                {unmatchedStems.map((stem) => {
                  const stemMixGain = mix?.stem_gains?.[stem.filename] ?? 0;
                  const stemMuted = isMuted(stemMixGain);
                  return (
                    <div key={stem.filename} className="flex flex-col items-center gap-1.5 w-14 select-none">
                      {/* Fixed-height pre-fader zone — matches BusChannel for row alignment */}
                      <div className="h-[22px] flex items-center justify-center w-full gap-1">
                        <span className="text-[9px] text-amber-400 font-bold leading-none" title="Not assigned to any bus">⚠</span>
                        <GainLabel
                          gainDb={stemMixGain}
                          active={!stemMuted}
                          muted={stemMuted}
                          excluded={false}
                          onEdit={(db) => { setStemGainForMix(stem.filename, db); }}
                        />
                      </div>
                      <FaderTrack
                        gainDb={stemMuted ? 0 : stemMixGain}
                        active={!stemMuted}
                        muted={stemMuted}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pct = 1 - (e.clientY - rect.top) / rect.height;
                          setStemGainForMix(stem.filename, clampDb(MIN_DB + pct * (MAX_DB - MIN_DB)));
                        }}
                      />
                      <span className="text-[11px] text-amber-500 text-center leading-tight w-14 break-words px-0.5" title="Not assigned to any bus">
                        {stem.filename}
                      </span>
                      {/* Fixed-height mute slot */}
                      <div className="h-5 flex items-center justify-center">
                        <button
                          className={`text-[10px] w-6 h-5 rounded font-bold transition-colors ${stemMuted ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                          onClick={() => { toggleStemMute(stem.filename, stemMixGain); }}
                          title={stemMuted ? 'Unmute' : 'Mute'}
                        >
                          M
                        </button>
                      </div>
                      {/* Fixed-height expand slot (empty — unmatched stems can't expand) */}
                      <div className="h-6" />
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Expanded stem detail panel */}
        {expandedBus && (
          <div className="border-t border-slate-700 pt-4">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
              {expandedBus.bus.name} — individual stems
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {expandedBus.stemRows.map(({ stem, stemGainDb, effectiveDb, stemMuted }) => (
                <StemChannel
                  key={stem.filename}
                  filename={stem.filename}
                  stemGainDb={stemGainDb}
                  effectiveDb={effectiveDb}
                  busDisplayDb={expandedBus.displayGainDb}
                  muted={stemMuted}
                  excluded={false}
                  onGainChange={(db) => { setStemGainForMix(stem.filename, db); }}
                  onMuteToggle={() => { toggleStemMute(stem.filename, stemGainDb); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-600">
        {expandedBus
          ? `${expandedBus.bus.name}: fader = offset from bus · ▲ to collapse`
          : 'Bus fader = gain for all stems in that bus · ▼ to see individual stems · Double-click tab to rename'}
      </p>
    </div>
  );
}
