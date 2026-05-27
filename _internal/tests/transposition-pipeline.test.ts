import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AudioBackend, MixInput, NormalizeOptions, TransposeOptions } from '../common/types.js';
import type { ProgressEvent } from '../common/events.js';

const { fakeBackend } = vi.hoisted(() => {
  const backend: AudioBackend = {
    maxConcurrency: 1,
    normalize(inputPath: string, outputPath: string, _options: NormalizeOptions): Promise<void> {
      fs.copyFileSync(inputPath, outputPath);
      return Promise.resolve();
    },
    mix(_inputs: MixInput[], outputPath: string, _format: string): Promise<void> {
      fs.writeFileSync(outputPath, 'mixed');
      return Promise.resolve();
    },
    transpose(inputPath: string, outputPath: string, _options: TransposeOptions): Promise<void> {
      fs.copyFileSync(inputPath, outputPath);
      return Promise.resolve();
    },
    transposeMethod(): Promise<'asetrate'> {
      return Promise.resolve('asetrate');
    },
    supportsTranspose(): boolean {
      return true;
    },
  };
  return { fakeBackend: backend };
});

vi.mock('../src/backend/factory.js', () => ({
  createBackend: vi.fn(() => Promise.resolve(fakeBackend)),
}));

const { runPipeline } = await import('../src/pipeline.js');

function minimalConfig(): string {
  return [
    'normalize: false',
    'target_lufs: -23',
    'output_format: wav',
    'buses:',
    '  - name: Band',
    '    gain_db: 0',
    '    contains:',
    '      - stem',
    'mixes:',
    '  - name: full',
    '',
  ].join('\n');
}

function collectEvents(events: ProgressEvent[]) {
  return (event: ProgressEvent) => { events.push(event); };
}

describe('transposition pipeline output routing', () => {
  let tmpRoot: string;
  let logicalSongDir: string;
  let physicalSongDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-xpose-test-'));
    logicalSongDir = path.join(tmpRoot, 'songs', 'Test Song-C-100.00bpm');
    physicalSongDir = path.join(tmpRoot, 'songs', 'Test Song', 'C-100bpm');
    const stemsDir = path.join(physicalSongDir, 'stems');
    fs.mkdirSync(stemsDir, { recursive: true });
    fs.writeFileSync(path.join(stemsDir, 'stem.wav'), Buffer.alloc(44));
    fs.writeFileSync(path.join(physicalSongDir, 'mix.yaml'), minimalConfig());
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does not let original-key output skip a different target-key mix', async () => {
    const originalOutputDir = path.join(physicalSongDir, 'output');
    fs.mkdirSync(originalOutputDir, { recursive: true });
    fs.writeFileSync(path.join(originalOutputDir, 'Test Song - full.wav'), 'original');

    const events: ProgressEvent[] = [];
    const result = await runPipeline(
      { songDir: logicalSongDir, targetKey: 'D' },
      collectEvents(events)
    );

    const targetOutputDir = path.join(tmpRoot, 'songs', 'Test Song', 'D-100bpm', 'output');
    expect(result.skipped).toBe(false);
    expect(result.outputDir).toBe(targetOutputDir);
    expect(fs.existsSync(path.join(targetOutputDir, 'Test Song - full.wav'))).toBe(true);
    expect(events.some((event) => event.type === 'skip')).toBe(false);
  });

  it('skips a target-key mix when that target output already exists', async () => {
    const targetOutputDir = path.join(tmpRoot, 'songs', 'Test Song', 'D-100bpm', 'output');
    fs.mkdirSync(targetOutputDir, { recursive: true });
    fs.writeFileSync(path.join(targetOutputDir, 'Test Song - full.wav'), 'existing target');

    const events: ProgressEvent[] = [];
    const result = await runPipeline(
      { songDir: logicalSongDir, targetKey: 'D' },
      collectEvents(events)
    );

    expect(result.skipped).toBe(true);
    expect(result.outputDir).toBe(targetOutputDir);
    expect(events.some((event) =>
      event.type === 'skip' && event.reason.includes(path.join('D-100bpm', 'output'))
    )).toBe(true);
  });
});
