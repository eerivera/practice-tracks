import type { Config } from '../types.js';

// Mirror of config/default_mix.yaml, bundled for the browser build where there
// is no filesystem to load YAML from at runtime.
//
// Bus contains entries use prefix glob patterns (ending with *) so they match
// numbered stems — e.g. "EG*" matches "EG 1", "EG 2", "EG 3" from the zip.
// Exact names (no *) are case-insensitive exact matches.
export const DEFAULT_CONFIG: Config = {
  normalize: false,
  normalization_concurrency: 0,
  target_lufs: -23,
  output_format: 'm4a',
  buses: [
    { name: 'Click',     gain_db: 0, contains: ['Click*'] },
    { name: 'Drums',     gain_db: 0, contains: ['Drums*'] },
    { name: 'Perc',      gain_db: 0, contains: ['Perc*'] },
    { name: 'Bass',      gain_db: 0, contains: ['Bass'] },
    { name: 'Synth Bass',gain_db: 0, contains: ['Synth Bass*'] },
    { name: 'Keys',      gain_db: 0, contains: ['Keys*'] },
    { name: 'Piano',     gain_db: 0, contains: ['Piano*'] },
    { name: 'Organ',     gain_db: 0, contains: ['Organ*'] },
    { name: 'EG',        gain_db: 0, contains: ['EG*'] },
    { name: 'AG',        gain_db: 0, contains: ['AG*'] },
    { name: 'Guide',     gain_db: 0, contains: ['Guide*'] },
    { name: 'Lead Vox',  gain_db: 0, contains: ['Lead*'] },
    { name: 'BGVs',      gain_db: 0, contains: ['BGV*'] },
    { name: 'Choir',     gain_db: 0, contains: ['Choir*'] },
    { name: 'Vox FX',    gain_db: 0, contains: ['Vox FX*'] },
    { name: 'FX',        gain_db: 0, contains: ['FX*'] },
  ],
  mixes: [
    { name: 'full' },
    { name: 'no-click', exclude: ['Click'] },
    { name: 'no-guide',  exclude: ['Guide'] },
    {
      name: 'drummer',
      include_only: ['Click', 'Drums', 'Perc', 'Bass', 'Synth Bass', 'Guide'],
      bus_gains: { Guide: -3 },
    },
    {
      name: 'vocalist',
      exclude: ['Click'],
      bus_gains: { Guide: 4, BGVs: 0, Choir: 0 },
    },
  ],
};
