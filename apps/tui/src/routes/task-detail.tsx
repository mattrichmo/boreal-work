import { Box, Text } from "ink";
import type { TuiCommandDescriptor, WorkItemView } from "@boreal/ui-model";

import type { RepoTaskDetailBody } from "../loaders.js";
import { reconciliationStatusForWork, type TuiReconciliationStep } from "../reconciliation.js";
import { cellWidth, COLOR, fit, graphemeClusters, statusColor } from "../theme.js";
import { Field, Pane, windowList } from "../ui.js";

export function fullTaskStatusLabel(status: string): string {
  return {
    in_progress: "in progress",
    needs_verification: "needs verification",
    reserved: "reserved",
    verified: "verified",
    cancelled: "cancelled"
  }[status] ?? status.replaceAll("_", " ");
}

export interface ReservationDisplay {
  readonly label: string;
  readonly color: string;
}

export function reservationDisplay(task: WorkItemView): ReservationDisplay {
  if (!task.activeReservation && !task.activeReservationId) return { label: "unreserved", color: COLOR.muted };
  if (!task.activeReservation) {
    return { label: "reserved · details unavailable · refresh", color: COLOR.warn };
  }
  if (task.activeReservation.expired) {
    return { label: `expired · ${task.activeReservation.agentId}`, color: COLOR.warn };
  }
  return { label: `active · ${task.activeReservation.agentId}`, color: COLOR.accentSoft };
}

export interface TaskActionDisplay {
  readonly label: string;
  readonly disabled: boolean;
  readonly reason?: string;
}

export function taskActionDisplay(action: TuiCommandDescriptor, task: WorkItemView): TaskActionDisplay {
  if (action.id.startsWith("work.close:") && task.activeReservation?.expired) {
    return {
      label: action.label,
      disabled: true,
      reason: "reservation is expired; repair or release it before finishing"
    };
  }
  if (action.id.startsWith("work.close:") && task.activeReservation) {
    return {
      label: action.label,
      disabled: true,
      reason: "reserved work must finish through the agent evidence flow"
    };
  }
  if (action.id.startsWith("work.close:") && task.activeReservationId) {
    return {
      label: action.label,
      disabled: true,
      reason: "reservation state needs repair before finishing"
    };
  }
  if (action.disabled) return { label: action.label, disabled: true, reason: action.disabledReason ?? "action unavailable" };
  return { label: action.label, disabled: false };
}

export function boundedTextLines(value: string, width: number, maxLines: number): readonly string[] {
  const maxWidth = Math.max(1, width);
  const lineLimit = Math.max(1, maxLines);
  const chunks = value.split(/\r?\n/).flatMap((line) => {
    if (line.length === 0) return [""];
    const parts: string[] = [];
    let part = "";
    for (const character of graphemeClusters(line)) {
      if (part.length > 0 && cellWidth(`${part}${character}`) > maxWidth) {
        parts.push(part);
        part = "";
      }
      part += character;
    }
    if (part.length > 0) parts.push(part);
    return parts;
  });
  if (chunks.length <= lineLimit) return chunks;
  const visible = chunks.slice(0, lineLimit);
  const last = visible.at(-1) ?? "";
  let suffix = "";
  for (const character of Array.from(last)) {
    if (cellWidth(`${suffix}${character}`) > Math.max(0, maxWidth - 1)) break;
    suffix += character;
  }
  visible[visible.length - 1] = `${suffix}…`;
  return visible;
}

function actionLine(action: TuiCommandDescriptor, task: WorkItemView): string {
  const display = taskActionDisplay(action, task);
  if (display.disabled) return `${display.label} · unavailable: ${display.reason ?? "refresh required"}`;
  return `${display.label} · ${action.mutatesState ? "confirmation required" : "read-only"} · ${action.displayCommand}`;
}

function reconciliationColor(status: TuiReconciliationStep["status"]): string {
  if (status === "blocked") return COLOR.danger;
  if (status === "pending") return COLOR.warn;
  if (status === "complete") return COLOR.accent;
  return COLOR.faint;
}

function ReconciliationStatus({
  work,
  width,
  maxLines
}: {
  readonly work: WorkItemView;
  readonly width: number;
  readonly maxLines: number;
}) {
  const status = reconciliationStatusForWork(work);
  const visibleSteps = windowList(status.steps, 0, maxLines);
  const hidden = visibleSteps.above + visibleSteps.below;
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={status.overall === "blocked" ? COLOR.danger : status.overall === "pending" ? COLOR.warn : COLOR.faint}>
        {`RECONCILIATION · ${fullTaskStatusLabel(status.overall)} · ${status.steps.length} steps`}
      </Text>
      {visibleSteps.above > 0 ? <Text color={COLOR.faint}>… earlier steps hidden</Text> : null}
      {visibleSteps.rows.map(({ item: step }) => (
        <Text key={step.id} wrap="truncate">
          <Text color={reconciliationColor(step.status)}>
            {step.status === "complete" ? "✓" : step.status === "blocked" ? "!" : step.status === "pending" ? "·" : "—"}
          </Text>
          <Text color={COLOR.text}>{` ${step.label}: `}</Text>
          <Text color={COLOR.muted}>{fit(`${fullTaskStatusLabel(step.status)} · ${step.detail}`, Math.max(1, width - 18))}</Text>
        </Text>
      ))}
      {hidden > 0 ? <Text color={COLOR.faint}>{`… ${hidden} reconciliation step${hidden === 1 ? "" : "s"} hidden`}</Text> : null}
    </Box>
  );
}

