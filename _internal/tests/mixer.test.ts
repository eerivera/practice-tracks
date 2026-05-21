import { describe, it, expect } from 'vitest';
import { buildMixInputs } from '../common/mixer.js';
import { type ClassifiedStem, type Config } from '../common/types.js';

const STEMS: ClassifiedStem[] = [
  { path: '/tmp/click.wav', filename: 'Click Track', category: 'click' },
  { path: '/tmp/guide.wav', filename: 'Guide', category: 'guide' },
  { path: '/tmp/drums.wav', filename: 'Drums', category: 'drums' },
  { path: '/tmp/bass.wav', filename: 'Bass', category: 'bass' },
];

const CONFIG: Config = {
  target_lufs: -14,
  output_format: 'm4a',
  track_rules: {
    click: { gain_db: -10 },
    guide: { gain_db: 2 },
    drums: { gain_db: 0 },
    bass: { gain_db: 0 },
  },
  mixes: [],
};

describe('buildMixInputs', () => {
  it('full mix includes all stems', () => {
    const inputs = buildMixInputs(STEMS, { name: 'full' }, CONFIG);
    expect(inputs).toHaveLength(4);
  });

  it('exclude removes the correct stems', () => {
    const inputs = buildMixInputs(STEMS, { name: 'no-click', exclude: ['click'] }, CONFIG);
    expect(inputs).toHaveLength(3);
    expect(inputs.every((i) => i.path !== '/tmp/click.wav')).toBe(true);
  });

  it('include_only keeps only the specified categories', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'drummer', include_only: ['click', 'drums'] },
      CONFIG
    );
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.path)).toContain('/tmp/click.wav');
    expect(inputs.map((i) => i.path)).toContain('/tmp/drums.wav');
  });

  it('applies base gain from track_rules', () => {
    const inputs = buildMixInputs(STEMS, { name: 'full' }, CONFIG);
    const click = inputs.find((i) => i.path === '/tmp/click.wav')!;
    expect(click.gainDb).toBe(-10);
    const guide = inputs.find((i) => i.path === '/tmp/guide.wav')!;
    expect(guide.gainDb).toBe(2);
  });

  it('mix-level override takes precedence over track_rules', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'custom', overrides: { guide: { gain_db: 10 } } },
      CONFIG
    );
    const guide = inputs.find((i) => i.path === '/tmp/guide.wav')!;
    expect(guide.gainDb).toBe(10);
  });

  it('muted stems get -120 dB gain', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'muted-click', overrides: { click: { gain_db: 0, mute: true } } },
      CONFIG
    );
    const click = inputs.find((i) => i.path === '/tmp/click.wav')!;
    expect(click.gainDb).toBe(-120);
  });

  it('returns empty array when include_only matches nothing', () => {
    const inputs = buildMixInputs(
      STEMS,
      { name: 'keys-only', include_only: ['keys'] },
      CONFIG
    );
    expect(inputs).toHaveLength(0);
  });

  it('falls back to 0 dB for categories not in track_rules', () => {
    const stemsWithUnknown: ClassifiedStem[] = [
      { path: '/tmp/mystery.wav', filename: 'Mystery', category: 'unknown' },
    ];
    const inputs = buildMixInputs(stemsWithUnknown, { name: 'full' }, {
      ...CONFIG,
      track_rules: {},
    });
    expect(inputs[0].gainDb).toBe(0);
  });
});
