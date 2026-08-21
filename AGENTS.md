# Project instructions

Tracksmith is a personal Bun CLI for inspecting and editing Matroska audio tracks.

## Toolchain

- Use `vp install`, `vp add`, and `vp remove` for dependencies. Vite+ delegates these commands to Bun.
- Use `bun run src/cli.ts <command>` to run the CLI.
- Use `bun test` for tests.
- Use `vp check` for formatting, linting, and TypeScript 7 checks.
- Use `vp check --fix` to apply Oxfmt and safe Oxlint fixes.

## Code

- Keep the CLI focused on personal local use. Do not add public-service infrastructure or compatibility layers without a concrete need.
- Validate external command output at the boundary. Use the existing Zod Mini schemas for structured JSON.
- Preserve Bun as the runtime and test runner.
- Preserve lossless audio handling. Do not add audio re-encoding.

## Verification

Run these commands before committing:

```sh
vp check
bun test
```
