import { isAbsolute, resolve } from 'node:path';

const TOOL_OPERATOR_PREFIXES = '-+@=()[]';

export function toolPath(path: string): string {
  if (isAbsolute(path) || !TOOL_OPERATOR_PREFIXES.includes(path[0] ?? '')) return path;
  return resolve(path);
}
