# Tracksmith CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is additionally structured in **waves** for parallel execution (see "Execution waves"); tasks inside a wave touch disjoint files and may run concurrently.

**Goal:** Build the `tracksmith` Bun CLI: inspect media tracks, losslessly extract an audio track to MKA, generate a short A/V sync test clip, and mux aligned audio into another MKV.

**Architecture:** Thin command modules turn validated options into argv arrays and hand them to a `Runner` interface; a Bun-backed runner spawns `ffmpeg`/`mkvmerge`, while tests use a fake runner that records argv. Shared contracts live in `src/types.ts` and are frozen in Task 1 so later tasks can build in parallel against them.

**Tech Stack:** Bun (runtime, `bun test`, `Bun.spawn`, `Bun.which`), TypeScript strict, `node:util` `parseArgs`. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-tracksmith-cli-design.md`

## Global Constraints

- Bun only: `bun test`, `Bun.spawn`, `Bun.which`. No Node-only tooling, no vite/jest/express.
- Zero runtime dependencies. Only devDependencies: `@types/bun`, `typescript`.
- TypeScript strict mode (tsconfig already strict). Never use `any`. Prefer inference and `satisfies`.
- Audio is NEVER transcoded. The only encode anywhere is the test-clip video (H.264).
- All subprocess invocations are argv string arrays. Never build shell strings; paths with spaces must survive.
- User-facing `--track` is always the MKVToolNix track ID from `mkvmerge -J`. FFmpeg selectors are internal only.
- Positive `--delay-ms` delays audio; negative advances it. Negative values must be passed as `--delay-ms=-250` (equals form) because `parseArgs` rejects a leading-dash value token.
- Docs/README examples use PowerShell syntax. The CLI itself must work on Windows, macOS, Linux.
- Error type is `CliError` (message + exit code); the CLI prints `tracksmith: <message>` to stderr and exits non-zero.
- Import specifiers include the `.ts` extension (tsconfig has `allowImportingTsExtensions`).
- Commits: when tasks run in parallel via the orchestrator, **workers must NOT run git commands**; the orchestrator commits atomically per task after each wave. When executed sequentially by a single engineer, perform each task's Commit step as written.

## File Structure

```
src/
  types.ts             shared contracts: RunResult, Runner, Track, CliError, CommandDeps
  runner.ts            BunRunner (Bun.spawn implementation of Runner)
  tools.ts             ToolName, findMissingTools, installHint, requireTools
  probe.ts             parseMkvmergeJson, probeTracks, requireAudioTrack, audioRelativeIndex
  output.ts            stemPath, default output names, ensureWritable (overwrite policy)
  commands/
    inspect.ts         formatTrackTable, inspectCommand
    extract.ts         buildExtractArgs, extractCommand
    test-clip.ts       parseTimeToSeconds, buildTestClipArgs, testClipCommand
    mux.ts             resolveAudioTrackId, buildMuxArgs, muxCommand
  cli.ts               entry point: shebang, parseArgs dispatch, runCli
tests/
  helpers.ts           FakeRunner, SAMPLE_MKVMERGE_JSON fixture
  runner.test.ts  tools.test.ts  probe.test.ts  output.test.ts
  inspect.test.ts  extract.test.ts  test-clip.test.ts  mux.test.ts  cli.test.ts
README.md              PowerShell-flavored usage docs
```

## Execution waves

| Wave | Tasks | Parallel? |
|------|-------|-----------|
| 0 | Task 1 (setup + contracts) | no |
| 1 | Tasks 2, 3, 4, 5 | yes — disjoint files |
| 2 | Tasks 6, 7, 8, 9 | yes — disjoint files |
| 3 | Task 10 (cli.ts) | no |
| 4 | Task 11 (README + full verification) | no |

Wave N starts only after every task in wave N−1 is complete and its tests pass.

---

### Task 1: Project setup and shared contracts

**Files:**
- Modify: `package.json`
- Delete: `index.ts`
- Create: `src/types.ts`
- Create: `tests/helpers.ts`
- Test: `tests/helpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (everything later tasks import): `RunResult`, `Runner`, `Track`, `CliError`, `CommandDeps` from `src/types.ts`; `FakeRunner`, `SAMPLE_MKVMERGE_JSON` from `tests/helpers.ts`.

- [ ] **Step 1: Replace `package.json`**

```json
{
  "name": "tracksmith",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": {
    "tracksmith": "./src/cli.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

Note: `private: true` stays until npm publication (out of scope for v1). `bin` points at `src/cli.ts`, which Task 10 creates with a `#!/usr/bin/env bun` shebang.

- [ ] **Step 2: Delete `index.ts`** (bun init boilerplate) and run `bun install`.

- [ ] **Step 3: Create `src/types.ts`**

```ts
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Runner {
  run(argv: readonly string[]): Promise<RunResult>;
}

export interface Track {
  id: number;
  type: string;
  codec: string;
  language?: string;
  name?: string;
  channels?: number;
  isDefault: boolean;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface CommandDeps {
  runner: Runner;
  isTTY: boolean;
  confirm: (message: string) => Promise<boolean>;
  exists?: (path: string) => boolean;
  which?: (cmd: string) => string | null;
}
```

- [ ] **Step 4: Create `tests/helpers.ts`**

```ts
import type { Runner, RunResult } from "../src/types.ts";

export class FakeRunner implements Runner {
  calls: string[][] = [];
  private results: RunResult[] = [];

  queue(result: Partial<RunResult>): void {
    this.results.push({ exitCode: 0, stdout: "", stderr: "", ...result });
  }

  async run(argv: readonly string[]): Promise<RunResult> {
    this.calls.push([...argv]);
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}

export const SAMPLE_MKVMERGE_JSON = JSON.stringify({
  container: { type: "Matroska" },
  tracks: [
    { id: 0, type: "video", codec: "HEVC", properties: { language: "und", default_track: true } },
    {
      id: 1,
      type: "audio",
      codec: "AC-3",
      properties: { language: "eng", track_name: "Surround 5.1", audio_channels: 6, default_track: true },
    },
    {
      id: 2,
      type: "audio",
      codec: "E-AC-3",
      properties: { language: "eng", track_name: "TrueHD companion", audio_channels: 8, default_track: false },
    },
    { id: 3, type: "subtitles", codec: "SubRip/SRT", properties: { language: "eng", default_track: false } },
  ],
});
```

- [ ] **Step 5: Write `tests/helpers.test.ts`** (proves the fake works; gives Wave 0 a green test run)

```ts
import { expect, test } from "bun:test";
import { FakeRunner } from "./helpers.ts";

test("FakeRunner records argv and replays queued results in order", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: "first", exitCode: 0 });
  runner.queue({ stderr: "boom", exitCode: 2 });

  const one = await runner.run(["mkvmerge", "-J", "a file.mkv"]);
  const two = await runner.run(["ffmpeg", "-i", "b.mkv"]);

  expect(runner.calls).toEqual([
    ["mkvmerge", "-J", "a file.mkv"],
    ["ffmpeg", "-i", "b.mkv"],
  ]);
  expect(one).toEqual({ exitCode: 0, stdout: "first", stderr: "" });
  expect(two).toEqual({ exitCode: 2, stdout: "", stderr: "boom" });
});

test("FakeRunner returns a success default when nothing is queued", async () => {
  const runner = new FakeRunner();
  expect(await runner.run(["mkvmerge"])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});
```

