---
'tracksmith': patch
---

`mux` now passes `--command-line-charset UTF-8` to mkvmerge so non-ASCII `--name` values are stored correctly regardless of the system locale, matching `edit`.
