import { type Config, type ClassifiedStem, type MixDefinition, type MixInput, type StemCategory } from './types.js';

/** Returns the bus gain for a category, or 0 if the category is not in any bus. */
function getBusGain(config: Config, category: StemCategory): number {
  if (!config.buses) return 0;
  return config.buses.find((b) => b.contains.includes(category))?.gain_db ?? 0;
}

export function buildMixInputs(
  stems: ClassifiedStem[],
  mixDef: MixDefinition,
  config: Config
): MixInput[] {
  const filtered = filterStems(stems, mixDef);

  return filtered.map((stem) => {
    const baseRule = config.track_rules[stem.category] ?? { gain_db: 0 };
    const override = mixDef.overrides?.[stem.category];
    // offset = mix override if present, else the category's track_rule.
    // With buses, this is always an offset relative to the bus level.
    const offset = override?.gain_db ?? baseRule.gain_db;
    const busGain = getBusGain(config, stem.category);
    const muted = override?.mute ?? baseRule.mute ?? false;
    return { path: stem.path, gainDb: muted ? -120 : busGain + offset };
  });
}

function filterStems(stems: ClassifiedStem[], mixDef: MixDefinition): ClassifiedStem[] {
  if (mixDef.include_only) {
    const includeOnly = mixDef.include_only;
    return stems.filter((s) => includeOnly.includes(s.category));
  }
  if (mixDef.exclude) {
    const exclude = mixDef.exclude;
    return stems.filter((s) => !exclude.includes(s.category));
  }
  return stems;
}
