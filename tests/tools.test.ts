import { expect, test } from 'vite-plus/test';

import { installHint, isToolName } from '../src/tools.ts';

test('recognizes supported external tools', () => {
  expect(isToolName('ffmpeg')).toBe(true);
  expect(isToolName('mkvmerge')).toBe(true);
  expect(isToolName('mkvpropedit')).toBe(true);
  expect(isToolName('node')).toBe(false);
});

test('install hints cover Windows, macOS, and Linux', () => {
  for (const tool of ['ffmpeg', 'mkvmerge', 'mkvpropedit'] as const) {
    const hint = installHint(tool);
    expect(hint).toContain('winget');
    expect(hint).toContain('scoop');
    expect(hint).toContain('brew');
    expect(hint).toContain('apt');
    expect(hint).toContain('pacman');
  }
});
