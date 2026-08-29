import { expect, test } from 'vite-plus/test';

import { ProcessRunner, processStartError } from '../src/runner.ts';
import { installHint } from '../src/tools.ts';
import { CliError } from '../src/types.ts';

test('ProcessRunner captures stdout, stderr, and exit code', async () => {
  const runner = new ProcessRunner();
  const result = await runner.run([
    process.execPath,
    '-e',
    "console.log('out'); console.error('err'); process.exit(3);"
  ]);
  expect(result.stdout.trim()).toBe('out');
  expect(result.stderr.trim()).toBe('err');
  expect(result.exitCode).toBe(3);
});

test('ProcessRunner reports generic errors for unknown missing executables', async () => {
  const runner = new ProcessRunner();
  const attempt = runner.run(['tracksmith-command-that-does-not-exist-38b9b8d8']);
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(
    /Failed to start tracksmith-command-that-does-not-exist-38b9b8d8:/
  );
});

test('processStartError includes install guidance for known missing tools', () => {
  for (const tool of ['ffmpeg', 'mkvmerge'] as const) {
    const error = processStartError(tool, { code: 'ENOENT' });
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toBe(
      `${tool} is required but was not found on PATH. ${installHint(tool)}`
    );
  }
});

test('ProcessRunner passes argv entries through verbatim (spaces intact)', async () => {
  const runner = new ProcessRunner();
  const result = await runner.run([
    process.execPath,
    '-e',
    'console.log(process.argv[1]);',
    'path with spaces.mkv'
  ]);
  expect(result.stdout.trim()).toBe('path with spaces.mkv');
});

test('ProcessRunner streams stdout chunks through the sink while still capturing', async () => {
  const chunks: string[] = [];
  const runner = new ProcessRunner({ sink: (chunk) => chunks.push(chunk) });
  const result = await runner.run(
    [process.execPath, '-e', "console.log('Progress: 42%'); console.error('noise');"],
    { stream: 'stdout' }
  );
  expect(chunks.join('')).toContain('Progress: 42%');
  expect(chunks.join('')).not.toContain('noise');
  expect(result.stdout.trim()).toBe('Progress: 42%');
  expect(result.stderr.trim()).toBe('noise');
});

test('ProcessRunner streams stderr chunks through the sink', async () => {
  const chunks: string[] = [];
  const runner = new ProcessRunner({ sink: (chunk) => chunks.push(chunk) });
  await runner.run([process.execPath, '-e', "console.log('out'); console.error('frame=10');"], {
    stream: 'stderr'
  });
  expect(chunks.join('')).toContain('frame=10');
  expect(chunks.join('')).not.toContain('out');
});

test('ProcessRunner leaves the sink untouched without a stream option', async () => {
  const chunks: string[] = [];
  const runner = new ProcessRunner({ sink: (chunk) => chunks.push(chunk) });
  await runner.run([process.execPath, '-e', "console.log('out'); console.error('err');"]);
  expect(chunks).toEqual([]);
});

// Windows reports killed children as exit code 1 with a null signal, so signal
// detection (and these tests) only apply on POSIX platforms.
test.skipIf(process.platform === 'win32')(
  'ProcessRunner rejects when the tool is terminated by a signal',
  async () => {
    const runner = new ProcessRunner();
    const attempt = runner.run([process.execPath, '-e', 'process.kill(process.pid, "SIGKILL");']);
    await expect(attempt).rejects.toThrow(CliError);
    await expect(attempt).rejects.toThrow(/terminated by signal SIGKILL/);
  }
);

test.skipIf(process.platform === 'win32')(
  'signal termination errors include output captured before death',
  async () => {
    const runner = new ProcessRunner();
    const attempt = runner.run([
      process.execPath,
      '-e',
      "console.log('diag line'); setTimeout(() => process.kill(process.pid, 'SIGKILL'), 100);"
    ]);
    await expect(attempt).rejects.toThrow(/diag line/);
  }
);
