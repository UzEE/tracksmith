import type { CommandDeps } from '../src/types.ts';

import { expect, test } from 'vite-plus/test';

import { runCli } from '../src/cli.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

const SINGLE_AUDIO_MKA = JSON.stringify({
  container: { type: 'Matroska' },
  tracks: [
    { id: 0, type: 'audio', codec: 'E-AC-3', properties: { language: 'eng', audio_channels: 8 } }
  ]
});

function makeDeps(runner: FakeRunner): CommandDeps {
  return {
    runner,
    isTTY: false,
    stderrIsTTY: false,
    confirm: async () => false,
    // Inputs the tests reference exist; output paths do not.
    exists: (path) => ['movie.mkv', 't.mkv', 'a.mka'].includes(path)
  };
}

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

test('no arguments prints usage and exits 1; --help exits 0', async () => {
  const runner = new FakeRunner();
  const out = capture();
  expect(await runCli([], makeDeps(runner), out.write)).toBe(1);
  expect(out.lines.join('\n')).toContain('Usage');
  expect(await runCli(['--help'], makeDeps(runner), out.write)).toBe(0);
});

test('unknown command exits 1', async () => {
  expect(await runCli(['frobnicate'], makeDeps(new FakeRunner()), () => {})).toBe(1);
});

test('inspect and extract reject extra positional arguments', async () => {
  const runner = new FakeRunner();
  const deps = makeDeps(runner);
  expect(await runCli(['inspect', 'movie.mkv', 'extra.mkv'], deps, () => {})).toBe(1);
  expect(await runCli(['extract', 'movie.mkv', 'extra.mkv', '--track', '1'], deps, () => {})).toBe(
    1
  );
  expect(runner.calls).toHaveLength(0);
});

test('inspect prints the track table', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const out = capture();
  expect(await runCli(['inspect', 'movie.mkv'], makeDeps(runner), out.write)).toBe(0);
  expect(out.lines.join('\n')).toContain('E-AC-3');
});

test('extract requires --track and validates it as a non-negative integer', async () => {
  const deps = makeDeps(new FakeRunner());
  expect(await runCli(['extract', 'movie.mkv'], deps, () => {})).toBe(1);
  expect(await runCli(['extract', 'movie.mkv', '--track', 'abc'], deps, () => {})).toBe(1);
  expect(await runCli(['extract', 'movie.mkv', '--track=-1'], deps, () => {})).toBe(1);
});

test('extract runs probe then mkvmerge and reports the output', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ exitCode: 0 });
  const out = capture();
  expect(await runCli(['extract', 'movie.mkv', '--track', '2'], makeDeps(runner), out.write)).toBe(
    0
  );
  expect(runner.calls).toHaveLength(2);
  expect(out.lines.join('\n')).toContain('movie.track2.mka');
});

test('mux groups repeatable audio inputs and deduplicates probes', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  const code = await runCli(
    [
      'mux',
      '--video',
      't.mkv',
      '--audio',
      'a.mka',
      '--name',
      'First',
      '--audio',
      'a.mka',
      '--track',
      '0',
      '--delay-ms',
      '150',
      '--name',
      'Second',
      '--output',
      'o.mkv'
    ],
    makeDeps(runner),
    () => {}
  );
  expect(code).toBe(0);
  expect(runner.calls[0]).toEqual(['mkvmerge', '-J', 't.mkv']);
  expect(runner.calls[1]).toEqual(['mkvmerge', '-J', 'a.mka']);
  expect(runner.calls).toHaveLength(3);
  expect(runner.calls[2]!.filter((arg) => arg === 'a.mka')).toHaveLength(2);
  expect(runner.calls[2]!.join(' ')).toContain('--sync 0:150');
});

test('mux rejects a per-track flag before an audio input', async () => {
  const runner = new FakeRunner();
  expect(
    await runCli(
      ['mux', '--video', 't.mkv', '--track', '1', '--audio', 'a.mka', '--output', 'o.mkv'],
      makeDeps(runner),
      () => {}
    )
  ).toBe(1);
  expect(runner.calls).toHaveLength(0);
});

test('mux rejects a duplicate per-track flag in one audio group', async () => {
  const runner = new FakeRunner();
  expect(
    await runCli(
      [
        'mux',
        '--video',
        't.mkv',
        '--audio',
        'a.mka',
        '--name',
        'First',
        '--name',
        'Second',
        '--output',
        'o.mkv'
      ],
      makeDeps(runner),
      () => {}
    )
  ).toBe(1);
  expect(runner.calls).toHaveLength(0);
});

