# Practice Tracks

Automatically generate rehearsal mixes from your Multitracks stems.

Drop in a zip file, run one command, and get back a folder of mixes — full mix, no-click, drummer mix, vocalist mix, and more — each one ready to share with your team.

---

## What This Does

When you download a song from Multitracks.com you get a zip file with individual audio tracks for every instrument: drums, bass, keys, guitar, click, guide vocal, BGVs, and so on. This tool reads those tracks, balances their levels, and exports several different practice mixes automatically.

No DAW required. No manual fader-tweaking. Run a command, get your files.

---

## Before You Start (One-Time Setup)

You'll need two things installed on your Mac. Open the **Terminal** app (it's in Applications → Utilities) and run these commands one at a time.

### 1. Install Homebrew

Homebrew is a tool that makes it easy to install software on a Mac. If you've never installed it, run:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts. It will ask for your Mac password.

### 2. Install Node.js

```
brew install node
```

### 3. Install FFmpeg (Recommended)

FFmpeg is the audio engine that does the actual mixing. It's optional — the tool will work without it — but with FFmpeg installed, each song processes in about 10 seconds instead of 1–2 minutes.

```
brew install ffmpeg
```

### 4. Set Up This Tool

Navigate to the practice-tracks folder and install its dependencies:

```
cd /path/to/practice-tracks
npm install
```

You only need to do all of this once.

---

## Using the Tool

### Step 1 — Extract a Song

Put your Multitracks zip file in the `track-zips/` folder, then run:

```
npm run mix -- extract "track-zips/Song Name.zip"
```

This extracts the stems into `songs/Song Name/stems/` and gets everything ready.

### Step 2 — Generate Mixes

```
npm run mix -- mix "songs/Song Name"
```

Your mixes will appear in `songs/Song Name/output/`:

| File | What it is |
|---|---|
| `full.m4a` | All stems, balanced for general listening |
| `no-click.m4a` | Full mix without the click track |
| `no-guide.m4a` | Full mix without the guide vocal |
| `drummer.m4a` | Click + rhythm section + quiet guide |
| `vocalist.m4a` | No click, louder guide and backing vocals |

### Preview Stems Without Processing

To see how a song's tracks were classified before running the full mix:

```
npm run mix -- list-stems "songs/Song Name"
```

---

## Customizing the Mix

### Adjusting the Default Balance

Open `config/default_mix.yaml` in any text editor. Each instrument has a `gain_db` value — positive numbers are louder, negative are quieter. Change the numbers and re-run the mix command.

```yaml
track_rules:
  click:
    gain_db: -10    # change this number
  guide:
    gain_db: 2
  # ...
```

### Per-Song Overrides

To adjust just one song without changing the defaults, create a `mix.yaml` file inside that song's folder. It only needs to contain the values you want to change:

```yaml
# songs/My Song/mix.yaml
track_rules:
  guide:
    gain_db: 5        # guide is quiet on this particular recording
```

---

## Output Format

The default output format is M4A (the same format as the source stems). To change to MP3 or WAV, edit `config/default_mix.yaml`:

```yaml
output_format: mp3   # or wav
```

---

## Troubleshooting

**"FFmpeg not found in PATH"** — The tool is running in slower WASM mode. Run `brew install ffmpeg` for full speed.

**"No stems directory found"** — Make sure you ran `extract` first, or that your song folder has a `stems/` subfolder containing `.m4a` files.

**"unzip: command not found"** — This is very unlikely on macOS, but if it happens, run `brew install unzip`.

**A stem shows as `unknown` in the list** — The tool didn't recognize the track name. You can either rename the file to match a known pattern (e.g. rename `Gtr.m4a` to `EG.m4a`) or ask your maintainer to add the pattern.

**The mixes sound unbalanced** — Adjust the `gain_db` values in `config/default_mix.yaml`. See "Customizing the Mix" above.

---

## Known Limitations (V1)

- The `extract` command uses the system `unzip` tool (macOS built-in). It won't work on Windows.
- Stems are normalized before mixing but the final mix level is not re-normalized. If a mix is very loud or very quiet, adjust the individual stem gains.
- Loudness normalization uses a single-pass algorithm. For stems with unusual dynamics, two-pass normalization may give better results in a future version.
