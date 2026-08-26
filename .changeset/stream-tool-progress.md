---
'tracksmith': minor
---

Long-running commands (`mux`, `extract`, `test-clip`) now stream ffmpeg/mkvmerge progress to stderr while running in a terminal. Piped and scripted runs stay quiet, and `inspect --json` output remains clean.
