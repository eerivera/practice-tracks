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

## Output Archive

The `--archive` flag (available on `mix`, `process`, and `process-queue`) copies any existing output files to a timestamped subdirectory before overwriting them:

```
songs/<name>/output/Ab-68bpm/
  full.m4a                      ← current
  archive/
    2026-05-19-133042/
      full.m4a                  ← previous run
```

Archives are inside `output/` and are covered by the existing `.gitignore` rule.

---

## Deferred: Normalized Stem Caching

Normalization is the slow step. Caching normalized WAVs would let re-runs skip it when stems haven't changed. The cache path must be keyed to the full song/key/bpm combo — not just the song — because different keys come from different stem sets with different recorded levels:

```
songs/<name>/normalized/Ab-68bpm/<stem>.wav
```

Not implemented in V1. When you add it, invalidate the cache on stem file mtime or content hash.

---

## Roadmap

### Near-term
- [ ] Two-pass loudness normalization for stems with high dynamic range
- [ ] `--dry-run` flag that logs what would be done without writing files
- [ ] Progress bar for normalization (especially useful with WASM backend)
- [ ] Normalized stem caching (see above) keyed to song + key + bpm

### Planning Center Integration (medium-term, high leverage)

This is worth prioritizing before the browser app — it largely sidesteps the distribution problem entirely.

**What's available in the PCO API:**
- `GET /services/v2/service_types/{id}/plans/{id}/items` — read next Sunday's setlist
- `POST /services/v2/songs/{id}/arrangements/{id}/keys/{id}/attachments` — upload a file at the key level
- Attachments can be key-specific, so `full.m4a` in Ab doesn't collide with `full.m4a` in Bb
- The PCO Services mobile app shows these attachments directly to team members

**Why this sidesteps the browser app concern:**
If the tool can automatically upload generated mixes to PCO as song attachments, team members access them through the PCO Services app — which they're already using for chord charts and lyrics. No link to share, no file to distribute, no browser app needed for the end-user step.

**Required setup (no server needed for single-church use):**
1. Register a PCO developer app at [developer.planning.center](https://developer.planning.center) (free)
2. Generate a Personal Access Token (PAT) for the church's PCO account
3. Store in `.env`: `PCO_APP_ID=xxx` and `PCO_SECRET=yyy`
4. Add `--upload-pco` flag to `process-queue`

A server is only needed if you want multiple different churches/users to authenticate independently (OAuth2 flow). For Elijah's single church, PAT is sufficient.

**Proposed V2 workflow:**
```
# worship leader drops zips in queue/, then:
npm run mix -- process-queue --upload-pco

# tool: extracts → mixes → uploads each mix as a PCO key-level attachment
# team opens PCO Services app and sees the mixes next to chord charts
```

**PCO storage cost:** $1/GB beyond the free tier. Five mixes × ~30MB each × 10 songs/week = ~1.5GB/month. Worth checking current PCO plan limits.

**Known gap:** There is no PCO API or Multitracks API for downloading stems programmatically. Zip downloads from multitracks.com are still manual. The queue workflow is currently the best automation available for that step.

### Web App (lower priority if PCO integration ships)
If the PCO upload path works, the web app's main value shifts from "distribution" to "self-service by individual team members who want custom mix levels." That's a narrower audience. Deprioritize relative to PCO integration unless team members ask for it.

If the web app does happen:
1. Adapt `WasmFFmpegBackend` I/O for browser (File API in, Blob download out)
2. Build a minimal frontend (Vite + React or plain HTML) with drag-drop zip input
3. No server required — everything runs client-side

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
