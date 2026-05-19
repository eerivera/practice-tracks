# Practice Tracks

Automatically generate rehearsal mixes from your Multitracks stems.

Drop in a zip file, run one command, and get back a folder of mixes — full mix, no-click, drummer mix, vocalist mix, and more — each one ready to share with your team.

---

## Before You Start (One-Time Setup)

You'll need two things installed on your Mac. Open the **Terminal** app (it's in Applications → Utilities) and run these commands one at a time.

### 1. Install Homebrew

Homebrew is a tool that makes it easy to install other software on a Mac. If you've never installed it:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts. It will ask for your Mac password.

### 2. Install Node.js

```
brew install node
```

### 3. Install FFmpeg (Recommended for Speed)

FFmpeg is the audio engine that does the actual mixing. It's optional — the tool works without it — but with FFmpeg installed, each song processes in about 10 seconds instead of 1–2 minutes.

```
brew install ffmpeg
```

### 4. Set Up This Tool

```
cd /path/to/practice-tracks
npm install
```

You only need to do all of this once.

> **Tip:** In Terminal, you can press the `Tab` key after typing a few characters of a file or folder name to auto-complete it. For example, type `queue/Who` and press Tab to fill in the rest without typing the whole name. If nothing happens, press Tab twice to see all matching options. You can also use a wildcard — `songs/Who*` will match any folder whose name starts with "Who," which saves a lot of typing for long Multitracks filenames.

---

## Quick Start

The fastest way to go from a zip file to finished mixes is the `process` command:

```
npm run mix -- process "queue/Song Name.zip"
```

This extracts the stems and generates all mixes in a single step. If you've already run this song before and want to keep the previous mixes before overwriting, add `--archive`:

```
npm run mix -- process "queue/Song Name.zip" --archive
``` Your mixes will appear in `songs/Song Name/output/Ab-68bpm/` (the key and BPM are read from the zip filename automatically).

---

## Step-by-Step Commands

If you prefer to run things separately — for example, to inspect the stems before mixing — you can use the individual commands:

### Extract a Song

```
npm run mix -- extract "queue/Song Name.zip"
```

This sets up `songs/Song Name/stems/` with all the audio files.

### Generate Mixes

```
npm run mix -- mix "songs/Song Name"
```

### Preview Stems Without Processing

```
npm run mix -- list-stems "songs/Song Name"
```

Shows each track and how it was classified, without doing any audio work.

---

## Output Files

Mixes are saved to `songs/<Song Name>/output/<Key>-<BPM>bpm/`:

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

The key and BPM subfolder prevents you from accidentally using mixes from one key as a stand-in for another.

| File | What it is |
|---|---|
| `full.m4a` | All stems, balanced for general listening |
| `no-click.m4a` | Full mix without the click track |
| `no-guide.m4a` | Full mix without the guide vocal |
| `drummer.m4a` | Click + rhythm section + quiet guide |
| `vocalist.m4a` | No click, louder guide and backing vocals |

---

## Processing a Weekly Set (Queue Workflow)

If you have multiple songs to prepare at once, drop all your zip files into the `queue/` folder and run:

```
npm run mix -- process-queue
```

This processes every zip in `queue/` one by one. When a song finishes successfully, its zip is moved to `processed/` automatically. If one song fails, the rest still run.

```
queue/
  Song A.zip        ← put zips here
  Song B.zip

processed/
  Song A.zip        ← moved here after success
```

---

## Customizing the Mix

### Adjusting the Default Balance

Open `config/default_mix.yaml` in any text editor. Each instrument type has a `gain_db` value — positive numbers are louder, negative are quieter. Change the values and re-run the mix command.

```yaml
track_rules:
  click:
    gain_db: -10    # reduce this to make the click even quieter
  guide:
    gain_db: 2      # increase this if the guide is hard to hear
```

### Per-Song Overrides

To tweak just one song without changing the global defaults, create a `mix.yaml` file inside that song's folder. It only needs the values you want to change:

```yaml
# songs/My Song/mix.yaml
track_rules:
  guide:
    gain_db: 5
```

### Output Format

The default format is M4A. To change to MP3 or WAV, edit `config/default_mix.yaml`:

```yaml
output_format: mp3   # or wav
```

---

## Troubleshooting

**"FFmpeg not found in PATH"** — The tool is running in slower mode. Run `brew install ffmpeg` for full speed.

**"No stems directory found"** — Make sure you ran `extract` or `process` first, or that the song folder has a `stems/` subfolder with `.m4a` files in it.

**A stem shows as `unknown` in the list** — The tool didn't recognize the track name. You can rename the file to match a known pattern (e.g. rename `Gtr.m4a` to `EG.m4a`) or ask your maintainer to add the pattern.

**The mixes sound unbalanced** — Adjust the `gain_db` values in `config/default_mix.yaml`. Each number is in decibels: `-3` is roughly half as loud, `+3` is roughly twice as loud.

**A song in the queue failed** — The error message is printed to the terminal. The zip stays in `queue/` (it is not moved to `processed/`) so you can fix the issue and re-run.

---

## Known Limitations (V1)

- Stems are normalized before mixing but the final mix level is not re-normalized. If a mix is very loud or quiet, adjust the individual stem gains in the config.
- The `extract` / `process` / `process-queue` commands expect zips in the standard Multitracks.com format (a top-level folder containing a `MultiTracks/` subdirectory).
