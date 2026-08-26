# Release Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one reviewed `tracksmith` npm CLI package for Node.js and Bun through a Changesets version PR and a guarded, retry-safe GitHub Actions release workflow.

**Architecture:** Keep `runCli` as the importable command boundary and add a small Node-compatible executable entrypoint. Build one ESM bundle, pack and test one exact tarball, then let Changesets own version changes while a release state machine reconciles the Git tag, npm integrity, and GitHub release before making writes. The generated version PR is the human approval boundary; merging any other branch cannot publish.

**Tech Stack:** TypeScript 7, Bun 1.3.14, Node.js 22+, Vite+ 0.2.6, Zod Mini, Changesets 3.0.1, GitHub Actions, npm Trusted Publishing with OIDC and provenance.

**Spec:** `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/superpowers/specs/2026-08-22-release-management-design.md`

## Global Constraints

- Work only in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9` on branch `t3code/add-release-management`.
- Keep Bun 1.3.14 as the contributor package manager and local CLI runner.
- Support Node.js 22 or newer and Bun 1.3.14 or newer for the published CLI.
- Publish one unscoped package and executable named `tracksmith`.
- Set the repository package version to bootstrap version `0.0.0`; the initial minor changeset must produce `0.1.0`.
- Changesets is the only source of semantic-version changes. Commit and pull-request history only enrich changelog text.
- Build one ESM executable at `dist/tracksmith.js` with source map `dist/tracksmith.js.map`; do not add CommonJS, declarations, a native executable, or a programmatic library export.
- Preserve `zod` as a runtime dependency and validate structured external output at boundaries with existing Zod Mini patterns.
- Preserve lossless audio handling. Do not add audio re-encoding or change media command behavior.
- Publish the exact tarball that passed package smoke verification; do not rebuild or repack between verification and publication.
- Create immutable annotated tags in `vX.Y.Z` form before npm publication. Never delete, move, or recreate an existing release tag.
- Use npm Trusted Publishing with `id-token: write`, provenance, and no stored npm write token.
- `UzEE/tracksmith` must be public before the first provenance-backed release. Implementation must not change repository visibility.
- Do not perform a real npm publish, Git tag push, GitHub release, repository visibility change, GitHub environment change, npm trusted-publisher change, release-PR merge, or branch-protection change during implementation.
- Pin every third-party GitHub Action to an immutable commit SHA with the readable version in a comment.
- Use `vp install`, `vp add`, and `vp remove` for dependency changes.
- Before every implementation commit, run `vp check` and `vp test run`. Run `vp run package:smoke` as well for tasks that affect packaging or workflows.
- Use the global `commit` skill for atomic commits. Do not add model or AI attribution.

## File Structure

### Runtime boundary

- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/cli.ts`: importable argument parsing and command dispatch only.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/prompt.ts`: Node-compatible interactive yes/no confirmation callback.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tracksmith.ts`: non-importable executable composition and process exit code.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tools.ts`: known-tool names and platform installation hints only.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/runner.ts`: process startup, PATH lookup through the operating system, and missing-executable error conversion.

### Package build and smoke verification

- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/build-package.ts`: remove stale output, invoke Vite+ package mode, and validate the two emitted files and shebang.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/package-smoke.ts`: build, pack, inspect, install, and execute the exact tarball under Node and Bun while leaving that tarball in `out/package-smoke`.

### Changesets and release logic

- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/check-changeset.ts`: pure changeset-path policy plus a small Git-backed CLI adapter.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/release/metadata.ts`: package version, release tag, changelog section, and tarball-integrity validation.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/release/state.ts`: pure release-state consistency checks and ordered action planning.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/release.ts`: injected release gateway, real command adapter, and retry-safe executor.

### Automation and documentation

- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/ci.yml`: pull-request validation and manual validation of the generated version branch.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/version.yml`: create or update the Changesets version PR and dispatch CI for its head branch.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/release.yml`: verify the merged generated PR, smoke-test the package, and invoke the guarded release executor.
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/releasing.md`: manual bootstrap, repository/publication prerequisites, configuration, approval boundaries, and recovery runbook.

---

### Task 1: Defer external-tool lookup to process startup

**Files:**
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/cli.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/types.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tools.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/runner.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/cli.test.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/tools.test.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/runner.test.ts`

**Interfaces:**
- Consumes: existing `Runner.run(argv: readonly string[]): Promise<RunResult>` and `CliError`.
- Produces: `isToolName(value: string): value is ToolName`; `CommandDeps` without `which`; `ProcessRunner` errors that include `installHint` only for known missing tools.

- [ ] **Step 1: Replace preflight tests with process-start tests**

In `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/tools.test.ts`, keep table-driven assertions for `installHint('ffmpeg')` and `installHint('mkvmerge')`, remove tests for `findMissingTools` and `requireTools`, and add:

```ts
import { expect, test } from 'vite-plus/test';

import { isToolName } from '../src/tools.ts';

