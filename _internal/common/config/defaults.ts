import { type Config } from '../types.js';

export const BUILT_IN_DEFAULTS: Config = {
  normalize: false,
  target_lufs: -23,
  output_format: 'm4a',
  // No buses by default — default_mix.yaml and embedded-config supply them.
  buses: [],
  mixes: [],
};

export function mergeConfig(base: Config, override: Partial<Config>): Config {
  return {
    ...base,
    ...override,
    buses: override.buses ?? base.buses,
    stem_gains: { ...(base.stem_gains ?? {}), ...(override.stem_gains ?? {}) },
    // mixes replaces entirely when overridden — partial mix list merging is confusing
    mixes: override.mixes ?? base.mixes,
  };
}
