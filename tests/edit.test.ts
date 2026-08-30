import { expect, test } from 'vite-plus/test';

import { buildEditArgs, editCommand } from '../src/commands/edit.ts';
import { CliError } from '../src/types.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

test('buildEditArgs sets the segment title', () => {
  expect(buildEditArgs({ kind: 'title', file: 'movie.mkv', title: 'Movie (2024)' })).toEqual([
    'mkvpropedit',
    '--command-line-charset',
    'UTF-8',
    'movie.mkv',
    '--edit',
    'info',
    '--set',
    'title=Movie (2024)'
  ]);
});

test('buildEditArgs deletes the segment title when set to an empty string', () => {
  expect(buildEditArgs({ kind: 'title', file: 'movie.mkv', title: '' })).toEqual([
    'mkvpropedit',
    '--command-line-charset',
    'UTF-8',
    'movie.mkv',
    '--edit',
    'info',
    '--delete',
    'title'
  ]);
});

test('buildEditArgs addresses tracks by 1-based mkvpropedit position from the mkvmerge ID', () => {
  expect(
    buildEditArgs({
      kind: 'track',
      file: 'movie.mkv',
      track: 2,
      name: 'Commentary',
      language: 'jpn',
      isDefault: true,
      isForced: false
    })
  ).toEqual([
    'mkvpropedit',
    '--command-line-charset',
    'UTF-8',
    'movie.mkv',
    '--edit',
    'track:3',
    '--set',
    'name=Commentary',
    '--set',
    'language=jpn',
    '--set',
    'flag-default=1',
    '--set',
    'flag-forced=0'
  ]);
});

test('buildEditArgs deletes the track name when set to an empty string', () => {
  expect(buildEditArgs({ kind: 'track', file: 'movie.mkv', track: 1, name: '' })).toEqual([
    'mkvpropedit',
    '--command-line-charset',
    'UTF-8',
    'movie.mkv',
    '--edit',
    'track:2',
    '--delete',
    'name'
  ]);
});

// Inputs exist by default in these tests.
const deps = {
  isTTY: false,
  stderrIsTTY: false,
  confirm: async () => false,
  exists: () => true
};

test('editCommand rejects a missing input file before running anything', async () => {
  const runner = new FakeRunner();
  await expect(
    editCommand(
      { kind: 'title', file: 'gone.mkv', title: 'x' },
      { ...deps, runner, exists: () => false }
    )
  ).rejects.toThrow(/Input file not found/);
  expect(runner.calls).toHaveLength(0);
});

test('editCommand edits the title without probing tracks and returns no warning', async () => {
  const runner = new FakeRunner();
  runner.queue({ exitCode: 0 });
  const warning = await editCommand(
    { kind: 'title', file: 'movie.mkv', title: 'T' },
    { ...deps, runner }
  );
  expect(runner.calls).toHaveLength(1);
  expect(runner.calls[0]?.[0]).toBe('mkvpropedit');
  expect(warning).toBeUndefined();
});

test('editCommand validates the track exists before running mkvpropedit', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe
  await expect(
    editCommand({ kind: 'track', file: 'movie.mkv', track: 9, name: 'x' }, { ...deps, runner })
  ).rejects.toThrow(/Track 9 does not exist/);
  expect(runner.calls).toHaveLength(1); // probe only
});

test('editCommand rejects a track edit with nothing to change', async () => {
  const runner = new FakeRunner();
  await expect(
    editCommand({ kind: 'track', file: 'movie.mkv', track: 1 }, { ...deps, runner })
  ).rejects.toThrow(/[Nn]othing to edit/);
  expect(runner.calls).toHaveLength(0);
});

test('editCommand probes, then applies the track edit', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe
  runner.queue({ exitCode: 0 }); // mkvpropedit
  await editCommand(
    { kind: 'track', file: 'movie.mkv', track: 1, isForced: true },
    { ...deps, runner }
  );
  expect(runner.calls[0]).toEqual(['mkvmerge', '-J', 'movie.mkv']);
  expect(runner.calls[1]).toEqual([
    'mkvpropedit',
    '--command-line-charset',
    'UTF-8',
    'movie.mkv',
    '--edit',
    'track:2',
    '--set',
    'flag-forced=1'
  ]);
});

test('editCommand returns mkvpropedit warning output on exit 1 but fails on exit 2', async () => {
  const runner = new FakeRunner();
  runner.queue({
    exitCode: 1,
    stdout: 'The file is being analyzed.',
    stderr: 'Warning: something minor'
  });
  const warning = await editCommand(
    { kind: 'title', file: 'movie.mkv', title: 'T' },
    { ...deps, runner }
  );
  expect(warning).toContain('Warning: something minor');

  const failing = new FakeRunner();
  failing.queue({ exitCode: 2, stderr: 'Error: cannot write' });
  await expect(
    editCommand({ kind: 'title', file: 'movie.mkv', title: 'T' }, { ...deps, runner: failing })
  ).rejects.toThrow(CliError);
});
