# Practice Tracks

Automatically generate rehearsal mixes from your Multitracks stems.

Drop zip files into the `queue-zips/` folder, run one command, and get back a set of mixes for each song — full mix, no-click, drummer mix, vocalist mix — saved and ready to share.

---

## Before You Start (One-Time Setup)

Open the **Terminal** app (Applications → Utilities) and run these commands one at a time.

### 1. Install Homebrew

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Node.js

```
brew install node
```

### 3. Install FFmpeg (Recommended for Speed)

Optional, but with FFmpeg installed each song processes in ~10 seconds instead of ~2 minutes.

```
brew install ffmpeg
```

### 4. Set Up This Tool

```
cd /path/to/practice-tracks
npm install
```

> **Tip:** In Terminal, press `Tab` after typing a few characters of a path to auto-complete it. For example, type `queue-zips/Who` and press Tab to fill in the rest. You can also use a wildcard — `songs/Who*` matches any folder starting with "Who," which saves a lot of typing for long Multitracks filenames.

---

## Typical Weekly Workflow

1. Download your song zips from [Multitracks.com](https://multitracks.com) and put them in `queue-zips/`
2. Run:
   ```
   npm run mix -- run
   ```
3. Find your mixes in `songs/<Song Name>/output/<Key>-<BPM>bpm/`

That's it. The `run` command extracts, mixes, and (once configured) uploads to Planning Center automatically.

---

## Commands

### `run` — Full pipeline
Extracts all new zips, mixes all queued songs, and uploads to Planning Center (if configured).

```
npm run mix -- run
npm run mix -- run --force     # re-mix and re-upload everything, ignore skip logic
npm run mix -- run --mix-only  # skip the upload step
npm run mix -- run --archive   # save previous mixes before overwriting
```

### `status` — Show what's queued
```
npm run mix -- status
```

### `extract` — Extract zips into stems
```
npm run mix -- extract                         # extract all new zips in queue-zips/
npm run mix -- extract "queue-zips/Song.zip"   # extract one specific zip
```

### `mix` — Generate mixes
```
npm run mix -- mix                             # mix all songs in the mix queue
npm run mix -- mix "songs/Song Name"           # mix one specific song
npm run mix -- mix --force                     # re-mix even if output exists
```

### `process` — Extract + mix in one step
```
npm run mix -- process "queue-zips/Song.zip"
```

### `list-stems` — Preview stem classification (dry run)
```
npm run mix -- list-stems "songs/Song Name"
```

---

## Output Structure

Mixes are saved to `songs/<Song Name>/output/<Key>-<BPM>bpm/` so mixes for different keys never get mixed up:

```
songs/
  Who Else-Crowns Down (Live)-Ab-68.00bpm/
    output/
      Ab-68bpm/
        full.m4a
        no-click.m4a
        no-guide.m4a
        drummer.m4a
        vocalist.m4a
```

| Mix file | What it contains |
|---|---|
| `full.m4a` | All stems, balanced |
| `no-click.m4a` | Full mix without click track |
| `no-guide.m4a` | Full mix without guide vocal |
| `drummer.m4a` | Click + rhythm section + quiet guide |
| `vocalist.m4a` | No click, louder guide and backing vocals |

---

## Queue Files

The tool tracks work-in-progress across runs using two files in `queues/`:

**`queues/to-mix.json`** — songs extracted but not yet mixed:
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

**`queues/to-upload.json`** — songs mixed but not yet uploaded to Planning Center:
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

To force a specific song to re-mix on the next `run`, open `queues/to-mix.json` and change its `"force"` to `true`. The `--force` flag on the command line forces everything in that run.

---

## Customizing the Mix

Edit `config/default_mix.yaml` to change gain levels or add mix types. All numbers are in dB — negative is quieter, positive is louder.

For per-song overrides, create `songs/<name>/mix.yaml` with only the values you want to change.

---

## Troubleshooting

**"FFmpeg not found in PATH"** — running in slower mode. Fix: `brew install ffmpeg`.

**"No stems directory found"** — run `extract` or `process` first.

**A stem shows as `unknown`** — the tool didn't recognize its filename. Rename it to match a known pattern (e.g. `Gtr.m4a` → `EG.m4a`) or ask your maintainer to add the pattern.

**Lost a queue file** — if `queues/to-mix.json` is gone, move the zip from `processed-zips/` back to `queue-zips/` and run `extract` again. If `queues/to-upload.json` is gone, re-run `mix` on the affected songs.

**PCO upload says "not yet implemented"** — PCO upload is coming soon. See your maintainer.
