import { Box, Text } from "ink";
import type { WorkItemView } from "@boreal/ui-model";

import type { RepoTaskDetailBody } from "../loaders.js";
import { reconciliationStatusForWork } from "../reconciliation.js";
import { COLOR, statusColor, statusLabel } from "../theme.js";
import { Field, Pane } from "../ui.js";

export function TaskDetailRoute({
  body,
  width,
  selectedActionIndex
}: {
  readonly body: RepoTaskDetailBody;
  readonly width: number;
  readonly selectedActionIndex: number;
}) {
  const task = body.work;
  return (
    <Pane title={task.title} tone={statusColor(task.status)}>
      <Text>
        <Text color={statusColor(task.status)} bold>
          {statusLabel(task.status)}
        </Text>
        <Text color={COLOR.faint}>{"  ·  "}</Text>
        <Text color={COLOR.muted}>{task.kind}</Text>
        <Text color={COLOR.faint}>{"  ·  "}</Text>
        <Text color={COLOR.muted}>{`${task.priority} priority`}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Field label="id" value={task.id} color={COLOR.muted} />
        <Field label="labels" value={task.labels.length > 0 ? task.labels.join(", ") : "none"} />
        <Field
          label="blockers"
          value={task.activeBlockerIds.length > 0 ? task.activeBlockerIds.join(", ") : "none"}
          color={task.activeBlockerIds.length > 0 ? COLOR.warn : undefined}
        />
        <Field
          label="reserved"
          value={task.activeReservation ? `${task.activeReservation.agentId}${task.activeReservation.expired ? " (expired)" : ""}` : "no"}
        />
        <Field label="evidence" value={`${task.evidenceCount} · verifications ${task.verificationCount}`} />
        {body.dependencyTitles.length > 0 ? <Field label="depends on" value={body.dependencyTitles.join(", ")} color={COLOR.muted} /> : null}
      </Box>
      {task.description ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>DESCRIPTION</Text>
          <Text color={COLOR.text} wrap="wrap">
            {clamp(task.description, 600)}
          </Text>
        </Box>
      ) : null}
      {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>ACCEPTANCE</Text>
          {task.acceptanceCriteria.slice(0, 8).map((criterion, index) => (
            <Text key={index} color={COLOR.text} wrap="truncate">
              <Text color={COLOR.accent}>• </Text>
              {clamp(criterion, Math.max(20, width - 4))}
            </Text>
          ))}
        </Box>
      ) : null}
      {body.actions.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>ACTIONS</Text>
          {body.actions.map((action, index) => (
            <Text key={action.id} color={index === selectedActionIndex ? COLOR.accent : COLOR.muted}>
              {`${index === selectedActionIndex ? "▸ " : "  "}${action.label}  (${action.displayCommand})`}
            </Text>
          ))}
        </Box>
      ) : null}
      <ReconciliationStatus work={task} width={width} />
    </Pane>
  );
}

function ReconciliationStatus({ work, width }: { readonly work: WorkItemView; readonly width: number }) {
  const status = reconciliationStatusForWork(work);
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={COLOR.faint}>RECONCILIATION · {status.overall.replaceAll("_", " ")}</Text>
      {status.steps.map((step) => (
        <Text key={step.id} wrap="truncate">
          <Text color={step.status === "blocked" ? COLOR.danger : step.status === "pending" ? COLOR.warn : step.status === "complete" ? COLOR.accent : COLOR.faint}>
            {step.status === "complete" ? "✓" : step.status === "blocked" ? "!" : step.status === "pending" ? "·" : "—"}
          </Text>
          <Text color={COLOR.text}>{` ${step.label}: `}</Text>
          <Text color={COLOR.muted}>{clamp(step.detail, Math.max(20, width - 18))}</Text>
        </Text>
      ))}
    </Box>
  );
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
