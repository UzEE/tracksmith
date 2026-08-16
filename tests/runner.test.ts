import { expect, test } from "bun:test";
import { BunRunner } from "../src/runner.ts";

test("BunRunner captures stdout, stderr, and exit code", async () => {
  const runner = new BunRunner();
  const result = await runner.run([
    process.execPath,
    "-e",
    "console.log('out'); console.error('err'); process.exit(3);",
  ]);
  expect(result.stdout.trim()).toBe("out");
  expect(result.stderr.trim()).toBe("err");
  expect(result.exitCode).toBe(3);
});

test("BunRunner passes argv entries through verbatim (spaces intact)", async () => {
  const runner = new BunRunner();
  const result = await runner.run([
    process.execPath,
    "-e",
    "console.log(process.argv[1]);",
    "path with spaces.mkv",
  ]);
  expect(result.stdout.trim()).toBe("path with spaces.mkv");
});
