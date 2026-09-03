import { resolve } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { buildMuxArgs, muxCommand, resolveAudioTrackId } from '../src/commands/mux.ts';
import { parseMkvmergeJson } from '../src/probe.ts';
import { CliError } from '../src/types.ts';
import { FakeRunner, SAMPLE_MKVMERGE_JSON } from './helpers.ts';

const SINGLE_AUDIO_MKA = JSON.stringify({
  container: { type: 'Matroska' },
  tracks: [
    { id: 0, type: 'audio', codec: 'E-AC-3', properties: { language: 'eng', audio_channels: 8 } }
  ]
});

const DUAL_AUDIO_MKA = JSON.stringify({
  container: { type: 'Matroska' },
  tracks: [
    {
      id: 0,
      type: 'audio',
      codec: 'TrueHD',
      properties: { language: 'jpn', track_name: 'Donor Original', audio_channels: 8 }
    },
    {
      id: 1,
      type: 'audio',
      codec: 'AC-3',
      properties: { language: 'eng', track_name: 'Donor Commentary', audio_channels: 2 }
    }
  ]
});

test('resolveAudioTrackId uses the only audio track when --track is omitted', () => {
  expect(resolveAudioTrackId(parseMkvmergeJson(SINGLE_AUDIO_MKA), undefined)).toBe(0);
});

test('resolveAudioTrackId requires --track when several audio tracks exist', () => {
  expect(() => resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), undefined)).toThrow(
    /--track/
  );
});

test('resolveAudioTrackId validates an explicit id', () => {
  expect(resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), 2)).toBe(2);
  expect(() => resolveAudioTrackId(parseMkvmergeJson(SAMPLE_MKVMERGE_JSON), 0)).toThrow(CliError);
});

test('buildMuxArgs emits one input block per group after the target', () => {
  const args = buildMuxArgs({
    video: 'target (2023).mkv',
    videoTrackIds: [0, 1, 2, 3],
    clearDefaultAudioIds: [],
    output: 'final.mkv',
    groups: [
      {
        audio: 'donor.mkv',
        trackId: 2,
        delayMs: -250,
        language: 'eng',
        trackName: 'Fixed Audio',
        makeDefault: false
      },
      {
        audio: 'commentary.mka',
        trackId: 0,
        delayMs: 0,
        makeDefault: false
      }
    ]
  });
  expect(args).toEqual([
    'mkvmerge',
    '--command-line-charset',
    'UTF-8',
    '-o',
    'final.mkv',
    '--track-order',
    '0:0,0:1,0:2,0:3,1:2,2:0',
    'target (2023).mkv',
    '--audio-tracks',
    '2',
    '--no-video',
    '--no-subtitles',
    '--no-buttons',
    '--no-chapters',
    '--no-attachments',
    '--no-global-tags',
    '--sync',
    '2:-250',
    '--language',
    '2:eng',
    '--track-name',
    '2:Fixed Audio',
    '--default-track-flag',
    '2:no',
    'donor.mkv',
    '--audio-tracks',
    '0',
    '--no-video',
    '--no-subtitles',
    '--no-buttons',
    '--no-chapters',
    '--no-attachments',
    '--no-global-tags',
    '--default-track-flag',
    '0:no',
    'commentary.mka'
  ]);
});

test('buildMuxArgs clears existing default audio flags on the video input', () => {
  const args = buildMuxArgs({
    video: 'target.mkv',
    videoTrackIds: [0, 1, 2, 3],
    clearDefaultAudioIds: [1, 2],
    output: 'final.mkv',
    groups: [{ audio: 'a.mka', trackId: 0, delayMs: 0, makeDefault: true }]
  });
  expect(args.slice(0, 12)).toEqual([
    'mkvmerge',
    '--command-line-charset',
    'UTF-8',
    '-o',
    'final.mkv',
    '--track-order',
    '0:0,0:1,0:2,0:3,1:0',
    '--default-track-flag',
    '1:no',
    '--default-track-flag',
    '2:no',
    'target.mkv'
  ]);
  expect(args.join(' ')).toContain('--default-track-flag 0:yes');
});

