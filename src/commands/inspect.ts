import type { CommandDeps, Track } from '../types.ts';

import { requireInputFile } from '../output.ts';
import { probeFile } from '../probe.ts';

export function formatTable(header: readonly string[], rows: readonly string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...all.map((row) => row[column]!.length)));
  return all
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join('  ')
        .trimEnd()
    )
    .join('\n');
}

export function formatTrackTable(tracks: Track[]): string {
  return formatTable(
    ['ID', 'TYPE', 'CODEC', 'LANG', 'CH', 'DEFAULT', 'FORCED', 'NAME'],
    tracks.map((track) => [
      String(track.id),
      track.type,
      track.codec,
      track.language ?? '-',
      track.channels !== undefined ? String(track.channels) : '-',
      track.isDefault ? 'yes' : '-',
      track.isForced ? 'yes' : '-',
      track.name ?? '-'
    ])
  );
}

export async function inspectCommand(file: string, deps: CommandDeps): Promise<string> {
  requireInputFile(file, deps.exists);
  const { title, tracks } = await probeFile(deps.runner, file);
  const table = formatTrackTable(tracks);
  return title === undefined ? table : `Title: ${title}\n\n${table}`;
}
