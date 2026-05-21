# Maintainer Guide

For end-user instructions, see `README.md`. For Claude's project memory, see `CLAUDE.md`.

---

## Development Setup

```bash
npm install
npm run check      # type-check + lint + test
npm run test:watch # re-runs on file save
```

---

## Project Structure

```
src/
├── types.ts          Shared TypeScript types
├── cli.ts            CLI entry point — all commands
├── pipeline.ts       Orchestration: normalize → mix → write output
├── mixer.ts          Pure gain routing logic (no I/O)
├── extractor.ts      Zip extraction + key/bpm metadata parsing
├── queue.ts          Queue state read/write (to-mix.json, to-upload.json)
├── pco.ts            Planning Center API client (upload stubbed — needs PAT)
├── env.ts            .env loader + PCO credential helper
├── config/
│   └── loader.ts     YAML config loading + 3-layer merge
├── stems/
│   └── classifier.ts Regex stem → StemCategory mapping
└── backend/
    ├── interface.ts  AudioBackend interface
    ├── native.ts     NativeFFmpegBackend (system ffmpeg)
    ├── wasm.ts       WasmFFmpegBackend (@ffmpeg/ffmpeg)
    └── factory.ts    Auto-detect native vs WASM
```

---

## Key Architectural Invariants

1. **Backend abstraction:** `pipeline.ts` and `mixer.ts` never import `native.ts` or `wasm.ts` directly. All audio calls go through `AudioBackend` from `createBackend()`. This is what keeps the web port feasible.

2. **Queue state is separate from pipeline logic:** `pipeline.ts` knows nothing about the queue files. All queue reads/writes happen in `cli.ts`, which calls `queue.ts`. This keeps the pipeline testable and reusable.

3. **PCO logic is isolated:** `pco.ts` is never imported by `pipeline.ts` or `queue.ts`. The CLI is the only thing that touches PCO. This keeps the mixing core PCO-agnostic.

---

## Directory Layout

```
queue-zips/          ← Drop Multitracks zips here
processed-zips/      ← Zips moved here after successful mix
queues/
  to-mix.json        ← Runtime state (gitignored, editable)
  to-upload.json     ← Runtime state (gitignored, editable)
songs/               ← Extracted song directories
config/
  default_mix.yaml   ← Editable default config
.env                 ← PCO credentials (gitignored)
.env.example         ← Committed template
```

---

## Queue File Format

These files are gitignored runtime state. Users can edit them directly to set `force: true` on individual entries.

**`queues/to-mix.json`** — songs waiting to be mixed:
```json
[
  {
    "songDir": "songs/Who Else-Crowns Down (Live)-Ab-68.00bpm",
    "zipPath": "queue-zips/Who Else-Crowns Down (Live)-Ab-68.00bpm.zip",
    "addedAt": "2026-05-19T14:00:00.000Z",
    "force": false
  }
]
```

**`queues/to-upload.json`** — songs mixed but not yet in PCO:
```json
[
  {
    "songDir": "songs/Who Else-Crowns Down (Live)-Ab-68.00bpm",
    "outputDir": "songs/Who Else-Crowns Down (Live)-Ab-68.00bpm/output/Ab-68bpm",
    "addedAt": "2026-05-19T14:05:00.000Z",
    "force": false
  }
]
```

**`songs/<name>/pco.json`** — PCO song/arrangement/key IDs (written by `pco-link`):
```json
{
  "songId": "12345678",
  "arrangementId": "87654321",
  "keys": {
    "Ab": "11111111",
    "Bb": "22222222"
  }
}
```

The `keys` map is keyed by local key signature (e.g. `"Ab"`) which is parsed from the output subdirectory name (e.g. `output/Ab-68bpm/`).

### `force` flag semantics

- `entry.force: true` in JSON → this entry is force-processed on any batch run, then reset to `false` after success.
- CLI `--force` flag → all entries are treated as forced for that one run (does not persist to JSON).
- Effective force = `entry.force || cliFlag`.

---

## State Machine

```
zip in queue-zips/
  ↓ extract  → appends to to-mix.json (stores zipPath)
  ↓ mix      → moves zip to processed-zips/, removes from to-mix, appends to to-upload
  ↓ upload   → removes from to-upload
```

### Skip logic
- **mix:** skipped if all expected output files exist AND `force` is false. Message directs user to set `"force": true` in `to-mix.json`.
- **upload:** `attachmentExists()` currently returns `false` (stub). Once implemented, checks PCO for a matching filename at the key level before uploading.

### Recovery
- Lost `to-mix.json`: move zip from `processed-zips/` → `queue-zips/`, re-run `extract`.
- Lost `to-upload.json`: re-run `mix --force` on affected songs.

---

## PCO Upload Implementation

