import { spawn } from 'node:child_process';

import type { Runner, RunResult } from './types.ts';

import { CliError } from './types.ts';

export class ProcessRunner implements Runner {
  async run(argv: readonly string[]): Promise<RunResult> {
    const [executable, ...args] = argv;
    if (executable === undefined) {
      throw new CliError('Could not start process: missing executable');
    }

    try {
      return await new Promise((resolve, reject) => {
        const process = spawn(executable, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';

        process.stdout.setEncoding('utf8');
        process.stderr.setEncoding('utf8');
        process.stdout.on('data', (chunk: string) => {
          stdout += chunk;
        });
        process.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
        process.once('error', reject);
        process.once('close', (exitCode) => {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });
      });
    } catch (error) {
      throw new CliError(
        `Could not start ${executable}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
