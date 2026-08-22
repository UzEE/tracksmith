# Release management design

Approved 2026-08-22.

## Purpose

Add a reviewable release process for Tracksmith that:

1. Uses Changesets as the only source of semantic-version changes.
2. Uses GitHub pull-request and commit history to enrich changelogs and GitHub releases.
3. Produces one npm package that runs under Node.js and Bun.
4. Creates an immutable `vX.Y.Z` Git tag before publishing the matching npm version.
5. Publishes through npm Trusted Publishing with provenance and no stored npm token.
6. Creates the GitHub release after npm accepts the package.

The target repository is `UzEE/tracksmith`. The public npm package and executable are both named `tracksmith`.

## Current baseline

The implementation starts from `origin/main` at or after commit `fbef8bcea11cb0938db1522a038b57b9d2b024e1`.

The repository currently has one root package at `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`. It is a Bun-only TypeScript CLI, is marked private, has no build output, and has no release automation.

The project uses Bun 1.3.14, Vite+ 0.2.6, and TypeScript 7. Contributor commands continue to use Vite+ with Bun.

## Release decisions

- Release approval: merge the generated Changesets release PR.
- Version authority: Changesets only.
- Commit-history role: add PR links, commit context, and contributors to changelog entries.
- Package name: `tracksmith`.
- First automated release: `v0.1.0`.
- Tag format: `vX.Y.Z`.
- npm distribution tag: `latest`.
- Package license: MIT.
- npm authentication: Trusted Publishing through GitHub OIDC.
- Publication flow: tag and publish in one guarded workflow.
- Changeset policy: every normal pull request must include a changeset file. Work that should not change the version uses an empty changeset.
- Runtime support: Node.js 22 or newer and Bun 1.3.14 or newer.
- Prereleases are not part of the first release system.

## Package and runtime design

### Executable boundary

Add `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tracksmith.ts` as the executable entrypoint.

It has four responsibilities:

1. Start with `#!/usr/bin/env node`.
2. Implement the interactive confirmation prompt with `node:readline/promises`.
3. Create the real process runner and call the CLI dispatcher.
4. Set the process exit code.

Keep `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/cli.ts` importable and testable. Remove its Bun shebang, Bun console iterator, `import.meta.main` startup block, and external-tool preflight calls.

### External executable handling

Remove `Bun.which` and the duplicate lookup step from `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/tools.ts` and `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/types.ts`.

`/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/src/runner.ts` remains responsible for starting `ffmpeg` and `mkvmerge`. The operating system resolves each executable through `PATH`. When process startup fails with a missing-executable error, Tracksmith names the missing tool and retains the current platform-specific installation guidance.

This removes the Bun runtime dependency without weakening the existing error message.

### Build output

Use Vite+ package mode to build one ESM entry:

```text
src/tracksmith.ts -> dist/tracksmith.js
                  -> dist/tracksmith.js.map
```

The initial proven command is:

```sh
vp pack src/tracksmith.ts --format esm --out-dir dist --sourcemap
```

The implementation must verify the exact output filename and whether Vite+ preserves the shebang. If it does not, configure the installed Vite+ version to add the banner. The build fails unless the first line of `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/dist/tracksmith.js` is exactly `#!/usr/bin/env node`.

The build emits no CommonJS copy, declaration files, standalone binary, or public library entrypoint. Local source modules are bundled. Node built-ins and `zod` remain external runtime imports.

### TypeScript environment

Replace Bun global types with explicit Node types in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/tsconfig.json` and `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`.

- Remove `@types/bun` after all Bun globals leave production code.
- Add `@types/node` as a direct development dependency.
- Keep bundler module resolution, TypeScript source import suffixes, strict checks, and `noEmit`.
- Tests continue through `vp test run`.

### npm package metadata

Update `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json` to:

- Remove `private: true`.
- Set the bootstrap version to `0.0.0`.
- Point `bin.tracksmith` to `./dist/tracksmith.js`.
- Add `files` for `dist`, `README.md`, and `LICENSE`.
- Add `engines.node` with `>=22`.
- Replace the Bun-only `devEngines.packageManager` rule with the standard `packageManager` field pinned to Bun 1.3.14.
- Add `build`, `changeset`, `version`, and package-smoke scripts.
- Keep `zod` as a runtime dependency.
- Add public npm publish configuration for the npm registry.
- Add the MIT license field.
- Add repository, bugs, and homepage links for `https://github.com/UzEE/tracksmith`.
- Use the description `CLI for inspecting, extracting, syncing, and muxing Matroska audio tracks.`
- Add keywords for Matroska, MKV, audio, FFmpeg, MKVToolNix, and CLI use.

Add `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/LICENSE` with the MIT license.

The packed package contains only:

```text
package/package.json
package/README.md
package/LICENSE
package/dist/tracksmith.js
package/dist/tracksmith.js.map
```