export function TaskDetailRoute({
  body,
  width,
  selectedActionIndex,
  height
}: {
  readonly body: RepoTaskDetailBody;
  readonly width: number;
  readonly selectedActionIndex: number;
  /** Optional until RouteApp passes its measured body height. */
  readonly height?: number;
}) {
  const task = body.work;
  const reservation = reservationDisplay(task);
  const contentWidth = Math.max(12, width - 4);
  const detailBudget = Math.max(10, height ?? 18);
  const sectionCount = Number(Boolean(task.description)) + Number(Boolean(task.acceptanceCriteria?.length)) + Number(body.actions.length > 0) + 1;
  const sectionLines = Math.max(1, Math.floor(Math.max(4, detailBudget - 8) / sectionCount));
  const descriptionLines = task.description ? boundedTextLines(task.description, contentWidth, sectionLines) : [];
  const criteria = task.acceptanceCriteria ?? [];
  const actionWindow = windowList(body.actions, selectedActionIndex, Math.max(1, sectionLines));
  const actionHidden = actionWindow.above + actionWindow.below;
  const enabledActionCount = body.actions.filter((action) => !taskActionDisplay(action, task).disabled).length;
  const directiveSummary = task.directiveSummary;
  return (
    <Pane title={task.title} tone={statusColor(task.status)} width={width}>
      <Text>
        <Text color={statusColor(task.status)} bold>
          {fullTaskStatusLabel(task.status)}
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
          value={task.activeBlockerIds.length > 0 ? `${task.activeBlockerIds.length} · ${task.activeBlockerIds.join(", ")}` : "none"}
          color={task.activeBlockerIds.length > 0 ? COLOR.warn : undefined}
        />
        <Field label="reservation" value={reservation.label} color={reservation.color} />
        <Field label="evidence" value={`${task.evidenceCount} · verifications ${task.verificationCount}`} />
        <Field label="depends on" value={body.dependencyTitles.length > 0 ? body.dependencyTitles.join(", ") : "none"} color={COLOR.muted} />
        {body.blockerTitles && body.blockerTitles.length > 0 ? <Field label="blocked by" value={body.blockerTitles.join(", ")} color={COLOR.warn} /> : null}
        {directiveSummary ? (
          <Field
            label="directives"
            value={`${directiveSummary.blocking} blocking · ${directiveSummary.required} required · ${directiveSummary.conflictCount} conflicts`}
            color={directiveSummary.blocking > 0 || directiveSummary.conflictCount > 0 ? COLOR.warn : COLOR.muted}
          />
        ) : null}
        {task.closedReason ? <Field label="closed reason" value={task.closedReason} color={COLOR.muted} /> : null}
      </Box>
      {task.description ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>{`DESCRIPTION · ${descriptionLines.length}${descriptionLines.length === sectionLines ? "+" : ""} lines`}</Text>
          {descriptionLines.map((line, index) => <Text key={index} color={COLOR.text}>{line}</Text>)}
        </Box>
      ) : null}
      {criteria.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>{`ACCEPTANCE · ${criteria.length} criteria`}</Text>
          {criteria.slice(0, sectionLines).map((criterion, index) => (
            <Text key={index} color={COLOR.text} wrap="truncate">
              <Text color={COLOR.accent}>• </Text>
              {fit(criterion, contentWidth)}
            </Text>
          ))}
          {criteria.length > sectionLines ? <Text color={COLOR.faint}>{`… ${criteria.length - sectionLines} criteria hidden`}</Text> : null}
        </Box>
      ) : null}
      {body.actions.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>{`ACTIONS · ${enabledActionCount} enabled · ${body.actions.length - enabledActionCount} unavailable`}</Text>
          {actionWindow.above > 0 ? <Text color={COLOR.faint}>… earlier actions hidden</Text> : null}
          {actionWindow.rows.map(({ item: action, index }) => {
            const display = taskActionDisplay(action, task);
            return (
              <Text key={action.id} color={display.disabled ? COLOR.faint : index === selectedActionIndex ? COLOR.accent : COLOR.muted} wrap="truncate">
                {`${index === selectedActionIndex ? "▸ " : "  "}${fit(actionLine(action, task), contentWidth)}`}
              </Text>
            );
          })}
          {actionHidden > 0 ? <Text color={COLOR.faint}>{`… ${actionHidden} action${actionHidden === 1 ? "" : "s"} hidden; move to inspect`}</Text> : null}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={COLOR.muted}>ACTIONS · none available in this route state.</Text>
        </Box>
      )}
      <ReconciliationStatus work={task} width={contentWidth} maxLines={sectionLines} />
    </Pane>
  );
}
