# Releasing Tracksmith

How the first public release gets bootstrapped and how every release after it runs.

## 1. Implementation safety boundary

The release code in this repository is complete on its own. Adding it changed nothing outside the repository.

Section 2 is safe to run at any time. Building, packing, inspecting the tarball, and looking up the npm name are local or read-only; they change no external state and need no approval.

Sections 3–7 write to npm or to GitHub. Each of these is a separate action needing its own explicit approval, and approving one never implies approval of the others:

- The `0.0.0` bootstrap publish (section 3).
- Making `UzEE/tracksmith` public (section 4).
- The GitHub repository settings and the `npm` environment (section 5).
- Registering the npm Trusted Publisher (section 6).
- Merging the release pull request, which triggers the tag, the publish, and the GitHub release (section 7).

## 2. Preflight

Start from the approved commit on a clean `main` branch synchronized with `origin/main`. Replace the placeholder with the approved full commit SHA:

```sh
approved_commit='<approved-full-commit-sha>'
test -z "$(git status --short)"
test "$(git branch --show-current)" = main
git fetch origin main
test "$(git rev-parse HEAD)" = "$approved_commit"
test "$(git rev-parse origin/main)" = "$approved_commit"
vp check
vp test run
vp run package:smoke
```

`vp run package:smoke` builds the package, packs it, and leaves exactly one `.tgz` under `out/package-smoke`. It asserts the archive holds only `package/package.json`, `package/README.md`, `package/LICENSE`, `package/dist/tracksmith.js`, and `package/dist/tracksmith.js.map`, then installs that tarball and runs `--help` under both Node and Bun. It also confirms the CLI exits with a clear `mkvmerge` install hint when the tools are missing.

Inspect the exact tarball that will be published:

```sh
tar -tzf out/package-smoke/tracksmith-*.tgz
```

Look up the npm name:

```sh
npm view tracksmith
```

A 404 means no public package currently resolves under that name. It is not proof of availability: names can be taken between the check and the publish, and npm blocks names too similar to existing ones. Availability is confirmed only when npm accepts the bootstrap publish.

## 3. Bootstrap `0.0.0`

npm can only register a Trusted Publisher on a package that already exists, so the very first publish is manual and unautomated.

`0.0.0` is a real public npm publication, installable by anyone the moment it lands. Its only purpose is to create the package so trust can be configured, and it deliberately gets no Git tag and no GitHub release. Give it the same scrutiny as any other publish.

- Create a granular npm token with **Packages and scopes: Read and write**, **Resource selection: All Packages**, and the shortest practical expiry.
- `All Packages` is temporarily required only because the unscoped `tracksmith` package does not exist yet and npm cannot select it. Limit the broader access through the short expiry, this single publish, account 2FA, and immediate revocation.
- Keep account 2FA enabled. Publish the tarball you just inspected, unchanged with `npm publish out/package-smoke/tracksmith-0.0.0.tgz --access public`, and complete the interactive OTP prompt. Do not bypass 2FA.
- Do not create a Git tag and do not create a GitHub release for it. The release automation owns tags and releases, and `0.0.0` is outside that flow.
- Revoke the token immediately once the publish succeeds.

## 4. Public repository prerequisite

npm provenance rejects private source repositories. `UzEE/tracksmith` has to be public before the provenance-backed `0.1.0` release.

This is a separate repository administration action with its own approval. It is not part of the release automation.

## 5. GitHub repository settings

- Allow GitHub Actions to create and approve pull requests, so the Version workflow can open the `changeset-release/main` pull request.
- Require the CI `verify` job on `main` through branch protection or a ruleset.
- Create an environment named `npm`. Optionally require a human reviewer on it, which puts a manual approval in front of every publish.

## 6. npm Trusted Publisher

Register a GitHub Actions trusted publisher on the npm package settings:

| Field            | Value         |
| ---------------- | ------------- |
| Package          | `tracksmith`  |
| Repository owner | `UzEE`        |
| Repository       | `tracksmith`  |
| Workflow         | `release.yml` |
| Environment      | `npm`         |
| Permission       | Publish       |

Trusted Publishing requires npm 11.5.1 or newer and Node.js 22.14.0 or newer. The release workflow pins Node.js 24 and npm 11.19.0, which clears both.

Trusted Publishing supplies provenance by itself. The release executor still passes `--provenance` explicitly so the repository's policy is visible in the command that runs. The publish step must be a direct `npm publish <tarball> --provenance`; do not use `vp pm publish` for it.

## 7. First automated release

Merge the generated `changeset-release/main` pull request only after all five of these are confirmed:

1. The `0.0.0` bootstrap publish succeeded.
2. `UzEE/tracksmith` is public.
3. The CI `verify` job is required and passing.
4. The `npm` environment exists.
5. The trusted publisher entry is registered.

Merging that pull request is what triggers the release workflow. The workflow proves it checked out the exact merge commit, runs `vp check`, `vp test run`, and `vp run package:smoke`, then publishes the single tarball that the smoke run left in `out/package-smoke`.

## 8. Retry table

The executor reads the tag, the npm version, npm `latest`, and the GitHub release before writing anything, so a rerun resumes where the last attempt stopped instead of duplicating work. When the target version is missing, npm `latest` must equal the nearest earlier package version in the release commit's first-parent history. A mismatch means releases are out of order or the published state does not match Git history, so the executor writes nothing.

| Observed state                                   | Executor does                                              |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Fresh: no tag, no npm version, no GitHub release | Creates the tag, publishes the tarball, creates the release |
| Tag only                                         | Publishes the tarball, creates the release                  |
| Tag plus npm version with matching integrity     | Creates the release                                         |
| Complete: tag, npm version, and release present  | Nothing                                                     |
| Wrong tag: tag points at a different commit      | Fails: the release tag points at a different commit         |
| npm version without a tag                        | Fails: the npm version exists without a release tag         |
| Matching tag plus npm version with wrong integrity | Fails: npm integrity does not match the verified tarball  |
| Matching tag plus GitHub release but no npm version | Fails: the GitHub release exists before npm publication |

A GitHub release with no tag at all does not reach that last check; it fails the earlier no-tag guard instead.

The four failing rows here stop before any write. They mean the world does not match what the release commit says it should be, and that has to be understood before another attempt.

## 9. Immutable state rule

Never delete or move a release tag. The tag is the anchor every other check trusts; moving one makes the npm and GitHub comparisons meaningless and hides whatever actually went wrong.

When a check fails, investigate the mismatch. Do not rerun until you know why the states disagree, and never reshape the published state to make a rerun pass.

A local tarball-integrity mismatch on retry means the build inputs or the toolchain changed between runs. Two builds of the same commit should produce the same tarball. Treat a mismatch as a real problem to investigate, not something to bypass.

## 10. Expected `0.1.0` evidence

After a successful `0.1.0` release, these four should agree:

- `package.json` on `main` reads version `0.1.0`.
- Tag `v0.1.0` is annotated and points at the release commit.
- npm shows `tracksmith@0.1.0` with a provenance attestation linking back to that commit and to `release.yml`.
- The GitHub release for `v0.1.0` carries the `0.1.0` section of `CHANGELOG.md` as its notes.

If any one of them disagrees, stop and read section 9 before doing anything else.
