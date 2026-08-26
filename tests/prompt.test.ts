import { PassThrough, Readable } from 'node:stream';

import { expect, test } from 'vite-plus/test';

import { createConfirmPrompt } from '../src/prompt.ts';

async function promptWith(inputText: string): Promise<{ answer: boolean; output: string }> {
  const input = Readable.from([inputText]);
  const output = new PassThrough();
  let written = '';
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    written += chunk;
  });

  const answer = await createConfirmPrompt({ input, output })('Continue?');
  return { answer, output: written };
}

test.each(['y', 'Y', 'yes', '  yes  '])('accepts %j as confirmation', async (value) => {
  expect((await promptWith(`${value}\n`)).answer).toBe(true);
});

test.each(['', 'n', 'maybe'])('rejects %j as confirmation', async (value) => {
  expect((await promptWith(`${value}\n`)).answer).toBe(false);
});

test('returns false on EOF without a line', async () => {
  const input = Readable.from([]);
  const output = new PassThrough();

  expect(await createConfirmPrompt({ input, output })('Continue?')).toBe(false);
});

test('writes the exact prompt', async () => {
  expect((await promptWith('n\n')).output).toBe('Continue? [y/N] ');
});
