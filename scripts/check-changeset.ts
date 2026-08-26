import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RELEASE_BRANCH = 'changeset-release/main' as const;

export interface ChangesetCheck {
  headRef: string;
  headRepository: string;
  repository: string;
  changedPaths: readonly string[];
}

export function isChangesetMarkdown(path: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md';
}

export function assertChangesetPresent(check: ChangesetCheck): void {
  if (
    check.headRef === RELEASE_BRANCH &&
    check.headRepository !== '' &&
    check.headRepository === check.repository
  ) {
    return;
  }

  if (!check.changedPaths.some(isChangesetMarkdown)) {
    throw new Error(
      'This pull request must add or change a .changeset/*.md file. Run `vp run changeset` or `vp run changeset add --empty`.'
    );
  }
}

function changedPathsSince(baseRef: string): readonly string[] {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--', '.changeset'],
    { encoding: 'utf8' }
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `git diff failed with exit code ${result.status ?? 'unknown'}.\n${result.stdout}${result.stderr}`
    );
  }

  return result.stdout.split('\0').filter(Boolean);
}

function main(): void {
  const headRef = process.argv[2] ?? '';
  const headRepository = process.argv[3] ?? '';
  const repository = process.argv[4] ?? '';
  const baseRef = process.argv[5] ?? 'origin/main';
  assertChangesetPresent({
    headRef,
    headRepository,
    repository,
    changedPaths: changedPathsSince(baseRef)
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
