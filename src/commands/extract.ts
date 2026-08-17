import type { CommandDeps } from "../types.ts";
import { CliError } from "../types.ts";
import { probeTracks, requireAudioTrack } from "../probe.ts";
import { defaultExtractOutput, ensureWritable, requireInputFile } from "../output.ts";
import { toolPath } from "../paths.ts";

export function buildExtractArgs(opts: { file: string; track: number; output: string }): string[] {
  return [
    "mkvmerge",
    "-o",
    toolPath(opts.output),
    "--audio-tracks",
    String(opts.track),
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
    toolPath(opts.file),
  ];
}

export async function extractCommand(
  opts: { file: string; track: number; output?: string; force: boolean },
  deps: CommandDeps,
): Promise<string> {
  requireInputFile(opts.file, deps.exists);
  const tracks = await probeTracks(deps.runner, opts.file);
  requireAudioTrack(tracks, opts.track);
  const output = opts.output ?? defaultExtractOutput(opts.file, opts.track);
  await ensureWritable(output, {
    force: opts.force,
    isTTY: deps.isTTY,
    confirm: deps.confirm,
    exists: deps.exists,
    inputs: [opts.file],
  });
  const result = await deps.runner.run(buildExtractArgs({ file: opts.file, track: opts.track, output }));
  if (result.exitCode >= 2) {
    throw new CliError(`mkvmerge failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
  return output;
}
