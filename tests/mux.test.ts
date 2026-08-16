import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { parseMkvmergeJson } from "../src/probe.ts";
import { buildMuxArgs, muxCommand, resolveAudioTrackId } from "../src/commands/mux.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

const SINGLE_AUDIO_MKA = JSON.stringify({
  container: { type: "Matroska" },
  tracks: [{ id: 0, type: "audio", codec: "E-AC-3", properties: { language: "eng", audio_channels: 8 } }],
});

test("resolveAudioTrackId uses the only audio track when --track is omitted", () => {
  expect(resolveAudioTrackId(parseMkvmergeJson(SINGLE_AUDIO_MKA), undefined)).toBe(0);
});

test("resolveAudioTrackId requires --track when several audio tracks exist", () => {
  expect(() => resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), undefined)).toThrow(/--track/);
});

test("resolveAudioTrackId validates an explicit id", () => {
  expect(resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), 2)).toBe(2);
  expect(() => resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), 0)).toThrow(CliError);
});

test("buildMuxArgs orders audio options after the target and before the audio input", () => {
  const args = buildMuxArgs({
    video: "target (2023).mkv",
    audio: "donor.mkv",
    audioTrackId: 2,
    delayMs: -250,
    language: "eng",
    trackName: "Fixed Audio",
    makeDefault: true,
    output: "final.mkv",
  });
  expect(args).toEqual([
    "mkvmerge",
    "-o",
    "final.mkv",
    "target (2023).mkv",
    "--audio-tracks",
    "2",
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
    "--sync",
    "2:-250",
    "--language",
    "2:eng",
    "--track-name",
    "2:Fixed Audio",
    "--default-track-flag",
    "2:yes",
    "donor.mkv",
  ]);
});

test("buildMuxArgs omits --sync at zero delay and forces default-track-flag no without --default", () => {
  const args = buildMuxArgs({
    video: "t.mkv",
    audio: "a.mka",
    audioTrackId: 0,
    delayMs: 0,
    makeDefault: false,
    output: "o.mkv",
  });
  expect(args).not.toContain("--sync");
  expect(args).not.toContain("--language");
  expect(args).not.toContain("--track-name");
  expect(args.join(" ")).toContain("--default-track-flag 0:no");
});

// Inputs exist; the named outputs do not.
const deps = { isTTY: false, confirm: async () => false, exists: (path: string) => path !== "final.mkv" && path !== "o.mkv" };

test("muxCommand rejects a missing target video before probing or prompting", async () => {
  const runner = new FakeRunner();
  await expect(
    muxCommand(
      { video: "gone.mkv", audio: "a.mka", delayMs: 0, makeDefault: false, output: "final.mkv", force: false },
      { ...deps, runner, exists: () => false },
    ),
  ).rejects.toThrow(/Input file not found: "gone.mkv"/);
  expect(runner.calls).toHaveLength(0);
});

test("muxCommand probes the audio input, resolves the track, and runs mkvmerge", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SINGLE_AUDIO_MKA }); // probe audio input
  runner.queue({ exitCode: 0 }); // mux
  const output = await muxCommand(
    { video: "target.mkv", audio: "movie.track2.mka", delayMs: 0, makeDefault: false, output: "final.mkv", force: false },
    { ...deps, runner },
  );
  expect(output).toBe("final.mkv");
  expect(runner.calls[0]).toEqual(["mkvmerge", "-J", "movie.track2.mka"]);
  expect(runner.calls[1]?.[0]).toBe("mkvmerge");
  expect(runner.calls[1]).toContain("target.mkv");
});

test("muxCommand surfaces mkvmerge failures", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 2, stderr: "container error" });
  await expect(
    muxCommand(
      { video: "t.mkv", audio: "a.mka", delayMs: 0, makeDefault: false, output: "o.mkv", force: false },
      { ...deps, runner },
    ),
  ).rejects.toThrow(/container error/);
});
