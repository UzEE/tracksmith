import { CliError } from "./types.ts";

export const TOOLS = ["ffmpeg", "mkvmerge"] as const;
export type ToolName = (typeof TOOLS)[number];
export type WhichFn = (cmd: string) => string | null;

const INSTALL_HINTS = {
  ffmpeg:
    "Windows: winget install Gyan.FFmpeg or scoop install ffmpeg | macOS: brew install ffmpeg | Linux: sudo apt install ffmpeg or sudo pacman -S ffmpeg",
  mkvmerge:
    "Windows: winget install MoritzBunkus.MKVToolNix or scoop install mkvtoolnix | macOS: brew install mkvtoolnix | Linux: sudo apt install mkvtoolnix or sudo pacman -S mkvtoolnix-cli",
} satisfies Record<ToolName, string>;

export function installHint(tool: ToolName): string {
  return INSTALL_HINTS[tool];
}

export function findMissingTools(needed: readonly ToolName[], which: WhichFn = Bun.which): ToolName[] {
  return needed.filter((tool) => which(tool) === null);
}

export function requireTools(needed: readonly ToolName[], which: WhichFn = Bun.which): void {
  const missing = findMissingTools(needed, which);
  if (missing.length === 0) return;
  const lines = missing.map((tool) => `  ${tool}: not found on PATH. Install: ${installHint(tool)}`);
  throw new CliError(`Missing required tools:\n${lines.join("\n")}`);
}
