import type { ReleaseMetadata, ReleaseTag, StableVersion } from '../scripts/release/metadata.ts';
import type { ReleaseState } from '../scripts/release/state.ts';

import { describe, expect, test } from 'vite-plus/test';

import {
  createCommandReleaseGateway,
  executeRelease,
  findReleaseTarball,
  requireFullCommitSha,
  type CommandResult,
  type ReleaseCommandRunner,
  type ReleaseGateway,
  type WithNotesFile
} from '../scripts/release.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';
const integrity = 'sha512-ZXhwZWN0ZWQ=';
const tarballPath = '/tmp/tracksmith-1.2.3.tgz';
const metadata = {
  name: 'tracksmith',
  version: '1.2.3',
  tag: 'v1.2.3',
  changelogSection: 'Release notes.\n'
} satisfies ReleaseMetadata;

class FakeReleaseGateway implements ReleaseGateway {
  readonly events: string[] = [];
  readonly writes: string[] = [];
  failRead: 'tag' | 'npm' | 'github' | null = null;
  failWrite: 'tag' | 'npm' | 'github' | null = null;
  tagCommit: string | null;
  npmIntegrity: string | null;
  githubExists: boolean;

  constructor(state: Pick<ReleaseState, 'tagCommit' | 'npmIntegrity' | 'githubReleaseExists'>) {
    this.tagCommit = state.tagCommit;
    this.npmIntegrity = state.npmIntegrity;
    this.githubExists = state.githubReleaseExists;
  }

  async readTagCommit(tag: ReleaseTag): Promise<string | null> {
    this.events.push(`read-tag:${tag}`);
    if (this.failRead === 'tag') throw new Error('tag read failed');
    return this.tagCommit;
  }

  async readNpmIntegrity(name: 'tracksmith', version: StableVersion): Promise<string | null> {
    this.events.push(`read-npm:${name}@${version}`);
    if (this.failRead === 'npm') throw new Error('npm read failed');
    return this.npmIntegrity;
  }

  async githubReleaseExists(tag: ReleaseTag): Promise<boolean> {
    this.events.push(`read-github:${tag}`);
    if (this.failRead === 'github') throw new Error('GitHub read failed');
    return this.githubExists;
  }

  async createAndPushTag(tag: ReleaseTag, tagCommit: string, message: string): Promise<void> {
    this.events.push(`write-tag:${tag}:${tagCommit}:${message}`);
    this.writes.push('tag');
    if (this.failWrite === 'tag') throw new Error('tag write failed');
    this.tagCommit = tagCommit;
  }

  async publishTarball(path: string): Promise<void> {
    this.events.push(`write-npm:${path}`);
    this.writes.push('npm');
    if (this.failWrite === 'npm') throw new Error('npm write failed');
    this.npmIntegrity = integrity;
  }

  async createGithubRelease(tag: ReleaseTag, notes: string): Promise<void> {
    this.events.push(`write-github:${tag}:${notes}`);
    this.writes.push('github');
    if (this.failWrite === 'github') throw new Error('GitHub write failed');
    this.githubExists = true;
  }
}

class DeferredReadGateway extends FakeReleaseGateway {
  readonly startedReads: string[] = [];
  #completeReads: (() => void) | undefined;
  readonly readsComplete = new Promise<void>((resolve) => {
    this.#completeReads = resolve;
  });

  completeReads(): void {
    this.#completeReads?.();
  }

  override async readTagCommit(tag: ReleaseTag): Promise<string | null> {
    this.startedReads.push('tag');
    await this.readsComplete;
    return super.readTagCommit(tag);
  }

  override async readNpmIntegrity(
    name: 'tracksmith',
    version: StableVersion
  ): Promise<string | null> {
    this.startedReads.push('npm');
    await this.readsComplete;
    return super.readNpmIntegrity(name, version);
  }

  override async githubReleaseExists(tag: ReleaseTag): Promise<boolean> {
    this.startedReads.push('github');
    await this.readsComplete;
    return super.githubReleaseExists(tag);
  }
}

function releaseState(
  overrides: Partial<Pick<ReleaseState, 'tagCommit' | 'npmIntegrity' | 'githubReleaseExists'>> = {}
) {
  return {
    tagCommit: null,
    npmIntegrity: null,
    githubReleaseExists: false,
    ...overrides
  };
}

function input() {
  return {
    metadata,
    commit,
    tarballPath,
    tarballIntegrity: integrity
  };
}

