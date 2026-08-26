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

const REPOSITORY = 'UzEE/tracksmith';
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

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'tracksmith-changeset-check-'));
  temporaryDirectories.push(repository);

  runGit(repository, ['init', '--quiet']);
  runGit(repository, ['config', 'user.email', 'tracksmith@example.invalid']);
  runGit(repository, ['config', 'user.name', 'Tracksmith Tests']);
  runGit(repository, ['checkout', '-b', 'main', '--quiet']);

  return repository;
}

function commit(repository: string, message: string): void {
  runGit(repository, [
    '-c',
    'commit.gpgSign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    message
  ]);
}

function runChecker(repository: string, headRef: string, baseRef: string) {
  const checker = resolve(process.cwd(), 'scripts/check-changeset.ts');
  return spawnSync('bun', ['run', checker, headRef, REPOSITORY, REPOSITORY, baseRef], {
    cwd: repository,
    encoding: 'utf8'
  });
}

test('a changeset markdown file satisfies a normal pull request', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: 'feature/audio-sync',
      headRepository: REPOSITORY,
      repository: REPOSITORY,
      changedPaths: ['.changeset/feature.md']
    })
  ).not.toThrow();
});

test('an empty changeset markdown file satisfies a normal pull request', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: 'feature/docs-only',
      headRepository: REPOSITORY,
      repository: REPOSITORY,
      changedPaths: ['.changeset/no-release.md']
    })
  ).not.toThrow();
});

test('Changesets metadata files are not release changesets', () => {
  expect(isChangesetMarkdown('.changeset/config.json')).toBe(false);
  expect(isChangesetMarkdown('.changeset/README.md')).toBe(false);
});

test('the Git adapter excludes deleted changesets', () => {
  const repository = createRepository();
  const changesetDirectory = join(repository, '.changeset');
  const deletedChangeset = join(changesetDirectory, 'deleted.md');
  mkdirSync(changesetDirectory);
  writeFileSync(deletedChangeset, '---\n---\n');
  runGit(repository, ['add', '.changeset/deleted.md']);
  commit(repository, 'add changeset');
  const baseRef = runGit(repository, ['rev-parse', 'HEAD']);

  rmSync(deletedChangeset);
  runGit(repository, ['add', '--update']);
  commit(repository, 'delete changeset');

  const result = runChecker(repository, 'feature/delete-changeset', baseRef);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('vp run changeset add --empty');
});

test('the Git adapter accepts a Unicode changeset path', () => {
  const repository = createRepository();
  writeFileSync(join(repository, 'README.md'), 'Tracksmith\n');
  runGit(repository, ['add', 'README.md']);
  commit(repository, 'add readme');
  const baseRef = runGit(repository, ['rev-parse', 'HEAD']);

  const changesetDirectory = join(repository, '.changeset');
  mkdirSync(changesetDirectory);
  writeFileSync(join(changesetDirectory, '日本語.md'), '---\n---\n');
  runGit(repository, ['add', '.changeset/日本語.md']);
  commit(repository, 'add Unicode changeset');

  const result = runChecker(repository, 'feature/unicode-changeset', baseRef);

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});

test('the same-repository generated release branch bypasses the changeset file requirement', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: RELEASE_BRANCH,
      headRepository: REPOSITORY,
      repository: REPOSITORY,
      changedPaths: []
    })
  ).not.toThrow();
});

test('a fork cannot bypass the changeset requirement with the release branch name', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: RELEASE_BRANCH,
      headRepository: 'someone/tracksmith',
      repository: REPOSITORY,
      changedPaths: []
    })
  ).toThrow('vp run changeset add --empty');
});

test('a normal pull request without a changeset explains how to add an empty one', () => {
  expect(() =>
    assertChangesetPresent({
      headRef: 'feature/audio-sync',
      headRepository: REPOSITORY,
      repository: REPOSITORY,
      changedPaths: ['.changeset/config.json', '.changeset/README.md']
    })
  ).toThrow('vp run changeset add --empty');
});
