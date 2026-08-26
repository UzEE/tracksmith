import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as z from 'zod/mini';

import {
  calculateIntegrity,
  readReleaseMetadata,
  type ReleaseMetadata,
  type ReleaseTag,
  type StableVersion
} from './release/metadata.ts';
import { planRelease } from './release/state.ts';

export interface ReleaseGateway {
  readTagCommit(tag: ReleaseTag): Promise<string | null>;
  readNpmIntegrity(name: 'tracksmith', version: StableVersion): Promise<string | null>;
  githubReleaseExists(tag: ReleaseTag): Promise<boolean>;
  createAndPushTag(tag: ReleaseTag, commit: string, message: string): Promise<void>;
  publishTarball(path: string): Promise<void>;
  createGithubRelease(tag: ReleaseTag, notes: string): Promise<void>;
}

export interface ExecuteReleaseInput {
  metadata: ReleaseMetadata;
  commit: string;
  tarballPath: string;
  tarballIntegrity: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ReleaseCommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<CommandResult>;

export type WithNotesFile = (notes: string, use: (path: string) => Promise<void>) => Promise<void>;

const fullCommitPattern = /^[0-9a-f]{40}$/;
const integrityPattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const npmIntegritySchema = z.string();
const githubReleaseSchema = z.object({ tagName: z.string() });

export async function executeRelease(
  input: ExecuteReleaseInput,
  gateway: ReleaseGateway
): Promise<void> {
  const [tagCommit, npmIntegrity, githubReleaseExists] = await Promise.all([
    gateway.readTagCommit(input.metadata.tag),
    gateway.readNpmIntegrity(input.metadata.name, input.metadata.version),
    gateway.githubReleaseExists(input.metadata.tag)
  ]);

  const actions = planRelease({
    expectedCommit: input.commit,
    expectedIntegrity: input.tarballIntegrity,
    tagCommit,
    npmIntegrity,
    githubReleaseExists
  });

  for (const action of actions) {
    switch (action) {
      case 'create-tag':
        // eslint-disable-next-line no-await-in-loop -- Release writes must stay ordered and stop after failure.
        await gateway.createAndPushTag(
          input.metadata.tag,
          input.commit,
          `Release ${input.metadata.version}`
        );
        break;
      case 'publish-tarball':
        // eslint-disable-next-line no-await-in-loop -- Release writes must stay ordered and stop after failure.
        await gateway.publishTarball(input.tarballPath);
        break;
      case 'create-github-release':
        // eslint-disable-next-line no-await-in-loop -- Release writes must stay ordered and stop after failure.
        await gateway.createGithubRelease(input.metadata.tag, input.metadata.changelogSection);
        break;
    }
  }
}

function commandFailure(command: string, args: readonly string[], result: CommandResult): Error {
  const output = `${result.stdout}${result.stderr}`.trim();
  return new Error(
    `${command} ${args.join(' ')} failed with exit code ${result.exitCode}.${output === '' ? '' : `\n${output}`}`
  );
}

function requireSuccess(
  command: string,
  args: readonly string[],
  result: CommandResult
): CommandResult {
  if (result.exitCode !== 0) throw commandFailure(command, args, result);
  return result;
}

function isMissingTag(result: CommandResult, tag: ReleaseTag): boolean {
  return (
    result.stderr.includes(
      `fatal: ambiguous argument '${tag}': unknown revision or path not in the working tree.`
    ) || result.stderr.trim() === `fatal: bad revision '${tag}'`
  );
}

function isMissingNpmVersion(result: CommandResult): boolean {
  return /^(?:npm (?:ERR!|error) )?code E404$/im.test(result.stderr);
}

function isMissingGithubRelease(result: CommandResult): boolean {
  return /^release not found$/im.test(result.stderr);
}

function parseNpmIntegrity(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('npm view returned malformed JSON.');
  }

  const result = z.safeParse(npmIntegritySchema, parsed);
  if (!result.success || !integrityPattern.test(result.data)) {
    throw new Error('npm view returned an invalid dist.integrity value.');
  }

  return result.data;
}

function requireGithubTag(stdout: string, expectedTag: ReleaseTag): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('gh release view returned malformed JSON.');
  }

  const result = z.safeParse(githubReleaseSchema, parsed);
  if (!result.success || result.data.tagName !== expectedTag) {
    throw new Error(`gh release view did not return the expected tag ${expectedTag}.`);
  }
}

