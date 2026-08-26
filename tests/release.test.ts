import type { ReleaseMetadata, ReleaseTag, StableVersion } from '../scripts/release/metadata.ts';
import type { ReleaseState } from '../scripts/release/state.ts';

import { describe, expect, test } from 'vite-plus/test';

import {
  createCommandReleaseGateway,
  executeRelease,
  findReleaseTarball,
  readPreviousPackageVersion,
  requireFullCommitSha,
  type CommandResult,
  type ExecuteReleaseInput,
  type ReleaseCommandRunner,
  type ReleaseGateway,
  type WithNotesFile
} from '../scripts/release.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';
const tagObject = '1111111111111111111111111111111111111111';
const integrity = 'sha512-ZXhwZWN0ZWQ=';
const tarballPath = '/tmp/tracksmith-1.2.3.tgz';
const previousVersion = '1.2.2' satisfies StableVersion;
const metadata = {
  name: 'tracksmith',
  version: '1.2.3',
  tag: 'v1.2.3',
  changelogSection: 'Release notes.\n'
} satisfies ReleaseMetadata;

class FakeReleaseGateway implements ReleaseGateway {
  readonly events: string[] = [];
  readonly writes: string[] = [];
  failRead: 'tag' | 'npm' | 'latest' | 'github' | null = null;
  failWrite: 'tag' | 'npm' | 'github' | null = null;
  tagCommit: string | null;
  npmIntegrity: string | null;
  npmLatest: StableVersion | null;
  githubExists: boolean;

