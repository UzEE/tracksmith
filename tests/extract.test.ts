import { expect, test } from "bun:test";
import { join } from "node:path";
import { CliError } from "../src/types.ts";
import { buildExtractArgs, extractCommand } from "../src/commands/extract.ts";
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from "./helpers.ts";

test("buildExtractArgs keeps only the chosen audio track, stream-copied to MKA", () => {
  expect(buildExtractArgs({ file: "in dir/movie.mkv", track: 2, output: "out dir/movie.track2.mka" })).toEqual([
    "mkvmerge",
    "-o",
    "out dir/movie.track2.mka",
    "--audio-tracks",
    "2",
    "--no-video",
    "--no-subtitles",
    "--no-buttons",
    "--no-chapters",
    "--no-attachments",
    "--no-global-tags",
    "in dir/movie.mkv",
  ]);
});

// Inputs (.mkv) exist; outputs (.mka) do not.
const deps = { isTTY: false, confirm: async () => false, exists: (path: string) => !path.endsWith(".mka") };

test("extractCommand validates the track, applies the default output name, and runs mkvmerge", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe
  runner.queue({ exitCode: 0 }); // extract
  const output = await extractCommand({ file: join("m", "movie.mkv"), track: 2, force: false }, { ...deps, runner });
  expect(output).toBe(join("m", "movie.track2.mka"));
  expect(runner.calls[0]).toEqual(["mkvmerge", "-J", join("m", "movie.mkv")]);
  expect(runner.calls[1]?.[2]).toBe(join("m", "movie.track2.mka"));
});

test("extractCommand rejects non-audio tracks before running mkvmerge", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  await expect(extractCommand({ file: "movie.mkv", track: 0, force: false }, { ...deps, runner })).rejects.toThrow(
    /not audio/,
  );
  expect(runner.calls).toHaveLength(1); // probe only
});

test("extractCommand rejects a missing input file before probing or prompting", async () => {
  const runner = new FakeRunner();
  let prompted = false;
  const attempt = extractCommand(
    { file: "gone.mkv", track: 1, force: false },
    {
      runner,
      isTTY: true,
      confirm: async () => {
        prompted = true;
        return true;
      },
      exists: () => false,
    },
  );
  await expect(attempt).rejects.toThrow(/Input file not found/);
  expect(runner.calls).toHaveLength(0);
  expect(prompted).toBe(false);
});

test("extractCommand surfaces mkvmerge failures with exit code and stderr", async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ exitCode: 2, stderr: "disk full" });
  const attempt = extractCommand({ file: "movie.mkv", track: 1, force: false }, { ...deps, runner });
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(/disk full/);
});
