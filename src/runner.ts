import type { Runner, RunResult } from "./types.ts";
import { CliError } from "./types.ts";

export class BunRunner implements Runner {
  async run(argv: readonly string[]): Promise<RunResult> {
    try {
      const proc = Bun.spawn([...argv], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    } catch (error) {
      const executable = argv[0] ?? "process";
      throw new CliError(`Could not start ${executable}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
