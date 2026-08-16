# Tracksmith CLI design

Approved 2026-08-16.

## Purpose

A cross-platform Bun CLI named `tracksmith` for working with audio tracks in Matroska files:

1. Inspect the tracks in a media file.
2. Extract one audio track from an MKV without altering its bitstream.
3. Generate a short audio/video alignment test clip.
4. Mux the aligned audio into another MKV.

The tool orchestrates `ffmpeg` and `mkvmerge` (MKVToolNix); `ffprobe` turned out to be unnecessary because all probing goes through `mkvmerge -J`. It never encodes, decodes, or otherwise modifies audio: audio is always stream-copied. It makes no claims about creating Dolby Atmos or any other format it merely copies.

## Invocation and packaging

- Package and executable name: `tracksmith` (npm availability rechecked immediately before any publish; last checked clear 2026-08-16).
- Eventual invocation: `bunx tracksmith <subcommand> ...`. Local development: `bun run src/cli.ts ...`.
- `package.json` declares `tracksmith` under `bin`; `src/cli.ts` carries a Bun shebang (`#!/usr/bin/env bun`).
- A compiled standalone executable may come later; it is out of scope for v1.
- Zero runtime dependencies. Argument parsing uses `parseArgs` from `node:util`.

## External tool requirements

`ffmpeg` and `mkvmerge` must be on `PATH`.

- Before running a command, tracksmith verifies the tools that command needs.
- A missing tool produces an actionable error naming the tool and how to install it (winget/scoop for Windows, brew for macOS, apt/pacman hints for Linux) — not a raw spawn failure.

## Track selection convention

The user-facing `--track <id>` is always the MKVToolNix track ID as shown by `inspect` (sourced from `mkvmerge -J`). FFmpeg-style selectors such as `1:a:0` are never exposed; when a command drives ffmpeg, tracksmith translates the MKVToolNix ID to the correct ffmpeg mapping internally.

Track IDs are validated before use: the ID must exist in the source and must be an audio track. Invalid IDs produce an error listing the valid audio tracks.

## Commands

### `inspect <file>`

Lists all tracks with: MKVToolNix track ID, type, codec, language, name, channel count (audio), and default-track flag. Backed by `mkvmerge -J`. Output is a readable table.

### `extract <file> --track <id> [--output <file>]`

Extracts one audio track to an audio-only MKA using `mkvmerge`, with no transcoding. MKA is preferred over raw elementary streams (e.g. `.eac3`) because it retains timing and container metadata.

Default output: `<source-stem>.track<id>.mka`, written next to the source file.

### `test-clip --video <target> --audio <donor> --track <id> --start <time> [--duration 60] [--delay-ms 0] [--output <file>]`

Produces a short clip for checking A/V alignment: the target's video is re-encoded to H.264 so the clip can begin at an exact timestamp; the selected donor audio is stream-copied unchanged. HDR/Dolby Vision fidelity is irrelevant in this sync-only artifact.

`--start` and `--duration` accept ffmpeg time syntax: plain seconds (`90`, `90.5`) or `HH:MM:SS[.ms]`.

Default output: `<video-stem>.sync-test.mkv`, written next to the target video.

Guidance surfaced in help/docs: check clips near the beginning, middle, and end of the file. If the required offset changes across those points, the releases differ by frame rate or edits and cannot be fixed with one constant delay.

### `mux --video <target> --audio <mka-or-donor-mkv> [--track <id>] [--delay-ms 0] [--language eng] [--name <title>] [--default] --output <file>`

Produces a new MKV that retains all of the target's existing tracks, chapters, and metadata, and appends the chosen audio, using `mkvmerge`.

- `--audio` accepts any Matroska file. The rule is track-count based, not extension based: if the file contains exactly one audio track (the normal `extract` output), `--track` is optional; if it contains more than one, `--track` is required and the selection is passed straight to `mkvmerge` — no intermediate extract step.
- `--output` is required. No default output name for `mux`, since it produces the final, typically large, file.
- `--default` sets the default-track flag on the appended audio.

## Shared behaviors

### Delay semantics

Positive `--delay-ms` delays audio; negative advances it. Implemented with `mkvmerge --sync` for `mux` and `-itsoffset` for `test-clip`.

### Overwrite behavior

If an output file already exists:

- Interactive terminal (stdin is a TTY): prompt y/n; decline aborts without touching the file.
- `--force`: overwrite without prompting.
- Non-interactive (stdin not a TTY, e.g. scripts/CI): refuse with an error suggesting `--force`, because prompting would hang.

### Paths and platforms

- Works on Windows, macOS, and Linux. Documentation and examples use PowerShell syntax per user preference; the tool itself is platform-neutral.
- All subprocess invocations pass argv arrays — never shell-interpolated strings — so paths containing spaces and special characters are safe.

### Errors

- Tool-missing, invalid-track, and file-not-found errors are detected up front with specific messages.
- Subprocess failures surface the tool's exit code and stderr, prefixed with which step failed.
- Non-zero exit code on any failure.

## Structure

```
src/
  cli.ts        entry point: shebang, subcommand dispatch, parseArgs
  commands/
    inspect.ts
    extract.ts
    test-clip.ts
    mux.ts
  probe.ts      wraps `mkvmerge -J`: track listing + track validation
  tools.ts      PATH detection for ffmpeg/mkvmerge + install hints
  runner.ts     small process-execution interface + Bun implementation
  output.ts     default output naming + overwrite policy (prompt/--force)
```

Each command module has one job: turn validated options into an argv array and hand it to the runner. That keeps commands unit-testable without media tools.

## Testing

- `bun test` unit tests, no external tools required:
  - Each command's generated argv array for representative option sets (including negative delays, paths with spaces, language/name/default flags).
  - `mkvmerge -J` JSON parsing and track validation in `probe.ts`.
  - Default output naming and overwrite policy in `output.ts`.
  - Achieved by passing a fake runner that records argv instead of spawning.
- Optional integration tests run only when the three executables and tiny fixture files are present; skipped otherwise.
- Manual verification order: Windows PowerShell first, then at least one Unix platform. Cases: paths with spaces, negative delays, missing tools, invalid track IDs, subprocess failures, overwrite refusal/prompt/--force.

## Out of scope for v1

- npm publication (revisit after CLI behavior is stable; recheck name availability first).
- Compiled standalone executable.
- Any audio transcoding, filtering, or format conversion.
- Automatic drift detection or variable-offset correction.