- [ ] **Step 6: Verify**

Run: `bun test` → both tests PASS. Run: `bun x tsc --noEmit` → no errors.

- [ ] **Step 7: Commit** *(orchestrator when parallel)*

```bash
git add package.json src/types.ts tests/helpers.ts tests/helpers.test.ts
git rm index.ts
git commit -m "feat: 🏗️ project scaffold, shared contracts, fake runner"
```

---

### Task 2: BunRunner

**Files:**
- Create: `src/runner.ts`
- Test: `tests/runner.test.ts`

**Interfaces:**
- Consumes: `Runner`, `RunResult` from `src/types.ts` (Task 1).
- Produces: `class BunRunner implements Runner` with `run(argv: readonly string[]): Promise<RunResult>`.

- [ ] **Step 1: Write failing test `tests/runner.test.ts`**

Uses Bun itself as the spawned executable so no media tools are needed.

```ts
import { expect, test } from "bun:test";
import { BunRunner } from "../src/runner.ts";

test("BunRunner captures stdout, stderr, and exit code", async () => {
  const runner = new BunRunner();
  const result = await runner.run([
    process.execPath,
    "-e",
    "console.log('out'); console.error('err'); process.exit(3);",
  ]);
  expect(result.stdout.trim()).toBe("out");
  expect(result.stderr.trim()).toBe("err");
  expect(result.exitCode).toBe(3);
});

test("BunRunner passes argv entries through verbatim (spaces intact)", async () => {
  const runner = new BunRunner();
  const result = await runner.run([
    process.execPath,
    "-e",
    "console.log(process.argv[2]);",
    "path with spaces.mkv",
  ]);
  expect(result.stdout.trim()).toBe("path with spaces.mkv");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/runner.test.ts` — Expected: FAIL (module `../src/runner.ts` not found).

- [ ] **Step 3: Implement `src/runner.ts`**

```ts
import type { Runner, RunResult } from "./types.ts";

export class BunRunner implements Runner {
  async run(argv: readonly string[]): Promise<RunResult> {
    const proc = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }
}
```

Missing executables are prevented up front by `requireTools` (Task 3) in the CLI, so `BunRunner` stays thin.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/runner.test.ts` — Expected: PASS (2 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat: ✨ Bun.spawn-backed process runner"
```

---

### Task 3: Tool detection

**Files:**
- Create: `src/tools.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `CliError` from `src/types.ts` (Task 1).
- Produces:
  - `const TOOLS = ["ffmpeg", "ffprobe", "mkvmerge"] as const`
  - `type ToolName = (typeof TOOLS)[number]`
  - `type WhichFn = (cmd: string) => string | null`
  - `findMissingTools(needed: readonly ToolName[], which?: WhichFn): ToolName[]`
  - `installHint(tool: ToolName): string`
  - `requireTools(needed: readonly ToolName[], which?: WhichFn): void` — throws `CliError` listing every missing tool with its install hint.

- [ ] **Step 1: Write failing test `tests/tools.test.ts`**

```ts
import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { findMissingTools, installHint, requireTools } from "../src/tools.ts";

const nonePresent = () => null;
const allPresent = (cmd: string) => `/usr/bin/${cmd}`;

test("findMissingTools reports only tools which() cannot resolve", () => {
  const onlyFfmpeg = (cmd: string) => (cmd === "ffmpeg" ? "/usr/bin/ffmpeg" : null);
  expect(findMissingTools(["ffmpeg", "mkvmerge"], onlyFfmpeg)).toEqual(["mkvmerge"]);
  expect(findMissingTools(["ffmpeg", "ffprobe", "mkvmerge"], allPresent)).toEqual([]);
});

test("requireTools passes silently when everything is present", () => {
  expect(() => requireTools(["ffmpeg", "mkvmerge"], allPresent)).not.toThrow();
});

test("requireTools throws a CliError naming every missing tool with an install hint", () => {
  try {
    requireTools(["ffmpeg", "mkvmerge"], nonePresent);
    throw new Error("expected CliError");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("ffmpeg");
    expect(message).toContain("mkvmerge");
    expect(message).toContain(installHint("ffmpeg"));
    expect(message).toContain(installHint("mkvmerge"));
  }
});

