import { expect, test } from 'bun:test';

import { FakeRunner } from './helpers.ts';

test('FakeRunner records argv and replays queued results in order', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: 'first', exitCode: 0 });
  runner.queue({ stderr: 'boom', exitCode: 2 });

  const one = await runner.run(['mkvmerge', '-J', 'a file.mkv']);
  const two = await runner.run(['ffmpeg', '-i', 'b.mkv']);

  expect(runner.calls).toEqual([
    ['mkvmerge', '-J', 'a file.mkv'],
    ['ffmpeg', '-i', 'b.mkv']
  ]);
  expect(one).toEqual({ exitCode: 0, stdout: 'first', stderr: '' });
  expect(two).toEqual({ exitCode: 2, stdout: '', stderr: 'boom' });
});

test('FakeRunner returns a success default when nothing is queued', async () => {
  const runner = new FakeRunner();
  expect(await runner.run(['mkvmerge'])).toEqual({ exitCode: 0, stdout: '', stderr: '' });
});
