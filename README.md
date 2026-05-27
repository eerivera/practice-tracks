# Practice Tracks

Automatically generate rehearsal mixes from your Multitracks stems.

Drop zip files in, run one command, and get back a set of mixes for each song — full mix, no-click, drummer mix, vocalist mix — ready to share.

---

## Two Ways to Use Practice Tracks

### Browser — no installation needed

Go to **[eerivera.github.io/practice-tracks](https://eerivera.github.io/practice-tracks/)** in Chrome or Edge. Drop your Multitracks zip files and download the finished mixes. Everything runs entirely in your browser — your audio never leaves your machine.

> **Storage note:** By default your files live in browser storage, which the browser may clear when it needs space. Click **"saving to a folder instead"** when prompted to pick a permanent folder on your Mac. Your stems and mixes will then survive between sessions.

### Command Line — faster, Planning Center upload coming soon

The setup below installs the tool on your Mac. It uses your Mac's built-in audio tools, which are about 4× faster than the browser version for large stem sets.

Once installed, you can also run:
```
npm run web
```
to open the same drag-and-drop interface at `http://localhost:3000` — useful if you prefer clicking over typing, and it will be the first place Planning Center upload appears once that feature ships.

---

## Before You Start (One-Time Setup)

You only need to do this once.

### 1. Get the code

Go to [github.com/eerivera/practice-tracks](https://github.com/eerivera/practice-tracks), click the green **Code** button, and choose **Download ZIP**. Unzip it somewhere you'll remember — your Desktop works fine.

### 2. Open Terminal

Open the **Terminal** app. It's in Applications → Utilities. (You can also search for "Terminal" with Spotlight — press `⌘ Space` and type Terminal.)

### 3. Navigate to the folder

In Terminal, type `cd ` (with a space after it), then drag the `practice-tracks` folder from Finder into the Terminal window. The path will fill in automatically. Press **Enter**.

### 4. Install Homebrew

Homebrew is a tool for installing software on a Mac. If you've never installed it, paste this into Terminal and press Enter:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It will ask for your Mac password. Nothing will appear as you type — that's normal.

### 5. Install Node.js

```
brew install node
```

### 6. Install FFmpeg

FFmpeg is the audio engine. It's optional but recommended — with it, each song processes in ~10 seconds instead of ~2 minutes.

```
brew install ffmpeg
```

### 7. Install tool dependencies

```
npm install
```

That's the one-time setup done.

---

### Optional: Higher-quality transposition

When you transpose a song to a different key, Practice Tracks uses FFmpeg's built-in pitch shifting by default. It works well, but if you want the highest-quality transposition (phase-coherent, no timing drift), you can install FFmpeg with the [Rubber Band](https://breakfastquay.com/rubberband/) library compiled in. The app detects it automatically — no configuration needed.

> **This step is optional.** The default pitch shifting is perfectly usable. You'd mostly notice the difference on sustained notes or piano — for most worship mix listening purposes the standard version is fine.

**Mac:**

You need to swap the standard FFmpeg for a version built with Rubber Band support. This takes a few minutes to compile.

```
brew uninstall ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-rubberband
```

The replacement installs to the same location, so everything else continues to work as before.

**Windows / Linux:** Instructions coming soon.

---

> **Tip:** In Terminal, press `Tab` after typing a few characters of a path to auto-complete it. You can also use a wildcard — `songs/Who*` matches any folder starting with "Who," which saves typing for long song names.

---

## Every Week

1. Download your song zips from [Multitracks.com](https://multitracks.com) and put them in the `queue-zips/` folder inside `practice-tracks`
2. In Terminal (make sure you're in the `practice-tracks` folder), run:
   ```
   npm run mix -- run
   ```
3. Find your mixes in `songs/<Song Name>/output/<Key>-<BPM>bpm/`

That's it for the basic workflow. The `run` command extracts the stems, balances the levels, and generates all the mixes automatically.

---

## Output Files

Each song gets its own folder with mixes labeled by key and tempo:

```
songs/
  Who Else-Crowns Down (Live)-Ab-68.00bpm/
    output/
      Ab-68bpm/
        full.m4a        ← all instruments, balanced
        no-click.m4a    ← same but without click track
        no-guide.m4a    ← same but without guide vocal
        drummer.m4a     ← click + rhythm section + quiet guide
        vocalist.m4a    ← no click, louder guide and BGVs
```

The key and tempo are part of the folder name so mixes for different keys never get mixed up.

---

## Re-mixing a Song

The tool skips a song automatically if its mixes already exist. To re-mix a specific song after getting updated stems:

```
npm run mix -- mix "songs/Song Name" --force
```

To re-mix everything on the next `run` (for example after adjusting gain settings):

```
npm run mix -- run --force
```

If you only want one specific song to be re-mixed on the next `run` without forcing everything else, open `queues/to-mix.json`, find that song's entry, and change `"force": false` to `"force": true`. The tool will reset it automatically after re-mixing.

---

## Other Commands

```
npm run mix -- status                          # see what's been processed and what's waiting
npm run mix -- process "queue-zips/Song.zip"   # extract + mix one song in one step
npm run mix -- list-stems "songs/Song Name"    # show which bus each stem is assigned to
npm run mix -- run --archive                   # save previous mixes before overwriting them
```

---

## Adjusting the Mix

Open `config/default_mix.yaml` in any text editor to adjust instrument levels. Stems are grouped into **buses** — for example, `EG` groups all electric guitar tracks, `Keys` groups keyboard tracks, `Guide` is the guide vocal. Numbers are in dB — negative is quieter, positive is louder.

To change a bus level across all mixes, edit its `gain_db`:

```yaml
buses:
  - name: Guide
    gain_db: 3    # lift the guide vocal by 3 dB in every mix
    contains: [Guide*]
```

To adjust a bus for one specific mix only, add a `bus_gains` entry to that mix:

```yaml
mixes:
  - name: vocalist
    bus_gains:
      Guide: 5    # +5 dB on top of the bus level, only in the vocalist mix
```

To tweak just one song without changing the defaults, create a `mix.yaml` file inside that song's folder using the same format.

### If mixing feels slow

The tool processes multiple stems at once automatically. If it seems sluggish on your machine, open `config/default_mix.yaml` and lower the `normalization_concurrency` setting from `0` (automatic) to a smaller number like `4` or `2`. Newer Macs run fastest at the automatic setting; older ones sometimes do better with fewer parallel tasks.

---

## Troubleshooting

**"FFmpeg not found in PATH"** — running in slower mode. Fix: `brew install ffmpeg`.

**"No stems directory found"** — run `extract` or `process` on the zip first.

**A warning about an unmatched stem** — the filename didn't match any bus pattern in the config. The stem is still included at its original volume. Contact your maintainer to add a matching pattern, or rename the file to match an existing bus (e.g. `Gtr.m4a` → `EG.m4a`).

**The mixes sound unbalanced** — adjust the `gain_db` values in `config/default_mix.yaml`. Each step of 3 dB is roughly twice as loud or half as quiet.

**Something went wrong mid-run** — run `npm run mix -- status` to see where things are. If needed, contact your maintainer.

---

## Planning Center Integration (Coming Soon)

Once this feature is complete, the tool will automatically upload the generated mix files to your Planning Center songs. Your team members will be able to play them directly inside the PCO Services app — alongside the chord charts and lyrics they already use — without you having to share files separately.

**What you'll need to do (takes about 2 minutes):**

1. Go to [api.planningcenter.com/oauth/applications](https://api.planningcenter.com/oauth/applications) and sign in with your Planning Center account.
2. Click **New Application**.
3. Give it a name like "Practice Tracks" — the other fields can be left blank or filled in however you like.
4. Click **Create Application**. You'll see an **Application ID** and a **Secret**.
5. Send both of those values to Elijah privately (a text or DM is fine — treat them like a password and don't post them publicly).

That's all you need to do. Elijah takes it from there.

**A note on what this access allows:** These credentials let the tool log in to Planning Center as you and attach audio files to your songs. They don't give access to anything else in your account, and they can be revoked at any time from the same page where you created them.
