import { resolve } from 'node:path';

import { expect, test } from 'vite-plus/test';

import {
  audioRelativeIndex,
  parseMkvmergeJson,
  probeTracks,
  parseMkvmergeFile,
  requireAudioTrack,
  requireTrack
} from '../src/probe.ts';
import { CliError } from '../src/types.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

test('parseMkvmergeJson maps mkvmerge fields onto Track', () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(tracks).toHaveLength(4);
  expect(tracks[1]).toEqual({
    id: 1,
    type: 'audio',
    codec: 'AC-3',
    language: 'eng',
    name: 'Surround 5.1',
    channels: 6,
    isDefault: true,
    isForced: false
  });
  expect(tracks[0]?.channels).toBeUndefined();
  expect(tracks[3]?.isDefault).toBe(false);
});

test('parseMkvmergeJson throws CliError on garbage input', () => {
  expect(() => parseMkvmergeJson('not json')).toThrow(CliError);
});

test('parseMkvmergeJson rejects structurally invalid track data', () => {
  const invalid = JSON.stringify({ tracks: [{ id: '1', type: 'audio', codec: 'AAC' }] });
  expect(() => parseMkvmergeJson(invalid)).toThrow(CliError);
});

test('parseMkvmergeJson rejects output without a tracks array', () => {
  expect(() => parseMkvmergeJson('{}')).toThrow(CliError);
});

test('probeTracks invokes mkvmerge -J with the file path verbatim', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const tracks = await probeTracks(runner, 'D:\\media\\a file.mkv');
  expect(runner.calls).toEqual([['mkvmerge', '-J', 'D:\\media\\a file.mkv']]);
  expect(tracks).toHaveLength(4);
});

test('probeTracks protects option-looking relative filenames', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  await probeTracks(runner, '--help');
  expect(runner.calls[0]).toEqual(['mkvmerge', '-J', resolve('--help')]);
});

test('probeTracks surfaces the exit code and stderr when mkvmerge cannot read the file', async () => {
  const runner = new FakeRunner();
  runner.queue({ exitCode: 2, stderr: 'unsupported container' });
  const attempt = probeTracks(runner, 'broken.mkv');
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(/\(exit 2\)/);
  await expect(attempt).rejects.toThrow(/unsupported container/);
});

test('requireAudioTrack returns the audio track for a valid id', () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(requireAudioTrack(tracks, 2).codec).toBe('E-AC-3');
});

test('requireAudioTrack rejects missing and non-audio ids, listing valid audio ids', () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(() => requireAudioTrack(tracks, 9)).toThrow(/Valid audio track IDs: 1, 2/);
  expect(() => requireAudioTrack(tracks, 0)).toThrow(/is video, not audio/);
});

test('audioRelativeIndex maps MKVToolNix ids to audio-relative order', () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(audioRelativeIndex(tracks, 1)).toBe(0);
  expect(audioRelativeIndex(tracks, 2)).toBe(1);
  expect(() => audioRelativeIndex(tracks, 0)).toThrow(CliError);
});

test('requireTrack returns any existing track and rejects unknown IDs', () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(requireTrack(tracks, 3).type).toBe('subtitles');
  expect(() => requireTrack(tracks, 9)).toThrow(
    /Track 9 does not exist. Valid track IDs: 0, 1, 2, 3/
  );
});

const IETF_TITLE_JSON = JSON.stringify({
  container: { properties: { title: 'My Movie' } },
  tracks: [
    {
      id: 0,
      type: 'audio',
      codec: 'AC-3',
      properties: { language: 'por', language_ietf: 'pt-BR', forced_track: true }
    }
  ]
});

test('parseMkvmergeFile prefers IETF language and parses forced flag and container title', () => {
  const { title, tracks } = parseMkvmergeFile(IETF_TITLE_JSON);
  expect(title).toBe('My Movie');
  expect(tracks[0]?.language).toBe('pt-BR');
  expect(tracks[0]?.isForced).toBe(true);
});
