import type { Config } from '../types.js';

// Mirror of config/default_mix.yaml, bundled for the browser build where there
// is no filesystem to load YAML from at runtime.
export const DEFAULT_CONFIG: Config = {
  normalize: false,
  normalization_concurrency: 0,
  target_lufs: -23,
  output_format: 'm4a',
  buses: [
    { name: 'Click',        gain_db: 0, contains: ['click'] },
    { name: 'Drums & Perc', gain_db: 0, contains: ['drums', 'percussion'] },
    { name: 'Bass',         gain_db: 0, contains: ['bass', 'synth_bass'] },
    { name: 'Keys',         gain_db: 0, contains: ['keys', 'piano', 'organ'] },
    { name: 'Guitar',       gain_db: 0, contains: ['electric_guitar', 'acoustic_guitar'] },
    { name: 'Vocals',       gain_db: 0, contains: ['guide', 'lead_vocals', 'bgvs', 'choir'] },
    { name: 'FX',           gain_db: 0, contains: ['fx', 'vox_fx'] },
  ],
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
