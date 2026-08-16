// Confirmation panel for write/danger TuiCommandDescriptors. Read actions
// never render this -- they run immediately (see route bodies' onAction).

import { Box, Text } from "ink";

import type { TuiCommandDescriptor } from "@boreal/ui-model";
import { COLOR } from "./theme.js";
import { Field, Pane } from "./ui.js";

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

export function descriptorCanRun(descriptor: Pick<TuiCommandDescriptor, "disabled">): boolean {
  return descriptor.disabled !== true;
}

export function CommandConfirmPanel({
  descriptor,
  running,
  error,
  width
}: {
  readonly descriptor: TuiCommandDescriptor;
  readonly running?: boolean;
  readonly error?: string;
  readonly width?: number;
}) {
  const disabled = !descriptorCanRun(descriptor);
  const tone = disabled ? COLOR.muted : descriptor.effect === "danger" ? COLOR.danger : COLOR.warn;
  return (
    <Pane title={descriptor.label} tone={tone} width={width}>
      <Field label="command" value={formatCommandDescriptor(descriptor)} color={COLOR.text} />
      <Field label="workspace" value={descriptor.workspaceRoot} color={COLOR.muted} />
      {descriptor.subject ? <Field label="subject" value={descriptor.subject.label} color={COLOR.muted} /> : null}
      {disabled ? (
        <Box marginTop={1}>
          <Text color={COLOR.warn}>{`Disabled${descriptor.disabledReason ? `: ${descriptor.disabledReason}` : "."}`}</Text>
        </Box>
      ) : null}
      {descriptor.description ? (
        <Box marginTop={1}>
          <Text color={COLOR.muted} wrap="wrap">
            {descriptor.description}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        {disabled ? (
          <Text color={COLOR.muted}>
            <Text color={COLOR.accent} bold>
              esc
            </Text>{" cancel"}
          </Text>
        ) : running ? (
          <Text color={COLOR.accent}>Running…</Text>
        ) : error ? (
          <Text color={COLOR.danger}>{`! ${error}`}</Text>
        ) : (
          <Text>
            <Text color={COLOR.accent} bold>
              enter
            </Text>
            <Text color={COLOR.muted}> run · </Text>
            <Text color={COLOR.accent} bold>
              esc
            </Text>
            <Text color={COLOR.muted}> cancel</Text>
          </Text>
        )}
      </Box>
    </Pane>
  );
}
