/**
 * Key-name utilities for transposition.
 *
 * Internally, all keys are represented as semitone indices 0–11 using sharps
 * (C=0, C#=1, D=2, …, B=11).  Flat names are normalised to their sharp
 * enharmonic equivalent before arithmetic, so Bb ↔ A# ↔ 10.
 */

/** Canonical key name ordering (sharps). */
export const ALL_KEYS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export type KeyName = (typeof ALL_KEYS)[number];

/** Flat → sharp enharmonic map (only the non-trivially-named flats). */
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

/**
 * Normalise any key name string to a canonical sharp-only KeyName.
 * Case-insensitive for the letter; accidental must be exactly '#' or 'b'.
 * Returns undefined when the input cannot be parsed.
 */
export function normalizeKey(raw: string): KeyName | undefined {
  // Capitalise first letter, leave rest as-is.
  const s = raw.charAt(0).toUpperCase() + raw.slice(1);
  // Resolve flat to sharp enharmonic.
  const resolved = FLAT_TO_SHARP[s] ?? s;
  return ALL_KEYS.includes(resolved as KeyName) ? (resolved as KeyName) : undefined;
}

/**
 * Return the number of semitones needed to move from `from` to `to`, choosing
 * the shortest path (≤ 6 semitones; negative = down, positive = up).
 *
 * E.g. semitonesBetween('C', 'G') → +7 (shortest path up)
 *      semitonesBetween('C', 'G') uses +7 going up but −5 going down; −5 wins.
 *      Actually: C→G = 7 up, 5 down → returns −5.
 */
export function semitonesBetween(from: KeyName, to: KeyName): number {
  const fromIdx = ALL_KEYS.indexOf(from);
  const toIdx = ALL_KEYS.indexOf(to);
  const up = ((toIdx - fromIdx) + 12) % 12; // 0..11 semitones upward
  const down = up === 0 ? 0 : 12 - up;      // 0..12 semitones downward
  // Prefer the shorter direction; on an exact tritone (6), go up.
  return down < up ? -down : up;
}

/**
 * Return the pitch-shift factor (multiplier relative to 1.0) for the given
 * semitone offset.  Used to build the FFmpeg asetrate argument.
 *
 * factor = 2^(semitones / 12)
 */
export function semitonesFactor(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

// ── Shared FFmpeg filter builders ─────────────────────────────────────────────
//
// Both NativeFFmpegBackend and WasmFFmpegBackend use identical filter strings.
// Only the mechanism for probing rubberband availability differs between backends.
// Keeping construction here avoids duplication across backends and makes PR 2
// (rubberband in WASM) a pure add — just switch useRubberband to true.

/**
 * Build the FFmpeg `-af` filter string for pitch transposition.
 *
 * rubberband=pitch=<factor>
 *   – High quality, phase-coherent.  Requires --enable-librubberband build flag.
 *   – Same filter syntax for native and WASM FFmpeg builds.
 *
 * aresample=44100,asetrate=<44100*factor>,aresample=44100,atempo=<1/factor>
 *   – Works with any FFmpeg, no extra build deps.
 *   – aresample before asetrate normalises the input sample rate so the factor
 *     calculation is always relative to 44100 Hz regardless of the source file.
 *   – Second aresample restores the correct sample rate after asetrate changes it.
 *   – atempo corrects playback speed; clamped to [0.5, 2.0] by FFmpeg, but
 *     all practical worship transpositions (≤ 6 semitones ≈ factor 1.41) are fine.
 */
export function buildTransposeFilter(semitones: number, useRubberband: boolean): string {
  const factor = semitonesFactor(semitones);
  if (useRubberband) {
    return `rubberband=pitch=${factor.toFixed(8)}`;
  }
  // aresample before asetrate ensures we always work from 44100 Hz baseline.
  const newRate = Math.round(44100 * factor);
  const tempo = (1 / factor).toFixed(8);
  return `aresample=44100,asetrate=${newRate},aresample=44100,atempo=${tempo}`;
}