test('recognizes supported external tools', () => {
  expect(isToolName('ffmpeg')).toBe(true);
  expect(isToolName('mkvmerge')).toBe(true);
  expect(isToolName('node')).toBe(false);
});
```

In `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/runner.test.ts`, add one real child-process test that runs a unique missing executable name and expects the generic startup error, then directly call a small exported error formatter with an `ENOENT` object for `ffmpeg` and `mkvmerge` so both known-tool hints are deterministic across platforms.

- [ ] **Step 2: Run focused tests and confirm the old API is still required**

Run:

```sh
vp test run tests/tools.test.ts tests/runner.test.ts tests/cli.test.ts
```

Expected: FAIL because `isToolName` and the missing-start formatter do not exist and CLI tests still construct `CommandDeps.which`.

- [ ] **Step 3: Reduce the tool module to names, guard, and hints**

Keep the existing platform-specific `installHint` implementation and replace lookup exports with:

```ts
export const TOOLS = ['ffmpeg', 'mkvmerge'] as const;

export type ToolName = (typeof TOOLS)[number];

export function isToolName(value: string): value is ToolName {
  return TOOLS.some((tool) => tool === value);
}
```

Remove `WhichFn`, `findMissingTools`, `requireTools`, and every `Bun.which` reference.

- [ ] **Step 4: Move missing-tool guidance into the runner boundary**

In `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/runner.ts`, export a focused formatter:

```ts
export function processStartError(program: string, error: unknown): CliError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT' &&
    isToolName(program)
  ) {
    return new CliError(
      `${program} is required but was not found on PATH. ${installHint(program)}`
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new CliError(`Failed to start ${program}: ${message}`);
}
```

Use `processStartError(argv[0], error)` only for a process `error` event. Do not interpret exit code `127` as a missing executable.

- [ ] **Step 5: Remove duplicate preflights and `which` injection**

Delete every `requireTools(...)` call and import from `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/cli.ts`. Remove `which?: (cmd: string) => string | null` from `CommandDeps`. Remove the `which` fake and the preflight-only test from `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/cli.test.ts`.

- [ ] **Step 6: Verify and commit**

Run:

```sh
vp test run tests/tools.test.ts tests/runner.test.ts tests/cli.test.ts
vp check
vp test run
```

Expected: all commands pass and `grep -R "Bun.which\|requireTools\|findMissingTools" src tests` returns no matches.

Use the global `commit` skill for an atomic commit with message:

```text
refactor(runtime): defer tool lookup to process start
```

### Task 2: Add a portable executable entrypoint and prompt

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/prompt.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tracksmith.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/cli.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/prompt.test.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/tracksmith.test.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`

**Interfaces:**
- Consumes: `runCli(argv, deps, stdout?)` and `ProcessRunner` from Task 1.
- Produces: `createConfirmPrompt(options?): (message: string) => Promise<boolean>` and executable source `/src/tracksmith.ts`.

- [ ] **Step 1: Write prompt behavior tests**

Use `Readable.from()` and `PassThrough` in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/prompt.test.ts`. Cover `y`, `Y`, `yes`, and surrounding whitespace as `true`; empty line, `n`, and arbitrary text as `false`; EOF without a line as `false`; and exact output `<message> [y/N] `.

- [ ] **Step 2: Write source-entrypoint child-process tests**

In `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/tracksmith.test.ts`, launch the TypeScript source through the pinned contributor runtime:

```ts
const result = spawnSync('bun', ['run', 'src/tracksmith.ts', '--help'], {
  cwd: projectRoot,
  encoding: 'utf8'
});
```

Assert `--help` exits `0` and prints the existing usage text; no arguments exits `1`; an unknown command exits `1`. These tests validate source composition under Bun. Task 4 validates the built file under both published runtimes, including Node.js.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```sh
vp test run tests/prompt.test.ts tests/tracksmith.test.ts
```

Expected: FAIL because both new source files are absent.

- [ ] **Step 4: Implement the EOF-safe prompt helper**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/prompt.ts`:

```ts
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';

import type { Readable, Writable } from 'node:stream';

export interface ConfirmPromptOptions {
  input?: Readable;
  output?: Writable;
}

export function createConfirmPrompt(
  options: ConfirmPromptOptions = {}
): (message: string) => Promise<boolean> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return async (message: string): Promise<boolean> => {
    const readline = createInterface({ input, output });

    try {
      const closed = once(readline, 'close').then(
        () => ({ kind: 'eof' }) as const
      );
      const answered = readline.question(`${message} [y/N] `).then(
        (value) => ({ kind: 'answer', value }) as const,
        () => ({ kind: 'eof' }) as const
      );
      const result = await Promise.race([answered, closed]);

      return (
        result.kind === 'answer' &&
        /^y(?:es)?$/i.test(result.value.trim())
      );
    } finally {
      readline.close();
    }
  };
}
```

- [ ] **Step 5: Split composition from the dispatcher**

Remove the Bun shebang, Bun console iterator, and `import.meta.main` block from `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/cli.ts`.

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tracksmith.ts`:

```ts
#!/usr/bin/env node

import { runCli } from './cli.ts';
import { createConfirmPrompt } from './prompt.ts';
import { ProcessRunner } from './runner.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  runner: new ProcessRunner(),
  isTTY: process.stdin.isTTY === true,
  confirm: createConfirmPrompt()
});
```

Make the entrypoint intentionally non-importable; `runCli` remains the testable API.

- [ ] **Step 6: Point local execution at the new entrypoint**

Change only the source script for now:

```json
"cli": "bun run src/tracksmith.ts"
```

Keep the existing package privacy and source `bin` target until Task 3 creates the publishable build.

- [ ] **Step 7: Verify and commit**

Run:

```sh
vp test run tests/prompt.test.ts tests/tracksmith.test.ts tests/cli.test.ts
vp run cli -- --help
vp check
vp test run
```

Expected: all commands pass under Bun and `src/cli.ts` contains no shebang or startup side effects.

Use the global `commit` skill with:

```text
feat(runtime): add portable Node and Bun entrypoint
```

### Task 3: Add public package metadata and one ESM build

**Files:**
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tsconfig.json`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/bun.lock`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/build-package.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/LICENSE`