test('mux dry run prints the plan without running the final mkvmerge command', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  const out = capture();
  expect(
    await runCli(
      ['mux', '--video', 't.mkv', '--audio', 'a.mka', '--output', 'o.mkv', '--dry-run'],
      makeDeps(runner),
      out.write
    )
  ).toBe(0);
  expect(out.lines.join('\n')).toContain('Planned tracks');
  expect(runner.calls).toHaveLength(2);
});

test('mux requires at least one audio input', async () => {
  const runner = new FakeRunner();
  expect(
    await runCli(['mux', '--video', 't.mkv', '--output', 'o.mkv'], makeDeps(runner), () => {})
  ).toBe(1);
  expect(runner.calls).toHaveLength(0);
});

test('negative delay is accepted in equals form', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  const code = await runCli(
    ['mux', '--video', 't.mkv', '--audio', 'a.mka', '--delay-ms=-250', '--output', 'o.mkv'],
    makeDeps(runner),
    () => {}
  );
  expect(code).toBe(0);
  expect(runner.calls[2]).toContain('0:-250');
});

test('negative delay is accepted in space form', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  const code = await runCli(
    ['mux', '--video', 't.mkv', '--audio', 'a.mka', '--delay-ms', '-250', '--output', 'o.mkv'],
    makeDeps(runner),
    () => {}
  );
  expect(code).toBe(0);
  expect(runner.calls[2]).toContain('0:-250');
});

test('mux requires --output', async () => {
  expect(
    await runCli(
      ['mux', '--video', 't.mkv', '--audio', 'a.mka'],
      makeDeps(new FakeRunner()),
      () => {}
    )
  ).toBe(1);
});

test('edit rejects combining --title with --track edits', async () => {
  const runner = new FakeRunner();
  const deps = makeDeps(runner);
  expect(await runCli(['edit', 'movie.mkv', '--title', 'T', '--track', '1'], deps, () => {})).toBe(
    1
  );
  expect(await runCli(['edit', 'movie.mkv', '--title', 'T', '--name', 'N'], deps, () => {})).toBe(
    1
  );
  expect(runner.calls).toHaveLength(0);
});

test('edit rejects contradictory flag pairs and empty edits', async () => {
  const runner = new FakeRunner();
  const deps = makeDeps(runner);
  expect(
    await runCli(['edit', 'movie.mkv', '--track', '1', '--default', '--no-default'], deps, () => {})
  ).toBe(1);
  expect(
    await runCli(['edit', 'movie.mkv', '--track', '1', '--forced', '--no-forced'], deps, () => {})
  ).toBe(1);
  expect(await runCli(['edit', 'movie.mkv', '--track', '1'], deps, () => {})).toBe(1);
  expect(await runCli(['edit', 'movie.mkv'], deps, () => {})).toBe(1);
  expect(await runCli(['edit', 'movie.mkv', '--name', 'N'], deps, () => {})).toBe(1);
  expect(runner.calls).toHaveLength(0);
});

test('edit applies a track rename via mkvpropedit', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe
  runner.queue({ exitCode: 0 }); // mkvpropedit
  const out = capture();
  expect(
    await runCli(
      ['edit', 'movie.mkv', '--track', '1', '--name', 'Commentary'],
      makeDeps(runner),
      out.write
    )
  ).toBe(0);
  expect(runner.calls[1]).toEqual([
    'mkvpropedit',
    '--command-line-charset',
    'UTF-8',
    'movie.mkv',
    '--edit',
    'track:2',
    '--set',
    'name=Commentary'
  ]);
  expect(out.lines.join('\n')).toContain('Edited movie.mkv');
});

test('edit sets the file title without probing', async () => {
  const runner = new FakeRunner();
  runner.queue({ exitCode: 0 });
  const out = capture();
  expect(
    await runCli(['edit', 'movie.mkv', '--title', 'Movie (2024)'], makeDeps(runner), out.write)
  ).toBe(0);
  expect(runner.calls).toHaveLength(1);
  expect(runner.calls[0]?.[0]).toBe('mkvpropedit');
});

test('edit rejects an empty --language with a clear error instead of a raw tool failure', async () => {
  const runner = new FakeRunner();
  expect(
    await runCli(
      ['edit', 'movie.mkv', '--track', '1', '--language', ''],
      makeDeps(runner),
      () => {}
    )
  ).toBe(1);
  expect(runner.calls).toHaveLength(0);
});
