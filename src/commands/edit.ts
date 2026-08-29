import type { CommandDeps } from '../types.ts';

import { requireInputFile } from '../output.ts';
import { toolPath } from '../paths.ts';
import { probeTracks, requireTrack } from '../probe.ts';
import { CliError } from '../types.ts';

export type EditOpts =
  | { kind: 'title'; file: string; title: string }
  | {
      kind: 'track';
      file: string;
      track: number;
      name?: string;
      language?: string;
      isDefault?: boolean;
      isForced?: boolean;
    };

type TrackEditOpts = Extract<EditOpts, { kind: 'track' }>;

function hasTrackEdit(opts: TrackEditOpts): boolean {
  return (
    opts.name !== undefined ||
    opts.language !== undefined ||
    opts.isDefault !== undefined ||
    opts.isForced !== undefined
  );
}

export function buildEditArgs(opts: EditOpts): string[] {
  const args = ['mkvpropedit', toolPath(opts.file)];
  switch (opts.kind) {
    case 'title': {
      args.push('--edit', 'info');
      if (opts.title === '') args.push('--delete', 'title');
      else args.push('--set', `title=${opts.title}`);
      return args;
    }
    case 'track': {
      // mkvpropedit's track:n selector is 1-based over the same track order
      // mkvmerge --identify reports, so the inspect ID maps to id + 1.
      args.push('--edit', `track:${opts.track + 1}`);
      if (opts.name === '') args.push('--delete', 'name');
      else if (opts.name !== undefined) args.push('--set', `name=${opts.name}`);
      if (opts.language !== undefined) args.push('--set', `language=${opts.language}`);
      if (opts.isDefault !== undefined)
        args.push('--set', `flag-default=${opts.isDefault ? '1' : '0'}`);
      if (opts.isForced !== undefined)
        args.push('--set', `flag-forced=${opts.isForced ? '1' : '0'}`);
      return args;
    }
    default:
      return opts satisfies never;
  }
}

/** Returns mkvpropedit's diagnostic output when it exited 1 (modified with warnings). */
export async function editCommand(opts: EditOpts, deps: CommandDeps): Promise<string | undefined> {
  requireInputFile(opts.file, deps.exists);
  if (opts.kind === 'track') {
    if (!hasTrackEdit(opts)) {
      throw new CliError(
        'Nothing to edit: pass --name, --language, --default/--no-default, or --forced/--no-forced.'
      );
    }
    requireTrack(await probeTracks(deps.runner, opts.file), opts.track);
  }
  const result = await deps.runner.run(buildEditArgs(opts));
  if (result.exitCode >= 2) {
    throw new CliError(
      `mkvpropedit failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
  }
  if (result.exitCode === 1) {
    const output = [result.stdout, result.stderr]
      .map((stream) => stream.trim())
      .filter(Boolean)
      .join('\n');
    return `mkvpropedit finished with warnings — check the file in a player:\n${output}`;
  }
  return undefined;
}
