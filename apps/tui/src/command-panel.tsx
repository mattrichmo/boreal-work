// Confirmation panel for write/danger TuiCommandDescriptors. Read actions
// never render this -- they run immediately (see route bodies' onAction).

import { Box, Text } from "ink";

import type { TuiCommandDescriptor } from "@boreal/ui-model";
import { COLOR, fit } from "./theme.js";
import { Pane } from "./ui.js";
import { boundedTextLines } from "./routes/task-detail.js";

const SAFE_SHELL_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;

/** Quote one argv element so the preview can be copied to a POSIX shell. */
export function quoteShellArg(value: string): string {
  if (value.length > 0 && SAFE_SHELL_WORD.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function firstDisplayWord(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "bwrk";
  if (trimmed[0] !== "'" && trimmed[0] !== '"') return trimmed.split(/\s/u, 1)[0] ?? "bwrk";
  const quote = trimmed[0];
  let escaped = false;
  let result = "";
  for (const character of trimmed.slice(1)) {
    if (escaped) {
      result += character;
      escaped = false;
    } else if (character === "\\" && quote === '"') {
      escaped = true;
    } else if (character === quote) {
      return result;
    } else {
      result += character;
    }
  }
  return result || "bwrk";
}

/**
 * Rebuild the preview from the immutable argv rather than displaying the
 * legacy space-joined string. This keeps spaces, quotes, empty values, and
 * shell metacharacters unambiguous without changing what will be executed.
 */
export function formatCommandDescriptor(descriptor: Pick<TuiCommandDescriptor, "displayCommand" | "argv">): string {
  const command = firstDisplayWord(descriptor.displayCommand);
  return [command, ...descriptor.argv].map(quoteShellArg).join(" ");
}

export function commandPreviewLines(descriptor: Pick<TuiCommandDescriptor, "displayCommand" | "argv">, width: number): readonly string[] {
  return boundedTextLines(formatCommandDescriptor(descriptor), Math.max(1, Math.floor(width)), 10_000);
}

export function commandPanelLines(descriptor: TuiCommandDescriptor, width: number, error?: string): readonly string[] {
  const values = [
    "COMMAND", formatCommandDescriptor(descriptor),
    "", `Workspace: ${descriptor.workspaceRoot}`,
    ...(descriptor.subject ? [`Subject: ${descriptor.subject.label}`] : []),
    ...(descriptor.description ? ["", descriptor.description] : []),
    ...(descriptor.disabled ? ["", `Unavailable: ${descriptor.disabledReason ?? "This action cannot run."}`] : []),
    ...(error ? ["", `Failed: ${error}`] : [])
  ];
  return values.flatMap((value) => boundedTextLines(value, Math.max(1, width - 4), Number.MAX_SAFE_INTEGER));
}

export function commandPanelMaxScroll(descriptor: TuiCommandDescriptor, width: number, height: number, error?: string): number {
  return Math.max(0, commandPanelLines(descriptor, width, error).length - Math.max(1, height - 4));
}

export function descriptorCanRun(descriptor: Pick<TuiCommandDescriptor, "disabled">): boolean {
  return descriptor.disabled !== true;
}

export function CommandConfirmPanel({ descriptor, running, error, width = 80, height = 18, scrollOffset = 0 }: {
  readonly descriptor: TuiCommandDescriptor;
  readonly running?: boolean;
  readonly error?: string;
  readonly width?: number;
  readonly height?: number;
  readonly scrollOffset?: number;
}) {
  const disabled = !descriptorCanRun(descriptor);
  const tone = disabled ? COLOR.muted : descriptor.effect === "danger" ? COLOR.danger : COLOR.warn;
  if (height < 4) return <Text wrap="truncate">{fit("Resize to review command. Esc cancels.", width)}</Text>;
  const viewport = Math.max(1, height - 4);
  const lines = commandPanelLines(descriptor, width, error);
  const max = Math.max(0, lines.length - viewport);
  const offset = Math.max(0, Math.min(max, Math.floor(scrollOffset)));
  return <Pane title={descriptor.label} tone={tone} width={width} height={height}>
    <Box flexDirection="column" height={viewport} overflow="hidden">
      {lines.slice(offset, offset + viewport).map((line, index) => <Text key={index} color={COLOR.text} wrap="truncate">{fit(line, Math.max(1, width - 4))}</Text>)}
    </Box>
    <Text color={error ? COLOR.danger : tone} wrap="truncate">{fit(
      `${running ? "Running…" : disabled ? "Unavailable · Esc cancel" : error ? "Failed · Enter retry · Esc cancel" : "Enter run · Esc cancel"}${max ? ` · ↑↓ scroll ${offset}/${max}` : ""}`,
      Math.max(1, width - 4)
    )}</Text>
  </Pane>;
}