export function createCommandReleaseGateway(
  run: ReleaseCommandRunner,
  withNotesFile: WithNotesFile
): ReleaseGateway {
  return {
    async readTagCommit(tag) {
      const args = ['rev-list', '-n', '1', tag] as const;
      const result = await run('git', args);
      if (result.exitCode !== 0) {
        if (isMissingTag(result, tag)) return null;
        throw commandFailure('git', args, result);
      }

      const commit = result.stdout.trim();
      if (!fullCommitPattern.test(commit)) {
        throw new Error('git rev-list did not return a full commit SHA.');
      }
      return commit;
    },

    async readNpmIntegrity(name, version) {
      const args = ['view', `${name}@${version}`, 'dist.integrity', '--json'] as const;
      const result = await run('npm', args);
      if (result.exitCode !== 0) {
        if (isMissingNpmVersion(result)) return null;
        throw commandFailure('npm', args, result);
      }
      return parseNpmIntegrity(result.stdout);
    },

    async githubReleaseExists(tag) {
      const args = ['release', 'view', tag, '--json', 'tagName'] as const;
      const result = await run('gh', args);
      if (result.exitCode !== 0) {
        if (isMissingGithubRelease(result)) return false;
        throw commandFailure('gh', args, result);
      }
      requireGithubTag(result.stdout, tag);
      return true;
    },

    async createAndPushTag(tag, commit, message) {
      const tagArgs = ['tag', '--annotate', tag, commit, '--message', message] as const;
      requireSuccess('git', tagArgs, await run('git', tagArgs));

      const pushArgs = ['push', 'origin', `refs/tags/${tag}`] as const;
      requireSuccess('git', pushArgs, await run('git', pushArgs));
    },

    async publishTarball(path) {
      if (!isAbsolute(path)) {
        throw new Error('The release tarball path must be absolute.');
      }

      const args = [
        'publish',
        path,
        '--access',
        'public',
        '--tag',
        'latest',
        '--provenance'
      ] as const;
      requireSuccess('npm', args, await run('npm', args));
    },

    async createGithubRelease(tag, notes) {
      await withNotesFile(notes, async (notesPath) => {
        const args = [
          'release',
          'create',
          tag,
          '--verify-tag',
          '--title',
          tag,
          '--notes-file',
          notesPath
        ] as const;
        requireSuccess('gh', args, await run('gh', args));
      });
    }
  };
}

export function requireFullCommitSha(value: string | undefined): string {
  if (value === undefined || !fullCommitPattern.test(value)) {
    throw new Error('GITHUB_SHA must be a full commit SHA.');
  }
  return value;
}

export function findReleaseTarball(outputDirectory: string, entries: readonly string[]): string {
  const tarballs = entries.filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(
      `Expected exactly one .tgz in ${outputDirectory}, but found ${tarballs.join(', ') || 'nothing'}.`
    );
  }

  return resolve(outputDirectory, tarballs[0]!);
}

function runCommandFrom(repositoryRoot: string): ReleaseCommandRunner {
  return (command, args) => {
    const result = spawnSync(command, [...args], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    });

    if (result.error !== undefined) throw result.error;
    if (result.status === null) {
      throw new Error(`${command} was terminated by signal ${result.signal ?? 'unknown'}.`);
    }

    return Promise.resolve({
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr
    });
  };
}

async function withTemporaryNotesFile(
  notes: string,
  use: (path: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tracksmith-release-'));
  const notesPath = join(directory, 'notes.md');

  try {
    await writeFile(notesPath, notes, 'utf8');
    await use(notesPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function releaseFromCli(): Promise<void> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputDirectory = join(repositoryRoot, 'out', 'package-smoke');
  const commit = requireFullCommitSha(process.env.GITHUB_SHA);
  const [packageJson, changelog, outputEntries] = await Promise.all([
    readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(join(repositoryRoot, 'CHANGELOG.md'), 'utf8'),
    readdir(outputDirectory)
  ]);
  const metadata = readReleaseMetadata(packageJson, changelog);
  const tarballPath = findReleaseTarball(outputDirectory, outputEntries);
  const tarballIntegrity = calculateIntegrity(await readFile(tarballPath));
  const run = runCommandFrom(repositoryRoot);
  const fetchArgs = ['fetch', 'origin', '--tags'] as const;

  requireSuccess('git', fetchArgs, await run('git', fetchArgs));
  await executeRelease(
    { metadata, commit, tarballPath, tarballIntegrity },
    createCommandReleaseGateway(run, withTemporaryNotesFile)
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void releaseFromCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
