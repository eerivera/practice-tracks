# Maintainer Guide

This document is for **Elijah** (or whoever maintains this project in the future). It covers the development workflow, how the code is organized, design decisions made during V1, and what comes next.

For end-user instructions, see `README.md`.
For Claude-specific project memory and AI context, see `CLAUDE.md`.

---

## Development Setup

```bash
npm install
npm run check      # type-check + lint + test (run before committing)
npm run test:watch # re-runs tests on file changes
```

The tool runs directly from TypeScript via `tsx` — no compilation step needed for local development. The `npm run build` command compiles to `dist/` for distribution.

---

## Project Structure

```
src/
├── types.ts              Shared TypeScript types (StemCategory, Config, MixInput, etc.)
├── cli.ts                CLI entry point — three commands: mix, extract, list-stems
├── pipeline.ts           Orchestration: normalize stems → generate each mix
├── mixer.ts              Pure business logic: build per-mix input lists from config + stems
├── extractor.ts          Zip extraction: Multitracks zip → songs/<name>/stems/
├── config/
│   └── loader.ts         YAML config loading, default values, deep-merge logic
├── stems/
│   └── classifier.ts     Regex-based stem name → StemCategory mapping
└── backend/
    ├── interface.ts      AudioBackend interface (normalize + mix)
    ├── native.ts         NativeFFmpegBackend — calls system ffmpeg via child_process
    ├── wasm.ts           WasmFFmpegBackend — uses @ffmpeg/ffmpeg (browser + fallback)
    └── factory.ts        createBackend() — auto-detects native vs. WASM
```

---

## Key Design Decisions

### Backend Abstraction

The `AudioBackend` interface in `src/backend/interface.ts` is the critical seam between business logic and audio processing. `pipeline.ts` and `mixer.ts` never call FFmpeg directly — they only call `backend.normalize()` and `backend.mix()`.

This means:
- **Local:** `NativeFFmpegBackend` runs the system `ffmpeg` binary (~10s per song)
- **No FFmpeg installed:** `WasmFFmpegBackend` uses WebAssembly (~1–2 min per song)
- **Browser:** `WasmFFmpegBackend` with CDN-loaded core, no installation needed
- **Future DAW integration:** Add a third backend without touching any other code

### Stem Classification

Regex patterns in `src/stems/classifier.ts`. Order matters — more specific patterns come first:
- `synth_bass` matches before `bass` to prevent "Synth Bass" from being classified as `bass`
- `vox_fx` matches before `fx` for the same reason

When you encounter a stem name that classifies as `unknown`, add a new pattern to the array in the appropriate order. The existing test suite covers all stems from the example Multitracks zip.

### Config Layering

Three layers, each overriding the previous:
1. Built-in defaults hardcoded in `loader.ts` (always present)
2. `config/default_mix.yaml` (project-wide, committed to git)
3. `songs/<name>/mix.yaml` (per-song, committed to git)

The `mergeConfig` function does a shallow merge at the top level and a key-by-key merge for `track_rules`. The `mixes` array replaces entirely — partial list merging is too confusing to reason about.

### TypeScript + ESM

The project uses `"module": "NodeNext"` + `"moduleResolution": "NodeNext"`. This means:
- All local imports need `.js` extensions in TypeScript source files (they resolve to `.ts` at runtime via `tsx`)
- This is the correct TypeScript ESM pattern, not a bug

### WASM Backend Notes

`WasmFFmpegBackend` works in Node.js (as a fallback) and will work in the browser with minor I/O adaptation. The I/O difference:
- **Node.js:** uses `writeFileSync`/`readFileSync` to exchange files with the WASM virtual filesystem
- **Browser:** will need `Blob`/`URL.createObjectURL` for output download, and `File`/`FileReader` for input — see the TODO comment in `src/backend/wasm.ts`

The WASM core binary (`@ffmpeg/core`) is an optional dependency (~30MB). If not installed, the WASM backend throws a helpful error message. In a browser build, it loads from a CDN URL instead.

---

## Running Checks

```bash
npm run type-check   # TypeScript strict mode check
npm run lint         # ESLint with typescript-eslint rules
npm run test         # Vitest unit tests (classifier, config-loader, mixer)
npm run check        # All three in sequence
```

Tests are pure unit tests — no FFmpeg required, no audio files needed. They test:
- Stem classification for every stem type in the example Multitracks zip
- Config merge behavior (overrides, mutation safety, mixes replacement)
- Mix input building (filtering, gain application, mute behavior)

---

## Adding a New Stem Category

1. Add the new category to the `StemCategory` union in `src/types.ts`
2. Add a regex pattern to `STEM_PATTERNS` in `src/stems/classifier.ts` (mind the ordering)
3. Add a default gain rule to `BUILT_IN_DEFAULTS.track_rules` in `src/config/loader.ts`
4. Add a default gain entry to `config/default_mix.yaml`
5. Add a test case in `tests/classifier.test.ts`

---

## Adding a New Mix Type

Edit `config/default_mix.yaml` and add an entry to the `mixes` array. No code changes needed unless you need logic the current `exclude`/`include_only`/`overrides` system can't express.

---

## Roadmap

### Near-term
- [ ] Two-pass loudness normalization for stems with high dynamic range
- [ ] `--dry-run` flag that logs what would be done without writing files
- [ ] Progress bar for normalization (especially useful with WASM backend)
- [ ] Support for song folders that already have stems directly (no `stems/` subdir)

### Web App (medium-term)
The architecture is already designed for this. What's needed:
1. Adapt `WasmFFmpegBackend` I/O for browser (File API in, Blob download out)
2. Build a minimal frontend (Vite + React or plain HTML) that:
   - Accepts a zip file via drag-drop
   - Shows classified stems and lets user adjust gains
   - Triggers the pipeline and offers output files for download
3. No server required — everything runs client-side

### Planning Center Integration (longer-term)
Planning Center has a public API. A potential flow:
- Read the upcoming service plan from PCO API
- Match song titles to available zip files or a cloud stem library
- Auto-generate mixes for all songs in the plan
- Upload or share resulting mix files
This would likely require a small server (for PCO OAuth) but the mixing could remain client-side.

---

## FFmpeg Filter Graph

For reference, the FFmpeg filter graph used for mixing N stems:

```
ffmpeg \
  -i stem1.wav -i stem2.wav -i stem3.wav \
  -filter_complex "
    [0:a]volume=0.316228[a0];
    [1:a]volume=1.259921[a1];
    [2:a]volume=0.707946[a2];
    [a0][a1][a2]amix=inputs=3:normalize=0[out]
  " \
  -map [out] -y output.m4a
```

`normalize=0` on `amix` is essential — without it, FFmpeg divides the sum by the number of inputs, which undoes the intentional mix balance.

Volume values are linear amplitudes converted from dB: `amplitude = 10^(dB/20)`.
