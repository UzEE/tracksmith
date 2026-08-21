# tracksmith

Tracksmith is a Bun CLI for MKV files. It inspects tracks, extracts an audio track losslessly, creates short clips for checking audio/video sync, and muxes aligned audio into another MKV. It wraps FFmpeg and MKVToolNix and never re-encodes audio.

## Requirements

- [Bun](https://bun.com)
- [Vite+](https://viteplus.dev/guide/) (`vp`)
- `ffmpeg` and `mkvmerge` available on `PATH`

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

`mkvmerge`:

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

## Commands

The package is not published yet, so run it from a local checkout. After publication, the equivalent command will be `bunx tracksmith`.

```powershell
bun run src/cli.ts inspect <file>
bun run src/cli.ts extract <file> --track <id> [--output <file>] [--force]
bun run src/cli.ts test-clip --video <target> --audio <donor> --track <id> --start <time> [--duration 60] [--delay-ms 0] [--output <file>] [--force]
bun run src/cli.ts mux --video <target> --audio <mka-or-mkv> --output <file> [--track <id>] [--delay-ms 0] [--language eng] [--name <title>] [--default] [--force]
```

`--track` is always the MKVToolNix track ID shown by `tracksmith inspect`. Times accept seconds such as `90` or `90.5`, or `HH:MM:SS[.ms]`.

## PowerShell walkthrough

```powershell
# 1. See what's in the donor file (note the MKVToolNix track IDs)
bun run src/cli.ts inspect "D:\rips\Movie DonorCut.mkv"

# 2. Extract the audio track losslessly (writes Movie DonorCut.track2.mka)
bun run src/cli.ts extract "D:\rips\Movie DonorCut.mkv" --track 2

# 3. Make a 60-second sync clip at the 10-minute mark, audio delayed 250 ms
bun run src/cli.ts test-clip --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --track 0 --start 00:10:00 --delay-ms 250

# 4. Once the delay is right, mux it into the target
bun run src/cli.ts mux --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --delay-ms=250 --name "Donor E-AC-3 7.1" --default --output "D:\rips\Movie Final.mkv"
```

Positive `--delay-ms` delays audio; negative values advance it (e.g. `--delay-ms -250` or `--delay-ms=-250`). Check sync near the beginning, middle, and end of the file. If the required offset changes, the files differ by frame rate or edits and one constant delay cannot fix them.

If an output already exists, an interactive terminal asks for confirmation with a y/N prompt. Pass `--force` to overwrite without prompting. Non-interactive sessions refuse to overwrite unless `--force` is provided.

## Local development

```powershell
vp install
bun test
vp check
bun run src/cli.ts <command>
```

Vite+ delegates dependency installation to Bun. `vp check` runs Oxfmt,
Oxlint, and TypeScript 7 together; use `vp check --fix` to apply safe formatting
and lint fixes.
