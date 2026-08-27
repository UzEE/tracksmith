---
'tracksmith': minor
---

Added an `edit` command for in-place Matroska metadata edits via mkvpropedit — track name, language, default/forced flags, and the file title — without remuxing. Empty values (`--name ""`, `--title ""`) clear the property, and `--title` is mutually exclusive with `--track` edits.
