import type { Runner, Track } from './types.ts';

import * as z from 'zod/mini';

import { toolPath } from './paths.ts';
import { CliError } from './types.ts';

const mkvmergePropertiesSchema = z.object({
  language: z.optional(z.string()),
  track_name: z.optional(z.string()),
  audio_channels: z.optional(z.number()),
  default_track: z.optional(z.boolean())
});

const mkvmergeTrackSchema = z.object({
  id: z.int(),
  type: z.string(),
  codec: z.string(),
  properties: z.optional(mkvmergePropertiesSchema)
});

const mkvmergeOutputSchema = z.object({
  tracks: z.optional(z.array(mkvmergeTrackSchema))
});

export function parseMkvmergeJson(json: string): Track[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CliError('Could not parse mkvmerge -J output as JSON.');
  }
  const result = z.safeParse(mkvmergeOutputSchema, parsed);
  if (!result.success) throw new CliError('mkvmerge -J output has an unexpected structure.');

  return (result.data.tracks ?? []).map((track) => ({
    id: track.id,
    type: track.type,
    codec: track.codec,
    language: track.properties?.language,
    name: track.properties?.track_name,
    channels: track.properties?.audio_channels,
    isDefault: track.properties?.default_track ?? false
  }));
}

export async function probeTracks(runner: Runner, file: string): Promise<Track[]> {
  const result = await runner.run(['mkvmerge', '-J', toolPath(file)]);
  if (result.exitCode >= 2) {
    throw new CliError(
      `mkvmerge could not read "${file}" (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
  }
  return parseMkvmergeJson(result.stdout);
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
