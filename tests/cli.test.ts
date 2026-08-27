import type { CommandDeps } from '../src/types.ts';

import { expect, test } from 'vite-plus/test';

import { runCli } from '../src/cli.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

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

test('negative delay is accepted in equals form', async () => {
  const runner = new FakeRunner();
  runner.queue({
    stdout: JSON.stringify({
      tracks: [{ id: 0, type: 'audio', codec: 'E-AC-3', properties: { audio_channels: 8 } }]
    })
  });
  runner.queue({ exitCode: 0 });
  const code = await runCli(
    ['mux', '--video', 't.mkv', '--audio', 'a.mka', '--delay-ms=-250', '--output', 'o.mkv'],
    makeDeps(runner),
    () => {}
  );
  expect(code).toBe(0);
  expect(runner.calls[1]).toContain('0:-250');
});

test('negative delay is accepted in space form', async () => {
  const runner = new FakeRunner();
  runner.queue({
    stdout: JSON.stringify({
      tracks: [{ id: 0, type: 'audio', codec: 'E-AC-3', properties: { audio_channels: 8 } }]
    })
  });
  runner.queue({ exitCode: 0 });
  const code = await runCli(
    ['mux', '--video', 't.mkv', '--audio', 'a.mka', '--delay-ms', '-250', '--output', 'o.mkv'],
    makeDeps(runner),
    () => {}
  );
  expect(code).toBe(0);
  expect(runner.calls[1]).toContain('0:-250');
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
