import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function runTracksmith(args: string[]) {
  return spawnSync('bun', ['run', 'src/tracksmith.ts', ...args], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
}

test('--help exits 0 and prints usage', () => {
  const result = runTracksmith(['--help']);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Usage:');
  expect(result.stdout).toContain('tracksmith inspect <file>');
});

test('no arguments exits 1', () => {
  expect(runTracksmith([]).status).toBe(1);
});

test('an unknown command exits 1', () => {
  expect(runTracksmith(['frobnicate']).status).toBe(1);
});