test('buildMuxArgs protects MKVToolNix operator-looking audio filenames', () => {
  const args = buildMuxArgs({
    video: 'target.mkv',
    videoTrackIds: [0, 1, 2, 3],
    clearDefaultAudioIds: [],
    output: 'final.mkv',
    groups: [{ audio: '+donor.mka', trackId: 0, delayMs: 0, makeDefault: false }]
  });
  expect(args.at(-1)).toBe(resolve('+donor.mka'));
});

// Inputs exist; the named outputs do not.
const deps = {
  isTTY: false,
  stderrIsTTY: false,
  confirm: async () => false,
  exists: (path: string) => path !== 'final.mkv' && path !== 'o.mkv'
};

function singleTrack(overrides: Record<string, unknown> = {}) {
  return { audio: 'movie.track2.mka', delayMs: 0, makeDefault: false, ...overrides };
}

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    video: 'target.mkv',
    tracks: [singleTrack()],
    output: 'final.mkv',
    force: false,
    dryRun: false,
    ...overrides
  };
}

test('muxCommand rejects a missing target video before probing or prompting', async () => {
  const runner = new FakeRunner();
  await expect(
    muxCommand(baseOpts({ video: 'gone.mkv' }), { ...deps, runner, exists: () => false })
  ).rejects.toThrow(/Input file not found: "gone.mkv"/);
  expect(runner.calls).toHaveLength(0);
});

test('muxCommand probes the video then each unique audio input once', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // probe video
  runner.queue({ stdout: DUAL_AUDIO_MKA }); // probe dual.mka once
  runner.queue({ exitCode: 0 }); // mux
  const result = await muxCommand(
    baseOpts({
      tracks: [
        singleTrack({ audio: 'dual.mka', track: 0 }),
        singleTrack({ audio: 'dual.mka', track: 1, delayMs: 150 })
      ]
    }),
    { ...deps, runner }
  );
  expect(result).toEqual({ kind: 'written', output: 'final.mkv' });
  expect(runner.calls[0]).toEqual(['mkvmerge', '-J', 'target.mkv']);
  expect(runner.calls[1]).toEqual(['mkvmerge', '-J', 'dual.mka']);
  expect(runner.calls).toHaveLength(3);
  const mux = runner.calls[2]!;
  expect(mux.slice(0, 7)).toEqual([
    'mkvmerge',
    '--command-line-charset',
    'UTF-8',
    '-o',
    'final.mkv',
    '--track-order',
    '0:0,0:1,0:2,0:3,1:0,2:1'
  ]);
  expect(mux.filter((arg) => arg === 'dual.mka')).toHaveLength(2);
  expect(mux.join(' ')).toContain('--sync 1:150');
});

test('muxCommand allows the same track twice from one source', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  const result = await muxCommand(
    baseOpts({
      tracks: [singleTrack({ delayMs: 0 }), singleTrack({ delayMs: 250 })]
    }),
    { ...deps, runner }
  );
  expect(result.kind).toBe('written');
  const mux = runner.calls[2]!;
  expect(mux.filter((arg) => arg === 'movie.track2.mka')).toHaveLength(2);
});

test('muxCommand rejects --default on more than one track', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: DUAL_AUDIO_MKA });
  await expect(
    muxCommand(
      baseOpts({
        tracks: [
          singleTrack({ audio: 'dual.mka', track: 0, makeDefault: true }),
          singleTrack({ audio: 'dual.mka', track: 1, makeDefault: true })
        ]
      }),
      { ...deps, runner }
    )
  ).rejects.toThrow(/--default/);
  expect(runner.calls).toHaveLength(2); // probes only, no mux
});

test('muxCommand names the offending --audio group when track resolution fails', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ stdout: DUAL_AUDIO_MKA });
  await expect(
    muxCommand(baseOpts({ tracks: [singleTrack(), singleTrack({ audio: 'dual.mka' })] }), {
      ...deps,
      runner
    })
  ).rejects.toThrow(/--audio #2 \("dual\.mka"\): The audio input contains 2 audio tracks/);
});

test('muxCommand clears the video default audio flags only when a new track takes default', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON }); // video: audio id 1 is default
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  await muxCommand(baseOpts({ tracks: [singleTrack({ makeDefault: true })] }), {
    ...deps,
    runner
  });
  expect(runner.calls[2]!.join(' ')).toContain('--default-track-flag 1:no target.mkv');

  const keep = new FakeRunner();
  keep.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  keep.queue({ stdout: SINGLE_AUDIO_MKA });
  keep.queue({ exitCode: 0 });
  await muxCommand(baseOpts(), { ...deps, runner: keep });
  expect(keep.calls[2]!.join(' ')).not.toContain('1:no target.mkv');
});

