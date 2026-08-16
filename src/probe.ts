import type { Runner, Track } from "./types.ts";
import { CliError } from "./types.ts";

interface MkvmergeTrack {
  id: number;
  type: string;
  codec: string;
  properties?: {
    language?: string;
    track_name?: string;
    audio_channels?: number;
    default_track?: boolean;
  };
}

export function parseMkvmergeJson(json: string): Track[] {
  let parsed: { tracks?: MkvmergeTrack[] };
  try {
    parsed = JSON.parse(json) as { tracks?: MkvmergeTrack[] };
  } catch {
    throw new CliError("Could not parse mkvmerge -J output as JSON.");
  }
  return (parsed.tracks ?? []).map((track) => ({
    id: track.id,
    type: track.type,
    codec: track.codec,
    language: track.properties?.language,
    name: track.properties?.track_name,
    channels: track.properties?.audio_channels,
    isDefault: track.properties?.default_track ?? false,
  }));
}

export async function probeTracks(runner: Runner, file: string): Promise<Track[]> {
  const result = await runner.run(["mkvmerge", "-J", file]);
  if (result.exitCode >= 2) {
    throw new CliError(`mkvmerge could not read "${file}" (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
  return parseMkvmergeJson(result.stdout);
}

function validAudioIds(tracks: Track[]): string {
  const ids = tracks.filter((track) => track.type === "audio").map((track) => track.id);
  return `Valid audio track IDs: ${ids.length > 0 ? ids.join(", ") : "none"}`;
}

export function requireAudioTrack(tracks: Track[], id: number): Track {
  const track = tracks.find((candidate) => candidate.id === id);
  if (!track) throw new CliError(`Track ${id} does not exist. ${validAudioIds(tracks)}`);
  if (track.type !== "audio") throw new CliError(`Track ${id} is ${track.type}, not audio. ${validAudioIds(tracks)}`);
  return track;
}

export function audioRelativeIndex(tracks: Track[], id: number): number {
  const index = tracks.filter((track) => track.type === "audio").findIndex((track) => track.id === id);
  if (index === -1) throw new CliError(`Track ${id} is not an audio track. ${validAudioIds(tracks)}`);
  return index;
}
