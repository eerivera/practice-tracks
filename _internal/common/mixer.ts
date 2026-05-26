import { type Config, type StemFile, type BusDefinition, type MixDefinition, type MixInput } from './types.js';

// Returns true if `filename` matches a bus contains entry.
// Entries ending with '*' are prefix patterns (case-insensitive).
// All other entries are exact matches (case-insensitive).
export function stemMatchesPattern(filename: string, pattern: string): boolean {
  const f = filename.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith('*') ? f.startsWith(p.slice(0, -1)) : f === p;
}

// Finds the first bus whose contains list matches the given filename.
export function findStemBus(buses: BusDefinition[], filename: string): BusDefinition | undefined {
  return buses.find((b) => b.contains.some((pat) => stemMatchesPattern(filename, pat)));
}

export function buildMixInputs(
  stems: StemFile[],
  mixDef: MixDefinition,
  config: Config
): MixInput[] {
  return stems.flatMap((stem) => {
    const bus = findStemBus(config.buses, stem.filename);
    const busName = bus?.name;

    // include_only / exclude operate on bus names.
    if (mixDef.include_only) {
      if (!busName || !mixDef.include_only.includes(busName)) return [];
    }
    if (mixDef.exclude && busName && mixDef.exclude.includes(busName)) return [];

    // Effective gain = base bus gain + per-mix bus offset + per-mix stem offset
    // (falling back to global stem_gains, then 0).
    const baseBusGain = bus?.gain_db ?? 0;
    const mixBusOffset = busName ? (mixDef.bus_gains?.[busName] ?? 0) : 0;
    const stemOffset =
      mixDef.stem_gains?.[stem.filename] ??
      config.stem_gains?.[stem.filename] ??
      0;

    return [{ path: stem.path, gainDb: baseBusGain + mixBusOffset + stemOffset }];
  });
}
