import { describe, it, expect } from 'vitest';
import { mergeConfig } from '../common/config/defaults.js';
import { type Config } from '../common/types.js';

const BASE: Config = {
  target_lufs: -14,
  output_format: 'm4a',
  buses: [
    { name: 'Click', gain_db: 0, contains: ['Click*'] },
    { name: 'Guide', gain_db: 0, contains: ['Guide'] },
  ],
  stem_gains: { 'EG 1': -2 },
  mixes: [{ name: 'full' }],
};

describe('mergeConfig', () => {
  it('overrides target_lufs', () => {
    const result = mergeConfig(BASE, { target_lufs: -16 });
    expect(result.target_lufs).toBe(-16);
  });

  it('overrides output_format', () => {
    const result = mergeConfig(BASE, { output_format: 'mp3' });
    expect(result.output_format).toBe('mp3');
  });

  it('replaces buses entirely when overridden', () => {
    const result = mergeConfig(BASE, {
      buses: [{ name: 'EG', gain_db: 0, contains: ['EG*'] }],
    });
    expect(result.buses).toHaveLength(1);
    expect(result.buses[0].name).toBe('EG');
  });

  it('keeps base buses when override has no buses key', () => {
    const result = mergeConfig(BASE, { target_lufs: -16 });
    expect(result.buses).toEqual(BASE.buses);
  });

  it('merges stem_gains (override adds / overwrites keys, keeps others)', () => {
    const result = mergeConfig(BASE, { stem_gains: { 'EG 2': -4, 'EG 1': -6 } });
    expect(result.stem_gains?.['EG 1']).toBe(-6); // overridden
    expect(result.stem_gains?.['EG 2']).toBe(-4); // new
  });

  it('replaces the full mixes list when overridden', () => {
    const result = mergeConfig(BASE, {
      mixes: [{ name: 'custom-mix', exclude: ['Click'] }],
    });
    expect(result.mixes).toHaveLength(1);
    expect(result.mixes[0].name).toBe('custom-mix');
  });

  it('keeps base mixes when override has no mixes key', () => {
    const result = mergeConfig(BASE, { target_lufs: -16 });
    expect(result.mixes).toEqual(BASE.mixes);
  });

  it('does not mutate the base config', () => {
    mergeConfig(BASE, { stem_gains: { 'EG 1': -99 } });
    expect(BASE.stem_gains?.['EG 1']).toBe(-2);
  });
});
