# tracksmith

Tracksmith is a Bun CLI for MKV files. It inspects tracks, extracts an audio track losslessly, creates short clips for checking audio/video sync, and muxes aligned audio into another MKV. It wraps FFmpeg and MKVToolNix and never re-encodes audio.

## Requirements

- [Bun](https://bun.com)
- `ffmpeg` and `mkvmerge` available on `PATH`

`ffmpeg`:

```powershell
# Windows
winget install Gyan.FFmpeg

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

`mkvmerge`:

```powershell
# Windows
winget install MoritzBunkus.MKVToolNix

# macOS
brew install mkvtoolnix

# Linux
sudo apt install mkvtoolnix
```

## Commands

```powershell
bunx tracksmith inspect <file>
bunx tracksmith extract <file> --track <id> [--output <file>] [--force]
bunx tracksmith test-clip --video <target> --audio <donor> --track <id> --start <time> [--duration 60] [--delay-ms 0] [--output <file>] [--force]
bunx tracksmith mux --video <target> --audio <mka-or-mkv> --output <file> [--track <id>] [--delay-ms 0] [--language eng] [--name <title>] [--default] [--force]
```

`--track` is always the MKVToolNix track ID shown by `tracksmith inspect`. Times accept seconds such as `90` or `90.5`, or `HH:MM:SS[.ms]`.

## PowerShell walkthrough

```powershell
# 1. See what's in the donor file (note the MKVToolNix track IDs)
bunx tracksmith inspect "D:\rips\Movie DonorCut.mkv"

# 2. Extract the audio track losslessly (writes Movie DonorCut.track2.mka)
bunx tracksmith extract "D:\rips\Movie DonorCut.mkv" --track 2

# 3. Make a 60-second sync clip at the 10-minute mark, audio delayed 250 ms
bunx tracksmith test-clip --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --track 0 --start 00:10:00 --delay-ms 250

# 4. Once the delay is right, mux it into the target
bunx tracksmith mux --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --delay-ms=250 --name "Donor E-AC-3 7.1" --default --output "D:\rips\Movie Final.mkv"
```

Positive `--delay-ms` delays audio; negative values advance it (e.g. `--delay-ms -250` or `--delay-ms=-250`). Check sync near the beginning, middle, and end of the file. If the required offset changes, the files differ by frame rate or edits and one constant delay cannot fix them.

If an output already exists, an interactive terminal asks for confirmation with a y/N prompt. Pass `--force` to overwrite without prompting. Non-interactive sessions refuse to overwrite unless `--force` is provided.

## Local development

```powershell
bun install
bun test
bun run typecheck
bun run src/cli.ts <command>
```
