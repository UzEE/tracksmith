---
'tracksmith': minor
---

Added an `edit` command for in-place Matroska metadata edits via mkvpropedit — track name, language, default/forced flags, and the file title — without remuxing. Empty values (`--name ""`, `--title ""`) clear the property, and `--title` is mutually exclusive with `--track` edits. `inspect` now shows the forced flag, IETF (BCP 47) languages, and the file title, and a tool killed mid-edit now fails loudly instead of reporting success (POSIX platforms). Non-ASCII names and titles are stored correctly regardless of the system locale.