**Interfaces:**
- Consumes: `/src/tracksmith.ts` from Task 2.
- Produces: `vp run build`; publishable package metadata at version `0.0.0`; exactly `dist/tracksmith.js` and `dist/tracksmith.js.map`.

- [ ] **Step 1: Replace Bun-only type definitions**

Run:

```sh
vp remove @types/bun
vp add -D @types/node@^22.20.1
```

Change `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tsconfig.json` from `"types": ["bun"]` to `"types": ["node"]`. Do not loosen strict compiler options.

- [ ] **Step 2: Add the package build wrapper**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/build-package.ts`. It must:

1. Resolve the repository root from `import.meta.url`.
2. Remove `dist` recursively.
3. Run this exact command with `spawnSync` and inherited stdio:

```sh
vp pack src/tracksmith.ts --format esm --out-dir dist --sourcemap
```

4. Require exactly `tracksmith.js` and `tracksmith.js.map` in `dist`.
5. Require the first line of `dist/tracksmith.js` to equal `#!/usr/bin/env node`.
6. Reject runtime relative imports that end in `.ts`.
7. Require a bare runtime import whose specifier starts with `zod`; package dependencies are externalized by default.

Export pure validators for emitted-file names and entrypoint text so focused tests can be added if Vite+ behavior requires adjustment. Do not use `--exe`: in Vite+ 0.2.6 it requests a Node.js single executable application, which is outside scope and incompatible with Bun. If the normal package build does not preserve the hashbang, fail first and use a supported Vite+/tsdown banner configuration rather than rewriting a successful bundle silently.

- [ ] **Step 3: Replace package metadata with the publishable contract**

Set these fields in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`:

```json
{
  "name": "tracksmith",
  "version": "0.0.0",
  "description": "CLI for inspecting, extracting, syncing, and muxing Matroska audio tracks.",
  "type": "module",
  "bin": {
    "tracksmith": "./dist/tracksmith.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": {
    "node": ">=22"
  },
  "packageManager": "bun@1.3.14",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/UzEE/tracksmith.git"
  },
  "bugs": {
    "url": "https://github.com/UzEE/tracksmith/issues"
  },
  "homepage": "https://github.com/UzEE/tracksmith#readme",
  "keywords": [
    "matroska",
    "mkv",
    "audio",
    "ffmpeg",
    "mkvtoolnix",
    "cli"
  ],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/",
    "tag": "latest"
  }
}
```

Remove `private` and `devEngines`. Preserve the `cli` script from Task 2 and the existing check, test, format, lint, and typecheck scripts. Add:

```json
"build": "bun run scripts/build-package.ts"
```

Do not add `main`, `exports`, declaration output, `prepack`, or `prepublishOnly`.

- [ ] **Step 4: Add the MIT license**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/LICENSE` with the standard MIT text, copyright year `2026`, and copyright holder `Uzair Sajid`.

- [ ] **Step 5: Build and inspect the output**

Run:

```sh
vp run build
find /home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/dist -maxdepth 1 -type f -print
vp check
vp test run
```

Expected: only the absolute paths ending in `dist/tracksmith.js` and `dist/tracksmith.js.map`; all checks pass.

- [ ] **Step 6: Commit**

Use the global `commit` skill with:

```text
build(package): add public package build
```

### Task 4: Verify the exact packed package under Node and Bun

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/package-smoke.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`

**Interfaces:**
- Consumes: `vp run build` and package metadata from Task 3.
- Produces: `vp run package:smoke`; exactly one verified `.tgz` retained in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/out/package-smoke`.

