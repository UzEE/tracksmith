import { resolve } from 'node:path';

import { expect, test } from 'vite-plus/test';

import {
  buildTestClipArgs,
  parseTimeToSeconds,
  testClipCommand
} from '../src/commands/test-clip.ts';
import { CliError } from '../src/types.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

test('parseTimeToSeconds accepts seconds and HH:MM:SS[.ms]', () => {
  expect(parseTimeToSeconds('90')).toBe(90);
  expect(parseTimeToSeconds('90.5')).toBe(90.5);
  expect(parseTimeToSeconds('01:02:03')).toBe(3723);
  expect(parseTimeToSeconds('00:00:05.25')).toBe(5.25);
  expect(() => parseTimeToSeconds('5m')).toThrow(CliError);
  expect(() => parseTimeToSeconds('1:99:00')).toThrow(CliError);
});

test('buildTestClipArgs re-encodes video, copies audio, and delays audio timestamps', () => {
  const args = buildTestClipArgs({
    video: 'target movie.mkv',
    audio: 'donor.mkv',
    audioStreamIndex: 1,
    startSeconds: 600,
    durationSeconds: 60,
    delayMs: 250,
    output: 'target movie.sync-test.mkv'
  });
  expect(args).toEqual([
    'ffmpeg',
    '-hide_banner',
    '-nostdin',
    '-ss',
    '600',
    '-i',
    'target movie.mkv',
    '-itsoffset',
    '0.25',
    '-ss',
    '600',
    '-i',
    'donor.mkv',
    '-map',
    '0:v:0',
    '-map',
    '1:a:1',
    '-t',
    '60',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    '-sn',
    '-abort_on',
    'empty_output_stream',
    '-y',
    'target movie.sync-test.mkv'
  ]);
});

test('buildTestClipArgs protects option-looking output filenames', () => {
  const args = buildTestClipArgs({
    video: 'v.mkv',
    audio: 'a.mka',
    audioStreamIndex: 0,
    startSeconds: 0,
    durationSeconds: 30,
    delayMs: 0,
    output: '-clip.mkv'
  });
  expect(args.at(-1)).toBe(resolve('-clip.mkv'));
});

test('buildTestClipArgs advances audio timestamps for negative delay', () => {
  const args = buildTestClipArgs({
    video: 'v.mkv',
    audio: 'a.mkv',
    audioStreamIndex: 0,
    startSeconds: 10,
    durationSeconds: 30,
    delayMs: -500,
    output: 'out.mkv'
  });
  expect(args.slice(args.indexOf('-itsoffset'), args.indexOf('-itsoffset') + 2)).toEqual([
    '-itsoffset',
    '-0.5'
  ]);
});

test('buildTestClipArgs allows positive delay at the beginning of a file', () => {
  expect(() =>
    buildTestClipArgs({
      video: 'v.mkv',
      audio: 'a.mkv',
      audioStreamIndex: 0,
      startSeconds: 0,
      durationSeconds: 30,
      delayMs: 500,
      output: 'out.mkv'
    })
  ).not.toThrow();
});

// Inputs exist; sync-test outputs do not.
const deps = {
  isTTY: false,
  confirm: async () => false,
  exists: (path: string) => !path.includes('.sync-test.')
};

test('testClipCommand rejects a missing input file before probing or prompting', async () => {
  const runner = new FakeRunner();
  await expect(
    testClipCommand(
      {
        video: 'gone.mkv',
        audio: 'donor.mkv',
        track: 1,
        start: '0',
        duration: '60',
        delayMs: 0,
        force: false
      },
      { ...deps, runner, exists: () => false }
    )
  ).rejects.toThrow(/Input file not found: "gone.mkv"/);
  expect(runner.calls).toHaveLength(0);
});

test('testClipCommand rejects zero duration before probing or prompting', async () => {
  const runner = new FakeRunner();
  await expect(
    testClipCommand(
      {
        video: 'target.mkv',
        audio: 'donor.mkv',
        track: 1,
        start: '0',
        duration: '0',
        delayMs: 0,
        force: false
      },
      { ...deps, runner }
    )
  ).rejects.toThrow(/--duration must be greater than zero/);
  expect(runner.calls).toHaveLength(0);
});

test('testClipCommand probes the donor, maps the audio-relative index, and runs ffmpeg', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe donor
  runner.queue({ exitCode: 0 }); // ffmpeg
  const output = await testClipCommand(
    {
      video: 'target.mkv',
      audio: 'donor.mkv',
      track: 2,
      start: '600',
      duration: '60',
      delayMs: 0,
      force: false
    },
    { ...deps, runner }
  );
  expect(output).toBe('target.sync-test.mkv');
  expect(runner.calls[0]).toEqual(['mkvmerge', '-J', 'donor.mkv']);
  const ffmpeg = runner.calls[1]!;
  expect(ffmpeg[0]).toBe('ffmpeg');
  expect(ffmpeg).toContain('1:a:1'); // track id 2 is the second audio track
});

test('testClipCommand surfaces ffmpeg failures', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ exitCode: 1, stderr: 'encoder error' });
  await expect(
    testClipCommand(
      {
        video: 't.mkv',
        audio: 'd.mkv',
        track: 1,
        start: '0',
        duration: '60',
        delayMs: 0,
        force: false
      },
      { ...deps, runner }
    )
  ).rejects.toThrow(/encoder error/);
});
