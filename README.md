# tracksmith

Tracksmith is a CLI for MKV files. It inspects tracks, edits metadata in place, extracts an audio track losslessly, creates short clips for checking audio/video sync, and muxes aligned audio into another MKV. It wraps FFmpeg and MKVToolNix. Audio tracks are always stream-copied, so Tracksmith never transcodes or re-encodes audio.

## Requirements

- [Node.js](https://nodejs.org) 22 or newer, or [Bun](https://bun.com) 1.3.14 or newer
- `ffmpeg`, `mkvmerge`, and `mkvpropedit` available on `PATH`

`ffmpeg`:

```powershell
# Windows (choose one)
winget install Gyan.FFmpeg
scoop install ffmpeg

# macOS
brew install ffmpeg

# Debian/Ubuntu
sudo apt install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

`mkvmerge` and `mkvpropedit` (both part of MKVToolNix):

```powershell
# Windows (choose one)
winget install MoritzBunkus.MKVToolNix
scoop install mkvtoolnix

# macOS
brew install mkvtoolnix

# Debian/Ubuntu
sudo apt install mkvtoolnix

# Arch Linux
sudo pacman -S mkvtoolnix-cli
```

## Install

Run it once without installing:

```powershell
# Node.js
npx tracksmith --help

# Bun
bunx --bun tracksmith --help
```

Install it globally:

```powershell
npm install --global tracksmith
```

Release process and approval boundaries: [docs/releasing.md](docs/releasing.md).

## Commands

```powershell
tracksmith inspect <file>
tracksmith extract <file> --track <id> [--output <file>] [--force]
tracksmith edit <file> --track <id> [--name <text>] [--language <lang>] [--default | --no-default] [--forced | --no-forced]
tracksmith edit <file> --title <text>
tracksmith test-clip --video <target> --audio <donor> --track <id> --start <time> [--duration 60] [--delay-ms 0] [--output <file>] [--force]
tracksmith mux --video <target> --output <file> --audio <mka-or-mkv> [--track <id>] [--delay-ms 0] [--language eng] [--name <title>] [--default] [--audio <next> ...] [--dry-run] [--force]
```

`--track` is always the MKVToolNix track ID shown by `tracksmith inspect`. For `mux`, repeat the full `--audio` group for each new track; its per-track flags apply to the most recent `--audio`, and `--default` may be used on at most one group. Using `--default` also clears the default flag on the target's existing audio tracks, so the new track really becomes the default. Times accept seconds such as `90` or `90.5`, or `HH:MM:SS[.ms]`.

`edit` changes metadata in place without remuxing. `--name ""` and `--title ""` clear the value, and `--title` (the file title) cannot be combined with `--track` edits. In Windows PowerShell, use the equals forms `--name=` and `--title=` to clear — PowerShell drops empty `""` arguments before they reach the CLI.

## PowerShell walkthrough

```powershell
# 1. See what's in the donor file (note the MKVToolNix track IDs)
tracksmith inspect "D:\rips\Movie DonorCut.mkv"

# 2. Extract the audio track losslessly (writes Movie DonorCut.track2.mka)
tracksmith extract "D:\rips\Movie DonorCut.mkv" --track 2

# 3. Make a 60-second sync clip at the 10-minute mark, audio delayed 250 ms
tracksmith test-clip --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --track 0 --start 00:10:00 --delay-ms 250

# 4. Preview two tracks from the same donor without writing an output file
tracksmith mux --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorTracks.mka" --track 0 --delay-ms 250 --language eng --name "Original E-AC-3 7.1" --default --audio "D:\rips\Movie DonorTracks.mka" --track 1 --delay-ms 0 --language eng --name "Commentary" --output "D:\rips\Movie Final.mkv" --dry-run

# 5. Once the plan looks right, mux both tracks into the target
tracksmith mux --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorTracks.mka" --track 0 --delay-ms 250 --language eng --name "Original E-AC-3 7.1" --default --audio "D:\rips\Movie DonorTracks.mka" --track 1 --delay-ms 0 --language eng --name "Commentary" --output "D:\rips\Movie Final.mkv"
```

Positive `--delay-ms` delays audio; negative values advance it (e.g. `--delay-ms -250` or `--delay-ms=-250`). Check sync near the beginning, middle, and end of the file. If the required offset changes, the files differ by frame rate or edits and one constant delay cannot fix them.

For `mux`, an interactive terminal shows the planned output track table and asks one combined y/N confirmation; if the output already exists, that same confirmation also covers overwriting it. Use `--dry-run` to print the plan, listing every track already in the target plus the new tracks with `SOURCE` and `DELAY` columns, then exit without writing. Pass `--force` to skip all mux prompting; non-interactive mux sessions never prompt and still require `--force` to overwrite an existing output. `extract` and `test-clip` keep the old overwrite-only prompt behavior.

## Local development

Contributors use [Bun](https://bun.com) 1.3.14 and [Vite+](https://viteplus.dev/guide/) (`vp`):

```powershell
vp install
vp run cli -- <command>
vp check
vp test run
```

Vite+ delegates dependency installation to Bun. `vp check` runs Oxfmt, Oxlint, and TypeScript 7 together; use `vp check --fix` to apply safe formatting and lint fixes.
