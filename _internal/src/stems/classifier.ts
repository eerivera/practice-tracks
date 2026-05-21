import path from 'path';
import { type StemCategory, type ClassifiedStem } from '../types.js';

// Order matters: more specific patterns must come before general ones.
// e.g. synth_bass before bass, vox_fx before fx
const STEM_PATTERNS: Array<[RegExp, StemCategory]> = [
  [/click/i, 'click'],
  [/guide/i, 'guide'],
  [/synth[\s_-]*bass/i, 'synth_bass'],
  [/vox[\s_-]*fx/i, 'vox_fx'],
  [/\bdrums?\b/i, 'drums'],
  [/\bperc\b/i, 'percussion'],
  [/\bbass\b/i, 'bass'],
  [/\bchoir\b/i, 'choir'],
  [/\bbgvs?\b/i, 'bgvs'],
  [/\bkeys?\b/i, 'keys'],
  [/\bpiano\b/i, 'piano'],
  [/\beg\b/i, 'electric_guitar'],
  [/\bag\b/i, 'acoustic_guitar'],
  [/\bfx\b/i, 'fx'],
  [/lead[\s_-]*vox|lead[\s_-]*vocals?/i, 'lead_vocals'],
];

const NUMBER_SUFFIX_RE = /[\s_-](\d+)(?:\s*\(.*\))?$/;

export function classifyStem(filePath: string): ClassifiedStem {
  const filename = path.basename(filePath, path.extname(filePath));

  let category: StemCategory = 'unknown';
  for (const [pattern, cat] of STEM_PATTERNS) {
    if (pattern.test(filename)) {
      category = cat;
      break;
    }
  }

  const numberMatch = NUMBER_SUFFIX_RE.exec(filename);
  const index = numberMatch ? parseInt(numberMatch[1], 10) : undefined;

  return { path: filePath, filename, category, index };
}

export function classifyStems(filePaths: string[]): ClassifiedStem[] {
  return filePaths.map(classifyStem);
}