npm may add its own required metadata entries. Project source, tests, plans, lockfiles, and tool configuration must not appear in the tarball.

## Changesets design

Add:

- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.changeset/config.json`
- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CHANGELOG.md`
- `@changesets/cli`
- `@changesets/changelog-github`

Use `changesets/action` in the version workflow. It is a GitHub Action, not a package dependency.

The Changesets configuration uses:

- Base branch `main`.
- Public access.
- `@changesets/changelog-github` for repository `UzEE/tracksmith`.
- No fixed or linked package groups because the repository has one package.
- No ignored packages.
- Changesets-managed changelog updates.

The implementation includes one initial minor changeset describing the first public Tracksmith CLI release. Applying it to package version `0.0.0` produces `0.1.0`.

Do not infer versions from conventional commit prefixes. Commit and pull-request history only enrich the text generated from the changeset summaries.

## Pull-request CI

Add `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/ci.yml`.

It runs on normal pull requests and supports `workflow_dispatch` so the version workflow can validate the generated release branch.

Every CI run:

1. Checks out full enough history to compare against `main`.
2. Installs the pinned Bun version.
3. Installs dependencies from the frozen lockfile.
4. Runs `vp check`.
5. Runs `vp test run`.
6. Builds the package.
7. Runs the packed-package smoke test under Node and Bun.

For normal pull requests, CI also requires at least one new or changed `.changeset/*.md` file and validates Changesets status against `main`. An empty changeset satisfies the file requirement when no version change is intended.

The generated branch `changeset-release/main` skips the changeset-file requirement because the release PR consumes changeset files as it applies them.

## Version PR workflow

Add `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/version.yml`.

It runs after pushes to `main` and uses `changesets/action` only to create or update the version PR. It does not publish packages or create tags.

The generated branch is `changeset-release/main`. The pull-request title and version commit identify the release clearly, for example `chore: release tracksmith`.

The workflow uses the repository `GITHUB_TOKEN` with only the permissions needed for contents, pull requests, and workflow dispatch. Third-party actions are pinned to immutable commit SHAs with a comment naming the human-readable version.

After creating or updating the release PR, `version.yml` dispatches `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/ci.yml` against `changeset-release/main`. This gives the generated PR a check on its own head commit without a PAT or GitHub App token.

## Release workflow

Add `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/.github/workflows/release.yml`.

It runs only when GitHub reports a merged pull request where:

- The base branch is `main`.
- The head branch is `changeset-release/main`.
- The pull request was merged, not merely closed.

The job uses a GitHub environment named `npm`. Its permissions are:

- `contents: write` for the Git tag and GitHub release.
- `id-token: write` for npm Trusted Publishing.
- No pull-request or package write permissions beyond those needs.

The workflow uses concurrency group `tracksmith-release` with cancellation disabled so two release attempts cannot overlap.

### Release sequence

The release workflow:

