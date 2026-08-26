import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as z from 'zod/mini';

import {
  calculateIntegrity,
  parseStableVersion,
  readReleaseMetadata,
  type ReleaseMetadata,
  type ReleaseTag,
  type StableVersion
} from './release/metadata.ts';
import { planRelease } from './release/state.ts';

export interface ReleaseGateway {
  readTagCommit(tag: ReleaseTag): Promise<string | null>;
  readNpmIntegrity(name: 'tracksmith', version: StableVersion): Promise<string | null>;
  readNpmLatest(name: 'tracksmith'): Promise<StableVersion | null>;
  githubReleaseExists(tag: ReleaseTag, expectedNotes: string): Promise<boolean>;
  createAndPushTag(tag: ReleaseTag, commit: string, message: string): Promise<void>;
  publishTarball(path: string): Promise<void>;
  createGithubRelease(tag: ReleaseTag, notes: string): Promise<void>;
}

export interface ExecuteReleaseInput {
  metadata: ReleaseMetadata;
  commit: string;
  previousVersion: StableVersion;
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
const npmVersionSchema = z.string();
const githubReleaseSchema = z.object({ tagName: z.string(), body: z.string() });
const previousPackageSchema = z.object({ version: z.string() });

function compareStableVersions(left: StableVersion, right: StableVersion): number {
  const leftParts = left.split('.');
  const rightParts = right.split('.');

  for (let index = 0; index < 3; index += 1) {
    const leftPart = BigInt(leftParts[index]!);
    const rightPart = BigInt(rightParts[index]!);
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }

  return 0;
}

function requireNpmLatestState(
  targetVersion: StableVersion,
  previousVersion: StableVersion,
  npmIntegrity: string | null,
  npmLatest: StableVersion | null
): void {
  if (npmIntegrity === null) {
    if (compareStableVersions(targetVersion, previousVersion) <= 0) {
      throw new Error('The target version must be newer than the previous package version.');
    }
    if (npmLatest !== previousVersion) {
      throw new Error('npm latest does not match the previous package version.');
    }
    return;
  }

  if (npmLatest === null || compareStableVersions(npmLatest, targetVersion) < 0) {
    throw new Error('npm latest is older than the published target version.');
  }
}

export async function executeRelease(
  input: ExecuteReleaseInput,
  gateway: ReleaseGateway
): Promise<void> {
  const [tagCommit, npmIntegrity, npmLatest, githubReleaseExists] = await Promise.all([
    gateway.readTagCommit(input.metadata.tag),
    gateway.readNpmIntegrity(input.metadata.name, input.metadata.version),
    gateway.readNpmLatest(input.metadata.name),
    gateway.githubReleaseExists(input.metadata.tag, input.metadata.changelogSection)
  ]);

  requireNpmLatestState(input.metadata.version, input.previousVersion, npmIntegrity, npmLatest);

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

function isMissingLocalTag(result: CommandResult, tag: ReleaseTag): boolean {
  return (
    result.stderr.includes(
      `fatal: ambiguous argument '${tag}': unknown revision or path not in the working tree.`
    ) || result.stderr.trim() === `fatal: bad revision '${tag}'`
  );
}

function isMissingRemoteTag(result: CommandResult): boolean {
  return result.exitCode === 2 && result.stdout.trim() === '' && result.stderr.trim() === '';
}

function isMissingNpmVersion(result: CommandResult): boolean {
  if (result.exitCode !== 1 || result.stdout.trim() !== '') return false;

  let codeLines = 0;
  for (const line of result.stderr.split(/\r?\n/).filter((value) => value !== '')) {
    const code = /^(?:npm (?:ERR!|error) )?code ([A-Z0-9]+)$/i.exec(line)?.[1];
    if (code !== undefined) {
      if (code.toUpperCase() !== 'E404') return false;
      codeLines += 1;
      continue;
    }

    if (/^(?:npm (?:ERR!|error) )?404(?:\s|$)/i.test(line)) continue;
    if (/^npm (?:ERR!|error) A complete log of this run can be found in:/i.test(line)) continue;
    return false;
  }

  return codeLines === 1;
}

function isMissingGithubRelease(result: CommandResult): boolean {
  return result.stdout.trim() === '' && result.stderr.trim().toLowerCase() === 'release not found';
}

function parseTagCommit(stdout: string): string {
  const commit = stdout.trim();
  if (!fullCommitPattern.test(commit)) {
    throw new Error('git rev-list did not return a full commit SHA.');
  }
  return commit;
}

function parseRemoteTagCommit(stdout: string, tag: ReleaseTag): string {
  const tagRef = `refs/tags/${tag}`;
  const peeledRef = `${tagRef}^{}`;
  const lines = stdout.trim().split(/\r?\n/);
  let tagObject: string | undefined;
  let peeledCommit: string | undefined;

  for (const line of lines) {
    const [object, ref, extra] = line.split('\t');
    if (object === undefined || !fullCommitPattern.test(object) || extra !== undefined) {
      throw new Error(`git ls-remote returned malformed state for ${tagRef}.`);
    }

    if (ref === tagRef && tagObject === undefined) {
      tagObject = object;
    } else if (ref === peeledRef && peeledCommit === undefined) {
      peeledCommit = object;
    } else {
      throw new Error(`git ls-remote returned ambiguous state for ${tagRef}.`);
    }
  }

  if (lines.length !== 2 || tagObject === undefined || peeledCommit === undefined) {
    throw new Error(
      `git ls-remote did not return one annotated tag and peeled commit for ${tagRef}.`
    );
  }

  return peeledCommit;
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

function parseNpmLatest(stdout: string): StableVersion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('npm view returned malformed JSON.');
  }

  const result = z.safeParse(npmVersionSchema, parsed);
  if (!result.success) {
    throw new Error('npm view returned a malformed dist-tags.latest value.');
  }

  return parseStableVersion(result.data);
}

function normalizeTrailingLineEndings(value: string): string {
  return value.replace(/[\r\n]+$/, '');
}

function requireGithubRelease(
  stdout: string,
  expectedTag: ReleaseTag,
  expectedNotes: string
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('gh release view returned malformed JSON.');
  }

