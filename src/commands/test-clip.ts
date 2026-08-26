import type { CommandDeps } from '../types.ts';

import { defaultTestClipOutput, ensureWritable, requireInputFile } from '../output.ts';
import { toolPath } from '../paths.ts';
import { audioRelativeIndex, probeTracks, requireAudioTrack } from '../probe.ts';
import { CliError } from '../types.ts';

export function parseTimeToSeconds(value: string): number {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/.exec(value);
  if (!match)
    throw new CliError(`Invalid time "${value}". Use seconds (90 or 90.5) or HH:MM:SS[.ms].`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function buildTestClipArgs(a: {
  video: string;
  audio: string;
  audioStreamIndex: number;
  startSeconds: number;
  durationSeconds: number;
  delayMs: number;
  output: string;
}): string[] {
  // -y is safe: our own overwrite policy (ensureWritable) has already run.
  return [
    'ffmpeg',
    '-hide_banner',
    '-nostdin',
    '-ss',
    String(a.startSeconds),
    '-i',
    toolPath(a.video),
    '-itsoffset',
    String(a.delayMs / 1000),
    '-ss',
    String(a.startSeconds),
    '-i',
    toolPath(a.audio),
    '-map',
    '0:v:0',
    '-map',
    `1:a:${a.audioStreamIndex}`,
    '-t',
    String(a.durationSeconds),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    '-sn',
    '-abort_on',
    'empty_output_stream',
    '-y',
    toolPath(a.output)
  ];
}

export async function testClipCommand(
  opts: {
    video: string;
    audio: string;
    track: number;
    start: string;
    duration: string;
    delayMs: number;
    output?: string;
    force: boolean;
  },
  deps: CommandDeps
): Promise<string> {
  requireInputFile(opts.video, deps.exists);
  requireInputFile(opts.audio, deps.exists);
  const startSeconds = parseTimeToSeconds(opts.start);
  const durationSeconds = parseTimeToSeconds(opts.duration);
  if (durationSeconds <= 0) throw new CliError('--duration must be greater than zero.');
  const donorTracks = await probeTracks(deps.runner, opts.audio);
  requireAudioTrack(donorTracks, opts.track);
  const output = opts.output ?? defaultTestClipOutput(opts.video);
  await ensureWritable(output, {
    force: opts.force,
    isTTY: deps.isTTY,
    confirm: deps.confirm,
    exists: deps.exists,
    inputs: [opts.video, opts.audio]
  });
  const result = await deps.runner.run(
    buildTestClipArgs({
      video: opts.video,
      audio: opts.audio,
      audioStreamIndex: audioRelativeIndex(donorTracks, opts.track),
      startSeconds,
      durationSeconds,
      delayMs: opts.delayMs,
      output
    }),
    deps.isTTY ? { stream: 'stderr' } : undefined
  );
  if (result.exitCode !== 0) {
    throw new CliError(
      `ffmpeg failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
  }
  return output;
}
