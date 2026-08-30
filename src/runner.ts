import { spawn } from 'node:child_process';

import type { RunOptions, Runner, RunResult } from './types.ts';

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

const writeToCliStderr = (chunk: string): void => {
  globalThis.process.stderr.write(chunk);
};

export class ProcessRunner implements Runner {
  private readonly sink: (chunk: string) => void;

  constructor(options: { sink?: (chunk: string) => void } = {}) {
    this.sink = options.sink ?? writeToCliStderr;
  }

  async run(argv: readonly string[], options?: RunOptions): Promise<RunResult> {
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
        if (options?.stream === 'stdout') this.sink(chunk);
      });
      process.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (options?.stream === 'stderr') this.sink(chunk);
      });
      process.once('error', (error) => {
        reject(processStartError(executable, error));
      });
      // Windows loses the signal: a killed child reports a plain numeric exit
      // code (usually 1) with signal null, so this detection is POSIX-only and
      // Windows cannot distinguish a killed tool from a warning exit.
      process.once('close', (exitCode, signal) => {
        if (signal !== null) {
          const output = [stdout, stderr]
            .map((stream) => stream.trim())
            .filter(Boolean)
            .join('\n');
          const diagnostics = output === '' ? '' : `\nOutput before termination:\n${output}`;
          reject(new CliError(`${executable} was terminated by signal ${signal}.${diagnostics}`));
          return;
        }
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  }
}
