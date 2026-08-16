import type { CommandDeps } from "../types.ts";
import { CliError } from "../types.ts";
import { audioRelativeIndex, probeTracks, requireAudioTrack } from "../probe.ts";
import { defaultTestClipOutput, ensureWritable } from "../output.ts";

export function parseTimeToSeconds(value: string): number {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/.exec(value);
  if (!match) throw new CliError(`Invalid time "${value}". Use seconds (90 or 90.5) or HH:MM:SS[.ms].`);
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
  const audioSeek = a.startSeconds - a.delayMs / 1000;
  if (audioSeek < 0) {
    throw new CliError(
      `--start ${a.startSeconds}s with --delay-ms ${a.delayMs} would seek before the file begins; pick a later --start.`,
    );
  }
  // -y is safe: our own overwrite policy (ensureWritable) has already run.
  return [
    "ffmpeg",
    "-hide_banner",
    "-nostdin",
    "-ss",
    String(a.startSeconds),
    "-t",
    String(a.durationSeconds),
    "-i",
    a.video,
    "-ss",
    String(audioSeek),
    "-t",
    String(a.durationSeconds),
    "-i",
    a.audio,
    "-map",
    "0:v:0",
    "-map",
    `1:a:${a.audioStreamIndex}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "copy",
    "-sn",
    "-y",
    a.output,
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
  deps: CommandDeps,
): Promise<string> {
  const donorTracks = await probeTracks(deps.runner, opts.audio);
  requireAudioTrack(donorTracks, opts.track);
  const output = opts.output ?? defaultTestClipOutput(opts.video);
  await ensureWritable(output, { force: opts.force, isTTY: deps.isTTY, confirm: deps.confirm, exists: deps.exists });
  const result = await deps.runner.run(
    buildTestClipArgs({
      video: opts.video,
      audio: opts.audio,
      audioStreamIndex: audioRelativeIndex(donorTracks, opts.track),
      startSeconds: parseTimeToSeconds(opts.start),
      durationSeconds: parseTimeToSeconds(opts.duration),
      delayMs: opts.delayMs,
      output,
    }),
  );
  if (result.exitCode !== 0) {
    throw new CliError(`ffmpeg failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
  return output;
}
