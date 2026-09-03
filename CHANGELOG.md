# tracksmith

## 0.3.1

### Patch Changes

- [#12](https://github.com/UzEE/tracksmith/pull/12) [`55db4c2`](https://github.com/UzEE/tracksmith/commit/55db4c27e3a43267cd2da633b0ae25d363b059ef) Thanks [@UzEE](https://github.com/UzEE)! - Fixed `mux` failing on Windows with "The file '--command-line-charset' could not be opened for reading". The Windows build of mkvmerge rejects that flag and does not need it, so `mux` now passes it only on POSIX platforms, where it still protects non-ASCII `--name` values under non-UTF-8 locales.

## 0.3.0

### Minor Changes

- [#8](https://github.com/UzEE/tracksmith/pull/8) [`6bc6756`](https://github.com/UzEE/tracksmith/commit/6bc67563599986c7cb7a0e7c04f036f9b455aefe) Thanks [@UzEE](https://github.com/UzEE)! - Added an `edit` command for in-place Matroska metadata edits via mkvpropedit — track name, language, default/forced flags, and the file title — without remuxing. Empty values (`--name ""`, `--title ""`) clear the property, and `--title` is mutually exclusive with `--track` edits. `inspect` now shows the forced flag, IETF (BCP 47) languages, and the file title, and a tool killed mid-edit now fails loudly instead of reporting success (POSIX platforms). Non-ASCII names and titles are stored correctly regardless of the system locale.

- [#10](https://github.com/UzEE/tracksmith/pull/10) [`4feae59`](https://github.com/UzEE/tracksmith/commit/4feae597d3ad43a0aa1368bf7e70984501f9dbd6) Thanks [@UzEE](https://github.com/UzEE)! - - `mux` now accepts repeatable `--audio` groups to add several tracks in one remux; per-track flags (`--track`, `--delay-ms`, `--language`, `--name`, `--default`) apply to the most recent `--audio`, and the same source file may be repeated
  - `--default` clears the default flag on the target's existing audio tracks so the new track really becomes the default
  - New `--dry-run` prints the planned output track table without writing; interactive runs show the same plan and ask a single combined write/overwrite confirmation
  - Confirmation prompts now print to stderr, keeping stdout pipeable
  - `mux` errors about a bad `--track` or a duplicate per-track flag now name the offending group by position and path, e.g. `--audio [#2](https://github.com/UzEE/tracksmith/issues/2) ("donor.mka")`

### Patch Changes

- [#11](https://github.com/UzEE/tracksmith/pull/11) [`a135573`](https://github.com/UzEE/tracksmith/commit/a1355730206c3c176e4f8df27868b95d91714fcc) Thanks [@UzEE](https://github.com/UzEE)! - `mux` now passes `--command-line-charset UTF-8` to mkvmerge so non-ASCII `--name` values are stored correctly regardless of the system locale, matching `edit`.

## 0.2.0

### Minor Changes

- [#5](https://github.com/UzEE/tracksmith/pull/5) [`b4b8a52`](https://github.com/UzEE/tracksmith/commit/b4b8a52a4c5724a69838f08d1dfc20c920e738fc) Thanks [@UzEE](https://github.com/UzEE)! - Long-running commands (`mux`, `extract`, `test-clip`) now stream ffmpeg/mkvmerge progress to stderr while running in a terminal. Piped and scripted runs stay quiet, and stdout stays clean for piping.

## 0.1.0

### Minor Changes

- [#3](https://github.com/UzEE/tracksmith/pull/3) [`e73ef55`](https://github.com/UzEE/tracksmith/commit/e73ef557dbd8c64ae7cd180f8b4ba6ee29fdb731) Thanks [@UzEE](https://github.com/UzEE)! - Publish the first public Tracksmith CLI with support for Node.js 22 or newer and Bun 1.3.14 or newer.
