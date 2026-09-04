import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedEntries = [
  'package/LICENSE',
  'package/README.md',
  'package/dist/tracksmith.js',
  'package/dist/tracksmith.js.map',
  'package/package.json'
] as const;

const usageText = `Usage:
  tracksmith inspect <file>`;
const mkvmergeInstallGuidance =
  'Windows: winget install MoritzBunkus.MKVToolNix or scoop install mkvtoolnix | macOS: brew install mkvtoolnix | Linux: sudo apt install mkvtoolnix or sudo pacman -S mkvtoolnix-cli';

function run(command: string, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8'
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.\n${result.stdout}${result.stderr}`
    );
  }

  return result;
}

function requireExactEntries(actualEntries: readonly string[]): void {
  const actual = actualEntries.toSorted();
  const expected = allowedEntries.toSorted();

  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      `Expected package to contain exactly:\n${expected.join('\n')}\n\nFound:\n${actual.join('\n') || 'nothing'}`
    );
  }
}

function requireUsage(stdout: string, runtime: 'Node' | 'Bun'): void {
  if (!stdout.includes(usageText)) {
    throw new Error(`${runtime} entrypoint did not print the expected usage text.\n${stdout}`);
  }
}

function requireMissingToolFailure(
  runtime: 'Node' | 'Bun',
  result: ReturnType<typeof spawnSync>
): void {
  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 1) {
    throw new Error(
      `${runtime} missing-tool check exited with ${result.status ?? 'unknown'} instead of 1.\n${String(result.stdout)}${String(result.stderr)}`
    );
  }

  const stderr = String(result.stderr);
  if (!stderr.includes('mkvmerge')) {
    throw new Error(`${runtime} missing-tool check did not identify mkvmerge.\n${stderr}`);
  }

  if (!stderr.includes(mkvmergeInstallGuidance)) {
    throw new Error(
      `${runtime} missing-tool check did not print installation guidance.\n${stderr}`
    );
  }
}

function absoluteExecutable(command: 'node' | 'bun', repositoryRoot: string): string {
  const result = run(command, ['-p', 'process.execPath'], repositoryRoot);
  const executable = result.stdout.trim();

  if (!isAbsolute(executable)) {
    throw new Error(`${command} reported a non-absolute executable path: ${executable}`);
  }

  return executable;
}

function packageSmoke(): void {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputDirectory = join(repositoryRoot, 'out', 'package-smoke');
  let temporaryRoot: string | undefined;
  let verifiedTarball: string | undefined;

  try {
    run('vp', ['run', 'build'], repositoryRoot);

    rmSync(outputDirectory, { recursive: true, force: true });
    mkdirSync(outputDirectory, { recursive: true });

    run(
      'vp',
      ['pm', 'pack', '--pack-destination', outputDirectory, '--', '--quiet'],
      repositoryRoot
    );

    const outputEntries = readdirSync(outputDirectory);
    const tarballs = outputEntries.filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1 || outputEntries.length !== 1) {
      throw new Error(
        `Expected exactly one .tgz in ${outputDirectory}, but found ${outputEntries.join(', ') || 'nothing'}.`
      );
    }

    const tarballPath = join(outputDirectory, tarballs[0]!);
    const archive = run('tar', ['-tzf', tarballPath], repositoryRoot);
    requireExactEntries(archive.stdout.trim().split(/\r?\n/).filter(Boolean));

    temporaryRoot = mkdtempSync(join(tmpdir(), 'tracksmith-package-smoke-'));
    const nodeProject = join(temporaryRoot, 'node');
    const bunProject = join(temporaryRoot, 'bun');
    const emptyPath = join(temporaryRoot, 'empty-path');
    const fixture = join(temporaryRoot, 'movie.mkv');

    mkdirSync(nodeProject);
    mkdirSync(bunProject);
    mkdirSync(emptyPath);
    writeFileSync(fixture, '');
    writeFileSync(
      join(nodeProject, 'package.json'),
      JSON.stringify({ name: 'tracksmith-node-smoke', private: true })
    );
    writeFileSync(
      join(bunProject, 'package.json'),
      JSON.stringify({ name: 'tracksmith-bun-smoke', private: true })
    );

    // --no-audit: npm's advisory lookup is a network call that has hung for the
    // full 5-minute fetch timeout both locally and in CI; it adds nothing to a
    // smoke test of a local tarball. --no-fund skips the funding lookup for the
    // same reason.
    run(
      'npm',
      ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarballPath],
      nodeProject
    );
    const nodeHelp = run('npx', ['--no-install', 'tracksmith', '--help'], nodeProject);
    requireUsage(nodeHelp.stdout, 'Node');

    run('bun', ['add', '--ignore-scripts', tarballPath], bunProject);
    const bunHelp = run('bunx', ['--bun', '--no-install', 'tracksmith', '--help'], bunProject);
    requireUsage(bunHelp.stdout, 'Bun');

    const nodeExecutable = absoluteExecutable('node', repositoryRoot);
    const bunExecutable = absoluteExecutable('bun', repositoryRoot);
    const missingToolEnvironment = { ...process.env, PATH: emptyPath };

    const nodeMissingTool = spawnSync(
      nodeExecutable,
      [
        join(nodeProject, 'node_modules', 'tracksmith', 'dist', 'tracksmith.js'),
        'inspect',
        fixture
      ],
      {
        cwd: nodeProject,
        env: missingToolEnvironment,
        encoding: 'utf8'
      }
    );
    requireMissingToolFailure('Node', nodeMissingTool);

    const bunMissingTool = spawnSync(
      bunExecutable,
      [join(bunProject, 'node_modules', 'tracksmith', 'dist', 'tracksmith.js'), 'inspect', fixture],
      {
        cwd: bunProject,
        env: missingToolEnvironment,
        encoding: 'utf8'
      }
    );
    requireMissingToolFailure('Bun', bunMissingTool);

    verifiedTarball = tarballPath;
  } finally {
    if (temporaryRoot !== undefined) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    if (verifiedTarball === undefined) {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }

  console.log(verifiedTarball);
}

packageSmoke();