- [ ] **Step 1: Add smoke helpers and allowlist assertions**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/package-smoke.ts` with a `run(command, args, cwd, env?)` helper based on `spawnSync`. Before doing work, remove `dist` through `vp run build` and remove/recreate `out/package-smoke`.

Pack through the configured package manager:

```ts
run('vp', [
  'pm',
  'pack',
  '--pack-destination',
  outputDirectory,
  '--',
  '--quiet'
]);
```

Require exactly one `.tgz` in the output directory. List it with `tar -tzf` and require exactly:

```ts
const allowedEntries = [
  'package/LICENSE',
  'package/README.md',
  'package/dist/tracksmith.js',
  'package/dist/tracksmith.js.map',
  'package/package.json'
] as const;
```

If npm adds a required metadata entry in the installed toolchain, document that exact entry in the allowlist rather than broadening the package contents.

- [ ] **Step 2: Install and execute the tarball under Node**

Create a temporary npm project with `{"name":"tracksmith-node-smoke","private":true}` and run:

```sh
npm install --ignore-scripts --no-package-lock <absolute-tarball>
npx --no-install tracksmith --help
```

Require exit code `0` and the existing usage text.

- [ ] **Step 3: Install and execute the tarball under Bun**

Create a separate temporary Bun project with `{"name":"tracksmith-bun-smoke","private":true}` and run:

```sh
bun add --ignore-scripts <absolute-tarball>
bunx --bun --no-install tracksmith --help
```

Require exit code `0` and the same usage text. Plain `bunx tracksmith` is not a Bun-runtime proof because the Node shebang may delegate to Node.

- [ ] **Step 4: Prove missing-tool behavior under both runtimes**

Create an empty `movie.mkv` fixture and an empty directory used as `PATH`. Invoke the installed `dist/tracksmith.js` directly with the absolute Node executable and then the absolute Bun executable:

```text
<runtime> <installed-entry> inspect <fixture>
```

Require exit code `1`, stderr containing `mkvmerge`, and stderr containing installation guidance. Launch runtimes by absolute path so clearing `PATH` only affects Tracksmith's child process.

- [ ] **Step 5: Preserve only the verified artifact**

Delete temporary install projects in `finally`, but retain the single tarball in `out/package-smoke`. Print its absolute path as the final output line. Do not rebuild or repack after these checks.

Add:

```json
"package:smoke": "bun run scripts/package-smoke.ts"
```

- [ ] **Step 6: Verify and commit**

Run:

```sh
vp run package:smoke
vp check
vp test run
```

Expected: all commands pass, one `.tgz` remains in `out/package-smoke`, and no additional packed files exist.

Use the global `commit` skill with:

```text
test(package): add packed-package smoke verification
```

### Task 5: Configure Changesets and the initial release intent

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.changeset/config.json`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.changeset/first-public-release.md`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CHANGELOG.md`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/bun.lock`

**Interfaces:**
- Consumes: package name `tracksmith` and version `0.0.0` from Task 3.
- Produces: `vp run changeset`; `vp run version`; one initial minor changeset that resolves to `0.1.0`.

- [ ] **Step 1: Add exact Changesets dependencies**

Run:

```sh
vp add -D @changesets/cli@3.0.1
vp add -D @changesets/changelog-github@1.0.0
```

Add scripts:

```json
"changeset": "changeset",
"version": "changeset version"
```

- [ ] **Step 2: Add Changesets configuration**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.0/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    {
      "repo": "UzEE/tracksmith"
    }
  ],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 3: Add the initial release intent**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.changeset/first-public-release.md`:

```md
---
"tracksmith": minor
---

Publish the first public Tracksmith CLI with support for Node.js 22 or newer and Bun 1.3.14 or newer.
```

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CHANGELOG.md`:

```md
# tracksmith
```

- [ ] **Step 4: Validate without consuming the changeset**

Run:

```sh
vp run changeset -- status
vp check
vp test run
```

Expected: status reports a minor bump for `tracksmith`; `package.json` remains `0.0.0`; the initial changeset remains present.

- [ ] **Step 5: Commit**

Use the global `commit` skill with:

```text
chore(release): configure Changesets
```

### Task 6: Enforce changesets and package verification in pull-request CI

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/check-changeset.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/check-changeset.test.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/ci.yml`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`

**Interfaces:**
- Consumes: `.changeset` configuration from Task 5 and `vp run package:smoke` from Task 4.
- Produces: `isChangesetMarkdown(path)`, `assertChangesetPresent(check)`, and a `ci` workflow runnable on pull requests or manual dispatch.

- [ ] **Step 1: Write pure changeset-policy tests**

In `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/check-changeset.test.ts`, cover:

- `.changeset/feature.md` satisfies a normal PR.
- `.changeset/no-release.md` also satisfies it; empty changeset content is valid Changesets syntax.
- `.changeset/config.json` and `.changeset/README.md` do not satisfy it.
- Deleted files do not reach the pure helper because the Git adapter uses `--diff-filter=ACMR`.
- `changeset-release/main` bypasses the file requirement.
- A normal PR without a qualifying path throws an error containing `vp run changeset -- add --empty`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
vp test run tests/check-changeset.test.ts
```

Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Implement the policy and Git adapter**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/check-changeset.ts` with:

```ts
export const RELEASE_BRANCH = 'changeset-release/main' as const;

export interface ChangesetCheck {
  headRef: string;
  changedPaths: readonly string[];
}

export function isChangesetMarkdown(path: string): boolean {
  return (
    /^\.changeset\/[^/]+\.md$/.test(path) &&
    path !== '.changeset/README.md'
  );
}

