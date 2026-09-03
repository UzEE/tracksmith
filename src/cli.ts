import { parseArgs } from 'node:util';

import type { CommandDeps } from './types.ts';

import { editCommand } from './commands/edit.ts';
import { extractCommand } from './commands/extract.ts';
import { inspectCommand } from './commands/inspect.ts';
import { describeAudioGroup, muxCommand } from './commands/mux.ts';
import { testClipCommand } from './commands/test-clip.ts';
import { CliError } from './types.ts';

const USAGE = `tracksmith — inspect, edit, extract, sync-test, and mux Matroska audio tracks

Usage:
  tracksmith inspect <file>
  tracksmith extract <file> --track <id> [--output <file>] [--force]
  tracksmith edit <file> --track <id> [--name <text>] [--language <lang>]
                  [--default | --no-default] [--forced | --no-forced]
  tracksmith edit <file> --title <text>
  tracksmith test-clip --video <target> --audio <donor> --track <id> --start <time>
                       [--duration 60] [--delay-ms 0] [--output <file>] [--force]
  tracksmith mux --video <target> --output <file> [--dry-run] [--force]
                 --audio <mka-or-mkv> [--track <id>] [--delay-ms 0] [--language eng] [--name <title>] [--default]
                 [--audio <next> ...]

Notes:
  Repeat --audio to add several tracks; per-track flags apply to the most recent --audio.
  --default may be set on at most one --audio; it also clears the target's existing default audio flags.
  --dry-run prints the planned track layout without writing.
  --track is always the MKVToolNix track ID shown by "tracksmith inspect".
  edit changes metadata in place without remuxing. --name "" and --title "" clear the value
  (in Windows PowerShell use --name= and --title=; empty "" arguments get dropped).
  --title sets the file title and cannot be combined with --track edits.
  Positive --delay-ms delays audio; negative advances it (e.g. --delay-ms -250).
  Times accept seconds (90, 90.5) or HH:MM:SS[.ms].
  Check sync near the beginning, middle, and end; a changing offset cannot be fixed by one delay.
  Requires ffmpeg and MKVToolNix (mkvmerge, mkvpropedit) on PATH.`;

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

function requireFilePositional(
  positionals: string[],
  command: 'inspect' | 'extract' | 'edit'
): string {
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
        const { values, tokens } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              video: { type: 'string' },
              output: { type: 'string' },
              force: { type: 'boolean', default: false },
              'dry-run': { type: 'boolean', default: false },
              audio: { type: 'string', multiple: true },
              track: { type: 'string', multiple: true },
              'delay-ms': { type: 'string', multiple: true },
              language: { type: 'string', multiple: true },
              name: { type: 'string', multiple: true },
              default: { type: 'boolean', multiple: true }
            },
            strict: true,
            tokens: true
          })
        );
        const groups: {
          audio: string;
          track?: string;
          delayMs?: string;
          language?: string;
          name?: string;
          makeDefault?: true;
        }[] = [];
        for (const token of tokens) {
          if (token.kind !== 'option') continue;
          if (token.name === 'audio') {
            groups.push({ audio: token.value });
            continue;
          }
          if (
            token.name !== 'track' &&
            token.name !== 'delay-ms' &&
            token.name !== 'language' &&
            token.name !== 'name' &&
            token.name !== 'default'
          ) {
            continue;
          }
          const group = groups.at(-1);
          if (group === undefined) {
            throw new CliError(`--${token.name} must come after an --audio input.`);
          }
          switch (token.name) {
            case 'track':
              if (group.track !== undefined)
                throw new CliError(
                  `Duplicate --track for ${describeAudioGroup(groups.length - 1, group.audio)}.`
                );
              group.track = token.value;
              break;
            case 'delay-ms':
              if (group.delayMs !== undefined)
                throw new CliError(
                  `Duplicate --delay-ms for ${describeAudioGroup(groups.length - 1, group.audio)}.`
                );
              group.delayMs = token.value;
              break;
            case 'language':
              if (group.language !== undefined)
                throw new CliError(
                  `Duplicate --language for ${describeAudioGroup(groups.length - 1, group.audio)}.`
                );
              group.language = token.value;
              break;
            case 'name':
              if (group.name !== undefined)
                throw new CliError(
                  `Duplicate --name for ${describeAudioGroup(groups.length - 1, group.audio)}.`
                );
              group.name = token.value;
              break;
            case 'default':
              if (group.makeDefault !== undefined)
                throw new CliError(
                  `Duplicate --default for ${describeAudioGroup(groups.length - 1, group.audio)}.`
                );
              group.makeDefault = true;
              break;
          }
        }
        if (!values.video || groups.length === 0)
          throw new CliError('mux requires --video and --audio.');
        if (!values.output)
          throw new CliError('mux requires --output (no default output name for the final file).');
        const result = await muxCommand(
          {
            video: values.video,
            tracks: groups.map((group) => ({
              audio: group.audio,
              track: group.track === undefined ? undefined : parseTrack(group.track),
              delayMs: parseIntStrict(group.delayMs ?? '0', '--delay-ms'),
              language: group.language ?? 'eng',
              name: group.name,
              makeDefault: group.makeDefault ?? false
            })),
            output: values.output,
            force: values.force ?? false,
            dryRun: values['dry-run'] ?? false
          },
          deps
        );
        if (result.kind === 'dry-run') stdout(result.plan);
        else stdout(`Wrote ${result.output}`);
        return 0;
      }
      case 'edit': {
        const { values, positionals } = parseOrCliError(() =>
          parseArgs({
            args: rest,
            options: {
              track: { type: 'string' },
              name: { type: 'string' },
              language: { type: 'string' },
              default: { type: 'boolean' },
              'no-default': { type: 'boolean' },
              forced: { type: 'boolean' },
              'no-forced': { type: 'boolean' },
              title: { type: 'string' }
            },
            allowPositionals: true,
            strict: true
          })
        );
        const file = requireFilePositional(positionals, 'edit');
        const hasTrackFlags =
          values.track !== undefined ||
          values.name !== undefined ||
          values.language !== undefined ||
          values.default !== undefined ||
          values['no-default'] !== undefined ||
          values.forced !== undefined ||
          values['no-forced'] !== undefined;
        if (values.title !== undefined && hasTrackFlags)
          throw new CliError(
            '--title cannot be combined with --track edits. Run them as separate invocations.'
          );
        if (values.default !== undefined && values['no-default'] !== undefined)
          throw new CliError('Pass either --default or --no-default, not both.');
        if (values.forced !== undefined && values['no-forced'] !== undefined)
          throw new CliError('Pass either --forced or --no-forced, not both.');
        if (values.language === '')
          throw new CliError('--language cannot be empty. Use --language und for undetermined.');
        let warning: string | undefined;
        if (values.title !== undefined) {
          warning = await editCommand({ kind: 'title', file, title: values.title }, deps);
        } else {
          if (values.track === undefined)
            throw new CliError('edit requires --track (or --title for the file title).');
          warning = await editCommand(
            {
              kind: 'track',
              file,
              track: parseTrack(values.track),
              name: values.name,
              language: values.language,
              isDefault: values.default ?? (values['no-default'] !== undefined ? false : undefined),
              isForced: values.forced ?? (values['no-forced'] !== undefined ? false : undefined)
            },
            deps
          );
        }
        if (warning !== undefined) console.error(`tracksmith: ${warning}`);
        stdout(`Edited ${file}`);
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
