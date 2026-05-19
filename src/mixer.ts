import { type Config, type ClassifiedStem, type MixDefinition, type MixInput } from './types.js';

export function buildMixInputs(
  stems: ClassifiedStem[],
  mixDef: MixDefinition,
  config: Config
): MixInput[] {
  const filtered = filterStems(stems, mixDef);

  return filtered.map((stem) => {
    const baseRule = config.track_rules[stem.category] ?? { gain_db: 0 };
    const override = mixDef.overrides?.[stem.category];
    const gainDb = override?.gain_db ?? baseRule.gain_db;
    const muted = override?.mute ?? baseRule.mute ?? false;
    return { path: stem.path, gainDb: muted ? -120 : gainDb };
  });
}

function filterStems(stems: ClassifiedStem[], mixDef: MixDefinition): ClassifiedStem[] {
  if (mixDef.include_only) {
    return stems.filter((s) => mixDef.include_only!.includes(s.category));
  }
  if (mixDef.exclude) {
    return stems.filter((s) => !mixDef.exclude!.includes(s.category));
  }
  return stems;
}
