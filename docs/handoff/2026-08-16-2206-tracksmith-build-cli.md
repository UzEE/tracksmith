# Tracksmith CLI handoff

## Current objective and status

Build a small cross-platform Bun CLI for inspecting media tracks, extracting an audio track from an MKV without altering its bitstream, generating a short audio/video alignment test, and muxing the aligned audio into another MKV.

Status: discovery and naming only. No repository, project files, design spec, implementation, or tests exist yet. `tracksmith` is the preferred package and executable name, but the user has not explicitly given final naming approval.

## Repository and relevant locations

- Repository: not created; create a dedicated project on the development machine.
- Branch: none.
- Current scratch workspace is empty and should not be used as the project: `/Users/uzee/Library/CloudStorage/OneDrive-Personal/Documents/Codex/2026-08-14/why`.
- Intended npm package: `tracksmith`.
- npm registry check on 2026-08-16 returned no unscoped `tracksmith` package. This is not a reservation; recheck immediately before publishing: <https://www.npmjs.com/package/tracksmith>
- Bun package execution reference: <https://bun.sh/docs/pm/bunx>

## Decisions and blockers

- Use Bun and Bun Shell for cross-platform orchestration.
- Primary eventual invocation: `bunx tracksmith <subcommand> ...`; local development may use `bun run src/cli.ts ...`.
- Declare `tracksmith` in `package.json` `bin` and use a Bun shebang. A compiled standalone executable can be added later, but is not required for the first version.
- Require `ffmpeg`, `ffprobe`, and MKVToolNix (`mkvmerge`) on `PATH`; validate dependencies and report actionable installation errors.
- Preserve the source audio exactly with stream copy. Do not encode, decode, or claim to create Dolby Atmos.
- Prefer an audio-only MKA over raw `.eac3`, because MKA retains timing/container metadata.
- Documentation and examples intended for this user must use PowerShell syntax, although the program itself must work on Windows, macOS, and Linux.
- Proposed subcommands:
  - `inspect <file>`: list track IDs, types, codecs, languages, names, channel information, and default flags.
  - `extract <file> --track <id> [--output <file>]`: extract one selected audio track to MKA using `mkvmerge` without transcoding.
  - `test-clip --video <target> --audio <donor> --track <id> --start <time> [--duration 60] [--delay-ms 0] [--output <file>]`: re-encode only the temporary video to H.264 for an exact start point; copy the selected audio unchanged. HDR/Dolby Vision appearance is irrelevant in this sync-only artifact.
  - `mux --video <target> --audio <mka-or-donor> [--track <id>] [--delay-ms 0] [--language eng] [--name <title>] [--default] --output <file>`: retain the target's existing tracks and metadata and append the chosen audio using `mkvmerge`.
- Positive delay means delay audio; negative delay means advance audio. Recommend checking clips near the beginning, middle, and end. A changing offset means the releases differ by frame rate or edits and cannot be fixed by one constant delay.
- Do not expose inconsistent track selectors. `mkvmerge` track IDs differ from FFmpeg audio-relative selectors such as `1:a:0`; design one user-facing `--track` convention and translate internally. Recommended convention: always accept the MKVToolNix track ID shown by `inspect`.
- Blocker: the brainstorming design gate is incomplete. The command surface, overwrite behavior, default output naming, and whether `mux` accepts donor MKVs directly still need user approval before implementation.

## Next steps

1. Create a dedicated Git repository for `tracksmith` on the development machine.
2. Reconfirm the name and finish the short design discussion, including the unresolved CLI behaviors above.
3. Write the approved design to `docs/superpowers/specs/`, self-review it, and obtain user approval.
4. Produce an implementation plan.
5. Implement test-first. Keep process execution behind a small interface so tests can verify generated argument arrays without needing media tools; add optional integration tests when the three external executables and tiny fixtures are available.
6. Verify on Windows PowerShell first, then at least one Unix platform. Verify paths containing spaces, negative delays, missing tools, invalid track IDs, subprocess failures, and refusal to overwrite unless explicitly requested.
7. Add npm packaging only after CLI behavior is stable; recheck package-name availability immediately before publication.

## Suggested skills

- `superpowers:brainstorming` to finish and approve the design.
- `superpowers:writing-plans` after design approval.
- `superpowers:test-driven-development` for implementation.
- `superpowers:verification-before-completion` before claiming the CLI is ready.