describe('executeRelease', () => {
  test('starts and completes all external reads before the first write', async () => {
    const gateway = new DeferredReadGateway(releaseState());
    const execution = executeRelease(input(), gateway);

    await Promise.resolve();
    expect(gateway.startedReads).toEqual(['tag', 'npm', 'github']);
    expect(gateway.writes).toEqual([]);

    gateway.completeReads();
    await execution;

    expect(gateway.events.slice(0, 3)).toEqual([
      'read-tag:v1.2.3',
      'read-npm:tracksmith@1.2.3',
      'read-github:v1.2.3'
    ]);
    expect(gateway.writes).toEqual(['tag', 'npm', 'github']);
  });

  test.each([
    {
      name: 'fresh state',
      state: releaseState(),
      writes: ['tag', 'npm', 'github']
    },
    {
      name: 'tag-only state',
      state: releaseState({ tagCommit: commit }),
      writes: ['npm', 'github']
    },
    {
      name: 'published state',
      state: releaseState({ tagCommit: commit, npmIntegrity: integrity }),
      writes: ['github']
    },
    {
      name: 'complete state',
      state: releaseState({
        tagCommit: commit,
        npmIntegrity: integrity,
        githubReleaseExists: true
      }),
      writes: []
    }
  ])('writes the missing actions in order for $name', async ({ state, writes }) => {
    const gateway = new FakeReleaseGateway(state);

    await executeRelease(input(), gateway);

    expect(gateway.writes).toEqual(writes);
  });

  test.each([
    releaseState({ tagCommit: 'ffffffffffffffffffffffffffffffffffffffff' }),
    releaseState({ npmIntegrity: integrity }),
    releaseState({ tagCommit: commit, npmIntegrity: 'sha512-d3Jvbmc=' }),
    releaseState({ githubReleaseExists: true }),
    releaseState({ tagCommit: commit, githubReleaseExists: true })
  ])('writes nothing for inconsistent state', async (state) => {
    const gateway = new FakeReleaseGateway(state);

    await expect(executeRelease(input(), gateway)).rejects.toThrow();
    expect(gateway.writes).toEqual([]);
  });

  test('resumes from tag-only state after npm publication fails', async () => {
    const gateway = new FakeReleaseGateway(releaseState());
    gateway.failWrite = 'npm';

    await expect(executeRelease(input(), gateway)).rejects.toThrow('npm write failed');
    expect(gateway.writes).toEqual(['tag', 'npm']);

    gateway.failWrite = null;
    gateway.writes.length = 0;
    await executeRelease(input(), gateway);

    expect(gateway.writes).toEqual(['npm', 'github']);
  });

  test('resumes from published state after GitHub release creation fails', async () => {
    const gateway = new FakeReleaseGateway(releaseState());
    gateway.failWrite = 'github';

    await expect(executeRelease(input(), gateway)).rejects.toThrow('GitHub write failed');
    expect(gateway.writes).toEqual(['tag', 'npm', 'github']);

    gateway.failWrite = null;
    gateway.writes.length = 0;
    await executeRelease(input(), gateway);

    expect(gateway.writes).toEqual(['github']);
  });

  test.each(['tag', 'npm', 'github'] as const)(
    'stops before writes when the %s read fails',
    async (read) => {
      const gateway = new FakeReleaseGateway(releaseState());
      gateway.failRead = read;

      await expect(executeRelease(input(), gateway)).rejects.toThrow();
      expect(gateway.writes).toEqual([]);
    }
  );
});

interface CommandInvocation {
  command: string;
  args: readonly string[];
}

function result(exitCode: number, stdout = '', stderr = ''): CommandResult {
  return { exitCode, stdout, stderr };
}

function commandHarness(results: readonly CommandResult[]) {
  const invocations: CommandInvocation[] = [];
  const pending = [...results];
  const run: ReleaseCommandRunner = (command, args) => {
    invocations.push({ command, args });
    const next = pending.shift();
    if (next === undefined) throw new Error(`No fake result for ${command}.`);
    return Promise.resolve(next);
  };
  let notes = '';
  const withNotesFile: WithNotesFile = async (contents, use) => {
    notes = contents;
    await use('/tmp/tracksmith-release-notes.md');
  };

  return {
    invocations,
    run,
    withNotesFile,
    get notes() {
      return notes;
    }
  };
}

