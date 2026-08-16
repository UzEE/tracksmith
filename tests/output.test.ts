import { expect, test } from "bun:test";
import { join } from "node:path";
import { CliError } from "../src/types.ts";
import { defaultExtractOutput, defaultTestClipOutput, ensureWritable, stemPath } from "../src/output.ts";

test("default output names sit next to the input, extension replaced", () => {
  const source = join("media", "Movie (2023).mkv");
  expect(defaultExtractOutput(source, 2)).toBe(join("media", "Movie (2023).track2.mka"));
  expect(defaultTestClipOutput(source)).toBe(join("media", "Movie (2023).sync-test.mkv"));
});

test("stemPath handles files without an extension", () => {
  expect(stemPath(join("media", "noext"))).toBe(join("media", "noext"));
});

const base = { confirm: async () => true, exists: () => true };

test("ensureWritable resolves when the file does not exist", async () => {
  await expect(
    ensureWritable("out.mka", { force: false, isTTY: false, confirm: async () => false, exists: () => false }),
  ).resolves.toBeUndefined();
});

test("ensureWritable resolves with --force without prompting", async () => {
  let prompted = false;
  await expect(
    ensureWritable("out.mka", {
      ...base,
      force: true,
      isTTY: true,
      confirm: async () => {
        prompted = true;
        return false;
      },
    }),
  ).resolves.toBeUndefined();
  expect(prompted).toBe(false);
});

test("ensureWritable prompts on a TTY and honors the answer", async () => {
  await expect(ensureWritable("out.mka", { ...base, force: false, isTTY: true })).resolves.toBeUndefined();
  await expect(
    ensureWritable("out.mka", { ...base, force: false, isTTY: true, confirm: async () => false }),
  ).rejects.toThrow(/Aborted/);
});

test("ensureWritable refuses in non-interactive sessions, suggesting --force", async () => {
  const attempt = ensureWritable("out.mka", { ...base, force: false, isTTY: false });
  await expect(attempt).rejects.toThrow(CliError);
  await expect(attempt).rejects.toThrow(/--force/);
});
