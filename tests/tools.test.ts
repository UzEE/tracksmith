import { expect, test } from "bun:test";
import { CliError } from "../src/types.ts";
import { findMissingTools, installHint, requireTools } from "../src/tools.ts";

const nonePresent = () => null;
const allPresent = (cmd: string) => `/usr/bin/${cmd}`;

test("findMissingTools reports only tools which() cannot resolve", () => {
  const onlyFfmpeg = (cmd: string) => (cmd === "ffmpeg" ? "/usr/bin/ffmpeg" : null);
  expect(findMissingTools(["ffmpeg", "mkvmerge"], onlyFfmpeg)).toEqual(["mkvmerge"]);
  expect(findMissingTools(["ffmpeg", "ffprobe", "mkvmerge"], allPresent)).toEqual([]);
});

test("requireTools passes silently when everything is present", () => {
  expect(() => requireTools(["ffmpeg", "mkvmerge"], allPresent)).not.toThrow();
});

test("requireTools throws a CliError naming every missing tool with an install hint", () => {
  try {
    requireTools(["ffmpeg", "mkvmerge"], nonePresent);
    throw new Error("expected CliError");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("ffmpeg");
    expect(message).toContain("mkvmerge");
    expect(message).toContain(installHint("ffmpeg"));
    expect(message).toContain(installHint("mkvmerge"));
  }
});

test("install hints cover Windows, macOS, and Linux", () => {
  for (const tool of ["ffmpeg", "ffprobe", "mkvmerge"] as const) {
    const hint = installHint(tool);
    expect(hint).toContain("winget");
    expect(hint).toContain("brew");
    expect(hint).toContain("apt");
  }
});
