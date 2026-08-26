import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import {
  RELEASE_BRANCH,
  assertChangesetPresent,
  isChangesetMarkdown
} from '../scripts/check-changeset.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed.\n${result.stdout}${result.stderr}`);
  }

  return result.stdout.trim();
}

test('a changeset markdown file satisfies a normal pull request', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: 'feature/audio-sync',
      changedPaths: ['.changeset/feature.md']
    })
  ).not.toThrow();
});

test('an empty changeset markdown file satisfies a normal pull request', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: 'feature/docs-only',
      changedPaths: ['.changeset/no-release.md']
    })
  ).not.toThrow();
});

test('Changesets metadata files are not release changesets', () => {
  expect(isChangesetMarkdown('.changeset/config.json')).toBe(false);
  expect(isChangesetMarkdown('.changeset/README.md')).toBe(false);
});

test('the Git adapter excludes deleted changesets', () => {
  const repository = mkdtempSync(join(tmpdir(), 'tracksmith-changeset-check-'));
  temporaryDirectories.push(repository);

  runGit(repository, ['init', '--quiet']);
  runGit(repository, ['config', 'user.email', 'tracksmith@example.invalid']);
  runGit(repository, ['config', 'user.name', 'Tracksmith Tests']);
  runGit(repository, ['checkout', '-b', 'main', '--quiet']);

  const changesetDirectory = join(repository, '.changeset');
  const deletedChangeset = join(changesetDirectory, 'deleted.md');
  mkdirSync(changesetDirectory);
  writeFileSync(deletedChangeset, '---\n---\n');
  runGit(repository, ['add', '.changeset/deleted.md']);
  runGit(repository, ['commit', '--quiet', '-m', 'add changeset']);
  const baseRef = runGit(repository, ['rev-parse', 'HEAD']);

  rmSync(deletedChangeset);
  runGit(repository, ['add', '--update']);
  runGit(repository, ['commit', '--quiet', '-m', 'delete changeset']);

  const checker = resolve(process.cwd(), 'scripts/check-changeset.ts');
  const result = spawnSync('bun', ['run', checker, 'feature/delete-changeset', baseRef], {
    cwd: repository,
    encoding: 'utf8'
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('vp run changeset add --empty');
});

test('the generated release branch bypasses the changeset file requirement', () => {
  expect(() => assertChangesetPresent({ headRef: RELEASE_BRANCH, changedPaths: [] })).not.toThrow();
});

test('a normal pull request without a changeset explains how to add an empty one', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: 'feature/audio-sync',
      changedPaths: ['.changeset/config.json', '.changeset/README.md']
    })
  ).toThrow('vp run changeset add --empty');
});
