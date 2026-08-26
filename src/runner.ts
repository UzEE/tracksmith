import { spawn } from 'node:child_process';

import type { Runner, RunResult } from './types.ts';

import { installHint, isToolName } from './tools.ts';
import { CliError } from './types.ts';

export function processStartError(program: string, error: unknown): CliError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT' &&
    isToolName(program)
  ) {
    return new CliError(
      `${program} is required but was not found on PATH. ${installHint(program)}`
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new CliError(`Failed to start ${program}: ${message}`);
}

export class ProcessRunner implements Runner {
  async run(argv: readonly string[]): Promise<RunResult> {
    const [executable, ...args] = argv;
    if (executable === undefined) {
      throw new CliError('Could not start process: missing executable');
    }

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
      process.once('error', (error) => {
        reject(processStartError(executable, error));
      });
      process.once('close', (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  }
}
