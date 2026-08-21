import { expect, test } from 'bun:test';

import { findMissingTools, installHint, requireTools } from '../src/tools.ts';
import { CliError } from '../src/types.ts';

const nonePresent = () => null;
const allPresent = (cmd: string) => `/usr/bin/${cmd}`;
const onlyFfmpeg = (cmd: string) => (cmd === 'ffmpeg' ? '/usr/bin/ffmpeg' : null);

test('findMissingTools reports only tools which() cannot resolve', () => {
  expect(findMissingTools(['ffmpeg', 'mkvmerge'], onlyFfmpeg)).toEqual(['mkvmerge']);
  expect(findMissingTools(['ffmpeg', 'mkvmerge'], allPresent)).toEqual([]);
});

test('requireTools passes silently when everything is present', () => {
  expect(() => requireTools(['ffmpeg', 'mkvmerge'], allPresent)).not.toThrow();
});

test('requireTools throws a CliError naming every missing tool with an install hint', () => {
  try {
    requireTools(['ffmpeg', 'mkvmerge'], nonePresent);
    throw new Error('expected CliError');
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) throw error;
    const message = error.message;
    expect(message).toContain('ffmpeg');
    expect(message).toContain('mkvmerge');
    expect(message).toContain(installHint('ffmpeg'));
    expect(message).toContain(installHint('mkvmerge'));
  }
});

test('install hints cover Windows, macOS, and Linux', () => {
  for (const tool of ['ffmpeg', 'mkvmerge'] as const) {
    const hint = installHint(tool);
    expect(hint).toContain('winget');
    expect(hint).toContain('scoop');
    expect(hint).toContain('brew');
    expect(hint).toContain('apt');
    expect(hint).toContain('pacman');
  }
});