1. Resolves the merged release commit and proves it belongs to `main`.
2. Checks out that exact commit with complete tag history.
3. Installs Bun 1.3.14.
4. Installs Node.js 24 and npm 11.5.1 or newer for OIDC publishing.
5. Installs dependencies from the frozen Bun lockfile.
6. Runs `vp check`, `vp test run`, the build, and the packed-package smoke test.
7. Reads the package name and version from `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json`.
8. Requires package name `tracksmith`, a stable semantic version, and a matching section in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CHANGELOG.md`.
9. Resolves the expected tag as `vX.Y.Z`.
10. Reconciles existing Git, npm, and GitHub release state.
11. Creates and pushes an annotated tag if it does not exist.
12. Publishes the already-verified tarball with `npm publish <tarball> --provenance --access public` if npm does not contain the version.
13. Creates the GitHub release from the matching changelog section if it does not exist.

The workflow publishes the exact tarball tested earlier in the job. It does not rebuild between verification and publication.

The GitHub release is created only after npm accepts the package or confirms that the same version already exists.

## Release state and retries

The release workflow is safe to rerun after partial failure.

For package version `X.Y.Z`:

- If neither the tag nor npm version exists, create the tag and publish.
- If `vX.Y.Z` exists, require it to point at the release commit.
- If the tag is correct and npm lacks `X.Y.Z`, publish the verified tarball.
- If npm already contains `X.Y.Z`, do not publish again.
- If the GitHub release is missing after publication, create it.
- If the tag, npm version, and GitHub release all exist and agree, exit successfully.
- If npm contains the version but the tag is absent, stop and report the inconsistent external state.
- If a tag or GitHub release points at another commit, stop.

The workflow never deletes, moves, or recreates an existing release tag. A failed npm publish may leave the correct tag without an npm version. Rerunning the same workflow resumes from that state.

## npm Trusted Publishing bootstrap

Trusted Publishing cannot create a package name that does not yet exist on npm. Tracksmith therefore needs one manual bootstrap before the automated `v0.1.0` release.

The implementation adds a runbook at `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/releasing.md` with these steps:

1. Recheck that `tracksmith` is still available on npm.
2. Build and inspect the exact `tracksmith@0.0.0` tarball from an approved commit on `main`.
3. Publish `0.0.0` once using a short-lived, least-privilege npm credential and account two-factor authentication.
4. Do not create a Git tag or GitHub release for `0.0.0`.
5. Configure npm Trusted Publishing for package `tracksmith`, repository `UzEE/tracksmith`, workflow file `release.yml`, GitHub environment `npm`, and `npm publish` permission.
6. Remove or revoke the bootstrap credential.
7. Merge the generated `0.1.0` release PR only after the trusted publisher is configured.

The repository implementation does not perform the bootstrap publish, configure npm, merge the release PR, or publish a real version. Each is a separate outward-facing action requiring explicit approval.

## Package smoke test

Add a project-owned package-smoke command that runs in normal CI and the release workflow.

It:

1. Removes stale `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/dist` output.
2. Builds `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/dist/tracksmith.js` and its source map.
3. Requires the Node shebang as the first line.
4. Requires no runtime relative `.ts` imports in the emitted JavaScript.
5. Packs the npm tarball with Bun.
6. Checks the tarball allowlist.
7. Installs the exact tarball into one clean npm project and one clean Bun project.
8. Runs `npx --no-install tracksmith --help` in the npm project.
9. Runs `bunx --bun --no-install tracksmith --help` in the Bun project.
10. Confirms missing `ffmpeg` or `mkvmerge` produces a normal Tracksmith error under both runtimes.

Plain `bunx tracksmith` is not the Bun-runtime assertion because the Node shebang may cause Bunx to launch Node. Documentation uses `bunx --bun tracksmith` when the user wants Bun to execute the package.

## Focused tests

Add or update tests for:

- The `node:readline/promises` confirmation prompt.
- The executable entrypoint's exit-code behavior.
- Missing external executable errors after removing `Bun.which`.
- Changeset-presence checks for normal, empty, and generated release PRs.
- Stable semantic-version and `vX.Y.Z` validation.
- Extraction of the exact version section from `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CHANGELOG.md`.
- Release-state decisions for fresh, partially complete, complete, and inconsistent releases.

Existing command argument and media behavior tests remain in place. The release work must not change audio handling.

## Documentation updates

Update `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/README.md` to document:

- npm installation and `npx tracksmith`.
- Bun execution with `bunx --bun tracksmith`.
- Node.js, FFmpeg, and MKVToolNix requirements.
- Contributor development through Bun and Vite+.

Update `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/AGENTS.md` and `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/CLAUDE.md` so they distinguish the contributor toolchain from the published runtime. Bun remains the contributor package manager, but the shipped CLI supports Node and Bun.

The release design supersedes the Bun-only packaging and npm-publication exclusions in `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/docs/superpowers/specs/2026-08-16-tracksmith-cli-design.md`.

## Security rules

- Use npm Trusted Publishing with provenance for normal releases.
- Store no npm write token in GitHub.
- Bind npm trust to the exact repository, workflow filename, and `npm` environment.
- Disable dependency caching in the release job.
- Pin third-party actions to immutable commit SHAs.
- Keep workflow permissions at job or workflow minimums.
- Publish only from the merged generated release PR.
- Publish the tested tarball rather than the repository directory.
- Never run release code from an untrusted pull-request branch with write or OIDC permissions.

## Out of scope

- Publishing the bootstrap or first real release during implementation.
- Automatic version inference from conventional commits.
- Prerelease channels or npm tags such as `next` or `beta`.
- Multiple npm packages or a workspace conversion.
- A standalone native executable.
- CommonJS output.
- A public programmatic library API.
- Automatic release from manually pushed tags.
- Changes to Tracksmith's media processing behavior.

## Success criteria

The implementation is complete when:

1. `vp check` passes.
2. `vp test run` passes.
3. Normal CI builds and smoke-tests the packed package under Node and Bun.
4. Normal pull requests cannot merge without a normal or empty changeset.
5. Changesets can create and update the generated release PR.
6. The generated release PR receives CI on its own head commit.
7. The release workflow validates tag, npm, and GitHub state before writing anything.
8. Release retries safely resume after tag, npm, or GitHub release failures.
9. No long-lived npm token is required.
10. The repository contains a checked bootstrap and release runbook.
11. No real npm publish, Git tag, GitHub release, or npm trust change occurs without separate explicit approval.

A successful later `v0.1.0` release must leave matching state in four places:

- `/home/uzee/.t3/worktrees/tracksmith/t3code-c04863e9/package.json` contains version `0.1.0`.
- Git tag `v0.1.0` points at the merged release commit.
- npm contains `tracksmith@0.1.0` with provenance.
- The GitHub `v0.1.0` release uses the matching changelog section.
