# Claude Project Memory — Practice Tracks

This file is for Claude. Human developer notes are in `_internal/MAINTAINER.md`.

---

## Project Summary

TypeScript CLI (Node.js, ESM, `tsx` for dev) that processes Multitracks.com stem zips into worship rehearsal mixes. Non-programmer worship leaders use it on macOS. Elijah Rivera (elijahrivera@brandeis.edu) is sole maintainer.

Primary workflow: drop zips in `queue-zips/` → `npm run mix -- run` → mixes appear in `songs/<name>/output/<key>-<bpm>bpm/`, PCO upload happens automatically once credentials are set.

---

## Stack

- **Language:** TypeScript strict, ESM, `NodeNext` module resolution (`.js` extensions in imports)
- **Runtime:** Node.js ≥ 18 local; browser build live (deployed to GitHub Pages via WASM backend)
- **Audio:** `NativeFFmpegBackend` (system ffmpeg) or `WasmFFmpegBackend` (@ffmpeg/ffmpeg), auto-detected
- **Config:** YAML 3-layer merge: built-in defaults → `config/default_mix.yaml` → `songs/<name>/mix.yaml`. Schema: `buses[].contains` patterns, per-mix `bus_gains` + `stem_gains`, global `stem_gains`. No `track_rules`.
- **Tooling:** `tsx` dev, `vitest` tests, `typescript-eslint`, `npm run check:light` = type-check + lint + unit tests; `npm run check` = `check:light` + `test:e2e` + `test:e2e:browser` (full gate)

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

AG, Bass, BGVS, Choir, Click Track, Drums (Live), EG 1/2/3, FX, Guide, Keys 1-5, Perc, Piano, Piano 2, Synth Bass, Vox FX — all matched by bus patterns in `config/default_mix.yaml` and `embedded-config.ts`. Mixer tests cover pattern matching.

---

## Transposition Status

Native/local transposition supports `--to-key <key>` and `--semitones <n>`. The pipeline normalizes/cache-loads stems first, transposes into sibling key/BPM folders, then mixes from the transposed stems. Target-key output uses the same normalized key/BPM directory style as extraction (`D-100bpm`, not `D-100.00bpm`).

`AudioBackend.transposeMethod()` reports the progress label (`rubberband` or `asetrate`) without pipeline importing backend internals. Native FFmpeg uses the `rubberband` filter when the installed FFmpeg has `--enable-librubberband`; otherwise it falls back to `aresample+asetrate+atempo`. WASM currently uses `asetrate+atempo`; PR 2 should upgrade browser/WASM quality via standalone `rubberband-wasm`.

Regression coverage: `transposition-pipeline.test.ts` ensures original-key output does not skip a different target-key mix, and target-key existing output still skips when not forced.

---

## Browser Frontend Notes

- PCO features: hidden until user pastes PAT in a Settings panel and it validates. Do NOT render PCO UI on initial load.
- Environment detection: `typeof process !== 'undefined' && process.env.PCO_APP_ID` for Node; browser has no env, so PCO gated by settings panel.

### Browser-mode storage (StemStore)

`_internal/web/src/storage/stem-store.ts` — manifest-free, works with any `FileSystemDirectoryHandle` (OPFS default or FSA folder).

Layout: `songs/<displayName>/<keyBpm>/stems/`, `.../output/`, `.../normalized/meta.json`. No `songs-list.json`, no song-level `meta.json`. Songs discovered by crawling with `entries()` (see `entriesOf()` cast helper — TypeScript DOM lib doesn't declare this yet). Only `normalized/meta.json` is kept because LUFS target cannot be derived from directory names.

`songDir` = synthesised `"${displayName}-${keyBpm}"`. Round-trips through `physicalPath()`. Tracked as `#refactor-triple` to replace with a proper pair.

### Browser UI phases

`App.tsx` is a phase state machine: `idle → files_selected → extracted → (normalizing | mixing) → complete`. Key affordances:

- **DropZone** — initial zip picker; replaced by "Add more zips" hidden input after first files are queued. Deduplicates by filename.
- **Past Mixes** — reconstructed from OPFS/FSA on reload. Re-mix button shown only when stems are on disk (`BrowserApi.listSongs()` filters to stem-bearing songs; `canRemix` callback gates the button in `PastMixes`).
- **Storage type indicator** — OPFS shows amber warning with "saving to a folder instead" link; FSA shows green info bar + "Switch folder". Switching mid-session (phase ≠ idle) shows a confirmation modal.
- **Upload/Download config buttons** — hidden until at least one song with stems is loaded (gated on `showSoundboard`).
- **Soundboard** — browser-style tabs per mix; bus faders + per-stem sub-faders. Active tab uses `margin-bottom: -1px` to overlap the strip border.

---

## User Profile

Elijah: TypeScript/Node.js developer, building for non-programmer worship leader on macOS. Wants type safety, clean separation of concerns, minimal V1 before feature additions. PCO integration is high-priority next milestone. Normalized stem caching deferred but must be keyed per song+key+bpm when added.

---

## Confirmed Preferences

- Three docs: README (user), `_internal/MAINTAINER.md` (Elijah), CLAUDE (Claude)
- `npm run check` as pre-commit gate
- `--force` CLI flag + per-entry JSON `force: true` OR together; entry resets to false after success
- `mix <song-dir>` always appends to `to-upload.json` on success, even when called outside the queue
- `process-queue` command removed; replaced by `run`

## Commit and PR Discipline (standing rule)

- **Commits:** atomic, one logical change, conventional format (`feat(scope):`, `refactor(scope):`, `fix(scope):`). Tests pass at every commit. No WIP or typo-fix commits in history.
- **PRs:** one coherent concern per PR. A refactor that enables a feature ships as its own PR before the feature PR. PRs must be independently reviewable.
- **Why:** auditability as the codebase grows.