**Status: stubbed — `uploadMixFile()` in `src/pco.ts` throws immediately.**

To complete:
1. Acquire a PAT: register an app at `https://api.planningcenter.com/oauth/applications`, store credentials in `.env`.
2. Run `npm run mix -- pco-link <song-dir>` to test the search/link flow.
3. Investigate the PCO attachment upload API:
   - Endpoint: `POST /services/v2/songs/{songId}/arrangements/{arrangementId}/keys/{keyId}/attachments`
   - May be multipart form-data, or may return a presigned S3 URL
   - Check response body for `upload_url` field
4. Implement `uploadMixFile()` and `attachmentExists()` in `src/pco.ts`.
5. Wire `upload` command into `run` (it's already wired — the stub just throws).

PCO auth uses HTTP Basic with `base64(appId:secret)` — see `authHeader()` in `src/pco.ts`.

### PCO storage cost
~$1/GB beyond the free tier. Five mixes × ~30 MB × 10 songs/week ≈ 1.5 GB/month. Check current PCO plan limits before enabling.

---

## Parallel Normalization

Stems are normalized concurrently using a worker-queue pattern in `src/pipeline.ts`. Effective concurrency is:

```
min(config.normalization_concurrency || backend.maxConcurrency, backend.maxConcurrency, stemCount)
```

- `NativeFFmpegBackend.maxConcurrency` = `min(os.cpus().length, 8)`
- `WasmFFmpegBackend.maxConcurrency` = `1` (shared virtual filesystem — cannot parallelize)
- `config.normalization_concurrency = 0` means "use backend default" (auto)
- Setting it to a positive integer in `default_mix.yaml` or `songs/<name>/mix.yaml` overrides the auto value, but can never exceed `backend.maxConcurrency`

**Measured on Apple Silicon M-series (21 stems, ~6 min song):**
- Sequential (1 worker): ~2m 38s normalization, ~2m 50s total
- 8 workers (auto): ~32s normalization, ~43s total

Per-stem times are slightly longer under parallelism (10–13s vs 7–9s) due to CPU/disk contention, but wall-clock time is ~5× better. The cap of 8 is intentional — above that, disk I/O becomes the bottleneck before additional CPU helps.

If a slower machine is running the tool, reducing `normalization_concurrency` to 4 or 2 in `config/default_mix.yaml` is the first dial to turn.

## Deferred: Normalized Stem Caching

Normalization is the slow step. When caching is added, cache paths must be keyed per song + key + bpm (not just song) because different keys come from different stem sets with different recorded levels:

```
songs/<name>/normalized/Ab-68bpm/<stem>.wav
```

Invalidate on stem file mtime or content hash. Not in V1.

---

## Stem Classification

Regex patterns in `src/stems/classifier.ts`. **Order is load-bearing:**
- `synth_bass` before `bass`
- `vox_fx` before `fx`

To add a new stem type: update `StemCategory` in `types.ts`, add pattern to `STEM_PATTERNS`, add default rule to `BUILT_IN_DEFAULTS` in `config/loader.ts`, add to `config/default_mix.yaml`, add test.

---

## Browser Frontend (future)

When building the web app, PCO features should only appear if the user has configured PCO credentials. The mechanism:
- In the Node CLI: presence of `PCO_APP_ID`/`PCO_SECRET` env vars
- In the browser: a "Settings" section where the user pastes their PAT and it is validated before the PCO upload UI is shown. Do not include PCO-related UI in the initial render — reveal it only after successful credential validation.

The WASM backend needs browser I/O adaptation before the web app ships: replace `writeFileSync`/`readFileSync` with File API input and Blob download output. See `TODO` comment in `src/backend/wasm.ts`.

---

## Running Checks

```bash
npm run type-check   # tsc strict
npm run lint         # eslint
npm run test         # vitest unit tests (classifier, config, mixer)
npm run check        # all three in sequence
```

## Resetting for Testing

```bash
npm run clean         # remove songs/*/output/, reset queue files
npm run clean:full    # also remove stems, move processed zips back to queue-zips/
```

`clean` is the fast reset for re-timing a mix run — stems stay on disk so extraction is skipped. `clean:full` starts completely fresh from the zips. Both reset `queues/to-mix.json` and `queues/to-upload.json` to empty arrays.

Tests are pure unit tests — no FFmpeg, no audio files, no network.

---

## FFmpeg Filter Graph Reference

```
ffmpeg \
  -i stem1.wav -i stem2.wav \
  -filter_complex "
    [0:a]volume=0.316228[a0];
    [1:a]volume=1.259921[a1];
    [a0][a1]amix=inputs=2:normalize=0[out]
  " \
  -map [out] -y output.m4a
```

`normalize=0` on `amix` is essential — without it FFmpeg divides by input count and breaks the configured balance. Volume values: `10^(dB/20)`.
