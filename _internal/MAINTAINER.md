# Maintainer Guide

For end-user instructions, see `README.md`. For Claude's project memory, see `CLAUDE.md`.

---

## Development Setup

```bash
npm install
npm run check      # type-check + lint + unit tests
npm run test:watch # unit tests, re-runs on file save
```

### E2E tests (one-time browser install required)

```bash
npm run playwright:install   # downloads Chromium — run once after npm install
npm run test:e2e             # runs against a freshly built server on port 3000
npm run test:e2e:ui          # interactive Playwright UI for debugging
```

`test:e2e` uses `reuseExistingServer` locally — if you already have the server
running (`npm run web` or `npm run web:dev`), Playwright will reuse it instead of
starting a new one. In CI the server is started automatically by the test runner.

E2E tests live in `_internal/tests/e2e/`. **Standing rule:** every bug fix must
include a regression test in that directory that would have caught the bug.

---

## Project Structure

```
src/
├── types.ts          Shared TypeScript types
├── cli.ts            CLI entry point — all commands
├── pipeline.ts       Orchestration: normalize → mix → write output
├── mixer.ts          Pure gain routing: stemMatchesPattern, findStemBus, buildMixInputs (shared with browser)
├── extractor.ts      Zip extraction + key/bpm metadata parsing
├── queue.ts          Queue state read/write (to-mix.json, to-upload.json)
├── pco.ts            Planning Center API client (upload stubbed — needs PAT)
├── env.ts            .env loader + PCO credential helper
├── config/
│   └── loader.ts     YAML config loading + 3-layer merge
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

## Bus Routing

Stems are assigned to buses by matching filenames against `BusDefinition.contains` patterns. No classifier — routing is entirely config-driven (`common/mixer.ts`).

**Pattern rules (`stemMatchesPattern`):**
- Patterns ending in `*` → case-insensitive prefix match (`EG*` matches EG 1, EG 2, EG 3)
- Patterns without `*` → case-insensitive exact match
- First matching bus wins — order of buses in the config is the tie-breaker

**Effective gain formula per stem per mix:**
```
effectiveDb = bus.gain_db
            + (mix.bus_gains[busName] ?? 0)
            + (mix.stem_gains[filename] ?? config.stem_gains[filename] ?? 0)
```

Stems that match no bus are included at 0 dB with a console warning.

**To add or change a bus:** edit `buses:` in `config/default_mix.yaml` **and** the matching entry in `_internal/web/src/api/embedded-config.ts` (the browser build's bundled config mirror — these must stay in sync). Add a test in `_internal/tests/mixer.test.ts`.

---

## Web Interface (Local Server Mode)

### Running

```bash
npm run web          # build frontend, then start server (production-like)
npm run web:dev      # concurrent dev server (Vite HMR) + Express server with tsx watch
```

Both open at `http://localhost:3000`. `web:dev` uses Vite's dev server on port 5173 and proxies `/api/*` to Express.

### Architecture

```
_internal/
  src/server.ts          Express server (SSE, upload, download, config + GET /api/songs + GET /api/stems/:dir)
  web/
    src/
      types.ts           Web-only types: MixOutput, SongOutputs, QueueStatus (common types re-exported from @common)
      api/
        interface.ts     ProcessingApi interface (includes listSongs, getStems)
        server.ts        ServerApi — fetch + EventSource (default)
        browser.ts       BrowserApi — full in-browser WASM pipeline (no server)
        browser-backend.ts  BrowserWasmBackend — @ffmpeg/ffmpeg with Uint8Array I/O
        embedded-config.ts  Default config bundled for browser build (must mirror default_mix.yaml)
        fake-event-source.ts  Mock EventSource for browser-mode progress events
        factory.ts       Selects impl via VITE_BACKEND build flag
      components/
        DropZone.tsx      Drag-and-drop + click-to-browse .zip picker
        ProgressFeed.tsx  SSE log + normalize progress bar
        Soundboard.tsx    Bus + per-stem faders; buses expand to show sub-faders for multi-stem buses
        OutputPanel.tsx   Download buttons for generated mix files
      App.tsx             State machine + song selector; global config controls above mixer
    vite.config.ts
    tailwind.config.js
    postcss.config.js     Must specify explicit tailwindcss config path (PostCSS resolves from CWD, not Vite root)
```

### Key design decisions

- **`VITE_BACKEND` build flag** — defaults to `'server'` (ServerApi). Set `VITE_BACKEND=browser` to build a static site that runs entirely in-browser via WASM. The `VITE_BASE` env var sets the Vite base URL (default `/`; use `/practice-tracks/` for GitHub Pages).
- **SSE + upload sequencing** — client opens `EventSource` (or `FakeEventSource` in browser mode) before POSTing files (both share the same `sessionId`). Server responds immediately to POST with 200 and runs the pipeline async, streaming events to the open SSE connection.
- **Download security** — download paths are base64url-encoded. Server validates that the decoded path stays within `songs/` before serving. No traversal possible. In browser mode, paths are Blob URLs managed by BrowserApi.
- **WEB_DIST path** — `server.ts` exits with a helpful message if `_internal/web/dist/` doesn't exist yet (i.e., `npm run web:build` hasn't been run). `npm run web` always builds first.

### GitHub Pages (browser build)

The browser build is deployed automatically to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`. It runs `VITE_BACKEND=browser VITE_BASE=/practice-tracks/ npm run web:build`.

**coi-serviceworker** — a service worker vendored at `_internal/web/public/coi-serviceworker.js` (v0.1.7, MIT). GitHub Pages cannot set `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` response headers, which are required for `SharedArrayBuffer` (used internally by @ffmpeg/ffmpeg). The service worker injects these headers on every response. The page reloads once on first visit to activate the worker. Check for updates at https://github.com/gzuidhof/coi-serviceworker/releases and replace the file if a meaningful update ships. It must stay in `public/` (not `node_modules` via `new URL()`) because service workers require a stable, non-hashed URL for registration and scope.

**@ffmpeg/core files** — `ffmpeg-core.js` (ESM) and `ffmpeg-core.wasm` are referenced in `browser-backend.ts` via Vite's `new URL('../../../../node_modules/@ffmpeg/core/...', import.meta.url)` pattern. Vite resolves these at build time, copies them to `dist/assets/` with content hashes, and returns the correct URL. No manual copying needed; they stay in sync with whatever `@ffmpeg/core` version npm has installed. The ESM version (not UMD) is required because the @ffmpeg/ffmpeg Worker's fallback uses `import().default`, which only works with a module that has a real `default` export. `toBlobURL` from `@ffmpeg/util` is also required — raw URLs fail silently in Vite's bundled Worker context.

**Future:** switching to Netlify or Cloudflare Pages would let us set COOP/COEP headers natively (via `_headers` file) and remove the service worker entirely.

### Tailwind + PostCSS config note

PostCSS resolves `tailwind.config.js` from `process.cwd()` (the project root), not the Vite root passed on the CLI. `postcss.config.js` must therefore specify the config path explicitly:

```js
tailwindcss: { config: './_internal/web/tailwind.config.js' }
```

This is a known Vite quirk when building a subdirectory with a non-root PostCSS config.

### Browser Frontend (WASM path)

The browser build (`VITE_BACKEND=browser`) runs the full pipeline in-browser. No server required. PCO upload is not available in browser mode (server-side only).

When PCO browser support is added, credentials should be gated behind a Settings panel — do not show PCO UI on initial load. See CLAUDE.md for details.

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
