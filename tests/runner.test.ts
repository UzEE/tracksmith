import { expect, test } from 'vite-plus/test';

import { ProcessRunner } from '../src/runner.ts';
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

test('ProcessRunner wraps process-start failures in a CliError', async () => {
  const runner = new ProcessRunner();
  const attempt = runner.run(['tracksmith-command-that-does-not-exist-38b9b8d8']);
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(/Could not start/);
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
