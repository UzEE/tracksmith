import type { CommandDeps, Track } from "../types.ts";
import { probeTracks } from "../probe.ts";
import { requireInputFile } from "../output.ts";

export function formatTrackTable(tracks: Track[]): string {
  const header = ["ID", "TYPE", "CODEC", "LANG", "CH", "DEFAULT", "NAME"];
  const rows = tracks.map((track) => [
    String(track.id),
    track.type,
    track.codec,
    track.language ?? "-",
    track.channels !== undefined ? String(track.channels) : "-",
    track.isDefault ? "yes" : "-",
    track.name ?? "-",
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...all.map((row) => row[column]!.length)));
  return all
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd())
    .join("\n");
}

export async function inspectCommand(file: string, deps: CommandDeps): Promise<string> {
  requireInputFile(file, deps.exists);
  return formatTrackTable(await probeTracks(deps.runner, file));
}
