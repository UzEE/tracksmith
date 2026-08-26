#!/usr/bin/env bun
import { parseArgs } from 'node:util';

import type { CommandDeps } from './types.ts';

import { extractCommand } from './commands/extract.ts';
import { inspectCommand } from './commands/inspect.ts';
import { muxCommand } from './commands/mux.ts';
import { testClipCommand } from './commands/test-clip.ts';
import { ProcessRunner } from './runner.ts';
import { CliError } from './types.ts';

const USAGE = `tracksmith — inspect, extract, sync-test, and mux Matroska audio tracks

Usage:
  tracksmith inspect <file>
  tracksmith extract <file> --track <id> [--output <file>] [--force]
  tracksmith test-clip --video <target> --audio <donor> --track <id> --start <time>
                       [--duration 60] [--delay-ms 0] [--output <file>] [--force]
  tracksmith mux --video <target> --audio <mka-or-mkv> --output <file>
                 [--track <id>] [--delay-ms 0] [--language eng] [--name <title>]
                 [--default] [--force]

Notes:
  --track is always the MKVToolNix track ID shown by "tracksmith inspect".
  Positive --delay-ms delays audio; negative advances it (e.g. --delay-ms -250).
  Times accept seconds (90, 90.5) or HH:MM:SS[.ms].
  Check sync near the beginning, middle, and end; a changing offset cannot be fixed by one delay.
  Requires ffmpeg and MKVToolNix (mkvmerge) on PATH.`;

function parseIntStrict(value: string | undefined, flag: string): number {
  if (value === undefined) throw new CliError(`${flag} is required.`);
  if (!/^-?\d+$/.test(value)) throw new CliError(`${flag} must be an integer, got "${value}".`);
  return Number(value);
}

function parseTrack(value: string | undefined): number {
  const track = parseIntStrict(value, '--track');
  if (track < 0) throw new CliError(`--track must be >= 0, got ${track}.`);
  return track;
}

function requireFilePositional(positionals: string[], command: 'inspect' | 'extract'): string {
  if (positionals.length === 0) throw new CliError(`${command} requires a file argument.`);
  if (positionals.length > 1) throw new CliError(`${command} accepts exactly one file argument.`);
  return positionals[0]!;
}

// Wraps a parseArgs call so parse failures become CliErrors. Takes a thunk
// (rather than the options object) so parseArgs keeps its precise generic
// inference over each command's inline options literal.
function parseOrCliError<T>(parseFn: () => T): T {
  try {
    return parseFn();
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

// parseArgs treats a leading-dash value token ("-250") as an option, so fold
// `--delay-ms -250` into the equals form it does accept.
function normalizeDelayMs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === '--delay-ms' && next !== undefined && /^-\d+$/.test(next)) {
      out.push(`--delay-ms=${next}`);
      i += 1;
    } else {
      out.push(arg);
    }
  }
  return out;
}

export async function runCli(
  argv: string[],
  deps: CommandDeps,
  stdout: (line: string) => void = console.log
): Promise<number> {
  const [command, ...rawRest] = argv;
  const rest = normalizeDelayMs(rawRest);
  try {
    switch (command) {
      case undefined: {
        stdout(USAGE);
        return 1;
      }
      case '--help':
      case '-h': {
        stdout(USAGE);
        return 0;
      }
      case 'inspect': {
        const { positionals } = parseOrCliError(() =>
          parseArgs({ args: rest, options: {}, allowPositionals: true, strict: true })
        );
        const file = requireFilePositional(positionals, 'inspect');
        stdout(await inspectCommand(file, deps));
        return 0;
      }
      case 'extract': {
        const { values, positionals } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              track: { type: 'string' },
              output: { type: 'string' },
              force: { type: 'boolean', default: false }
            },
            allowPositionals: true,
            strict: true
          })
        );
        const file = requireFilePositional(positionals, 'extract');
        const output = await extractCommand(
          {
            file,
            track: parseTrack(values.track),
            output: values.output,
            force: values.force ?? false
          },
          deps
        );
        stdout(`Wrote ${output}`);
        return 0;
      }
      case 'test-clip': {
        const { values } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              video: { type: 'string' },
              audio: { type: 'string' },
              track: { type: 'string' },
              start: { type: 'string' },
              duration: { type: 'string', default: '60' },
              'delay-ms': { type: 'string', default: '0' },
              output: { type: 'string' },
              force: { type: 'boolean', default: false }
            },
            strict: true
          })
        );
        if (!values.video || !values.audio)
          throw new CliError('test-clip requires --video and --audio.');
        if (!values.start) throw new CliError('test-clip requires --start.');
        const output = await testClipCommand(
          {
            video: values.video,
            audio: values.audio,
            track: parseTrack(values.track),
            start: values.start,
            duration: values.duration ?? '60',
            delayMs: parseIntStrict(values['delay-ms'] ?? '0', '--delay-ms'),
            output: values.output,
            force: values.force ?? false
          },
          deps
        );
        stdout(`Wrote ${output}`);
        return 0;
      }
      case 'mux': {
        const { values } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              video: { type: 'string' },
              audio: { type: 'string' },
              track: { type: 'string' },
              'delay-ms': { type: 'string', default: '0' },
              language: { type: 'string', default: 'eng' },
              name: { type: 'string' },
              default: { type: 'boolean', default: false },
              output: { type: 'string' },
              force: { type: 'boolean', default: false }
            },
            strict: true
          })
        );
        if (!values.video || !values.audio) throw new CliError('mux requires --video and --audio.');
        if (!values.output)
          throw new CliError('mux requires --output (no default output name for the final file).');
        const output = await muxCommand(
          {
            video: values.video,
            audio: values.audio,
            track: values.track === undefined ? undefined : parseTrack(values.track),
            delayMs: parseIntStrict(values['delay-ms'] ?? '0', '--delay-ms'),
            language: values.language,
            name: values.name,
            makeDefault: values.default ?? false,
            output: values.output,
            force: values.force ?? false
          },
          deps
        );
        stdout(`Wrote ${output}`);
        return 0;
      }
      default:
        throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
    }
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`tracksmith: ${error.message}`);
      return error.exitCode;
    }
    throw error;
  }
}

async function promptYesNo(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);
  for await (const line of console) {
    return /^y(es)?$/i.test(line.trim());
  }
  return false;
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), {
    runner: new ProcessRunner(),
    isTTY: process.stdin.isTTY,
    confirm: promptYesNo
  });
}
