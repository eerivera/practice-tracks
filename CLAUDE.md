# Claude Project Memory — Practice Tracks

This file is for Claude. Human developer notes are in `MAINTAINER.md`.

---

## Project Summary

TypeScript CLI (Node.js, ESM, `tsx` for dev) that processes Multitracks.com stem zips into worship rehearsal mixes. Non-programmer worship leaders use it on macOS. Elijah Rivera (elijahrivera@brandeis.edu) is sole maintainer.

Primary workflow: drop zips in `queue-zips/` → `npm run mix -- run` → mixes appear in `songs/<name>/output/<key>-<bpm>bpm/`, PCO upload happens automatically once credentials are set.

---

## Stack

- **Language:** TypeScript strict, ESM, `NodeNext` module resolution (`.js` extensions in imports)
- **Runtime:** Node.js ≥ 18 local; browser target for future web build
- **Audio:** `NativeFFmpegBackend` (system ffmpeg) or `WasmFFmpegBackend` (@ffmpeg/ffmpeg), auto-detected
- **Config:** YAML 3-layer merge: built-in defaults → `config/default_mix.yaml` → `songs/<name>/mix.yaml`
- **Tooling:** `tsx` dev, `vitest` tests, `typescript-eslint`, `npm run check` = type-check + lint + test

---

## Critical Invariants

1. `pipeline.ts` and `mixer.ts` MUST NOT import from `native.ts`, `wasm.ts`, or `pco.ts`. Backend is injected via `createBackend()`. PCO is CLI-only.
2. Queue files (`to-mix.json`, `to-upload.json`) are managed exclusively by `cli.ts` via `queue.ts`. Pipeline is queue-unaware.
3. PCO upload is **stubbed** — `uploadMixFile()` throws. Do not hook it up until Elijah provides a PAT.

---

## State Machine

```
zip in queue-zips/
  ↓ extract → appends to to-mix.json
  ↓ mix     → moves zip to processed-zips/, removes from to-mix, appends to to-upload
  ↓ upload  → removes from to-upload [STUBBED]
```

`force` flag ORs between entry-level JSON and CLI `--force`. Entry-level persists until processed; CLI flag is one-run-only.

---

## Directories

```
queue-zips/      ← incoming zips
processed-zips/  ← zips after mix
queues/          ← to-mix.json, to-upload.json (gitignored)
songs/           ← extracted stems + output + pco.json
config/          ← default_mix.yaml
```

---

## PCO Integration Status

- `src/pco.ts`: `searchSongs`, `getArrangements`, `getKeys`, `validateCredentials` — implemented
- `uploadMixFile`, `attachmentExists` — **stubbed, throw immediately**
- `pco-link` command — implemented (interactive song → arrangement → key mapping)
- `.env.example` documents `PCO_APP_ID` and `PCO_SECRET` setup
- PCO upload wired into `run` and `upload` commands but blocked by stub

**Next step:** Elijah gets a PAT → test `pco-link` → implement `uploadMixFile` multipart upload.

---

## Stem Naming Reference (Who Else - Crowns Down Live zip)

AG, Bass, BGVS, Choir, Click Track, Drums (Live), EG 1/2/3, FX, Guide, Keys 1-5, Perc, Piano, Piano 2, Synth Bass, Vox FX — all covered by classifier patterns and tested.

---

## Browser Frontend Notes

- PCO features: hidden until user pastes PAT in a Settings panel and it validates. Do NOT render PCO UI on initial load.
- WASM backend I/O: needs File API (input) + Blob download (output) swap. See TODO in `src/backend/wasm.ts`.
- Environment detection: `typeof process !== 'undefined' && process.env.PCO_APP_ID` for Node; browser has no env, so PCO gated by settings panel.

---

## User Profile

Elijah: TypeScript/Node.js developer, building for non-programmer worship leader on macOS. Wants type safety, clean separation of concerns, minimal V1 before feature additions. PCO integration is high-priority next milestone. Normalized stem caching deferred but must be keyed per song+key+bpm when added.

---

## Confirmed Preferences

- Three docs: README (user), MAINTAINER (Elijah), CLAUDE (Claude)
- `npm run check` as pre-commit gate
- `--force` CLI flag + per-entry JSON `force: true` OR together; entry resets to false after success
- `mix <song-dir>` always appends to `to-upload.json` on success, even when called outside the queue
- `process-queue` command removed; replaced by `run`
