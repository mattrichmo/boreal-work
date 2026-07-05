// Confirmation panel for write/danger TuiCommandDescriptors. Read actions
// never render this -- they run immediately (see route bodies' onAction).

import { Box, Text } from "ink";

import type { TuiCommandDescriptor } from "@boreal/ui-model";
import { COLOR } from "./theme.js";
import { Field, Pane } from "./ui.js";

export function CommandConfirmPanel({
  descriptor,
  running,
  error
}: {
  readonly descriptor: TuiCommandDescriptor;
  readonly running?: boolean;
  readonly error?: string;
}) {
  const tone = descriptor.effect === "danger" ? COLOR.danger : COLOR.warn;
  return (
    <Pane title={descriptor.label} tone={tone}>
      <Field label="command" value={descriptor.displayCommand} color={COLOR.text} />
      <Field label="workspace" value={descriptor.workspaceRoot} color={COLOR.muted} />
      {descriptor.subject ? <Field label="subject" value={descriptor.subject.label} color={COLOR.muted} /> : null}
      {descriptor.description ? (
        <Box marginTop={1}>
          <Text color={COLOR.muted} wrap="wrap">
            {descriptor.description}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        {running ? (
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
