import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { CliError } from "./types.ts";

export function stemPath(file: string): string {
  return join(dirname(file), basename(file, extname(file)));
}

export function defaultExtractOutput(source: string, trackId: number): string {
  return `${stemPath(source)}.track${trackId}.mka`;
}

export function defaultTestClipOutput(video: string): string {
  return `${stemPath(video)}.sync-test.mkv`;
}

export function requireInputFile(path: string, exists: (path: string) => boolean = existsSync): void {
  if (!exists(path)) throw new CliError(`Input file not found: "${path}".`);
}

export interface OverwriteContext {
  force: boolean;
  isTTY: boolean;
  confirm: (message: string) => Promise<boolean>;
  exists?: (path: string) => boolean;
}

export async function ensureWritable(path: string, ctx: OverwriteContext): Promise<void> {
  const exists = ctx.exists ?? existsSync;
  if (!exists(path)) return;
  if (ctx.force) return;
  if (!ctx.isTTY) {
    throw new CliError(`Output "${path}" already exists. Pass --force to overwrite (cannot prompt in a non-interactive session).`);
  }
  const approved = await ctx.confirm(`Output "${path}" already exists. Overwrite?`);
  if (!approved) throw new CliError("Aborted: existing output left untouched.");
}
