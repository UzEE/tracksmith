import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vite-plus/test';

import {
  calculateIntegrity,
  extractChangelogSection,
  parseStableVersion,
  readReleaseMetadata,
  releaseTag
} from '../scripts/release/metadata.ts';

describe('parseStableVersion', () => {
  test.each(['0.1.0', '10.20.30'])('accepts %s', (version) => {
    expect(parseStableVersion(version)).toBe(version);
  });

  test.each(['1.0.0-alpha.1', '1.0.0+build.1', '01.0.0', '1.0', 'v1.0.0'])(
    'rejects %s',
    (version) => {
      expect(() => parseStableVersion(version)).toThrow();
    }
  );
});

test('releaseTag prefixes a stable version', () => {
  expect(releaseTag(parseStableVersion('1.2.3'))).toBe('v1.2.3');
});

describe('extractChangelogSection', () => {
  const changelog = `# Changelog

## 1.2.3

First line.

### Details

Nested details.

## 1.2.30

Other release.
`;

  test('extracts the exact version section and retains nested headings', () => {
    expect(extractChangelogSection(changelog, parseStableVersion('1.2.3'))).toBe(
      'First line.\n\n### Details\n\nNested details.\n'
    );
  });

  test('does not match a longer version heading', () => {
    expect(() => extractChangelogSection(changelog, parseStableVersion('1.2.4'))).toThrow();
  });

  test('rejects duplicate sections', () => {
    expect(() =>
      extractChangelogSection(
        '## 1.2.3\n\nFirst.\n\n## 1.2.3\n\nSecond.\n',
        parseStableVersion('1.2.3')
      )
    ).toThrow();
  });

  test('rejects a bodyless section', () => {
    expect(() =>
      extractChangelogSection('## 1.2.3\n\n## 1.2.4\n\nNext.\n', parseStableVersion('1.2.3'))
    ).toThrow();
  });
});

describe('readReleaseMetadata', () => {
  const changelog = '## 1.2.3\n\nRelease notes.\n';

  test('validates and combines package and changelog metadata', () => {
    expect(readReleaseMetadata('{"name":"tracksmith","version":"1.2.3"}', changelog)).toEqual({
      name: 'tracksmith',
      version: '1.2.3',
      tag: 'v1.2.3',
      changelogSection: 'Release notes.\n'
    });
  });

  test('requires the package name to be exactly tracksmith', () => {
    expect(() => readReleaseMetadata('{"name":"other","version":"1.2.3"}', changelog)).toThrow();
  });
});

test('calculateIntegrity returns a SHA-512 SRI digest', () => {
  const bytes = Buffer.from('verified tarball bytes');
  const expected = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

  expect(calculateIntegrity(bytes)).toBe(expected);
});
