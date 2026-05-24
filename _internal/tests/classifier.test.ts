import { describe, it, expect } from 'vitest';
import { classifyStem, classifyStems } from '../common/stems/classifier.js';

describe('classifyStem', () => {
  it('classifies "Click Track" as click', () => {
    expect(classifyStem('/path/Click Track.m4a').category).toBe('click');
  });

  it('classifies "Guide" as guide', () => {
    expect(classifyStem('/path/Guide.m4a').category).toBe('guide');
  });

  it('classifies "Drums (Live)" as drums', () => {
    expect(classifyStem('/path/Drums (Live).m4a').category).toBe('drums');
  });

  it('classifies "BGVS" as bgvs', () => {
    expect(classifyStem('/path/BGVS.m4a').category).toBe('bgvs');
  });

  it('classifies "Choir" as choir', () => {
    expect(classifyStem('/path/Choir.m4a').category).toBe('choir');
  });

  it('classifies "Bass" as bass', () => {
    expect(classifyStem('/path/Bass.m4a').category).toBe('bass');
  });

  it('classifies "Synth Bass" as synth_bass (not bass)', () => {
    expect(classifyStem('/path/Synth Bass.m4a').category).toBe('synth_bass');
  });

  it('classifies "Vox FX" as vox_fx (not fx)', () => {
    expect(classifyStem('/path/Vox FX.m4a').category).toBe('vox_fx');
  });

  it('classifies "FX" as fx', () => {
    expect(classifyStem('/path/FX.m4a').category).toBe('fx');
  });

  it('classifies "Perc" as percussion', () => {
    expect(classifyStem('/path/Perc.m4a').category).toBe('percussion');
  });

  it('classifies "AG" as acoustic_guitar', () => {
    expect(classifyStem('/path/AG.m4a').category).toBe('acoustic_guitar');
  });

  it('classifies "EG 1" as electric_guitar with index 1', () => {
    const result = classifyStem('/path/EG 1.m4a');
    expect(result.category).toBe('electric_guitar');
    expect(result.index).toBe(1);
  });

  it('classifies "Keys 3" as keys with index 3', () => {
    const result = classifyStem('/path/Keys 3.m4a');
    expect(result.category).toBe('keys');
    expect(result.index).toBe(3);
  });

  it('classifies "Piano 2" as piano with index 2', () => {
    const result = classifyStem('/path/Piano 2.m4a');
    expect(result.category).toBe('piano');
    expect(result.index).toBe(2);
  });

  it('classifies "Piano" as piano with no index', () => {
    const result = classifyStem('/path/Piano.m4a');
    expect(result.category).toBe('piano');
    expect(result.index).toBeUndefined();
  });

  it('classifies "Organ" as organ', () => {
    expect(classifyStem('/path/Organ.m4a').category).toBe('organ');
  });

  it('classifies "Organ 2" as organ with index 2', () => {
    const result = classifyStem('/path/Organ 2.m4a');
    expect(result.category).toBe('organ');
    expect(result.index).toBe(2);
  });

  it('classifies unknown stems as unknown', () => {
    expect(classifyStem('/path/Ambience.m4a').category).toBe('unknown');
  });

  it('preserves the filename without extension', () => {
    const result = classifyStem('/some/dir/Click Track.m4a');
    expect(result.filename).toBe('Click Track');
  });
});

describe('classifyStems', () => {
  it('classifies an array of paths', () => {
    const results = classifyStems([
      '/path/Click Track.m4a',
      '/path/Guide.m4a',
      '/path/Drums (Live).m4a',
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].category).toBe('click');
    expect(results[1].category).toBe('guide');
    expect(results[2].category).toBe('drums');
  });
});
