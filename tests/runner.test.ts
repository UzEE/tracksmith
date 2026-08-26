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