test('muxCommand dry run prints the full planned layout and never runs mkvmerge', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: DUAL_AUDIO_MKA });
  const result = await muxCommand(
    baseOpts({
      dryRun: true,
      tracks: [singleTrack({ audio: 'dual.mka', track: 1, language: 'eng', name: 'Commentary' })]
    }),
    { ...deps, runner }
  );
  expect(result.kind).toBe('dry-run');
  if (result.kind !== 'dry-run') return;
  expect(runner.calls).toHaveLength(2); // probes only
  expect(result.plan).toContain('final.mkv');
  expect(result.plan).toContain('Surround 5.1'); // existing video audio track
  expect(result.plan).toMatch(/^3\s+subtitles\s+SubRip\/SRT/m); // target subtitle keeps its id
  expect(result.plan).toMatch(/^4\s+audio\s+AC-3.*Commentary/m); // new audio is appended
  expect(result.plan).toContain('target.mkv'); // source column
  expect(result.plan).toContain('dual.mka');
});

test('muxCommand on a TTY asks one combined question containing the plan', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  const questions: string[] = [];
  const result = await muxCommand(baseOpts(), {
    ...deps,
    runner,
    isTTY: true,
    confirm: async (message) => {
      questions.push(message);
      return true;
    }
  });
  expect(result.kind).toBe('written');
  expect(questions).toHaveLength(1);
  expect(questions[0]).toContain('Surround 5.1');
  expect(questions[0]).toContain('Write "final.mkv"?');
  expect(questions[0]).not.toContain('already exists');
});

test('muxCommand mentions overwriting in the combined prompt when the output exists', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  const questions: string[] = [];
  await muxCommand(baseOpts(), {
    ...deps,
    runner,
    exists: () => true,
    isTTY: true,
    confirm: async (message) => {
      questions.push(message);
      return true;
    }
  });
  expect(questions[0]).toContain('already exists');
});

test('muxCommand aborts without running mkvmerge when the prompt is declined', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  await expect(
    muxCommand(baseOpts(), { ...deps, runner, isTTY: true, confirm: async () => false })
  ).rejects.toThrow(/Aborted/);
  expect(runner.calls).toHaveLength(2);
});

test('muxCommand with --force never prompts', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  let prompted = false;
  const result = await muxCommand(baseOpts({ force: true }), {
    ...deps,
    runner,
    exists: () => true,
    isTTY: true,
    confirm: async () => {
      prompted = true;
      return false;
    }
  });
  expect(result.kind).toBe('written');
  expect(prompted).toBe(false);
});

test('muxCommand refuses to overwrite non-interactively without --force', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  await expect(muxCommand(baseOpts(), { ...deps, runner, exists: () => true })).rejects.toThrow(
    /--force/
  );
  expect(runner.calls).toHaveLength(2);
});

test('muxCommand surfaces mkvmerge failures', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 2, stderr: 'container error' });
  await expect(muxCommand(baseOpts({ output: 'o.mkv' }), { ...deps, runner })).rejects.toThrow(
    /container error/
  );
});

test('muxCommand streams mkvmerge progress only when stderr is a TTY', async () => {
  const runner = new FakeRunner();
  runner.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  runner.queue({ stdout: SINGLE_AUDIO_MKA });
  runner.queue({ exitCode: 0 });
  await muxCommand(baseOpts(), { ...deps, runner, stderrIsTTY: true });
  expect(runner.options[0]).toBeUndefined(); // probes stay quiet
  expect(runner.options[1]).toBeUndefined();
  expect(runner.options[2]).toEqual({ stream: 'stdout' });

  // An interactive stdin alone (e.g. `mux ... 2>log`) must not stream.
  const quiet = new FakeRunner();
  quiet.queue({ stdout: SAMPLE_MKVMERGE_JSON });
  quiet.queue({ stdout: SINGLE_AUDIO_MKA });
  quiet.queue({ exitCode: 0 });
  await muxCommand(baseOpts(), { ...deps, runner: quiet, isTTY: true, confirm: async () => true });
  expect(quiet.options[2]).toBeUndefined();
});
