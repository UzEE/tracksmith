import { createHash } from 'node:crypto';

import * as z from 'zod/mini';

export type StableVersion = `${number}.${number}.${number}`;
export type ReleaseTag = `v${StableVersion}`;

export interface ReleaseMetadata {
  name: 'tracksmith';
  version: StableVersion;
  tag: ReleaseTag;
  changelogSection: string;
}

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const packageJsonSchema = z.object({
  name: z.literal('tracksmith'),
  version: z.string(),
  private: z.optional(z.literal(false)),
  publishConfig: z.object({
    access: z.literal('public'),
    registry: z.literal('https://registry.npmjs.org/'),
    tag: z.literal('latest')
  })
});

function isStableVersion(version: string): version is StableVersion {
  return stableVersionPattern.test(version);
}

export function parseStableVersion(version: string): StableVersion {
  if (!isStableVersion(version)) {
    throw new Error(`Release version must be a stable semantic version, received "${version}".`);
  }

  return version;
}

export function releaseTag(version: StableVersion): ReleaseTag {
  return `v${version}`;
}

export function extractChangelogSection(changelog: string, version: StableVersion): string {
  const lines = changelog.split(/\r?\n/);
  const heading = `## ${version}`;
  const sectionStarts = lines.flatMap((line, index) => (line === heading ? [index] : []));

  if (sectionStarts.length === 0) {
    throw new Error(`CHANGELOG.md is missing the ${heading} section.`);
  }

  if (sectionStarts.length > 1) {
    throw new Error(`CHANGELOG.md contains duplicate ${heading} sections.`);
  }

  const sectionStart = sectionStarts[0];
  if (sectionStart === undefined) {
    throw new Error(`CHANGELOG.md is missing the ${heading} section.`);
  }

  const nextSection = lines.findIndex(
    (line, index) => index > sectionStart && line.startsWith('## ')
  );
  const sectionLines = lines.slice(sectionStart + 1, nextSection === -1 ? undefined : nextSection);

  while (sectionLines[0]?.trim() === '') sectionLines.shift();
  while (sectionLines.at(-1)?.trim() === '') sectionLines.pop();

  if (sectionLines.every((line) => line.trim() === '')) {
    throw new Error(`CHANGELOG.md section ${heading} has no body.`);
  }

  return `${sectionLines.join('\n')}\n`;
}

export function calculateIntegrity(bytes: Uint8Array): string {
  const digest = createHash('sha512').update(bytes).digest('base64');
  return `sha512-${digest}`;
}

export function readReleaseMetadata(packageJson: string, changelog: string): ReleaseMetadata {
  let parsedPackageJson: unknown;
  try {
    parsedPackageJson = JSON.parse(packageJson);
  } catch {
    throw new Error('package.json is not valid JSON.');
  }

  const result = z.safeParse(packageJsonSchema, parsedPackageJson);
  if (!result.success) {
    throw new Error(
      'package.json must contain publishable tracksmith metadata and a string version.'
    );
  }

  const version = parseStableVersion(result.data.version);
  return {
    name: result.data.name,
    version,
    tag: releaseTag(version),
    changelogSection: extractChangelogSection(changelog, version)
  };
}
