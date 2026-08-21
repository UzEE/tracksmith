import type { Runner, Track } from './types.ts';

import { toolPath } from './paths.ts';
import { CliError } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTrack(value: unknown): Track | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'number' || !Number.isInteger(value.id)) return undefined;
  if (typeof value.type !== 'string' || typeof value.codec !== 'string') return undefined;

  const properties = value.properties;
  if (properties !== undefined && !isRecord(properties)) return undefined;
  if (properties?.language !== undefined && typeof properties.language !== 'string')
    return undefined;
  if (properties?.track_name !== undefined && typeof properties.track_name !== 'string')
    return undefined;
  if (properties?.audio_channels !== undefined && typeof properties.audio_channels !== 'number')
    return undefined;
  if (properties?.default_track !== undefined && typeof properties.default_track !== 'boolean')
    return undefined;

  return {
    id: value.id,
    type: value.type,
    codec: value.codec,
    language: properties?.language,
    name: properties?.track_name,
    channels: properties?.audio_channels,
    isDefault: properties?.default_track ?? false
  };
}

export function parseMkvmergeJson(json: string): Track[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CliError('Could not parse mkvmerge -J output as JSON.');
  }
  if (!isRecord(parsed) || (parsed.tracks !== undefined && !Array.isArray(parsed.tracks))) {
    throw new CliError('mkvmerge -J output has an unexpected structure.');
  }

  const tracks: Track[] = [];
  for (const value of parsed.tracks ?? []) {
    const track = parseTrack(value);
    if (!track) throw new CliError('mkvmerge -J output has an unexpected track structure.');
    tracks.push(track);
  }
  return tracks;
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