export function assertChangesetPresent(check: ChangesetCheck): void {
  if (check.headRef === RELEASE_BRANCH) return;

  if (!check.changedPaths.some(isChangesetMarkdown)) {
    throw new Error(
      'This pull request must add or change a .changeset/*.md file. Run `vp run changeset` or `vp run changeset -- add --empty`.'
    );
  }
}
```

The CLI adapter must execute the equivalent of:

```sh
git diff --name-only --diff-filter=ACMR <base-ref>...HEAD -- .changeset
```

Pass the received `baseRef` as the first half of `${baseRef}...HEAD`; do not hardcode `origin/main` inside the helper. Use `pathToFileURL(process.argv[1]).href` for the direct-execution guard. Accept `headRef` and `baseRef` as arguments, defaulting the base to `origin/main`.

Add:

```json
"check:changeset": "bun run scripts/check-changeset.ts"
```

- [ ] **Step 4: Add the CI workflow**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/ci.yml` with full history and these immutable action pins:

```yaml
name: CI

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22'
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: '1.3.14'
      - uses: voidzero-dev/setup-vp@1b32467adbe183473499fd9d5d372c3ed9641754 # v1.18.0
        with:
          node-manager: false
          run-install: false
          cache: false
      - run: vp install --frozen-lockfile
      - name: Require a changeset
        if: github.event_name == 'pull_request' && github.head_ref != 'changeset-release/main'
        env:
          HEAD_REF: ${{ github.head_ref }}
        run: vp run check:changeset -- "$HEAD_REF" origin/main
      - name: Validate changesets
        if: github.event_name == 'pull_request' && github.head_ref != 'changeset-release/main'
        run: vp run changeset -- status --since origin/main
      - run: vp check
      - run: vp test run
      - run: vp run package:smoke
```

The manual dispatch against `changeset-release/main` skips both changeset checks because `github.event_name` is not `pull_request`.

- [ ] **Step 5: Verify and commit**

Run:

```sh
vp test run tests/check-changeset.test.ts
vp check
vp test run
vp run package:smoke
```

Expected: all commands pass.

Use the global `commit` skill with:

```text
ci: add pull request release validation
```

### Task 7: Validate release metadata and plan consistent state transitions

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/release/metadata.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/release/state.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/release-metadata.test.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/release-state.test.ts`

**Interfaces:**
- Produces: `StableVersion`, `ReleaseTag`, `ReleaseMetadata`, `parseStableVersion`, `releaseTag`, `extractChangelogSection`, `calculateIntegrity`, `readReleaseMetadata`, `ReleaseState`, `ReleaseAction`, and `planRelease`.

- [ ] **Step 1: Write metadata tests**

Cover:

- Accept `0.1.0` and `10.20.30`.
- Reject prerelease, build metadata, leading zero, missing component, and `v`-prefixed values.
- Require package name exactly `tracksmith`.
- Extract only exact heading `## X.Y.Z`, retain nested `###` headings, and stop at the next `## ` heading.
- Reject missing, duplicate, or bodyless sections.
- Calculate local SRI as `sha512-<base64 digest>` from tarball bytes.

- [ ] **Step 2: Write table-driven state tests**

Use this matrix:

| Tag commit | npm integrity | GitHub release | Expected |
| --- | --- | --- | --- |
| Missing | Missing | Missing | `create-tag`, `publish-tarball`, `create-github-release` |
| Correct | Missing | Missing | `publish-tarball`, `create-github-release` |
| Correct | Matching | Missing | `create-github-release` |
| Correct | Matching | Present | no actions |
| Wrong | Any | Any | error before writes |
| Missing | Present | Any | error before writes |
| Any | Wrong | Any | error before writes |
| Correct | Missing | Present | error before writes |

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```sh
vp test run tests/release-metadata.test.ts tests/release-state.test.ts
```

Expected: FAIL because the release helpers do not exist.

- [ ] **Step 4: Implement typed release metadata**

Use Zod Mini to parse:

```ts
const packageJsonSchema = z.object({
  name: z.literal('tracksmith'),
  version: z.string()
});
```

Define:

```ts
export type StableVersion = `${number}.${number}.${number}`;
export type ReleaseTag = `v${StableVersion}`;

export interface ReleaseMetadata {
  name: 'tracksmith';
  version: StableVersion;
  tag: ReleaseTag;
  changelogSection: string;
}
```

Validate stable versions with `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`. Extract one exact changelog section and return it with a trailing newline. Calculate integrity with `createHash('sha512').update(bytes).digest('base64')` and prefix `sha512-`.

- [ ] **Step 5: Implement the pure release planner**

Define:

```ts
export type ReleaseAction =
  | 'create-tag'
  | 'publish-tarball'
  | 'create-github-release';

export interface ReleaseState {
  expectedCommit: string;
  expectedIntegrity: string;
  tagCommit: string | null;
  npmIntegrity: string | null;
  githubReleaseExists: boolean;
}
```

`planRelease` must validate every inconsistency before appending actions. A wrong tag commit, wrong npm integrity, npm version without tag, GitHub release without tag, or GitHub release before npm must throw. A valid state returns missing actions in tag → publish → release order.

