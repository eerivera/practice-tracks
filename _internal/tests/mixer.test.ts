import { describe, it, expect } from 'vitest';
import { buildMixInputs, stemMatchesPattern, findStemBus } from '../common/mixer.js';
import { type StemFile, type Config } from '../common/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STEMS: StemFile[] = [
  { path: '/tmp/Click Track.wav', filename: 'Click Track' },
  { path: '/tmp/Guide.wav',       filename: 'Guide' },
  { path: '/tmp/Drums.wav',       filename: 'Drums' },
  { path: '/tmp/Bass.wav',        filename: 'Bass' },
  { path: '/tmp/EG 1.wav',        filename: 'EG 1' },
  { path: '/tmp/EG 2.wav',        filename: 'EG 2' },
  { path: '/tmp/EG 3.wav',        filename: 'EG 3' },
];

const CONFIG: Config = {
  target_lufs: -14,
  output_format: 'm4a',
  buses: [
    { name: 'Click', gain_db: 0,   contains: ['Click*'] },
    { name: 'Guide', gain_db: 0,   contains: ['Guide'] },
    { name: 'Drums', gain_db: 0,   contains: ['Drums*'] },
    { name: 'Bass',  gain_db: 0,   contains: ['Bass'] },
    { name: 'EG',    gain_db: 0,   contains: ['EG*'] },
  ],
  mixes: [],
};

// ── stemMatchesPattern ─────────────────────────────────────────────────────────

describe('stemMatchesPattern', () => {
  it('exact match is case-insensitive', () => {
    expect(stemMatchesPattern('Bass', 'Bass')).toBe(true);
    expect(stemMatchesPattern('bass', 'Bass')).toBe(true);
    expect(stemMatchesPattern('BASS', 'bass')).toBe(true);
  });

  it('exact match does not match prefix', () => {
    expect(stemMatchesPattern('Bass Lead', 'Bass')).toBe(false);
  });

  it('glob * matches prefix', () => {
    expect(stemMatchesPattern('EG 1', 'EG*')).toBe(true);
    expect(stemMatchesPattern('EG 2', 'EG*')).toBe(true);
    expect(stemMatchesPattern('EG 3', 'EG*')).toBe(true);
  });

  it('glob * is case-insensitive', () => {
    expect(stemMatchesPattern('eg 1', 'EG*')).toBe(true);
    expect(stemMatchesPattern('EG 1', 'eg*')).toBe(true);
  });

  it('glob * does not match unrelated names', () => {
    expect(stemMatchesPattern('Acoustic Guitar', 'EG*')).toBe(false);
  });

  it('glob * matches exact name (no suffix required)', () => {
    expect(stemMatchesPattern('Bass', 'Bass*')).toBe(true);
  });
});

// ── findStemBus ────────────────────────────────────────────────────────────────

describe('findStemBus', () => {
  it('finds the bus for a matching stem', () => {
    expect(findStemBus(CONFIG.buses, 'EG 1')?.name).toBe('EG');
    expect(findStemBus(CONFIG.buses, 'EG 2')?.name).toBe('EG');
    expect(findStemBus(CONFIG.buses, 'Bass')?.name).toBe('Bass');
  });

  it('returns undefined for an unmatched stem', () => {
    expect(findStemBus(CONFIG.buses, 'Synth Bass')).toBeUndefined();
  });
});

// ── buildMixInputs ─────────────────────────────────────────────────────────────

