import type { Runner, RunResult } from '../src/types.ts';

export class FakeRunner implements Runner {
  calls: string[][] = [];
  private results: RunResult[] = [];

  queue(result: Partial<RunResult>): void {
    this.results.push({ exitCode: 0, stdout: '', stderr: '', ...result });
  }

  async run(argv: readonly string[]): Promise<RunResult> {
    this.calls.push([...argv]);
    return this.results.shift() ?? { exitCode: 0, stdout: '', stderr: '' };
  }
}

export const SAMPLE_MKVMERGE_JSON = JSON.stringify({
  container: { type: 'Matroska' },
  tracks: [
    { id: 0, type: 'video', codec: 'HEVC', properties: { language: 'und', default_track: true } },
    {
      id: 1,
      type: 'audio',
      codec: 'AC-3',
      properties: {
        language: 'eng',
        track_name: 'Surround 5.1',
        audio_channels: 6,
        default_track: true
      }
    },
    {
      id: 2,
      type: 'audio',
      codec: 'E-AC-3',
      properties: {
        language: 'eng',
        track_name: 'TrueHD companion',
        audio_channels: 8,
        default_track: false
      }
    },
    {
      id: 3,
      type: 'subtitles',
      codec: 'SubRip/SRT',
      properties: { language: 'eng', default_track: false }
    }
  ]
});
