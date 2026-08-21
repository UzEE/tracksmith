import type { CommandDeps, Track } from '../types.ts';

import { ensureWritable, requireInputFile } from '../output.ts';
import { toolPath } from '../paths.ts';
import { probeTracks, requireAudioTrack } from '../probe.ts';
import { CliError } from '../types.ts';

export function resolveAudioTrackId(tracks: Track[], requested: number | undefined): number {
  if (requested !== undefined) return requireAudioTrack(tracks, requested).id;
  const audio = tracks.filter((track) => track.type === 'audio');
  if (audio.length === 1) return audio[0]!.id;
  if (audio.length === 0) throw new CliError('The audio input contains no audio tracks.');
  throw new CliError(
    `The audio input contains ${audio.length} audio tracks; pass --track <id> (see: tracksmith inspect <file>).`
  );
}

export function buildMuxArgs(a: {
  video: string;
  audio: string;
  audioTrackId: number;
  delayMs: number;
  language?: string;
  trackName?: string;
  makeDefault: boolean;
  output: string;
}): string[] {
  const id = String(a.audioTrackId);
  const args = [
    'mkvmerge',
    '-o',
    toolPath(a.output),
    toolPath(a.video),
    '--audio-tracks',
    id,
    '--no-video',
    '--no-subtitles',
    '--no-buttons',
    '--no-chapters',
    '--no-attachments',
    '--no-global-tags'
  ];
  if (a.delayMs !== 0) args.push('--sync', `${id}:${a.delayMs}`);
  if (a.language !== undefined) args.push('--language', `${id}:${a.language}`);
  if (a.trackName !== undefined) args.push('--track-name', `${id}:${a.trackName}`);
  args.push('--default-track-flag', `${id}:${a.makeDefault ? 'yes' : 'no'}`);
  args.push(toolPath(a.audio));
  return args;
}

export async function muxCommand(
  opts: {
    video: string;
    audio: string;
    track?: number;
    delayMs: number;
    language?: string;
    name?: string;
    makeDefault: boolean;
    output: string;
    force: boolean;
  },
  deps: CommandDeps
): Promise<string> {
  requireInputFile(opts.video, deps.exists);
  requireInputFile(opts.audio, deps.exists);
  const audioTracks = await probeTracks(deps.runner, opts.audio);
  const audioTrackId = resolveAudioTrackId(audioTracks, opts.track);
  await ensureWritable(opts.output, {
    force: opts.force,
    isTTY: deps.isTTY,
    confirm: deps.confirm,
    exists: deps.exists,
    inputs: [opts.video, opts.audio]
  });
  const result = await deps.runner.run(
    buildMuxArgs({
      video: opts.video,
      audio: opts.audio,
      audioTrackId,
      delayMs: opts.delayMs,
      language: opts.language,
      trackName: opts.name,
      makeDefault: opts.makeDefault,
      output: opts.output
    })
  );
  if (result.exitCode >= 2) {
    throw new CliError(
      `mkvmerge failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
  }
  return opts.output;
}
