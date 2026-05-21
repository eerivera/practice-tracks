export type StemCategory =
  | 'click'
  | 'guide'
  | 'drums'
  | 'percussion'
  | 'bass'
  | 'synth_bass'
  | 'keys'
  | 'piano'
  | 'electric_guitar'
  | 'acoustic_guitar'
  | 'bgvs'
  | 'choir'
  | 'lead_vocals'
  | 'fx'
  | 'vox_fx'
  | 'unknown';

export interface StemRule {
  gain_db: number;
  mute?: boolean;
}

export interface MixDefinition {
  name: string;
  exclude?: StemCategory[];
  include_only?: StemCategory[];
  overrides?: Partial<Record<StemCategory, StemRule>>;
}

export interface Config {
  target_lufs: number;
  output_format: 'm4a' | 'mp3' | 'wav';
  // 0 or undefined → auto (backend.maxConcurrency, capped at 8 for native FFmpeg)
  normalization_concurrency?: number;
  track_rules: Partial<Record<StemCategory, StemRule>>;
  mixes: MixDefinition[];
}

export interface ClassifiedStem {
  path: string;
  filename: string;
  category: StemCategory;
  index?: number;
}

export interface MixInput {
  path: string;
  gainDb: number;
}
