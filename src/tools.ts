export const TOOLS = ['ffmpeg', 'mkvmerge', 'mkvpropedit'] as const;

export type ToolName = (typeof TOOLS)[number];

export function isToolName(value: string): value is ToolName {
  return TOOLS.some((tool) => tool === value);
}

const MKVTOOLNIX_HINT =
  'Windows: winget install MoritzBunkus.MKVToolNix or scoop install mkvtoolnix | macOS: brew install mkvtoolnix | Linux: sudo apt install mkvtoolnix or sudo pacman -S mkvtoolnix-cli';

const INSTALL_HINTS = {
  ffmpeg:
    'Windows: winget install Gyan.FFmpeg or scoop install ffmpeg | macOS: brew install ffmpeg | Linux: sudo apt install ffmpeg or sudo pacman -S ffmpeg',
  mkvmerge: MKVTOOLNIX_HINT,
  mkvpropedit: MKVTOOLNIX_HINT
} satisfies Record<ToolName, string>;

export function installHint(tool: ToolName): string {
  return INSTALL_HINTS[tool];
}
