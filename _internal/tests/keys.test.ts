import { describe, it, expect } from 'vitest';
import {
  ALL_KEYS,
  normalizeKey,
  semitonesBetween,
  semitonesFactor,
  buildTransposeFilter,
} from '../common/keys.js';

describe('normalizeKey', () => {
  it('passes through canonical sharp names', () => {
    for (const k of ALL_KEYS) {
      expect(normalizeKey(k)).toBe(k);
    }
  });

  it('normalises flat names to enharmonic sharps', () => {
    expect(normalizeKey('Bb')).toBe('A#');
    expect(normalizeKey('Eb')).toBe('D#');
    expect(normalizeKey('Ab')).toBe('G#');
    expect(normalizeKey('Db')).toBe('C#');
    expect(normalizeKey('Gb')).toBe('F#');
    expect(normalizeKey('Cb')).toBe('B');
    expect(normalizeKey('Fb')).toBe('E');
  });

  it('returns undefined for unrecognised input', () => {
    expect(normalizeKey('X')).toBeUndefined();
    expect(normalizeKey('')).toBeUndefined();
    expect(normalizeKey('H#')).toBeUndefined();
  });
});

describe('semitonesBetween', () => {
  it('returns 0 for same key', () => {
    expect(semitonesBetween('C', 'C')).toBe(0);
    expect(semitonesBetween('A#', 'A#')).toBe(0);
  });

  it('takes the shortest path (up or down)', () => {
    // C → G: 7 semitones up or 5 down → should return −5
    expect(semitonesBetween('C', 'G')).toBe(-5);
    // C → F: 5 up or 7 down → should return +5
    expect(semitonesBetween('C', 'F')).toBe(5);
    // C → D: 2 up or 10 down → should return +2
    expect(semitonesBetween('C', 'D')).toBe(2);
    // C → B: 11 up or 1 down → should return −1
    expect(semitonesBetween('C', 'B')).toBe(-1);
  });

  it('on exact tritone (6 semitones), goes up', () => {
    // C → F#: 6 up = 6 down → should prefer +6
    expect(semitonesBetween('C', 'F#')).toBe(6);
  });

  it('handles typical worship transpositions', () => {
    // G → Bb (A#): 3 semitones up
    expect(semitonesBetween('G', 'A#')).toBe(3);
    // A# → G: 3 semitones down
    expect(semitonesBetween('A#', 'G')).toBe(-3);
    // E → Ab (G#): 4 semitones up
    expect(semitonesBetween('E', 'G#')).toBe(4);
  });
});

describe('semitonesFactor', () => {
  it('returns 1.0 for 0 semitones', () => {
    expect(semitonesFactor(0)).toBeCloseTo(1.0);
  });

  it('returns ~1.059 for +1 semitone', () => {
    expect(semitonesFactor(1)).toBeCloseTo(1.0594630943592953, 6);
  });

  it('returns ~2.0 for +12 semitones (one octave up)', () => {
    expect(semitonesFactor(12)).toBeCloseTo(2.0, 5);
  });

  it('returns ~0.5 for −12 semitones (one octave down)', () => {
    expect(semitonesFactor(-12)).toBeCloseTo(0.5, 5);
  });
});

describe('buildTransposeFilter', () => {
  it('produces rubberband filter when useRubberband=true', () => {
    const f = buildTransposeFilter(2, true);
    expect(f).toMatch(/^rubberband=pitch=/);
    expect(f).not.toContain('asetrate');
  });

  it('produces asetrate chain when useRubberband=false', () => {
    const f = buildTransposeFilter(2, false);
    expect(f).toMatch(/^aresample=44100,asetrate=/);
    expect(f).toContain('atempo=');
    expect(f).not.toContain('rubberband');
  });

  it('asetrate chain starts at 44100 baseline regardless of semitone direction', () => {
    const up = buildTransposeFilter(3, false);
    const down = buildTransposeFilter(-3, false);
    expect(up).toMatch(/^aresample=44100,/);
    expect(down).toMatch(/^aresample=44100,/);
  });

  it('rubberband pitch factor matches 2^(semitones/12)', () => {
    const semitones = 3;
    const filter = buildTransposeFilter(semitones, true);
    const match = /rubberband=pitch=([0-9.]+)/.exec(filter);
    if (!match) throw new Error('rubberband filter did not match expected pattern');
    const factor = parseFloat(match[1]);
    expect(factor).toBeCloseTo(Math.pow(2, semitones / 12), 5);
  });

  it('0 semitones produces a valid (identity) filter', () => {
    const rb = buildTransposeFilter(0, true);
    const as = buildTransposeFilter(0, false);
    // rubberband: pitch=1.0
    expect(rb).toContain('rubberband=pitch=1.');
    // asetrate: rate=44100, atempo=1.0
    expect(as).toContain('asetrate=44100,');
    expect(as).toContain('atempo=1.');
  });
});