  constructor(
    state: Pick<ReleaseState, 'tagCommit' | 'npmIntegrity' | 'githubReleaseExists'>,
    npmLatest: StableVersion | null = state.npmIntegrity === null
      ? previousVersion
      : metadata.version
  ) {
    this.tagCommit = state.tagCommit;
    this.npmIntegrity = state.npmIntegrity;
    this.npmLatest = npmLatest;
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

  async readNpmLatest(name: 'tracksmith'): Promise<StableVersion | null> {
    this.events.push(`read-npm-latest:${name}`);
    if (this.failRead === 'latest') throw new Error('npm latest read failed');
    return this.npmLatest;
  }

  async githubReleaseExists(tag: ReleaseTag, expectedNotes: string): Promise<boolean> {
    this.events.push(`read-github:${tag}:${expectedNotes}`);
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
    this.npmLatest = metadata.version;
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

  override async readNpmLatest(name: 'tracksmith'): Promise<StableVersion | null> {
    this.startedReads.push('latest');
    await this.readsComplete;
    return super.readNpmLatest(name);
  }

  override async githubReleaseExists(tag: ReleaseTag, expectedNotes: string): Promise<boolean> {
    this.startedReads.push('github');
    await this.readsComplete;
    return super.githubReleaseExists(tag, expectedNotes);
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

function input(overrides: Partial<ExecuteReleaseInput> = {}): ExecuteReleaseInput {
  return {
    metadata,
    commit,
    previousVersion,
    tarballPath,
    tarballIntegrity: integrity,
    ...overrides
  };
}

describe('executeRelease', () => {
  test('starts and completes all external reads before the first write', async () => {
    const gateway = new DeferredReadGateway(releaseState());
    const execution = executeRelease(input(), gateway);

    await Promise.resolve();
    expect(gateway.startedReads).toEqual(['tag', 'npm', 'latest', 'github']);
    expect(gateway.writes).toEqual([]);

    gateway.completeReads();
    await execution;

    expect(gateway.events.slice(0, 4)).toEqual([
      'read-tag:v1.2.3',
      'read-npm:tracksmith@1.2.3',
      'read-npm-latest:tracksmith',
      'read-github:v1.2.3:Release notes.\n'
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

  test.each([
    { name: 'npm latest is absent', latest: null },
    { name: 'npm latest is not the previous version', latest: metadata.version }
  ] as const)('does not publish a missing target when $name', async ({ latest }) => {
    const gateway = new FakeReleaseGateway(releaseState(), latest);

    await expect(executeRelease(input(), gateway)).rejects.toThrow('npm latest');
    expect(gateway.writes).toEqual([]);
  });

  test('does not publish a target older than its previous package version', async () => {
    const newerPreviousVersion = '1.2.4' satisfies StableVersion;
    const gateway = new FakeReleaseGateway(releaseState(), newerPreviousVersion);

    await expect(
      executeRelease(input({ previousVersion: newerPreviousVersion }), gateway)
    ).rejects.toThrow('newer than');
    expect(gateway.writes).toEqual([]);
  });

  test('allows metadata repair when the target exists and npm latest is newer', async () => {
    const gateway = new FakeReleaseGateway(
      releaseState({ tagCommit: commit, npmIntegrity: integrity }),
      '1.2.4'
    );

    await executeRelease(input(), gateway);

    expect(gateway.writes).toEqual(['github']);
  });

  test('rejects an existing target when npm latest is older', async () => {
    const gateway = new FakeReleaseGateway(
      releaseState({ tagCommit: commit, npmIntegrity: integrity }),
      previousVersion
    );

    await expect(executeRelease(input(), gateway)).rejects.toThrow('npm latest');
    expect(gateway.writes).toEqual([]);
  });

  test.each(['tag', 'npm', 'latest', 'github'] as const)(
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

async function withFakeNotesFile(
  _notes: string,
  use: (path: string) => Promise<void>
): Promise<void> {
  await use('/tmp/tracksmith-release-notes.md');
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
      result(0, `${tagObject}\trefs/tags/v1.2.3\n${commit}\trefs/tags/v1.2.3^{}\n`),
      result(0, `${commit}\n`),
      result(0, `"${integrity}"\n`),
      result(0, `"${metadata.version}"\n`),
      result(0, '{"tagName":"v1.2.3","body":"Release notes.\\n"}\n')
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.readTagCommit(metadata.tag)).resolves.toBe(commit);
    await expect(gateway.readNpmIntegrity(metadata.name, metadata.version)).resolves.toBe(
      integrity
    );
    await expect(gateway.readNpmLatest(metadata.name)).resolves.toBe(metadata.version);
    await expect(
      gateway.githubReleaseExists(metadata.tag, metadata.changelogSection)
    ).resolves.toBe(true);
    expect(harness.invocations).toEqual([
      {
        command: 'git',
        args: ['ls-remote', '--exit-code', 'origin', 'refs/tags/v1.2.3', 'refs/tags/v1.2.3^{}']
      },
      { command: 'git', args: ['rev-list', '-n', '1', 'v1.2.3'] },
      {
        command: 'npm',
        args: ['view', 'tracksmith@1.2.3', 'dist.integrity', '--json']
      },
      {
        command: 'npm',
        args: ['view', 'tracksmith', 'dist-tags.latest', '--json']
      },
      {
        command: 'gh',
        args: ['release', 'view', 'v1.2.3', '--json', 'tagName,body']
      }
    ]);
  });

  test('throws before writes when remote and local tag commits differ', async () => {
    const remoteCommit = '2222222222222222222222222222222222222222';
    const harness = commandHarness([
      result(0, `${tagObject}\trefs/tags/v1.2.3\n${remoteCommit}\trefs/tags/v1.2.3^{}\n`),
      result(0, `${commit}\n`)
    ]);
    const commandGateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);
    const writes: string[] = [];
    const gateway: ReleaseGateway = {
      readTagCommit: (tag) => commandGateway.readTagCommit(tag),
      readNpmIntegrity: () => Promise.resolve(null),
      readNpmLatest: () => Promise.resolve(previousVersion),
      githubReleaseExists: () => Promise.resolve(false),
      createAndPushTag: () => {
        writes.push('tag');
        return Promise.resolve();
      },
      publishTarball: () => {
        writes.push('npm');
        return Promise.resolve();
      },
      createGithubRelease: () => {
        writes.push('github');
        return Promise.resolve();
      }
    };

    await expect(executeRelease(input(), gateway)).rejects.toThrow('remote tag commit');
    expect(writes).toEqual([]);
    expect(harness.invocations).toEqual([
      {
        command: 'git',
        args: ['ls-remote', '--exit-code', 'origin', 'refs/tags/v1.2.3', 'refs/tags/v1.2.3^{}']
      },
      { command: 'git', args: ['rev-list', '-n', '1', 'v1.2.3'] }
    ]);
  });

  test('returns absent state only for explicit not-found responses', async () => {
    const harness = commandHarness([
      result(2),
      result(1, '', 'npm error code E404\n'),
      result(1, '', 'npm error code E404\n'),
      result(1, '', 'release not found\n')
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.readTagCommit(metadata.tag)).resolves.toBeNull();
    await expect(gateway.readNpmIntegrity(metadata.name, metadata.version)).resolves.toBeNull();
    await expect(gateway.readNpmLatest(metadata.name)).resolves.toBeNull();
    await expect(
      gateway.githubReleaseExists(metadata.tag, metadata.changelogSection)
    ).resolves.toBe(false);
  });

  test.each([
    {
      name: 'Git tag lookup',
      result: result(128, '', 'fatal: unable to access remote helper\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readTagCommit(metadata.tag)
    },
    {
      name: 'npm version lookup',
      result: result(1, '', 'npm error code E401\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readNpmIntegrity(metadata.name, metadata.version)
    },
    {
      name: 'npm latest lookup',
      result: result(1, '', 'npm error code E401\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readNpmLatest(metadata.name)
    },
    {
      name: 'GitHub lookup',
      result: result(1, '', 'HTTP 503: Service Unavailable\n'),
      invoke: (gateway: ReleaseGateway) =>
        gateway.githubReleaseExists(metadata.tag, metadata.changelogSection)
    }
  ])('throws on ambiguous $name failures', async ({ result: commandResult, invoke }) => {
    const harness = commandHarness([commandResult]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(invoke(gateway)).rejects.toThrow();
  });

  test.each([
    {
      name: 'extra stderr',
      stdout: '',
      stderr: 'npm error code E404\nnpm error HTTP 503: Service Unavailable\n'
    },
    {
      name: 'non-empty stdout',
      stdout: 'unexpected output\n',
      stderr: 'npm error code E404\n'
    }
  ])('does not classify npm E404 with $name as missing', async ({ stdout, stderr }) => {
    const harness = commandHarness([result(1, stdout, stderr)]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.readNpmLatest(metadata.name)).rejects.toThrow();
  });

  test.each([
    {
      name: 'extra stderr',
      stdout: '',
      stderr: 'release not found\nHTTP 503: Service Unavailable\n'
    },
    {
      name: 'non-empty stdout',
      stdout: 'HTTP 503: Service Unavailable\n',
      stderr: 'release not found\n'
    }
  ])('does not classify GitHub not-found with $name as missing', async ({ stdout, stderr }) => {
    const harness = commandHarness([result(1, stdout, stderr)]);
    const commandGateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);
    const writes: string[] = [];
    const gateway: ReleaseGateway = {
      readTagCommit: () => Promise.resolve(commit),
      readNpmIntegrity: () => Promise.resolve(null),
      readNpmLatest: () => Promise.resolve(previousVersion),
      githubReleaseExists: (tag, expectedNotes) =>
        commandGateway.githubReleaseExists(tag, expectedNotes),
      createAndPushTag: () => {
        writes.push('tag');
        return Promise.resolve();
      },
      publishTarball: () => {
        writes.push('npm');
        return Promise.resolve();
      },
      createGithubRelease: () => {
        writes.push('github');
        return Promise.resolve();
      }
    };

    await expect(executeRelease(input(), gateway)).rejects.toThrow('HTTP 503');
    expect(writes).toEqual([]);
    expect(harness.invocations).toEqual([
      {
        command: 'gh',
        args: ['release', 'view', 'v1.2.3', '--json', 'tagName,body']
      }
    ]);
  });

  test.each([
    {
      name: 'Git remote tag output',
      result: result(0, 'not-a-commit\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readTagCommit(metadata.tag)
    },
    {
      name: 'lightweight Git remote tag output',
      result: result(0, `${commit}\trefs/tags/v1.2.3\n`),
      invoke: (gateway: ReleaseGateway) => gateway.readTagCommit(metadata.tag)
    },
    {
      name: 'conflicting Git remote tag output',
      result: result(
        0,
        `${tagObject}\trefs/tags/v1.2.3\n${commit}\trefs/tags/v1.2.3^{}\nffffffffffffffffffffffffffffffffffffffff\trefs/tags/v1.2.3^{}\n`
      ),
      invoke: (gateway: ReleaseGateway) => gateway.readTagCommit(metadata.tag)
    },
    {
      name: 'npm integrity output',
      result: result(0, 'not-json\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readNpmIntegrity(metadata.name, metadata.version)
    },
    {
      name: 'npm latest output',
      result: result(0, '"latest"\n'),
      invoke: (gateway: ReleaseGateway) => gateway.readNpmLatest(metadata.name)
    },
    {
      name: 'GitHub output',
      result: result(0, '{"tagName":"v9.9.9","body":"Release notes.\\n"}\n'),
      invoke: (gateway: ReleaseGateway) =>
        gateway.githubReleaseExists(metadata.tag, metadata.changelogSection)
    }
  ])('throws on malformed $name', async ({ result: commandResult, invoke }) => {
    const harness = commandHarness([commandResult]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(invoke(gateway)).rejects.toThrow();
  });

  test('rejects existing GitHub release notes that do not match the changelog', async () => {
    const harness = commandHarness([
      result(0, '{"tagName":"v1.2.3","body":"Different notes.\\n"}\n')
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(
      gateway.githubReleaseExists(metadata.tag, metadata.changelogSection)
    ).rejects.toThrow('release notes');
  });

  test('rejects a malformed GitHub release body', async () => {
    const harness = commandHarness([result(0, '{"tagName":"v1.2.3","body":false}\n')]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(
      gateway.githubReleaseExists(metadata.tag, metadata.changelogSection)
    ).rejects.toThrow('malformed');
  });

  test('writes nothing when existing GitHub release notes do not match', async () => {
    const harness = commandHarness([
      result(0, '{"tagName":"v1.2.3","body":"Different notes.\\n"}\n')
    ]);
    const commandGateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);
    const writes: string[] = [];
    const gateway: ReleaseGateway = {
      readTagCommit: () => Promise.resolve(commit),
      readNpmIntegrity: () => Promise.resolve(integrity),
      readNpmLatest: () => Promise.resolve(metadata.version),
      githubReleaseExists: (tag, expectedNotes) =>
        commandGateway.githubReleaseExists(tag, expectedNotes),
      createAndPushTag: () => {
        writes.push('tag');
        return Promise.resolve();
      },
      publishTarball: () => {
        writes.push('npm');
        return Promise.resolve();
      },
      createGithubRelease: () => {
        writes.push('github');
        return Promise.resolve();
      }
    };

    await expect(executeRelease(input(), gateway)).rejects.toThrow('release notes');
    expect(writes).toEqual([]);
  });

  test('uses exact write argv and passes release notes through a temporary file', async () => {
    const harness = commandHarness([
      result(
        128,
        '',
        "fatal: ambiguous argument 'v1.2.3': unknown revision or path not in the working tree.\n"
      ),
      result(0),
      result(0),
      result(0),
      result(0)
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await gateway.createAndPushTag(metadata.tag, commit, 'Release 1.2.3');
    await gateway.publishTarball(tarballPath);
    await gateway.createGithubRelease(metadata.tag, metadata.changelogSection);

    expect(harness.notes).toBe(metadata.changelogSection);
    expect(harness.invocations).toEqual([
      { command: 'git', args: ['rev-list', '-n', '1', 'v1.2.3'] },
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
    const harness = commandHarness([
      result(
        128,
        '',
        "fatal: ambiguous argument 'v1.2.3': unknown revision or path not in the working tree.\n"
      ),
      result(1, '', 'tag failed\n')
    ]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.createAndPushTag(metadata.tag, commit, 'Release 1.2.3')).rejects.toThrow();
    expect(harness.invocations).toHaveLength(2);
  });

  test('resumes in the same checkout after local tag creation succeeds and push fails', async () => {
    const invocations: CommandInvocation[] = [];
    let localCommit: string | null = null;
    let remoteCommit: string | null = null;
    let npmPublished = false;
    let githubReleaseExists = false;
    let pushAttempts = 0;
    const run: ReleaseCommandRunner = (command, args) => {
      invocations.push({ command, args });

      if (command === 'git' && args[0] === 'ls-remote') {
        return Promise.resolve(
          remoteCommit === null
            ? result(2)
            : result(0, `${tagObject}\trefs/tags/v1.2.3\n${remoteCommit}\trefs/tags/v1.2.3^{}\n`)
        );
      }
      if (command === 'git' && args[0] === 'rev-list') {
        return Promise.resolve(
          localCommit === null
            ? result(
                128,
                '',
                "fatal: ambiguous argument 'v1.2.3': unknown revision or path not in the working tree.\n"
              )
            : result(0, `${localCommit}\n`)
        );
      }
      if (command === 'git' && args[0] === 'cat-file') {
        return Promise.resolve(result(0, 'tag\n'));
      }
      if (command === 'git' && args[0] === 'tag') {
        localCommit = commit;
        return Promise.resolve(result(0));
      }
      if (command === 'git' && args[0] === 'push') {
        pushAttempts += 1;
        if (pushAttempts === 1) return Promise.resolve(result(1, '', 'push failed\n'));
        remoteCommit = localCommit;
        return Promise.resolve(result(0));
      }
      if (command === 'npm' && args[0] === 'view' && args[1] === 'tracksmith') {
        return Promise.resolve(
          result(0, `"${npmPublished ? metadata.version : previousVersion}"\n`)
        );
      }
      if (command === 'npm' && args[0] === 'view') {
        return Promise.resolve(
          npmPublished ? result(0, `"${integrity}"\n`) : result(1, '', 'npm error code E404\n')
        );
      }
      if (command === 'npm' && args[0] === 'publish') {
        npmPublished = true;
        return Promise.resolve(result(0));
      }
      if (command === 'gh' && args[1] === 'view') {
        return Promise.resolve(
          githubReleaseExists
            ? result(0, '{"tagName":"v1.2.3","body":"Release notes.\\n"}\n')
            : result(1, '', 'release not found\n')
        );
      }
      if (command === 'gh' && args[1] === 'create') {
        githubReleaseExists = true;
        return Promise.resolve(result(0));
      }

      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    };
    const gateway = createCommandReleaseGateway(run, withFakeNotesFile);

    await expect(executeRelease(input(), gateway)).rejects.toThrow('push failed');
    await executeRelease(input(), gateway);

    expect(
      invocations.filter(({ command, args }) => command === 'git' && args[0] === 'tag')
    ).toHaveLength(1);
    expect(
      invocations.filter(({ command, args }) => command === 'git' && args[0] === 'push')
    ).toHaveLength(2);
    expect(invocations).toContainEqual({
      command: 'git',
      args: ['cat-file', '-t', 'refs/tags/v1.2.3']
    });
    expect(npmPublished).toBe(true);
    expect(githubReleaseExists).toBe(true);
  });

  test('throws before push when an orphaned local tag points at another commit', async () => {
    const wrongCommit = 'ffffffffffffffffffffffffffffffffffffffff';
    const harness = commandHarness([result(0, `${wrongCommit}\n`)]);
    const gateway = createCommandReleaseGateway(harness.run, harness.withNotesFile);

    await expect(gateway.createAndPushTag(metadata.tag, commit, 'Release 1.2.3')).rejects.toThrow(
      'different commit'
    );
    expect(harness.invocations).toEqual([
      { command: 'git', args: ['rev-list', '-n', '1', 'v1.2.3'] }
    ]);
  });
});

describe('release CLI validation', () => {
  test('requires a full 40-character GitHub commit SHA', () => {
    expect(requireFullCommitSha(commit)).toBe(commit);
    expect(() => requireFullCommitSha(undefined)).toThrow('GITHUB_SHA');
    expect(() => requireFullCommitSha('0123456')).toThrow('full commit SHA');
  });

  test('reads the previous package version from the release commit first parent', async () => {
    const harness = commandHarness([result(0, '{"version":"1.2.2"}\n')]);

    await expect(readPreviousPackageVersion(commit, harness.run)).resolves.toBe(previousVersion);
    expect(harness.invocations).toEqual([
      { command: 'git', args: ['show', `${commit}^1:package.json`] }
    ]);
  });

  test('rejects a malformed previous package version', async () => {
    const harness = commandHarness([result(0, '{"version":"next"}\n')]);

    await expect(readPreviousPackageVersion(commit, harness.run)).rejects.toThrow(
      'previous package version'
    );
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
