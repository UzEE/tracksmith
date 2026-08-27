---
'tracksmith': minor
---

- `mux` now accepts repeatable `--audio` groups to add several tracks in one remux; per-track flags (`--track`, `--delay-ms`, `--language`, `--name`, `--default`) apply to the most recent `--audio`, and the same source file may be repeated
- `--default` clears the default flag on the target's existing audio tracks so the new track really becomes the default
- New `--dry-run` prints the planned output track table without writing; interactive runs show the same plan and ask a single combined write/overwrite confirmation
- Confirmation prompts now print to stderr, keeping stdout pipeable
