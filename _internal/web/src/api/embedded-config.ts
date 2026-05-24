import type { Config } from '../types.js';

// Mirror of config/default_mix.yaml, bundled for the browser build where there
// is no filesystem to load YAML from at runtime.
export const DEFAULT_CONFIG: Config = {
  normalize: false,
  normalization_concurrency: 0,
  target_lufs: -23,
  output_format: 'm4a',
  // No buses by default — each category in track_rules is its own channel.
  // Numbered stems (EG 1/2/3, Keys 1–5, Piano/Piano 2) are all controlled
  // by their single category fader. Add buses here to group categories together.
  buses: [],
  track_rules: {
    click:           { gain_db: -10 },
    guide:           { gain_db:   2 },
    drums:           { gain_db:   0 },
    percussion:      { gain_db:  -2 },
    bass:            { gain_db:   0 },
    synth_bass:      { gain_db:  -2 },
    keys:            { gain_db:  -3 },
    piano:           { gain_db:  -3 },
    organ:           { gain_db:  -3 },
    electric_guitar: { gain_db:  -4 },
    acoustic_guitar: { gain_db:  -4 },
    bgvs:            { gain_db:  -6 },
    choir:           { gain_db:  -6 },
    lead_vocals:     { gain_db:   0 },
    fx:              { gain_db:  -6 },
    vox_fx:          { gain_db:  -8 },
    unknown:         { gain_db:   0 },
  },
  mixes: [
    { name: 'full' },
    { name: 'no-click', exclude: ['click'] },
    { name: 'no-guide', exclude: ['guide'] },
    {
      name: 'drummer',
      include_only: ['click', 'drums', 'percussion', 'bass', 'synth_bass', 'guide'],
      overrides: { guide: { gain_db: -3 } },
    },
    {
      name: 'vocalist',
      exclude: ['click'],
      overrides: { guide: { gain_db: 4 }, bgvs: { gain_db: 0 }, choir: { gain_db: 0 } },
    },
  ],
};
