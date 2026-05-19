# Claude Project Memory — Practice Tracks

This file is for Claude's benefit as an AI assistant maintaining this project.
Human developer notes live in `MAINTAINER.md`.

---

## Project Summary

A TypeScript CLI tool that processes Multitracks.com stem zips into worship rehearsal mixes. Non-programmer end users (worship leaders) run it on macOS; Elijah (elijahrivera@brandeis.edu) is the sole maintainer.

Primary workflow:
1. `npm run mix -- extract <zip>` → unpacks to `songs/<name>/stems/`
2. `npm run mix -- mix "songs/<name>"` → normalizes stems, generates configured mixes

---

## Stack

- **Language:** TypeScript (strict, ESM with `NodeNext` module resolution)
- **Runtime:** Node.js ≥ 18 locally; browser target for future web build
- **Audio:** `NativeFFmpegBackend` (system ffmpeg) or `WasmFFmpegBackend` (@ffmpeg/ffmpeg), auto-detected by `createBackend()` in `src/backend/factory.ts`
- **Config:** YAML (`js-yaml`) with three-layer merge: built-in defaults → `config/default_mix.yaml` → `songs/<name>/mix.yaml`
- **Tooling:** `tsx` for dev, `vitest` for tests, `typescript-eslint` for linting, `npm run check` runs all three

---

## Critical Architecture Invariant

Business logic (`mixer.ts`, `pipeline.ts`) MUST NOT import from `src/backend/native.ts` or `src/backend/wasm.ts` directly. All audio processing goes through the `AudioBackend` interface via `createBackend()`. This is what makes the web port feasible without touching the business logic.

---

## Stem Classification

`src/stems/classifier.ts` uses an ordered regex array. Pattern ORDER is load-bearing:
- `synth_bass` must come before `bass`
- `vox_fx` must come before `fx`

Stems from the reference zip (Who Else - Crowns Down Live):
`AG`, `Bass`, `BGVS`, `Choir`, `Click Track`, `Drums (Live)`, `EG 1/2/3`, `FX`, `Guide`, `Keys 1-5`, `Perc`, `Piano`, `Piano 2`, `Synth Bass`, `Vox FX`

All of these are covered by the current patterns and tested in `tests/classifier.test.ts`.

---

## Config System

`mergeConfig()` in `src/config/loader.ts` is exported for unit testing. The `mixes` array replaces entirely on override (no partial merge). `track_rules` merges key-by-key. The built-in defaults in `BUILT_IN_DEFAULTS` are the last-resort fallback.

---

## WASM Backend Status

`WasmFFmpegBackend` is fully implemented for Node.js (with `@ffmpeg/core` optional dep). Browser adaptation needed: swap `writeFileSync`/`readFileSync` for File API + Blob download. See TODO comment in `src/backend/wasm.ts`.

---

## Import Convention

All local TypeScript imports use `.js` extensions (e.g. `import { foo } from './bar.js'`). This is correct TypeScript ESM with NodeNext — `tsx` resolves `.js` → `.ts` at dev time.

---

## User Profile

Elijah is a developer (comfortable with TypeScript, Git, Node.js). He is building this for a non-programmer worship leader who uses macOS. Elijah wants:
- Type annotations throughout
- Clean separation of concerns
- No over-engineering
- A path to a browser-based web app (Planning Center integration is longer-term)
- Both user-facing (README) and maintainer-facing (MAINTAINER.md) documentation

## Feedback / Preferences

- Three docs: README.md (worship leader), MAINTAINER.md (Elijah), CLAUDE.md (Claude)
- TypeScript required (not optional annotations on top of plain JS)
- `npm run check` as the single pre-commit verification command
