import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { audioRelativeIndex, parseMkvmergeJson, probeTracks, requireAudioTrack } from "../src/probe.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

test("parseMkvmergeJson maps mkvmerge fields onto Track", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(tracks).toHaveLength(4);
  expect(tracks[1]).toEqual({
    id: 1,
    type: "audio",
    codec: "AC-3",
    language: "eng",
    name: "Surround 5.1",
    channels: 6,
    isDefault: true,
  });
  expect(tracks[0]?.channels).toBeUndefined();
  expect(tracks[3]?.isDefault).toBe(false);
});

test("parseMkvmergeJson throws CliError on garbage input", () => {
  expect(() => parseMkvmergeJson("not json")).toThrow(CliError);
});

test("probeTracks invokes mkvmerge -J with the file path verbatim", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  const tracks = await probeTracks(runner, "D:\\media\\a file.mkv");
  expect(runner.calls).toEqual([["mkvmerge", "-J", "D:\\media\\a file.mkv"]]);
  expect(tracks).toHaveLength(4);
});

test("probeTracks throws CliError when mkvmerge cannot read the file", async () => {
  const runner = new FakeRunner();
  runner.queue({ exitCode: 2, stderr: "unsupported container" });
  await expect(probeTracks(runner, "broken.mkv")).rejects.toThrow(CliError);
});

test("requireAudioTrack returns the audio track for a valid id", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(requireAudioTrack(tracks, 2).codec).toBe("E-AC-3");
});

test("requireAudioTrack rejects missing and non-audio ids, listing valid audio ids", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(() => requireAudioTrack(tracks, 9)).toThrow(/Valid audio track IDs: 1, 2/);
  expect(() => requireAudioTrack(tracks, 0)).toThrow(/is video, not audio/);
});

test("audioRelativeIndex maps MKVToolNix ids to audio-relative order", () => {
  const tracks = parseMkvmergeJson(SAMPLE_MKVMERGE_JSON);
  expect(audioRelativeIndex(tracks, 1)).toBe(0);
  expect(audioRelativeIndex(tracks, 2)).toBe(1);
  expect(() => audioRelativeIndex(tracks, 0)).toThrow(CliError);
});
