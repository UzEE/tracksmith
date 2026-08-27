import { existsSync } from 'node:fs';

import type { CommandDeps, Track } from '../types.ts';

import { findAliasedInput, requireInputFile } from '../output.ts';
import { toolPath } from '../paths.ts';
import { probeTracks, requireAudioTrack } from '../probe.ts';
import { CliError } from '../types.ts';
import { formatTable } from './inspect.ts';

/** One `--audio` block from the CLI: a source file plus its per-track options. */
export interface MuxTrackRequest {
  audio: string;
  track?: number;
  delayMs: number;
  language?: string;
  name?: string;
  makeDefault: boolean;
}

export interface MuxOptions {
  video: string;
  tracks: readonly MuxTrackRequest[];
  output: string;
  force: boolean;
  dryRun: boolean;
}

/** A request whose track id has been resolved against the probed source. */
export interface ResolvedMuxTrack {
  audio: string;
  trackId: number;
  delayMs: number;
  language?: string;
  trackName?: string;
  makeDefault: boolean;
}

export type MuxResult = { kind: 'dry-run'; plan: string } | { kind: 'written'; output: string };

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
  clearDefaultAudioIds: readonly number[];
  groups: readonly ResolvedMuxTrack[];
  output: string;
}): string[] {
  const args = ['mkvmerge', '-o', toolPath(a.output)];
  for (const id of a.clearDefaultAudioIds) args.push('--default-track-flag', `${id}:no`);
  args.push(toolPath(a.video));
  for (const group of a.groups) {
    const id = String(group.trackId);
    args.push(
      '--audio-tracks',
      id,
      '--no-video',
      '--no-subtitles',
      '--no-buttons',
      '--no-chapters',
      '--no-attachments',
      '--no-global-tags'
    );
    if (group.delayMs !== 0) args.push('--sync', `${id}:${group.delayMs}`);
    if (group.language !== undefined) args.push('--language', `${id}:${group.language}`);
    if (group.trackName !== undefined) args.push('--track-name', `${id}:${group.trackName}`);
    args.push('--default-track-flag', `${id}:${group.makeDefault ? 'yes' : 'no'}`);
    args.push(toolPath(group.audio));
  }
  return args;
}

function buildPlan(a: {
  video: string;
  videoTracks: readonly Track[];
  groups: readonly ResolvedMuxTrack[];
  sourceTracks: ReadonlyMap<string, Track[]>;
  clearDefaultAudioIds: readonly number[];
  output: string;
}): string {
  const cleared = new Set(a.clearDefaultAudioIds);
  const existingRows = a.videoTracks.map((track) => [
    String(track.id),
    track.type,
    track.codec,
    track.language ?? '-',
    track.channels !== undefined ? String(track.channels) : '-',
    track.isDefault && !cleared.has(track.id) ? 'yes' : '-',
    '-',
    track.name ?? '-',
    a.video
  ]);
  const newRows = a.groups.map((group, index) => {
    const donor = a.sourceTracks.get(group.audio)?.find((track) => track.id === group.trackId);
    return [
      String(a.videoTracks.length + index),
      'audio',
      donor?.codec ?? '-',
      group.language ?? donor?.language ?? '-',
      donor?.channels !== undefined ? String(donor.channels) : '-',
      group.makeDefault ? 'yes' : '-',
      group.delayMs !== 0 ? `${group.delayMs}ms` : '-',
      group.trackName ?? donor?.name ?? '-',
      group.audio
    ];
  });
  const table = formatTable(
    ['ID', 'TYPE', 'CODEC', 'LANG', 'CH', 'DEFAULT', 'DELAY', 'NAME', 'SOURCE'],
    [...existingRows, ...newRows]
  );
  return `Planned tracks for "${a.output}":\n${table}`;
}

export async function muxCommand(opts: MuxOptions, deps: CommandDeps): Promise<MuxResult> {
  requireInputFile(opts.video, deps.exists);
  const uniqueAudio = [...new Set(opts.tracks.map((track) => track.audio))];
  for (const audio of uniqueAudio) requireInputFile(audio, deps.exists);

  const videoTracks = await probeTracks(deps.runner, opts.video);
  const sourceTracks = new Map(
    await Promise.all(
      uniqueAudio.map(async (audio): Promise<[string, Track[]]> => [
        audio,
        await probeTracks(deps.runner, audio)
      ])
    )
  );

  const groups: ResolvedMuxTrack[] = opts.tracks.map((track) => ({
    audio: track.audio,
    trackId: resolveAudioTrackId(sourceTracks.get(track.audio)!, track.track),
    delayMs: track.delayMs,
    language: track.language,
    trackName: track.name,
    makeDefault: track.makeDefault
  }));
  if (groups.filter((group) => group.makeDefault).length > 1) {
    throw new CliError('--default can be set on at most one --audio input.');
  }

  const aliasedInput = findAliasedInput(opts.output, [opts.video, ...uniqueAudio]);
  if (aliasedInput !== undefined) {
    throw new CliError(
      `Output "${opts.output}" is the same file as input "${aliasedInput}". Choose a different output path.`
    );
  }

  const clearDefaultAudioIds = groups.some((group) => group.makeDefault)
    ? videoTracks
        .filter((track) => track.type === 'audio' && track.isDefault)
        .map((track) => track.id)
    : [];
  const plan = buildPlan({
    video: opts.video,
    videoTracks,
    groups,
    sourceTracks,
    clearDefaultAudioIds,
    output: opts.output
  });
  if (opts.dryRun) return { kind: 'dry-run', plan };

  const exists = deps.exists ?? existsSync;
  const outputExists = exists(opts.output);
  if (!opts.force) {
    if (deps.isTTY) {
      const overwrite = outputExists
        ? `\nOutput "${opts.output}" already exists and will be overwritten.`
        : '';
      const approved = await deps.confirm(`${plan}${overwrite}\nWrite "${opts.output}"?`);
      if (!approved) throw new CliError('Aborted: nothing written.');
    } else if (outputExists) {
      throw new CliError(
        `Output "${opts.output}" already exists. Pass --force to overwrite (cannot prompt in a non-interactive session).`
      );
    }
  }

  const result = await deps.runner.run(
    buildMuxArgs({
      video: opts.video,
      clearDefaultAudioIds,
      groups,
      output: opts.output
    }),
    deps.stderrIsTTY ? { stream: 'stdout' } : undefined
  );
  if (result.exitCode >= 2) {
    throw new CliError(
      `mkvmerge failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
  }
  return { kind: 'written', output: opts.output };
}