  const result = z.safeParse(githubReleaseSchema, parsed);
  if (!result.success) {
    throw new Error('gh release view returned malformed release metadata.');
  }
  if (result.data.tagName !== expectedTag) {
    throw new Error(`gh release view did not return the expected tag ${expectedTag}.`);
  }
  if (
    normalizeTrailingLineEndings(result.data.body) !== normalizeTrailingLineEndings(expectedNotes)
  ) {
    throw new Error('The existing GitHub release notes do not match CHANGELOG.md.');
  }
}

export function createCommandReleaseGateway(
  run: ReleaseCommandRunner,
  withNotesFile: WithNotesFile
): ReleaseGateway {
  return {
    async readTagCommit(tag) {
      const remoteArgs = [
        'ls-remote',
        '--exit-code',
        'origin',
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`
      ] as const;
      const remoteResult = await run('git', remoteArgs);
      if (remoteResult.exitCode !== 0) {
        if (isMissingRemoteTag(remoteResult)) return null;
        throw commandFailure('git', remoteArgs, remoteResult);
      }
      const remoteCommit = parseRemoteTagCommit(remoteResult.stdout, tag);

      const localArgs = ['rev-list', '-n', '1', tag] as const;
      const localResult = requireSuccess('git', localArgs, await run('git', localArgs));
      const localCommit = parseTagCommit(localResult.stdout);
      if (localCommit !== remoteCommit) {
        throw new Error('The local tag commit does not match the remote tag commit.');
      }
      return remoteCommit;
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

    async readNpmLatest(name) {
      const args = ['view', name, 'dist-tags.latest', '--json'] as const;
      const result = await run('npm', args);
      if (result.exitCode !== 0) {
        if (isMissingNpmVersion(result)) return null;
        throw commandFailure('npm', args, result);
      }
      return parseNpmLatest(result.stdout);
    },

    async githubReleaseExists(tag, expectedNotes) {
      const args = ['release', 'view', tag, '--json', 'tagName,body'] as const;
      const result = await run('gh', args);
      if (result.exitCode !== 0) {
        if (isMissingGithubRelease(result)) return false;
        throw commandFailure('gh', args, result);
      }
      requireGithubRelease(result.stdout, tag, expectedNotes);
      return true;
    },

    async createAndPushTag(tag, commit, message) {
      const localArgs = ['rev-list', '-n', '1', tag] as const;
      const localResult = await run('git', localArgs);

      if (localResult.exitCode !== 0) {
        if (!isMissingLocalTag(localResult, tag)) {
          throw commandFailure('git', localArgs, localResult);
        }

        const tagArgs = ['tag', '--annotate', tag, commit, '--message', message] as const;
        requireSuccess('git', tagArgs, await run('git', tagArgs));
      } else {
        const localCommit = parseTagCommit(localResult.stdout);
        if (localCommit !== commit) {
          throw new Error('The local release tag points at a different commit.');
        }

        const typeArgs = ['cat-file', '-t', `refs/tags/${tag}`] as const;
        const typeResult = requireSuccess('git', typeArgs, await run('git', typeArgs));
        if (typeResult.stdout.trim() !== 'tag') {
          throw new Error('The local release tag is not annotated.');
        }
      }

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

export async function readPreviousPackageVersion(
  commit: string,
  run: ReleaseCommandRunner
): Promise<StableVersion> {
  const args = ['show', `${commit}^1:package.json`] as const;
  const result = requireSuccess('git', args, await run('git', args));
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('git show returned malformed previous package.json.');
  }

  const packageResult = z.safeParse(previousPackageSchema, parsed);
  if (!packageResult.success) {
    throw new Error('git show did not return a string previous package version.');
  }

  try {
    return parseStableVersion(packageResult.data.version);
  } catch {
    throw new Error('git show returned an invalid previous package version.');
  }
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
  const run = runCommandFrom(repositoryRoot);
  const [packageJson, changelog, outputEntries, previousVersion] = await Promise.all([
    readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(join(repositoryRoot, 'CHANGELOG.md'), 'utf8'),
    readdir(outputDirectory),
    readPreviousPackageVersion(commit, run)
  ]);
  const metadata = readReleaseMetadata(packageJson, changelog);
  const tarballPath = findReleaseTarball(outputDirectory, outputEntries);
  const tarballIntegrity = calculateIntegrity(await readFile(tarballPath));
  const fetchArgs = ['fetch', 'origin', '--tags'] as const;

  requireSuccess('git', fetchArgs, await run('git', fetchArgs));
  await executeRelease(
    { metadata, commit, previousVersion, tarballPath, tarballIntegrity },
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
