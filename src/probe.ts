import type { Runner, Track } from './types.ts';

import * as z from 'zod/mini';

import { toolPath } from './paths.ts';
import { CliError } from './types.ts';

const mkvmergePropertiesSchema = z.object({
  language: z.optional(z.string()),
  language_ietf: z.optional(z.string()),
  track_name: z.optional(z.string()),
  audio_channels: z.optional(z.number()),
  default_track: z.optional(z.boolean()),
  forced_track: z.optional(z.boolean())
});

const mkvmergeTrackSchema = z.object({
  id: z.int(),
  type: z.string(),
  codec: z.string(),
  properties: z.optional(mkvmergePropertiesSchema)
});

const mkvmergeContainerSchema = z.object({
  properties: z.optional(z.object({ title: z.optional(z.string()) }))
});

const mkvmergeOutputSchema = z.object({
  // Container metadata is ancillary: an unexpected shape must not fail track
  // parsing, so it is validated separately and dropped on mismatch.
  container: z.optional(z.unknown()),
  tracks: z.array(mkvmergeTrackSchema)
});

function containerTitle(container: unknown): string | undefined {
  const result = z.safeParse(mkvmergeContainerSchema, container);
  return result.success ? result.data.properties?.title : undefined;
}

export interface MkvFile {
  title?: string;
  tracks: Track[];
}

export function parseMkvmergeFile(json: string): MkvFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CliError('Could not parse mkvmerge -J output as JSON.');
  }
  const result = z.safeParse(mkvmergeOutputSchema, parsed);
  if (!result.success) throw new CliError('mkvmerge -J output has an unexpected structure.');

  return {
    title: containerTitle(result.data.container),
    tracks: result.data.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      codec: track.codec,
      language: track.properties?.language_ietf || track.properties?.language || undefined,
      name: track.properties?.track_name,
      channels: track.properties?.audio_channels,
      isDefault: track.properties?.default_track ?? false,
      isForced: track.properties?.forced_track ?? false
    }))
  };
}

export function parseMkvmergeJson(json: string): Track[] {
  return parseMkvmergeFile(json).tracks;
}

export async function probeFile(runner: Runner, file: string): Promise<MkvFile> {
  const result = await runner.run(['mkvmerge', '-J', toolPath(file)]);
  if (result.exitCode >= 2) {
    throw new CliError(
      `mkvmerge could not read "${file}" (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
  }
  return parseMkvmergeFile(result.stdout);
}

export async function probeTracks(runner: Runner, file: string): Promise<Track[]> {
  return (await probeFile(runner, file)).tracks;
}

function validAudioIds(tracks: Track[]): string {
  const ids = tracks.filter((track) => track.type === 'audio').map((track) => track.id);
  return `Valid audio track IDs: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
}

export function requireAudioTrack(tracks: Track[], id: number): Track {
  const track = tracks.find((candidate) => candidate.id === id);
  if (!track) throw new CliError(`Track ${id} does not exist. ${validAudioIds(tracks)}`);
  if (track.type !== 'audio')
    throw new CliError(`Track ${id} is ${track.type}, not audio. ${validAudioIds(tracks)}`);
  return track;
}

export function audioRelativeIndex(tracks: Track[], id: number): number {
  const index = tracks
    .filter((track) => track.type === 'audio')
    .findIndex((track) => track.id === id);
  if (index === -1)
    throw new CliError(`Track ${id} is not an audio track. ${validAudioIds(tracks)}`);
  return index;
}

export function requireTrack(tracks: Track[], id: number): Track {
  const track = tracks.find((candidate) => candidate.id === id);
  if (!track) {
    const ids = tracks.map((candidate) => candidate.id);
    throw new CliError(
      `Track ${id} does not exist. Valid track IDs: ${ids.length > 0 ? ids.join(', ') : 'none'}`
    );
  }
  return track;
}