test("install hints cover Windows, macOS, and Linux", () => {
  for (const tool of ["ffmpeg", "ffprobe", "mkvmerge"] as const) {
    const hint = installHint(tool);
    expect(hint).toContain("winget");
    expect(hint).toContain("brew");
    expect(hint).toContain("apt");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/tools.ts`**

```ts
import { CliError } from "./types.ts";

export const TOOLS = ["ffmpeg", "ffprobe", "mkvmerge"] as const;
export type ToolName = (typeof TOOLS)[number];
export type WhichFn = (cmd: string) => string | null;

const INSTALL_HINTS = {
  ffmpeg: "Windows: winget install Gyan.FFmpeg | macOS: brew install ffmpeg | Linux: sudo apt install ffmpeg",
  ffprobe:
    "ffprobe ships with FFmpeg. Windows: winget install Gyan.FFmpeg | macOS: brew install ffmpeg | Linux: sudo apt install ffmpeg",
  mkvmerge:
    "Windows: winget install MoritzBunkus.MKVToolNix | macOS: brew install mkvtoolnix | Linux: sudo apt install mkvtoolnix",
} satisfies Record<ToolName, string>;

export function installHint(tool: ToolName): string {
  return INSTALL_HINTS[tool];
}

export function findMissingTools(needed: readonly ToolName[], which: WhichFn = Bun.which): ToolName[] {
  return needed.filter((tool) => which(tool) === null);
}

export function requireTools(needed: readonly ToolName[], which: WhichFn = Bun.which): void {
  const missing = findMissingTools(needed, which);
  if (missing.length === 0) return;
  const lines = missing.map((tool) => `  ${tool}: not found on PATH. Install: ${installHint(tool)}`);
  throw new CliError(`Missing required tools:\n${lines.join("\n")}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: ✨ external tool detection with install hints"
```

---

### Task 4: Probe (mkvmerge -J)

**Files:**
- Create: `src/probe.ts`
- Test: `tests/probe.test.ts`

**Interfaces:**
- Consumes: `Runner`, `Track`, `CliError` from `src/types.ts`; `FakeRunner`, `SAMPLE_MKVMERGE_JSON` from `tests/helpers.ts` (Task 1).
- Produces:
  - `parseMkvmergeJson(json: string): Track[]`
  - `probeTracks(runner: Runner, file: string): Promise<Track[]>` — runs `["mkvmerge", "-J", file]`; throws `CliError` when mkvmerge exit code is ≥ 2 or JSON is unparseable.
  - `requireAudioTrack(tracks: Track[], id: number): Track` — throws `CliError` listing valid audio IDs when `id` is absent or not audio.
  - `audioRelativeIndex(tracks: Track[], id: number): number` — 0-based position of `id` among audio tracks in file order (for ffmpeg `1:a:<n>` mapping).

- [ ] **Step 1: Write failing test `tests/probe.test.ts`**

```ts
import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { audioRelativeIndex, parseMkvmergeJson, probeTracks, requireAudioTrack } from "../src/probe.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

test("parseMkvmergeJson maps mkvmerge fields onto Track", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(tracks).toHaveLength(4);
  expect(tracks[1]).toEqual({
    id: 1,
    type: "audio",
    codec: "AC-3",
    language: "eng",
    name: "Surround 5.1",
    channels: 6,
    isDefault: true,
  });
  expect(tracks[0]?.channels).toBeUndefined();
  expect(tracks[3]?.isDefault).toBe(false);
});

test("parseMkvmergeJson throws CliError on garbage input", () => {
  expect(() => parseMkvmergeJson("not json")).toThrow(CliError);
});

test("probeTracks invokes mkvmerge -J with the file path verbatim", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const tracks = await probeTracks(runner, "D:\\media\\a file.mkv");
  expect(runner.calls).toEqual([["mkvmerge", "-J", "D:\\media\\a file.mkv"]]);
  expect(tracks).toHaveLength(4);
});

test("probeTracks throws CliError when mkvmerge cannot read the file", async () => {
  const runner = new FakeRunner();
  runner.queue({ exitCode: 2, stderr: "unsupported container" });
  await expect(probeTracks(runner, "broken.mkv")).rejects.toThrow(CliError);
});

test("requireAudioTrack returns the audio track for a valid id", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(requireAudioTrack(tracks, 2).codec).toBe("E-AC-3");
});

test("requireAudioTrack rejects missing and non-audio ids, listing valid audio ids", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(() => requireAudioTrack(tracks, 9)).toThrow(/Valid audio track IDs: 1, 2/);
  expect(() => requireAudioTrack(tracks, 0)).toThrow(/is video, not audio/);
});

test("audioRelativeIndex maps MKVToolNix ids to audio-relative order", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(audioRelativeIndex(tracks, 1)).toBe(0);
  expect(audioRelativeIndex(tracks, 2)).toBe(1);
  expect(() => audioRelativeIndex(tracks, 0)).toThrow(CliError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/probe.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/probe.ts`**

```ts
import type { Runner, Track } from "./types.ts";
import { CliError } from "./types.ts";

interface MkvmergeTrack {
  id: number;
  type: string;
  codec: string;
  properties?: {
    language?: string;
    track_name?: string;
    audio_channels?: number;
    default_track?: boolean;
  };
}

export function parseMkvmergeJson(json: string): Track[] {
  let parsed: { tracks?: MkvmergeTrack[] };
  try {
    parsed = JSON.parse(json) as { tracks?: MkvmergeTrack[] };
  } catch {
    throw new CliError("Could not parse mkvmerge -J output as JSON.");
  }
  return (parsed.tracks ?? []).map((track) => ({
    id: track.id,
    type: track.type,
    codec: track.codec,
    language: track.properties?.language,
    name: track.properties?.track_name,
    channels: track.properties?.audio_channels,
    isDefault: track.properties?.default_track ?? false,
  }));
}

export async function probeTracks(runner: Runner, file: string): Promise<Track[]> {
  const result = await runner.run(["mkvmerge", "-J", file]);
  if (result.exitCode >= 2) {
    throw new CliError(`mkvmerge could not read "${file}":\n${result.stderr || result.stdout}`);
  }
  return parseMkvmergeJson(result.stdout);
}

function validAudioIds(tracks: Track[]): string {
  const ids = tracks.filter((track) => track.type === "audio").map((track) => track.id);
  return `Valid audio track IDs: ${ids.length > 0 ? ids.join(", ") : "none"}`;
}

export function requireAudioTrack(tracks: Track[], id: number): Track {
  const track = tracks.find((candidate) => candidate.id === id);
  if (!track) throw new CliError(`Track ${id} does not exist. ${validAudioIds(tracks)}`);
  if (track.type !== "audio") throw new CliError(`Track ${id} is ${track.type}, not audio. ${validAudioIds(tracks)}`);
  return track;
}

export function audioRelativeIndex(tracks: Track[], id: number): number {
  const index = tracks.filter((track) => track.type === "audio").findIndex((track) => track.id === id);
  if (index === -1) throw new CliError(`Track ${id} is not an audio track. ${validAudioIds(tracks)}`);
  return index;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/probe.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/probe.ts tests/probe.test.ts
git commit -m "feat: ✨ mkvmerge -J probing and track validation"
```

---

### Task 5: Output naming and overwrite policy

**Files:**
- Create: `src/output.ts`
- Test: `tests/output.test.ts`

**Interfaces:**
- Consumes: `CliError` from `src/types.ts` (Task 1).
- Produces:
  - `stemPath(file: string): string` — path minus final extension.
  - `defaultExtractOutput(source: string, trackId: number): string` — `<stem>.track<id>.mka`.
  - `defaultTestClipOutput(video: string): string` — `<stem>.sync-test.mkv`.
  - `interface OverwriteContext { force: boolean; isTTY: boolean; confirm: (message: string) => Promise<boolean>; exists?: (path: string) => boolean }`
  - `ensureWritable(path: string, ctx: OverwriteContext): Promise<void>` — resolves when writing is allowed; throws `CliError` when the user declines or when non-TTY without `--force`.

- [ ] **Step 1: Write failing test `tests/output.test.ts`**

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CliError } from "../src/types.ts";
import { defaultExtractOutput, defaultTestClipOutput, ensureWritable, stemPath } from "../src/output.ts";

test("default output names sit next to the input, extension replaced", () => {
  const source = join("media", "Movie (2023).mkv");
  expect(defaultExtractOutput(source, 2)).toBe(join("media", "Movie (2023).track2.mka"));
  expect(defaultTestClipOutput(source)).toBe(join("media", "Movie (2023).sync-test.mkv"));
});

test("stemPath handles files without an extension", () => {
  expect(stemPath(join("media", "noext"))).toBe(join("media", "noext"));
});

const base = { confirm: async () => true, exists: () => true };

test("ensureWritable resolves when the file does not exist", async () => {
  await expect(
    ensureWritable("out.mka", { force: false, isTTY: false, confirm: async () => false, exists: () => false }),
  ).resolves.toBeUndefined();
});

test("ensureWritable resolves with --force without prompting", async () => {
  let prompted = false;
  await expect(
    ensureWritable("out.mka", {
      ...base,
      force: true,
      isTTY: true,
      confirm: async () => {
        prompted = true;
        return false;
      },
    }),
  ).resolves.toBeUndefined();
  expect(prompted).toBe(false);
});

test("ensureWritable prompts on a TTY and honors the answer", async () => {
  await expect(ensureWritable("out.mka", { ...base, force: false, isTTY: true })).resolves.toBeUndefined();
  await expect(
    ensureWritable("out.mka", { ...base, force: false, isTTY: true, confirm: async () => false }),
  ).rejects.toThrow(/Aborted/);
});

test("ensureWritable refuses in non-interactive sessions, suggesting --force", async () => {
  const attempt = ensureWritable("out.mka", { ...base, force: false, isTTY: false });
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(/--force/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/output.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/output.ts`**

```ts
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { CliError } from "./types.ts";

export function stemPath(file: string): string {
  return join(dirname(file), basename(file, extname(file)));
}

export function defaultExtractOutput(source: string, trackId: number): string {
  return `${stemPath(source)}.track${trackId}.mka`;
}

export function defaultTestClipOutput(video: string): string {
  return `${stemPath(video)}.sync-test.mkv`;
}

export interface OverwriteContext {
  force: boolean;
  isTTY: boolean;
  confirm: (message: string) => Promise<boolean>;
  exists?: (path: string) => boolean;
}

export async function ensureWritable(path: string, ctx: OverwriteContext): Promise<void> {
  const exists = ctx.exists ?? existsSync;
  if (!exists(path)) return;
  if (ctx.force) return;
  if (!ctx.isTTY) {
    throw new CliError(`Output "${path}" already exists. Pass --force to overwrite (cannot prompt in a non-interactive session).`);
  }
  const approved = await ctx.confirm(`Output "${path}" already exists. Overwrite?`);
  if (!approved) throw new CliError("Aborted: existing output left untouched.");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/output.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat: ✨ default output naming and overwrite policy"
```

---

### Task 6: `inspect` command

**Files:**
- Create: `src/commands/inspect.ts`
- Test: `tests/inspect.test.ts`

**Interfaces:**
- Consumes: `Track`, `CommandDeps` from `src/types.ts`; `probeTracks` from `src/probe.ts`; `FakeRunner`, `SAMPLE_MKVMERGE_JSON` from `tests/helpers.ts`.
- Produces:
  - `formatTrackTable(tracks: Track[]): string`
  - `inspectCommand(file: string, deps: CommandDeps): Promise<string>` — returns the table text (caller prints it).

- [ ] **Step 1: Write failing test `tests/inspect.test.ts`**

```ts
import { expect, test } from "bun:test";
import { formatTrackTable, inspectCommand } from "../src/commands/inspect.ts";
import { parseMkvmergeJson } from "../src/probe.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

test("formatTrackTable renders aligned columns with placeholders for missing values", () => {
  const table = formatTrackTable(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON));
  const lines = table.split("\n");
  expect(lines[0]).toMatch(/^ID\s+TYPE\s+CODEC\s+LANG\s+CH\s+DEFAULT\s+NAME$/);
  expect(lines).toHaveLength(5);
  expect(lines[1]).toContain("video");
  expect(lines[1]).toContain("-"); // video has no channel count
  expect(lines[2]).toContain("Surround 5.1");
  expect(lines[2]).toContain("yes");
});

test("inspectCommand probes the file and returns the table", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const out = await inspectCommand("movie.mkv", { runner, isTTY: false, confirm: async () => false });
  expect(runner.calls).toEqual([["mkvmerge", "-J", "movie.mkv"]]);
  expect(out).toContain("E-AC-3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/inspect.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/commands/inspect.ts`**

```ts
import type { CommandDeps, Track } from "../types.ts";
import { probeTracks } from "../probe.ts";

export function formatTrackTable(tracks: Track[]): string {
  const header = ["ID", "TYPE", "CODEC", "LANG", "CH", "DEFAULT", "NAME"];
  const rows = tracks.map((track) => [
    String(track.id),
    track.type,
    track.codec,
    track.language ?? "-",
    track.channels !== undefined ? String(track.channels) : "-",
    track.isDefault ? "yes" : "-",
    track.name ?? "-",
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...all.map((row) => row[column]!.length)));
  return all
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd())
    .join("\n");
}

export async function inspectCommand(file: string, deps: CommandDeps): Promise<string> {
  return formatTrackTable(await probeTracks(deps.runner, file));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/inspect.test.ts` — Expected: PASS (2 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/commands/inspect.ts tests/inspect.test.ts
git commit -m "feat: ✨ inspect command with track table"
```

---

### Task 7: `extract` command

**Files:**
- Create: `src/commands/extract.ts`
- Test: `tests/extract.test.ts`

**Interfaces:**
- Consumes: `CommandDeps`, `CliError` from `src/types.ts`; `probeTracks`, `requireAudioTrack` from `src/probe.ts`; `defaultExtractOutput`, `ensureWritable` from `src/output.ts`; test helpers.
- Produces:
  - `buildExtractArgs(opts: { file: string; track: number; output: string }): string[]`
  - `extractCommand(opts: { file: string; track: number; output?: string; force: boolean }, deps: CommandDeps): Promise<string>` — returns the output path written.

- [ ] **Step 1: Write failing test `tests/extract.test.ts`**

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CliError } from "../src/types.ts";
import { buildExtractArgs, extractCommand } from "../src/commands/extract.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

test("buildExtractArgs keeps only the chosen audio track, stream-copied to MKA", () => {
  expect(buildExtractArgs({ file: "in dir/movie.mkv", track: 2, output: "out dir/movie.track2.mka" })).toEqual([
    "mkvmerge",
    "-o",
    "out dir/movie.track2.mka",
    "--audio-tracks",
    "2",
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
    "in dir/movie.mkv",
  ]);
});

const deps = { isTTY: false, confirm: async () => false, exists: () => false };

test("extractCommand validates the track, applies the default output name, and runs mkvmerge", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe
  runner.queue({ exitCode: 0 }); // extract
  const output = await extractCommand({ file: join("m", "movie.mkv"), track: 2, force: false }, { ...deps, runner });
  expect(output).toBe(join("m", "movie.track2.mka"));
  expect(runner.calls[0]).toEqual(["mkvmerge", "-J", join("m", "movie.mkv")]);
  expect(runner.calls[1]?.[2]).toBe(join("m", "movie.track2.mka"));
});

test("extractCommand rejects non-audio tracks before running mkvmerge", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  await expect(extractCommand({ file: "movie.mkv", track: 0, force: false }, { ...deps, runner })).rejects.toThrow(
    /not audio/,
  );
  expect(runner.calls).toHaveLength(1); // probe only
});

test("extractCommand surfaces mkvmerge failures with exit code and stderr", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ exitCode: 2, stderr: "disk full" });
  const attempt = extractCommand({ file: "movie.mkv", track: 1, force: false }, { ...deps, runner });
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(/disk full/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/extract.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/commands/extract.ts`**

```ts
import type { CommandDeps } from "../types.ts";
import { CliError } from "../types.ts";
import { probeTracks, requireAudioTrack } from "../probe.ts";
import { defaultExtractOutput, ensureWritable } from "../output.ts";

export function buildExtractArgs(opts: { file: string; track: number; output: string }): string[] {
  return [
    "mkvmerge",
    "-o",
    opts.output,
    "--audio-tracks",
    String(opts.track),
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
    opts.file,
  ];
}

export async function extractCommand(
  opts: { file: string; track: number; output?: string; force: boolean },
  deps: CommandDeps,
): Promise<string> {
  const tracks = await probeTracks(deps.runner, opts.file);
  requireAudioTrack(tracks, opts.track);
  const output = opts.output ?? defaultExtractOutput(opts.file, opts.track);
  await ensureWritable(output, { force: opts.force, isTTY: deps.isTTY, confirm: deps.confirm, exists: deps.exists });
  const result = await deps.runner.run(buildExtractArgs({ file: opts.file, track: opts.track, output }));
  if (result.exitCode >= 2) {
    throw new CliError(`mkvmerge failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/extract.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/commands/extract.ts tests/extract.test.ts
git commit -m "feat: ✨ lossless audio extract command"
```

---

### Task 8: `test-clip` command

**Files:**
- Create: `src/commands/test-clip.ts`
- Test: `tests/test-clip.test.ts`

**Interfaces:**
- Consumes: `CommandDeps`, `CliError` from `src/types.ts`; `probeTracks`, `requireAudioTrack`, `audioRelativeIndex` from `src/probe.ts`; `defaultTestClipOutput`, `ensureWritable` from `src/output.ts`; test helpers.
- Produces:
  - `parseTimeToSeconds(value: string): number` — accepts `"90"`, `"90.5"`, or `"HH:MM:SS[.ms]"`; `CliError` otherwise.
  - `buildTestClipArgs(a: { video: string; audio: string; audioStreamIndex: number; startSeconds: number; durationSeconds: number; delayMs: number; output: string }): string[]`
  - `testClipCommand(opts: { video: string; audio: string; track: number; start: string; duration: string; delayMs: number; output?: string; force: boolean }, deps: CommandDeps): Promise<string>` — returns the output path written.

Delay model: positive `delayMs` must delay audio, so the audio input seeks *earlier* by `delayMs` (audio seek = start − delay/1000). A negative resulting seek is a `CliError` telling the user to pick a later `--start`.

- [ ] **Step 1: Write failing test `tests/test-clip.test.ts`**

```ts
import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { buildTestClipArgs, parseTimeToSeconds, testClipCommand } from "../src/commands/test-clip.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

test("parseTimeToSeconds accepts seconds and HH:MM:SS[.ms]", () => {
  expect(parseTimeToSeconds("90")).toBe(90);
  expect(parseTimeToSeconds("90.5")).toBe(90.5);
  expect(parseTimeToSeconds("01:02:03")).toBe(3723);
  expect(parseTimeToSeconds("00:00:05.25")).toBe(5.25);
  expect(() => parseTimeToSeconds("5m")).toThrow(CliError);
  expect(() => parseTimeToSeconds("1:99:00")).toThrow(CliError);
});

test("buildTestClipArgs re-encodes video, copies audio, and offsets the audio seek by the delay", () => {
  const args = buildTestClipArgs({
    video: "target movie.mkv",
    audio: "donor.mkv",
    audioStreamIndex: 1,
    startSeconds: 600,
    durationSeconds: 60,
    delayMs: 250,
    output: "target movie.sync-test.mkv",
  });
  expect(args).toEqual([
    "ffmpeg",
    "-hide_banner",
    "-nostdin",
    "-ss",
    "600",
    "-t",
    "60",
    "-i",
    "target movie.mkv",
    "-ss",
    "599.75",
    "-t",
    "60",
    "-i",
    "donor.mkv",
    "-map",
    "0:v:0",
    "-map",
    "1:a:1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "copy",
    "-sn",
    "-y",
    "target movie.sync-test.mkv",
  ]);
});

test("buildTestClipArgs advances audio for negative delay", () => {
  const args = buildTestClipArgs({
    video: "v.mkv",
    audio: "a.mkv",
    audioStreamIndex: 0,
    startSeconds: 10,
    durationSeconds: 30,
    delayMs: -500,
    output: "out.mkv",
  });
  const audioSeek = args[args.indexOf("-i") + 3]; // second -ss value
  expect(args).toContain("10.5");
  expect(audioSeek).toBeDefined();
});

test("buildTestClipArgs rejects a delay that would seek before zero", () => {
  expect(() =>
    buildTestClipArgs({
      video: "v.mkv",
      audio: "a.mkv",
      audioStreamIndex: 0,
      startSeconds: 0.1,
      durationSeconds: 30,
      delayMs: 500,
      output: "out.mkv",
    }),
  ).toThrow(/later --start/);
});

const deps = { isTTY: false, confirm: async () => false, exists: () => false };

test("testClipCommand probes the donor, maps the audio-relative index, and runs ffmpeg", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe donor
  runner.queue({ exitCode: 0 }); // ffmpeg
  const output = await testClipCommand(
    { video: "target.mkv", audio: "donor.mkv", track: 2, start: "600", duration: "60", delayMs: 0, force: false },
    { ...deps, runner },
  );
  expect(output).toBe("target.sync-test.mkv");
  expect(runner.calls[0]).toEqual(["mkvmerge", "-J", "donor.mkv"]);
  const ffmpeg = runner.calls[1]!;
  expect(ffmpeg[0]).toBe("ffmpeg");
  expect(ffmpeg).toContain("1:a:1"); // track id 2 is the second audio track
});

test("testClipCommand surfaces ffmpeg failures", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ exitCode: 1, stderr: "encoder error" });
  await expect(
    testClipCommand(
      { video: "t.mkv", audio: "d.mkv", track: 1, start: "0", duration: "60", delayMs: 0, force: false },
      { ...deps, runner },
    ),
  ).rejects.toThrow(/encoder error/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/test-clip.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/commands/test-clip.ts`**

```ts
import type { CommandDeps } from "../types.ts";
import { CliError } from "../types.ts";
import { audioRelativeIndex, probeTracks, requireAudioTrack } from "../probe.ts";
import { defaultTestClipOutput, ensureWritable } from "../output.ts";

export function parseTimeToSeconds(value: string): number {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/.exec(value);
  if (!match) throw new CliError(`Invalid time "${value}". Use seconds (90 or 90.5) or HH:MM:SS[.ms].`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function buildTestClipArgs(a: {
  video: string;
  audio: string;
  audioStreamIndex: number;
  startSeconds: number;
  durationSeconds: number;
  delayMs: number;
  output: string;
}): string[] {
  const audioSeek = a.startSeconds - a.delayMs / 1000;
  if (audioSeek < 0) {
    throw new CliError(
      `--start ${a.startSeconds}s with --delay-ms ${a.delayMs} would seek before the file begins; pick a later --start.`,
    );
  }
  // -y is safe: our own overwrite policy (ensureWritable) has already run.
  return [
    "ffmpeg",
    "-hide_banner",
    "-nostdin",
    "-ss",
    String(a.startSeconds),
    "-t",
    String(a.durationSeconds),
    "-i",
    a.video,
    "-ss",
    String(audioSeek),
    "-t",
    String(a.durationSeconds),
    "-i",
    a.audio,
    "-map",
    "0:v:0",
    "-map",
    `1:a:${a.audioStreamIndex}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "copy",
    "-sn",
    "-y",
    a.output,
  ];
}

export async function testClipCommand(
  opts: {
    video: string;
    audio: string;
    track: number;
    start: string;
    duration: string;
    delayMs: number;
    output?: string;
    force: boolean;
  },
  deps: CommandDeps,
): Promise<string> {
  const donorTracks = await probeTracks(deps.runner, opts.audio);
  requireAudioTrack(donorTracks, opts.track);
  const output = opts.output ?? defaultTestClipOutput(opts.video);
  await ensureWritable(output, { force: opts.force, isTTY: deps.isTTY, confirm: deps.confirm, exists: deps.exists });
  const result = await deps.runner.run(
    buildTestClipArgs({
      video: opts.video,
      audio: opts.audio,
      audioStreamIndex: audioRelativeIndex(donorTracks, opts.track),
      startSeconds: parseTimeToSeconds(opts.start),
      durationSeconds: parseTimeToSeconds(opts.duration),
      delayMs: opts.delayMs,
      output,
    }),
  );
  if (result.exitCode !== 0) {
    throw new CliError(`ffmpeg failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/test-clip.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/commands/test-clip.ts tests/test-clip.test.ts
git commit -m "feat: ✨ sync test-clip command"
```

---

### Task 9: `mux` command

**Files:**
- Create: `src/commands/mux.ts`
- Test: `tests/mux.test.ts`

**Interfaces:**
- Consumes: `CommandDeps`, `CliError`, `Track` from `src/types.ts`; `probeTracks`, `requireAudioTrack` from `src/probe.ts`; `ensureWritable` from `src/output.ts`; test helpers.
- Produces:
  - `resolveAudioTrackId(tracks: Track[], requested: number | undefined): number` — requested id validated via `requireAudioTrack`; when omitted: the single audio track's id, or `CliError` if the file has zero or multiple audio tracks ("pass --track; see tracksmith inspect").
  - `buildMuxArgs(a: { video: string; audio: string; audioTrackId: number; delayMs: number; language?: string; trackName?: string; makeDefault: boolean; output: string }): string[]`
  - `muxCommand(opts: { video: string; audio: string; track?: number; delayMs: number; language?: string; name?: string; makeDefault: boolean; output: string; force: boolean }, deps: CommandDeps): Promise<string>`

mkvmerge argument-order rule (critical): per-track options apply to the **next** input file on the command line. So the appended-audio options (`--audio-tracks`, `--sync`, `--language`, `--track-name`, `--default-track-flag`, `--no-video`, …) must appear **after** the target video path and **before** the audio file path. The target video is passed first with no options so all of its tracks, chapters, and metadata are retained.

`--default-track-flag` is always set explicitly (`yes` when `--default`, otherwise `no`) so a donor track's own default flag never sneaks in and competes with the target's default audio.

- [ ] **Step 1: Write failing test `tests/mux.test.ts`**

```ts
import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { parseMkvmergeJson } from "../src/probe.ts";
import { buildMuxArgs, muxCommand, resolveAudioTrackId } from "../src/commands/mux.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

const SINGLE_AUDIO_MKA = JSON.stringify({
  container: { type: "Matroska" },
  tracks: [{ id: 0, type: "audio", codec: "E-AC-3", properties: { language: "eng", audio_channels: 8 } }],
});

test("resolveAudioTrackId uses the only audio track when --track is omitted", () => {
  expect(resolveAudioTrackId(parseMkvmergeJson(SINGLE_AUDIO_MKA), undefined)).toBe(0);
});

test("resolveAudioTrackId requires --track when several audio tracks exist", () => {
  expect(() => resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), undefined)).toThrow(/--track/);
});

test("resolveAudioTrackId validates an explicit id", () => {
  expect(resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), 2)).toBe(2);
  expect(() => resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), 0)).toThrow(CliError);
});

test("buildMuxArgs orders audio options after the target and before the audio input", () => {
  const args = buildMuxArgs({
    video: "target (2023).mkv",
    audio: "donor.mkv",
    audioTrackId: 2,
    delayMs: -250,
    language: "eng",
    trackName: "Fixed Audio",
    makeDefault: true,
    output: "final.mkv",
  });
  expect(args).toEqual([
    "mkvmerge",
    "-o",
    "final.mkv",
    "target (2023).mkv",
    "--audio-tracks",
    "2",
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
    "--sync",
    "2:-250",
    "--language",
    "2:eng",
    "--track-name",
    "2:Fixed Audio",
    "--default-track-flag",
    "2:yes",
    "donor.mkv",
  ]);
});

test("buildMuxArgs omits --sync at zero delay and forces default-track-flag no without --default", () => {
  const args = buildMuxArgs({
    video: "t.mkv",
    audio: "a.mka",
    audioTrackId: 0,
    delayMs: 0,
    makeDefault: false,
    output: "o.mkv",
  });
  expect(args).not.toContain("--sync");
  expect(args).not.toContain("--language");
  expect(args).not.toContain("--track-name");
  expect(args.join(" ")).toContain("--default-track-flag 0:no");
});

const deps = { isTTY: false, confirm: async () => false, exists: () => false };

test("muxCommand probes the audio input, resolves the track, and runs mkvmerge", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SINGLE_AUDIO_MKA }); // probe audio input
  runner.queue({ exitCode: 0 }); // mux
  const output = await muxCommand(
    { video: "target.mkv", audio: "movie.track2.mka", delayMs: 0, makeDefault: false, output: "final.mkv", force: false },
    { ...deps, runner },
  );
  expect(output).toBe("final.mkv");
  expect(runner.calls[0]).toEqual(["mkvmerge", "-J", "movie.track2.mka"]);
  expect(runner.calls[1]?.[0]).toBe("mkvmerge");
  expect(runner.calls[1]).toContain("target.mkv");
});

test("muxCommand surfaces mkvmerge failures", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 2, stderr: "container error" });
  await expect(
    muxCommand(
      { video: "t.mkv", audio: "a.mka", delayMs: 0, makeDefault: false, output: "o.mkv", force: false },
      { ...deps, runner },
    ),
  ).rejects.toThrow(/container error/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mux.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/commands/mux.ts`**

```ts
import type { CommandDeps, Track } from "../types.ts";
import { CliError } from "../types.ts";
import { probeTracks, requireAudioTrack } from "../probe.ts";
import { ensureWritable } from "../output.ts";

export function resolveAudioTrackId(tracks: Track[], requested: number | undefined): number {
  if (requested !== undefined) return requireAudioTrack(tracks, requested).id;
  const audio = tracks.filter((track) => track.type === "audio");
  if (audio.length === 1) return audio[0]!.id;
  if (audio.length === 0) throw new CliError("The audio input contains no audio tracks.");
  throw new CliError(
    `The audio input contains ${audio.length} audio tracks; pass --track <id> (see: tracksmith inspect <file>).`,
  );
}

export function buildMuxArgs(a: {
  video: string;
  audio: string;
  audioTrackId: number;
  delayMs: number;
  language?: string;
  trackName?: string;
  makeDefault: boolean;
  output: string;
}): string[] {
  const id = String(a.audioTrackId);
  const args = [
    "mkvmerge",
    "-o",
    a.output,
    a.video,
    "--audio-tracks",
    id,
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
  ];
  if (a.delayMs !== 0) args.push("--sync", `${id}:${a.delayMs}`);
  if (a.language !== undefined) args.push("--language", `${id}:${a.language}`);
  if (a.trackName !== undefined) args.push("--track-name", `${id}:${a.trackName}`);
  args.push("--default-track-flag", `${id}:${a.makeDefault ? "yes" : "no"}`);
  args.push(a.audio);
  return args;
}

export async function muxCommand(
  opts: {
    video: string;
    audio: string;
    track?: number;
    delayMs: number;
    language?: string;
    name?: string;
    makeDefault: boolean;
    output: string;
    force: boolean;
  },
  deps: CommandDeps,
): Promise<string> {
  const audioTracks = await probeTracks(deps.runner, opts.audio);
  const audioTrackId = resolveAudioTrackId(audioTracks, opts.track);
  await ensureWritable(opts.output, { force: opts.force, isTTY: deps.isTTY, confirm: deps.confirm, exists: deps.exists });
  const result = await deps.runner.run(
    buildMuxArgs({
      video: opts.video,
      audio: opts.audio,
      audioTrackId,
      delayMs: opts.delayMs,
      language: opts.language,
      trackName: opts.name,
      makeDefault: opts.makeDefault,
      output: opts.output,
    }),
  );
  if (result.exitCode >= 2) {
    throw new CliError(`mkvmerge failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
  return opts.output;
}
```

Note: mkvmerge exit code 1 means "completed with warnings" — the file was written, so only exit codes ≥ 2 are failures.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/mux.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/commands/mux.ts tests/mux.test.ts
git commit -m "feat: ✨ mux command with delay, language, and default-flag control"
```

---

### Task 10: CLI entry point

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: everything above — `CommandDeps`, `CliError` (`src/types.ts`), `BunRunner` (`src/runner.ts`), `requireTools` + `ToolName` (`src/tools.ts`), `inspectCommand`, `extractCommand`, `testClipCommand`, `muxCommand`.
- Produces: `runCli(argv: string[], deps: CommandDeps, stdout?: (line: string) => void): Promise<number>` (exported for tests) and an `import.meta.main` entry with a `#!/usr/bin/env bun` shebang.

Behavior contract:
- `tracksmith` with no args or with `--help`/`-h` prints usage; exit 1 when no args, 0 for help.
- Unknown command → usage + exit 1. `parseArgs` errors and `CliError`s print `tracksmith: <message>` to stderr, return the error's exit code.
- Tool preflight per command via `deps.which`: `inspect`/`extract`/`mux` need `["mkvmerge"]`; `test-clip` needs `["ffmpeg", "mkvmerge"]`.
- `--track` and `--delay-ms` parsed with a strict integer helper (`/^-?\d+$/`); `--track` must be ≥ 0. Negative delays use the equals form (`--delay-ms=-250`), documented in usage text.
- `mux` defaults `--language` to `eng`; `extractCommand`/`testClipCommand`/`muxCommand` receive `force` from the parsed `--force` flag; `test-clip` defaults `--duration` to `"60"` and `--delay-ms` to 0.
- On success each command prints what was written (`Wrote <path>`), `inspect` prints the table.

- [ ] **Step 1: Write failing test `tests/cli.test.ts`**

```ts
import { expect, test } from "bun:test";
import type { CommandDeps } from "../src/types.ts";
import { runCli } from "../src/cli.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

function makeDeps(runner: FakeRunner): CommandDeps {
  return {
    runner,
    isTTY: false,
    confirm: async () => false,
    exists: () => false,
    which: (cmd) => `/usr/bin/${cmd}`,
  };
}

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

test("no arguments prints usage and exits 1; --help exits 0", async () => {
  const runner = new FakeRunner();
  const out = capture();
  expect(await runCli([], makeDeps(runner), out.write)).toBe(1);
  expect(out.lines.join("\n")).toContain("Usage");
  expect(await runCli(["--help"], makeDeps(runner), out.write)).toBe(0);
});

test("unknown command exits 1", async () => {
  expect(await runCli(["frobnicate"], makeDeps(new FakeRunner()), () => {})).toBe(1);
});

test("inspect prints the track table", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const out = capture();
  expect(await runCli(["inspect", "movie.mkv"], makeDeps(runner), out.write)).toBe(0);
  expect(out.lines.join("\n")).toContain("E-AC-3");
});

test("extract requires --track and validates it as a non-negative integer", async () => {
  const deps = makeDeps(new FakeRunner());
  expect(await runCli(["extract", "movie.mkv"], deps, () => {})).toBe(1);
  expect(await runCli(["extract", "movie.mkv", "--track", "abc"], deps, () => {})).toBe(1);
  expect(await runCli(["extract", "movie.mkv", "--track=-1"], deps, () => {})).toBe(1);
});

test("extract runs probe then mkvmerge and reports the output", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ exitCode: 0 });
  const out = capture();
  expect(await runCli(["extract", "movie.mkv", "--track", "2"], makeDeps(runner), out.write)).toBe(0);
  expect(runner.calls).toHaveLength(2);
  expect(out.lines.join("\n")).toContain("movie.track2.mka");
});

test("missing tools abort before any subprocess runs", async () => {
  const runner = new FakeRunner();
  const deps: CommandDeps = { ...makeDeps(runner), which: () => null };
  expect(await runCli(["inspect", "movie.mkv"], deps, () => {})).toBe(1);
  expect(runner.calls).toHaveLength(0);
});

test("negative delay is accepted in equals form", async () => {
  const runner = new FakeRunner();
  runner.queue({
    stdout: JSON.stringify({
      tracks: [{ id: 0, type: "audio", codec: "E-AC-3", properties: { audio_channels: 8 } }],
    }),
  });
  runner.queue({ exitCode: 0 });
  const code = await runCli(
    ["mux", "--video", "t.mkv", "--audio", "a.mka", "--delay-ms=-250", "--output", "o.mkv"],
    makeDeps(runner),
    () => {},
  );
  expect(code).toBe(0);
  expect(runner.calls[1]).toContain("0:-250");
});

test("mux requires --output", async () => {
  expect(await runCli(["mux", "--video", "t.mkv", "--audio", "a.mka"], makeDeps(new FakeRunner()), () => {})).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
#!/usr/bin/env bun
import { parseArgs } from "node:util";
import type { CommandDeps } from "./types.ts";
import { CliError } from "./types.ts";
import { BunRunner } from "./runner.ts";
import { requireTools } from "./tools.ts";
import { inspectCommand } from "./commands/inspect.ts";
import { extractCommand } from "./commands/extract.ts";
import { testClipCommand } from "./commands/test-clip.ts";
import { muxCommand } from "./commands/mux.ts";

const USAGE = `tracksmith — inspect, extract, sync-test, and mux Matroska audio tracks

Usage:
  tracksmith inspect <file>
  tracksmith extract <file> --track <id> [--output <file>] [--force]
  tracksmith test-clip --video <target> --audio <donor> --track <id> --start <time>
                       [--duration 60] [--delay-ms 0] [--output <file>] [--force]
  tracksmith mux --video <target> --audio <mka-or-mkv> --output <file>
                 [--track <id>] [--delay-ms 0] [--language eng] [--name <title>]
                 [--default] [--force]

Notes:
  --track is always the MKVToolNix track ID shown by "tracksmith inspect".
  Positive --delay-ms delays audio; negative advances it. Write negatives as --delay-ms=-250.
  Times accept seconds (90, 90.5) or HH:MM:SS[.ms].
  Check sync near the beginning, middle, and end; a changing offset cannot be fixed by one delay.
  Requires ffmpeg and MKVToolNix (mkvmerge) on PATH.`;

function parseIntStrict(value: string | undefined, flag: string): number {
  if (value === undefined) throw new CliError(`${flag} is required.`);
  if (!/^-?\d+$/.test(value)) throw new CliError(`${flag} must be an integer, got "${value}".`);
  return Number(value);
}

function parseTrack(value: string | undefined): number {
  const track = parseIntStrict(value, "--track");
  if (track < 0) throw new CliError(`--track must be >= 0, got ${track}.`);
  return track;
}

// Wraps a parseArgs call so parse failures become CliErrors. Takes a thunk
// (rather than the options object) so parseArgs keeps its precise generic
// inference over each command's inline options literal.
function parseOrCliError<T>(parseFn: () => T): T {
  try {
    return parseFn();
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

export async function runCli(
  argv: string[],
  deps: CommandDeps,
  stdout: (line: string) => void = console.log,
): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined: {
        stdout(USAGE);
        return 1;
      }
      case "--help":
      case "-h": {
        stdout(USAGE);
        return 0;
      }
      case "inspect": {
        const { positionals } = parseOrCliError(() =>
          parseArgs({ args: rest, options: {}, allowPositionals: true, strict: true }),
        );
        const file = positionals[0];
        if (!file) throw new CliError("inspect requires a file argument.");
        requireTools(["mkvmerge"], deps.which);
        stdout(await inspectCommand(file, deps));
        return 0;
      }
      case "extract": {
        const { values, positionals } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              track: { type: "string" },
              output: { type: "string" },
              force: { type: "boolean", default: false },
            },
            allowPositionals: true,
            strict: true,
          }),
        );
        const file = positionals[0];
        if (!file) throw new CliError("extract requires a file argument.");
        requireTools(["mkvmerge"], deps.which);
        const output = await extractCommand(
          { file, track: parseTrack(values.track), output: values.output, force: values.force ?? false },
          deps,
        );
        stdout(`Wrote ${output}`);
        return 0;
      }
      case "test-clip": {
        const { values } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              video: { type: "string" },
              audio: { type: "string" },
              track: { type: "string" },
              start: { type: "string" },
              duration: { type: "string", default: "60" },
              "delay-ms": { type: "string", default: "0" },
              output: { type: "string" },
              force: { type: "boolean", default: false },
            },
            strict: true,
          }),
        );
        if (!values.video || !values.audio) throw new CliError("test-clip requires --video and --audio.");
        if (!values.start) throw new CliError("test-clip requires --start.");
        requireTools(["ffmpeg", "mkvmerge"], deps.which);
        const output = await testClipCommand(
          {
            video: values.video,
            audio: values.audio,
            track: parseTrack(values.track),
            start: values.start,
            duration: values.duration ?? "60",
            delayMs: parseIntStrict(values["delay-ms"] ?? "0", "--delay-ms"),
            output: values.output,
            force: values.force ?? false,
          },
          deps,
        );
        stdout(`Wrote ${output}`);
        return 0;
      }
      case "mux": {
        const { values } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              video: { type: "string" },
              audio: { type: "string" },
              track: { type: "string" },
              "delay-ms": { type: "string", default: "0" },
              language: { type: "string", default: "eng" },
              name: { type: "string" },
              default: { type: "boolean", default: false },
              output: { type: "string" },
              force: { type: "boolean", default: false },
            },
            strict: true,
          }),
        );
        if (!values.video || !values.audio) throw new CliError("mux requires --video and --audio.");
        if (!values.output) throw new CliError("mux requires --output (no default output name for the final file).");
        requireTools(["mkvmerge"], deps.which);
        const output = await muxCommand(
          {
            video: values.video,
            audio: values.audio,
            track: values.track === undefined ? undefined : parseTrack(values.track),
            delayMs: parseIntStrict(values["delay-ms"] ?? "0", "--delay-ms"),
            language: values.language,
            name: values.name,
            makeDefault: values.default ?? false,
            output: values.output,
            force: values.force ?? false,
          },
          deps,
        );
        stdout(`Wrote ${output}`);
        return 0;
      }
      default:
        throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
    }
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`tracksmith: ${error.message}`);
      return error.exitCode;
    }
    throw error;
  }
}

async function promptYesNo(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);
  for await (const line of console) {
    return /^y(es)?$/i.test(line.trim());
  }
  return false;
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), {
    runner: new BunRunner(),
    isTTY: Boolean(process.stdin.isTTY),
    confirm: promptYesNo,
  });
}
```

- [ ] **Step 4: Run the full suite**

Run: `bun test` — Expected: ALL tests PASS (Tasks 1–10).
Run: `bun x tsc --noEmit` — Expected: no errors.
Smoke: `bun run src/cli.ts --help` prints usage; `bun run src/cli.ts` exits 1.

- [ ] **Step 5: Commit** *(orchestrator when parallel)*

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: ✨ tracksmith CLI entry point and dispatch"
```

---

### Task 11: README and final verification

**Files:**
- Modify: `README.md` (replace bun init boilerplate)

**Interfaces:**
- Consumes: the finished CLI surface from Task 10 (exact flags and defaults — copy from `USAGE`).
- Produces: user-facing docs; no code.

- [ ] **Step 1: Replace `README.md`**

Required content (write real prose, PowerShell code fences for every example):
- What tracksmith does (one paragraph: lossless audio track extraction, sync testing, muxing for MKV files; wraps ffmpeg + MKVToolNix; never re-encodes audio).
- Requirements section: Bun, plus `ffmpeg`, `ffprobe`, `mkvmerge` on PATH with the same winget/brew/apt install lines used in `src/tools.ts`.
- A worked PowerShell walkthrough in this order:

```powershell
# 1. See what's in the donor file (note the MKVToolNix track IDs)
bunx tracksmith inspect "D:\rips\Movie DonorCut.mkv"

# 2. Extract the audio track losslessly (writes Movie DonorCut.track2.mka)
bunx tracksmith extract "D:\rips\Movie DonorCut.mkv" --track 2

# 3. Make a 60-second sync clip at the 10-minute mark, audio delayed 250 ms
bunx tracksmith test-clip --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --track 0 --start 00:10:00 --delay-ms 250

# 4. Once the delay is right, mux it into the target
bunx tracksmith mux --video "D:\rips\Movie TargetCut.mkv" --audio "D:\rips\Movie DonorCut.track2.mka" --delay-ms=250 --name "Donor E-AC-3 7.1" --default --output "D:\rips\Movie Final.mkv"
```

- Delay guidance paragraph: positive `--delay-ms` delays audio, negative advances it; negatives must be written `--delay-ms=-250`; verify near the beginning, middle, and end — a changing offset means frame-rate or edit differences that one constant delay cannot fix.
- Overwrite behavior paragraph: interactive y/N prompt; `--force` overwrites; non-interactive sessions refuse without `--force`.
- Local development section: `bun install`, `bun test`, `bun run typecheck`, `bun run src/cli.ts <command>`.

- [ ] **Step 2: Final verification**

Run: `bun test` — Expected: ALL PASS.
Run: `bun x tsc --noEmit` — Expected: no errors.
Run: `bun run src/cli.ts --help` — Expected: usage text, exit 0.

- [ ] **Step 3: Commit** *(orchestrator when parallel)*

```bash
git add README.md
git commit -m "docs: 📝 usage guide with PowerShell examples"
```

---

## Post-plan verification (orchestrator)

1. Full `bun test` and `bun x tsc --noEmit` in the worktree — everything green.
2. Independent code review (depth reviewer) against the spec: track-ID convention respected, no audio transcode paths, argv arrays only, overwrite policy per spec, mkvmerge option ordering in `mux`.
3. Manual verification with real media tools is a follow-up on Windows PowerShell first, then a Unix platform (spec §Testing); not automatable here.