describe('buildMixInputs', () => {
  it('full mix includes all stems', () => {
    const inputs = buildMixInputs(STEMS, { name: 'full' }, CONFIG);
    expect(inputs).toHaveLength(STEMS.length);
  });

  it('unmatched stems are included at 0 dB', () => {
    const stems: StemFile[] = [{ path: '/tmp/X.wav', filename: 'Unknown Stem' }];
    const inputs = buildMixInputs(stems, { name: 'full' }, CONFIG);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].gainDb).toBe(0);
  });

  it('bus gain applies to all stems in that bus', () => {
    const config: Config = {
      ...CONFIG,
      buses: [
        ...CONFIG.buses.filter((b) => b.name !== 'EG'),
        { name: 'EG', gain_db: -3, contains: ['EG*'] },
      ],
    };
    const inputs = buildMixInputs(STEMS, { name: 'full' }, config);
    const eg1 = inputs.find((i) => i.path === '/tmp/EG 1.wav');
    const eg2 = inputs.find((i) => i.path === '/tmp/EG 2.wav');
    expect(eg1?.gainDb).toBe(-3);
    expect(eg2?.gainDb).toBe(-3);
  });

  it('per-mix bus_gains offsets on top of bus.gain_db', () => {
    const config: Config = {
      ...CONFIG,
      buses: CONFIG.buses.map((b) =>
        b.name === 'EG' ? { ...b, gain_db: -2 } : b
      ),
    };
    const inputs = buildMixInputs(
      STEMS,
      { name: 'test', bus_gains: { EG: 1 } },
      config
    );
    // bus.gain_db(-2) + mix.bus_gains.EG(1) = -1
    const eg1 = inputs.find((i) => i.path === '/tmp/EG 1.wav');
    expect(eg1?.gainDb).toBe(-1);
  });

  it('per-mix stem_gains applies to the specific stem', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'test', stem_gains: { 'EG 2': -6 } },
      CONFIG
    );
    const eg1 = inputs.find((i) => i.path === '/tmp/EG 1.wav');
    const eg2 = inputs.find((i) => i.path === '/tmp/EG 2.wav');
    // EG 1 has no per-stem override → 0
    expect(eg1?.gainDb).toBe(0);
    // EG 2 has -6 dB stem offset
    expect(eg2?.gainDb).toBe(-6);
  });

  it('global stem_gains used when no per-mix override', () => {
    const config: Config = {
      ...CONFIG,
      stem_gains: { 'EG 1': 3 },
    };
    const inputs = buildMixInputs(STEMS, { name: 'full' }, config);
    const eg1 = inputs.find((i) => i.path === '/tmp/EG 1.wav');
    expect(eg1?.gainDb).toBe(3);
  });

  it('per-mix stem_gains overrides global stem_gains', () => {
    const config: Config = {
      ...CONFIG,
      stem_gains: { 'EG 1': 3 },
    };
    const inputs = buildMixInputs(
      STEMS,
      { name: 'test', stem_gains: { 'EG 1': -2 } },
      config
    );
    const eg1 = inputs.find((i) => i.path === '/tmp/EG 1.wav');
    expect(eg1?.gainDb).toBe(-2);
  });

  it('all three layers stack: bus.gain_db + mix bus_gains + mix stem_gains', () => {
    const config: Config = {
      ...CONFIG,
      buses: CONFIG.buses.map((b) =>
        b.name === 'EG' ? { ...b, gain_db: 1 } : b
      ),
    };
    const inputs = buildMixInputs(
      STEMS,
      { name: 'test', bus_gains: { EG: 2 }, stem_gains: { 'EG 1': 3 } },
      config
    );
    // bus(1) + bus_offset(2) + stem_offset(3) = 6
    const eg1 = inputs.find((i) => i.path === '/tmp/EG 1.wav');
    expect(eg1?.gainDb).toBe(6);
    // EG 2 gets bus(1) + bus_offset(2) + 0 = 3
    const eg2 = inputs.find((i) => i.path === '/tmp/EG 2.wav');
    expect(eg2?.gainDb).toBe(3);
  });

  it('exclude by bus name removes all stems in that bus', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'no-click', exclude: ['Click'] },
      CONFIG
    );
    expect(inputs.every((i) => i.path !== '/tmp/Click Track.wav')).toBe(true);
    expect(inputs).toHaveLength(STEMS.length - 1);
  });

  it('include_only by bus name keeps only those buses', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'eg-only', include_only: ['EG'] },
      CONFIG
    );
    expect(inputs).toHaveLength(3); // EG 1, EG 2, EG 3
    expect(inputs.every((i) => i.path.includes('EG'))).toBe(true);
  });

  it('include_only matching nothing returns empty array', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'missing', include_only: ['Nonexistent'] },
      CONFIG
    );
    expect(inputs).toHaveLength(0);
  });

  it('unmatched stems pass through even with include_only (no bus = not filtered)', () => {
    // Stems with no bus are included by include_only when include_only is absent,
    // but excluded when include_only is set (they have no bus name to match).
    const stems: StemFile[] = [{ path: '/tmp/X.wav', filename: 'Unmatched' }];
    const inputs = buildMixInputs(stems, { name: 'eg-only', include_only: ['EG'] }, CONFIG);
    expect(inputs).toHaveLength(0);
  });
});
