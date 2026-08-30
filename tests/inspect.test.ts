import { expect, test } from 'vite-plus/test';

import { formatTrackTable, inspectCommand } from '../src/commands/inspect.ts';
import { parseMkvmergeJson } from '../src/probe.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

test('formatTrackTable renders aligned columns with placeholders for missing values', () => {
  const table = formatTrackTable(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON));
  const lines = table.split('\n');
  expect(lines[0]).toMatch(/^ID\s+TYPE\s+CODEC\s+LANG\s+CH\s+DEFAULT\s+FORCED\s+NAME$/);
  expect(lines).toHaveLength(5);
  expect(lines[1]).toContain('video');
  expect(lines[1]).toContain('-'); // video has no channel count
  expect(lines[2]).toContain('Surround 5.1');
  expect(lines[2]).toContain('yes');
  expect(lines[4]).toContain('yes'); // subtitle track is forced in the sample
});

test('inspectCommand probes the file and returns the table', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const out = await inspectCommand('movie.mkv', {
    runner,
    isTTY: false,
    stderrIsTTY: false,
    confirm: async () => false,
    exists: () => true
  });
  expect(runner.calls).toEqual([['mkvmerge', '-J', 'movie.mkv']]);
  expect(out).toContain('E-AC-3');
});

test('inspectCommand rejects a missing input file before probing', async () => {
  const runner = new FakeRunner();
  await expect(
    inspectCommand('gone.mkv', {
      runner,
      isTTY: false,
      stderrIsTTY: false,
      confirm: async () => false,
      exists: () => false
    })
  ).rejects.toThrow(/Input file not found/);
  expect(runner.calls).toHaveLength(0);
});

test('inspectCommand prints the container title above the table when set', async () => {
  const runner = new FakeRunner();
  runner.queue({
    stdout: JSON.stringify({
      container: { properties: { title: 'My Movie' } },
      tracks: [{ id: 0, type: 'audio', codec: 'AC-3', properties: { language: 'eng' } }]
    })
  });
  const out = await inspectCommand('movie.mkv', {
    runner,
    isTTY: false,
    stderrIsTTY: false,
    confirm: async () => false,
    exists: () => true
  });
  expect(out.startsWith('Title: My Movie\n\n')).toBe(true);
});
