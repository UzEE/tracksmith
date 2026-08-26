import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RELEASE_BRANCH = 'changeset-release/main' as const;

export interface ChangesetCheck {
  headRef: string;
  changedPaths: readonly string[];
}

export function isChangesetMarkdown(path: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md';
}

export function assertChangesetPresent(check: ChangesetCheck): void {
  if (check.headRef === RELEASE_BRANCH) return;

  if (!check.changedPaths.some(isChangesetMarkdown)) {
    throw new Error(
      'This pull request must add or change a .changeset/*.md file. Run `vp run changeset` or `vp run changeset add --empty`.'
    );
  }
}

function changedPathsSince(baseRef: string): readonly string[] {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--', '.changeset'],
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

  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function main(): void {
  const headRef = process.argv[2] ?? '';
  const baseRef = process.argv[3] ?? 'origin/main';
  assertChangesetPresent({ headRef, changedPaths: changedPathsSince(baseRef) });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