- [ ] **Step 6: Verify and commit**

Run:

```sh
vp test run tests/release-metadata.test.ts tests/release-state.test.ts
vp check
vp test run
```

Expected: all commands pass.

Use the global `commit` skill with:

```text
feat(release): validate release metadata and state
```

### Task 8: Add the retry-safe release executor

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/scripts/release.ts`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tests/release.test.ts`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`

**Interfaces:**
- Consumes: metadata and state helpers from Task 7; one verified tarball in `out/package-smoke`.
- Produces: `ReleaseGateway`, `executeRelease(input, gateway)`, a real command gateway, and `vp run release`.

- [ ] **Step 1: Write an injected fake-gateway test suite**

Define a `FakeReleaseGateway` that records all reads and writes. Cover:

- All three external reads complete before the first write.
- Fresh state writes tag → npm → GitHub release.
- Tag-only state writes npm → GitHub release.
- Published state writes GitHub release only.
- Complete state writes nothing.
- Every inconsistency writes nothing.
- Failure after tag creation can resume from a correct tag-only state.
- Failure after npm publication can resume from a correct published state.
- A read failure stops before writes.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
vp test run tests/release.test.ts tests/release-state.test.ts
```

Expected: FAIL because the executor and gateway do not exist.

- [ ] **Step 3: Define the release gateway and executor input**

Use:

```ts
export interface ReleaseGateway {
  readTagCommit(tag: ReleaseTag): Promise<string | null>;
  readNpmIntegrity(
    name: 'tracksmith',
    version: StableVersion
  ): Promise<string | null>;
  githubReleaseExists(tag: ReleaseTag): Promise<boolean>;
  createAndPushTag(
    tag: ReleaseTag,
    commit: string,
    message: string
  ): Promise<void>;
  publishTarball(path: string): Promise<void>;
  createGithubRelease(
    tag: ReleaseTag,
    notes: string
  ): Promise<void>;
}

export interface ExecuteReleaseInput {
  metadata: ReleaseMetadata;
  commit: string;
  tarballPath: string;
  tarballIntegrity: string;
}
```

`executeRelease` gathers `readTagCommit`, `readNpmIntegrity`, and `githubReleaseExists` with `Promise.all`, calls `planRelease`, then executes the returned actions in order. It must not catch and continue after a write failure.

- [ ] **Step 4: Implement exact command adapters**

The real gateway must use argv arrays and reject ambiguous failures.

- Read a tag with `git rev-list -n 1 <tag>`. Only a confirmed missing ref returns `null`.
- Read npm integrity with `npm view tracksmith@<version> dist.integrity --json`. Only npm `E404` returns `null`; authentication, registry, network, and malformed JSON errors throw.
- Read GitHub release state with `gh release view <tag> --json tagName`. Only an explicit release-not-found response returns `false`; authentication, network, and API errors throw.
- Create a tag with `git tag --annotate <tag> <commit> --message "Release <version>"`, then `git push origin refs/tags/<tag>`.
- Publish with `npm publish <absolute-tarball> --access public --tag latest --provenance`. Do not use `vp pm publish`; Bun currently drops the provenance flag on that path.
- Create notes in a temporary file, then run `gh release create <tag> --verify-tag --title <tag> --notes-file <notes-file>`.

Never delete or move a tag. Never treat any existing mismatched state as recoverable.

- [ ] **Step 5: Add the CLI adapter**

The direct script must:

1. Require `GITHUB_SHA` and prove it is a full commit SHA.
2. Read `package.json` and `CHANGELOG.md` from the repository root.
3. Require exactly one `.tgz` in `out/package-smoke`.
4. Calculate its SHA-512 SRI.
5. Fetch tags from origin without deleting or force-moving remote tags.
6. Invoke `executeRelease` with the real gateway.

Add:

```json
"release": "bun run scripts/release.ts"
```

- [ ] **Step 6: Verify and commit**

Run only local tests; do not invoke the real release script because it is outward-facing.

```sh
vp test run tests/release.test.ts tests/release-state.test.ts tests/release-metadata.test.ts
vp check
vp test run
```

Expected: all commands pass and no Git, npm, or GitHub writes occur.

Use the global `commit` skill with:

```text
feat(release): add retry-safe release executor
```

### Task 9: Create and validate the Changesets version PR

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/version.yml`

**Interfaces:**
- Consumes: `vp run version`, `ci.yml`, and initial changeset from Tasks 5 and 6.
- Produces: generated branch `changeset-release/main`, version PR, and manual CI dispatch for that branch.

- [ ] **Step 1: Add the version workflow**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/version.yml`:

