import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const expectedFileNames = ['tracksmith.js', 'tracksmith.js.map'] as const;
const moduleSpecifierPattern =
  /\b(?:import|export)\s+(?:[^;"']*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;

export function validateEmittedFileNames(fileNames: readonly string[]): void {
  const actual = fileNames.toSorted();
  const expected = expectedFileNames.toSorted();

  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(
      `Expected dist to contain exactly ${expected.join(', ')}, but found ${actual.join(', ') || 'nothing'}.`
    );
  }
}

export function validateEntrypointText(entrypointText: string): void {
  const [firstLine] = entrypointText.split(/\r?\n/, 1);

  if (firstLine !== '#!/usr/bin/env node') {
    throw new Error('Expected dist/tracksmith.js to start with #!/usr/bin/env node.');
  }

  const specifiers = [...entrypointText.matchAll(moduleSpecifierPattern)].map(
    (match) => match[1] ?? match[2]
  );

  const typeScriptImport = specifiers.find(
    (specifier) =>
      specifier !== undefined && /^\.\.?\//.test(specifier) && specifier.endsWith('.ts')
  );

  if (typeScriptImport !== undefined) {
    throw new Error(`Unexpected runtime TypeScript import: ${typeScriptImport}`);
  }

  const hasZodImport = specifiers.some(
    (specifier) =>
      specifier !== undefined &&
      !specifier.startsWith('.') &&
      !specifier.startsWith('/') &&
      (specifier === 'zod' || specifier.startsWith('zod/'))
  );

  if (!hasZodImport) {
    throw new Error(
      'Expected dist/tracksmith.js to retain a bare runtime import starting with zod.'
    );
  }
}

function buildPackage(): void {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const distPath = join(repositoryRoot, 'dist');

  rmSync(distPath, { recursive: true, force: true });

  const result = spawnSync(
    'vp',
    ['pack', 'src/tracksmith.ts', '--format', 'esm', '--out-dir', 'dist', '--sourcemap'],
    {
      cwd: repositoryRoot,
      stdio: 'inherit'
    }
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`vp pack failed with exit code ${result.status ?? 'unknown'}.`);
  }

  validateEmittedFileNames(readdirSync(distPath));
  validateEntrypointText(readFileSync(join(distPath, 'tracksmith.js'), 'utf8'));
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  buildPackage();
}
