import { describe, it, expect } from 'vitest';
import { mergeConfig } from '../src/config/loader.js';
import { type Config } from '../src/types.js';

const BASE: Config = {
  target_lufs: -14,
  output_format: 'm4a',
  track_rules: {
    click: { gain_db: -10 },
    guide: { gain_db: 2 },
    drums: { gain_db: 0 },
  },
  mixes: [{ name: 'full' }],
};

describe('mergeConfig', () => {
  it('overrides a single track rule without affecting others', () => {
    const result = mergeConfig(BASE, {
      track_rules: { click: { gain_db: -20 } },
    });
    expect(result.track_rules.click?.gain_db).toBe(-20);
    expect(result.track_rules.guide?.gain_db).toBe(2);
    expect(result.track_rules.drums?.gain_db).toBe(0);
  });

  it('overrides target_lufs', () => {
    const result = mergeConfig(BASE, { target_lufs: -16 });
    expect(result.target_lufs).toBe(-16);
  });

  it('overrides output_format', () => {
    const result = mergeConfig(BASE, { output_format: 'mp3' });
    expect(result.output_format).toBe('mp3');
  });

  it('replaces the full mixes list when overridden', () => {
    const result = mergeConfig(BASE, {
      mixes: [{ name: 'custom-mix', exclude: ['click'] }],
    });
    expect(result.mixes).toHaveLength(1);
    expect(result.mixes[0].name).toBe('custom-mix');
  });

  it('keeps base mixes when override has no mixes key', () => {
    const result = mergeConfig(BASE, { target_lufs: -16 });
    expect(result.mixes).toEqual(BASE.mixes);
  });

  it('does not mutate the base config', () => {
    mergeConfig(BASE, { track_rules: { click: { gain_db: -99 } } });
    expect(BASE.track_rules.click?.gain_db).toBe(-10);
  });
});
