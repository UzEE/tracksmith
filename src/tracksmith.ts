#!/usr/bin/env node

import { runCli } from './cli.ts';
import { createConfirmPrompt } from './prompt.ts';
import { ProcessRunner } from './runner.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  runner: new ProcessRunner(),
  isTTY: process.stdin.isTTY ?? false,
  stderrIsTTY: process.stderr.isTTY ?? false,
  confirm: createConfirmPrompt({ output: process.stderr })
});