```yaml
name: Version

on:
  push:
    branches:
      - main

permissions:
  actions: write
  contents: write
  pull-requests: write

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22'
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: '1.3.14'
      - uses: voidzero-dev/setup-vp@1b32467adbe183473499fd9d5d372c3ed9641754 # v1.18.0
        with:
          node-manager: false
          run-install: false
          cache: false
      - run: vp install --frozen-lockfile
      - id: changesets
        uses: changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1 # v2.1.1
        with:
          github-token: ${{ github.token }}
          version-script: vp run version
          commit-message: 'chore: release tracksmith'
          pr-title: 'chore: release tracksmith'
          pr-base-branch: main
          create-github-releases: false
          push-git-tags: false
      - name: Validate the version branch
        if: steps.changesets.outputs.pr-number != ''
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh workflow run ci.yml --ref changeset-release/main
```

Do not provide a publish script. `actions: write` is the permission that authorizes workflow dispatch.

- [ ] **Step 2: Perform static and local validation**

Run:

```sh
vp run changeset -- status
vp check
vp test run
```

Expected: all commands pass and the initial changeset remains unconsumed. Do not run `vp run version` without a disposable copy because it would modify `package.json`, `CHANGELOG.md`, and the changeset files.

- [ ] **Step 3: Commit**

Use the global `commit` skill with:

```text
ci(release): add version pull request workflow
```

### Task 10: Add the guarded provenance publication workflow

**Files:**
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/release.yml`

**Interfaces:**
- Consumes: `vp run package:smoke` and `vp run release` from Tasks 4 and 8.
- Produces: release job that can run only after the same-repository `changeset-release/main` PR is merged into `main`.

- [ ] **Step 1: Add the release trigger and permission guard**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/release.yml` with:

```yaml
name: Release

on:
  pull_request:
    types:
      - closed
    branches:
      - main

permissions:
  contents: write
  id-token: write

concurrency:
  group: tracksmith-release
  cancel-in-progress: false
  queue: max
```

The release job condition must require every clause:

```yaml
if: >-
  github.event.pull_request.merged == true &&
  github.event.pull_request.base.ref == 'main' &&
  github.event.pull_request.head.ref == 'changeset-release/main' &&
  github.event.pull_request.head.repo.full_name == github.repository
```

`queue: max` keeps up to 100 pending runs instead of replacing the older pending release attempt. It cannot be combined with `cancel-in-progress: true`.

- [ ] **Step 2: Check out and prove the exact merged commit**

Set job `environment: npm`. Check out the event commit with:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    ref: ${{ github.event.pull_request.merge_commit_sha }}
    fetch-depth: 0
```

Then run a shell step that:

```sh
set -euo pipefail
sha='${{ github.event.pull_request.merge_commit_sha }}'
git fetch origin main --tags
test "$(git rev-parse HEAD)" = "$sha"
git merge-base --is-ancestor "$sha" origin/main
```

This proves the trusted code is the merged release commit and belongs to current `main`.

- [ ] **Step 3: Install the pinned toolchain without dependency caching**

Use:

```yaml
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  with:
    node-version: '24'
- uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
  with:
    bun-version: '1.3.14'
- uses: voidzero-dev/setup-vp@1b32467adbe183473499fd9d5d372c3ed9641754 # v1.18.0
  with:
    node-manager: false
    run-install: false
    cache: false
- run: npm install --global npm@11.19.0
- run: vp install --frozen-lockfile
```

Do not set `NODE_AUTH_TOKEN`, configure an npm token, or enable dependency caching.

- [ ] **Step 4: Verify once and publish the retained tarball**

Add these steps in order:

```yaml
- run: vp check
- run: vp test run
- run: vp run package:smoke
- run: vp run release
  env:
    GITHUB_SHA: ${{ github.event.pull_request.merge_commit_sha }}
    GH_TOKEN: ${{ github.token }}
