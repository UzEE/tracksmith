---
'tracksmith': minor
---

Long-running commands (`mux`, `extract`, `test-clip`) now stream ffmpeg/mkvmerge progress to stderr while running in a terminal. Piped and scripted runs stay quiet, and stdout stays clean for piping.
