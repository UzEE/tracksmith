import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { CliError } from './types.ts';

export function stemPath(file: string): string {
  return join(dirname(file), basename(file, extname(file)));
}

export function defaultExtractOutput(source: string, trackId: number): string {
  return `${stemPath(source)}.track${trackId}.mka`;
}

export function defaultTestClipOutput(video: string): string {
  return `${stemPath(video)}.sync-test.mkv`;
}

export function requireInputFile(
  path: string,
  exists: (path: string) => boolean = existsSync
): void {
  if (!exists(path)) throw new CliError(`Input file not found: "${path}".`);
}

export interface OverwriteContext {
  force: boolean;
  isTTY: boolean;
  confirm: (message: string) => Promise<boolean>;
  exists?: (path: string) => boolean;
  inputs?: readonly string[];
}

function sameFile(left: string, right: string): boolean {
  try {
    const leftStat = statSync(left, { bigint: true });
    const rightStat = statSync(right, { bigint: true });
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return false;
  }
}

/** Returns the input path the output aliases on disk (same dev/inode), if any. */
export function findAliasedInput(output: string, inputs: readonly string[]): string | undefined {
  return inputs.find((input) => sameFile(output, input));
}

export async function ensureWritable(path: string, ctx: OverwriteContext): Promise<void> {
  const aliasedInput = findAliasedInput(path, ctx.inputs ?? []);
  if (aliasedInput !== undefined) {
    throw new CliError(
      `Output "${path}" is the same file as input "${aliasedInput}". Choose a different output path.`
    );
  }

  const exists = ctx.exists ?? existsSync;
  if (!exists(path)) return;
  if (ctx.force) return;
  if (!ctx.isTTY) {
    throw new CliError(
      `Output "${path}" already exists. Pass --force to overwrite (cannot prompt in a non-interactive session).`
    );
  }
  const approved = await ctx.confirm(`Output "${path}" already exists. Overwrite?`);
  if (!approved) throw new CliError('Aborted: existing output left untouched.');
}
