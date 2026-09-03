---
'tracksmith': patch
---

Fixed `mux` failing on Windows with "The file '--command-line-charset' could not be opened for reading". The Windows build of mkvmerge rejects that flag and does not need it, so `mux` now passes it only on POSIX platforms, where it still protects non-ASCII `--name` values under non-UTF-8 locales.