describe('command release gateway', () => {
  test('uses the exact read commands and parses successful output', async () => {
    const harness = commandHarness([
      result(0, `${commit}\n`),
      result(0, `"${integrity}"\n`),
      result(0, '{"tagName":"v1.2.3"}\n')
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.readTagCommit(metadata.tag)).resolves.toBe(commit);
    await expect(gateway.readNpmIntegrity(metadata.name, metadata.version)).resolves.toBe(
      integrity
    );
    await expect(gateway.githubReleaseExists(metadata.tag)).resolves.toBe(true);
    expect(harness.invocations).toEqual([
      { command: 'git', args: ['rev-list', '-n', '1', 'v1.2.3'] },
      {
        command: 'npm',
        args: ['view', 'tracksmith@1.2.3', 'dist.integrity', '--json']
      },
      {
        command: 'gh',
        args: ['release', 'view', 'v1.2.3', '--json', 'tagName']
      }
    ]);
  });

  test('returns absent state only for explicit not-found responses', async () => {
    const harness = commandHarness([
      result(
        128,
        '',
        "fatal: ambiguous argument 'v1.2.3': unknown revision or path not in the working tree.\n"
      ),
      result(1, '', 'npm error code E404\n'),
      result(1, '', 'release not found\n')
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.readTagCommit(metadata.tag)).resolves.toBeNull();
    await expect(gateway.readNpmIntegrity(metadata.name, metadata.version)).resolves.toBeNull();
    await expect(gateway.githubReleaseExists(metadata.tag)).resolves.toBe(false);
  });

  test.each([
    {
      name: 'Git tag lookup',
      result: result(128, '', 'fatal: unable to access remote helper\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readTagCommit(metadata.tag)
    },
    {
      name: 'npm lookup',
      result: result(1, '', 'npm error code E401\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readNpmIntegrity(metadata.name, metadata.version)
    },
    {
      name: 'GitHub lookup',
      result: result(1, '', 'HTTP 503: Service Unavailable\n'),
      invoke: (gateway: ReleaseGateway) => gateway.githubReleaseExists(metadata.tag)
    }
  ])('throws on ambiguous $name failures', async ({ result: commandResult, invoke }) => {
    const harness = commandHarness([commandResult]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(invoke(gateway)).rejects.toThrow();
  });

  test.each([
    {
      name: 'Git tag output',
      result: result(0, 'not-a-commit\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readTagCommit(metadata.tag)
    },
    {
      name: 'npm output',
      result: result(0, 'not-json\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readNpmIntegrity(metadata.name, metadata.version)
    },
    {
      name: 'GitHub output',
      result: result(0, '{"tagName":"v9.9.9"}\n'),
      invoke: (gateway: ReleaseGateway) => gateway.githubReleaseExists(metadata.tag)
    }
  ])('throws on malformed $name', async ({ result: commandResult, invoke }) => {
    const harness = commandHarness([commandResult]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(invoke(gateway)).rejects.toThrow();
  });

  test('uses exact write argv and passes release notes through a temporary file', async () => {
    const harness = commandHarness([result(0), result(0), result(0), result(0)]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await gateway.createAndPushTag(metadata.tag, commit, 'Release 1.2.3');
    await gateway.publishTarball(tarballPath);
    await gateway.createGithubRelease(metadata.tag, metadata.changelogSection);

    expect(harness.notes).toBe(metadata.changelogSection);
    expect(harness.invocations).toEqual([
      {
        command: 'git',
        args: ['tag', '--annotate', 'v1.2.3', commit, '--message', 'Release 1.2.3']
      },
      {
        command: 'git',
        args: ['push', 'origin', 'refs/tags/v1.2.3']
      },
      {
        command: 'npm',
        args: ['publish', tarballPath, '--access', 'public', '--tag', 'latest', '--provenance']
      },
      {
        command: 'gh',
        args: [
          'release',
          'create',
          'v1.2.3',
          '--verify-tag',
          '--title',
          'v1.2.3',
          '--notes-file',
          '/tmp/tracksmith-release-notes.md'
        ]
      }
    ]);
  });

  test('stops immediately when a tag write command fails', async () => {
    const harness = commandHarness([result(1, '', 'tag failed\n')]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.createAndPushTag(metadata.tag, commit, 'Release 1.2.3')).rejects.toThrow();
    expect(harness.invocations).toHaveLength(1);
  });
});

describe('release CLI validation', () => {
  test('requires a full 40-character GitHub commit SHA', () => {
    expect(requireFullCommitSha(commit)).toBe(commit);
    expect(() => requireFullCommitSha(undefined)).toThrow('GITHUB_SHA');
    expect(() => requireFullCommitSha('0123456')).toThrow('full commit SHA');
  });

  test('requires exactly one package-smoke tarball and returns its absolute path', () => {
    expect(findReleaseTarball('/repo/out/package-smoke', ['tracksmith-1.2.3.tgz'])).toBe(
      '/repo/out/package-smoke/tracksmith-1.2.3.tgz'
    );
    expect(() => findReleaseTarball('/repo/out/package-smoke', [])).toThrow('exactly one .tgz');
    expect(() => findReleaseTarball('/repo/out/package-smoke', ['one.tgz', 'two.tgz'])).toThrow(
      'exactly one .tgz'
    );
  });
});