```

Do not call build, pack, or package smoke after `vp run package:smoke`. The executor publishes the one tarball left in `out/package-smoke`.

- [ ] **Step 5: Verify locally without triggering release behavior**

Run:

```sh
vp check
vp test run
vp run package:smoke
```

Expected: all commands pass. Do not invoke `vp run release`, push a tag, publish a package, create a GitHub release, configure the `npm` environment, or change npm trust.

- [ ] **Step 6: Commit**

Use the global `commit` skill with:

```text
ci(release): add guarded publication workflow
```

### Task 11: Document installation, bootstrap, configuration, and approval boundaries

**Files:**
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/README.md`
- Modify: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/AGENTS.md`
- Create: `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/releasing.md`

**Interfaces:**
- Consumes: final commands, versions, branches, workflow names, and state behavior from Tasks 1-10.
- Produces: user installation instructions and an operator runbook for the separately approved external setup and first release.

- [ ] **Step 1: Update user installation and runtime documentation**

Update `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/README.md` to state:

- Requirements: Node.js 22+ or Bun 1.3.14+, FFmpeg, and MKVToolNix.
- One-off Node execution: `npx tracksmith --help`.
- One-off Bun execution: `bunx --bun tracksmith --help`.
- Global npm installation: `npm install --global tracksmith`.
- Contributor commands remain `vp install`, `vp run cli -- <command>`, `vp check`, and `vp test run` through Bun/Vite+.
- Audio tracks remain stream-copied; Tracksmith does not transcode audio.

Remove language that says the package is unpublished or Bun-only.

- [ ] **Step 2: Correct project instructions without duplicating them**

Update `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/AGENTS.md` so the opening and runtime rule say:

```md
Tracksmith is a personal CLI for inspecting and editing Matroska audio tracks. Contributors use Bun and Vite+; the published package runs under Node.js and Bun.
```

Replace `Preserve Bun as the CLI runtime.` with:

```md
- Preserve Bun 1.3.14 as the contributor package manager and local development runtime. Keep the published CLI compatible with Node.js 22 or newer and Bun 1.3.14 or newer.
```

Leave `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CLAUDE.md` unchanged because it already imports `AGENTS.md`.

- [ ] **Step 3: Write the bootstrap and release runbook**

Create `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/releasing.md` with these exact sections:

1. **Implementation safety boundary**: repository code is complete without making external changes; every external write below requires explicit approval.
2. **Preflight**: `vp check`, `vp test run`, `vp run package:smoke`, inspect the exact `.tgz`, and recheck npm name availability.
3. **Bootstrap `0.0.0`**: publish the inspected tarball once with a short-lived least-privilege npm credential and account 2FA; do not create a Git tag or GitHub release; revoke the credential immediately.
4. **Public repository prerequisite**: make `UzEE/tracksmith` public before provenance-backed `0.1.0`; this is a separate repository administration action.
5. **GitHub repository settings**: allow GitHub Actions to create and approve pull requests; require the CI `verify` job through branch protection or a ruleset; create the `npm` environment and optionally require a human reviewer.
6. **npm Trusted Publisher**: package `tracksmith`, repository owner `UzEE`, repository `tracksmith`, workflow `release.yml`, environment `npm`, permission to publish.
7. **First automated release**: merge the generated `changeset-release/main` PR only after bootstrap, public visibility, CI, environment, and trusted publisher are confirmed.
8. **Retry table**: fresh; tag only; tag + matching npm integrity; complete; wrong tag; npm without tag; wrong npm integrity; GitHub release before npm.
9. **Immutable state rule**: never delete or move release tags; investigate mismatches before rerunning. A local tarball-integrity mismatch on retry means the build inputs or toolchain changed and must be investigated rather than bypassed.
10. **Expected `0.1.0` evidence**: `package.json` version, tag commit, npm package with provenance, and GitHub release notes all match.

State clearly that npm provenance rejects private source repositories. Trusted Publishing requires npm 11.5.1 or newer and Node.js 22.14.0 or newer; the workflow pins Node.js 24 and npm 11.19.0. Provenance is supplied by Trusted Publishing, while the explicit `--provenance` flag makes the repository policy visible. Direct `npm publish ... --provenance` is required; do not recommend `vp pm publish` for the release step.

- [ ] **Step 4: Run final verification**

Run:

```sh
vp check
vp test run
vp run package:smoke
```

Expected: all commands pass and the exact package tarball remains under `out/package-smoke`.

- [ ] **Step 5: Commit**

Use the global `commit` skill with:

```text
docs(release): document installation and release bootstrap
```

### Task 12: Final implementation review without external release actions

**Files:**
- Review all changed files from Tasks 1-11.

**Interfaces:**
- Consumes: complete release-management implementation.
- Produces: verified implementation ready for a pull request, but no npm, GitHub release, tag, trust, environment, visibility, merge, or ruleset changes.

- [ ] **Step 1: Run the full local verification suite**

Run:

```sh
vp check
vp test run
vp run package:smoke
```

Expected: all commands pass.

- [ ] **Step 2: Inspect release-safety invariants**

Confirm:

```sh
git grep -n "NODE_AUTH_TOKEN\|npm_token\|NPM_TOKEN" -- . ':!bun.lock'
git grep -n "npm publish" -- .github scripts docs package.json
git grep -n "changeset-release/main" -- .github scripts docs
```

Expected:

- No stored npm-token reference exists.
- The only automated publication command is direct `npm publish <tarball> --access public --tag latest --provenance` in the guarded release path.
- Every release trigger and bypass uses the exact branch `changeset-release/main`.

- [ ] **Step 3: Inspect the package artifact**

Run:

```sh
tar -tzf /home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/out/package-smoke/*.tgz
```

Expected: package metadata, README, LICENSE, `dist/tracksmith.js`, and its source map only.

- [ ] **Step 4: Obtain two-stage review**

Use `superpowers:subagent-driven-development` review gates:

1. A spec-compliance reviewer checks the implementation against `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/superpowers/specs/2026-08-22-release-management-design.md` and this plan.
2. A depth/correctness reviewer checks runtime compatibility, workflow permissions and triggers, exact-artifact publication, state reconciliation, and tests.

Fix verified findings in atomic commits, rerunning `vp check`, `vp test run`, and `vp run package:smoke` after each packaging or workflow fix.

- [ ] **Step 5: Stop at the external-action boundary**

Report the final test results and remaining manual setup. Do not:

- publish `tracksmith@0.0.0` or any later version;
- create or push `v0.1.0` or another tag;
- create a GitHub release;
- make the repository public;
- configure npm Trusted Publishing;
- create or change the GitHub `npm` environment;
- change branch protection or rulesets;
- merge the version PR.
