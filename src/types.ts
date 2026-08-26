export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Runner {
  run(argv: readonly string[]): Promise<RunResult>;
}

export interface Track {
  id: number;
  type: string;
  codec: string;
  language?: string;
  name?: string;
  channels?: number;
  isDefault: boolean;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export interface CommandDeps {
  runner: Runner;
  isTTY: boolean;
  confirm: (message: string) => Promise<boolean>;
  exists?: (path: string) => boolean;
}
