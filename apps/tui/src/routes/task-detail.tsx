import { Box, Text } from "ink";
import type { TuiCommandDescriptor, WorkItemView } from "@boreal/ui-model";

import type { RepoTaskDetailBody } from "../loaders.js";
import { reconciliationStatusForWork } from "../reconciliation.js";
import { cellWidth, COLOR, fit, graphemeClusters, statusColor } from "../theme.js";
import { Pane } from "../ui.js";

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

export function buildTaskDetailLines(body: RepoTaskDetailBody, width: number): readonly string[] {
  const task = body.work;
  const contentWidth = Math.max(1, Math.floor(width) - 4);
  const reservation = reservationDisplay(task);
  const lines = [
    `id          ${task.id}`,
    `labels      ${task.labels.length > 0 ? task.labels.join(", ") : "none"}`,
    `blockers    ${task.activeBlockerIds.length > 0 ? task.activeBlockerIds.join(", ") : "none"}`,
    `reservation ${reservation.label}`,
    `evidence    ${task.evidenceCount} · verifications ${task.verificationCount}`,
    `depends on  ${body.dependencyTitles.length > 0 ? body.dependencyTitles.join(", ") : "none"}`
  ];
  if (body.blockerTitles?.length) lines.push(`blocked by  ${body.blockerTitles.join(", ")}`);
  if (task.directiveSummary) lines.push(`directives   ${task.directiveSummary.blocking} blocking · ${task.directiveSummary.required} required · ${task.directiveSummary.conflictCount} conflicts`);
  if (task.closedReason) lines.push(`closed      ${task.closedReason}`);
  if (task.description) lines.push("", "DESCRIPTION", ...boundedTextLines(task.description, contentWidth, 10_000));
  if (task.acceptanceCriteria?.length) lines.push("", `ACCEPTANCE · ${task.acceptanceCriteria.length} criteria`, ...task.acceptanceCriteria.flatMap((criterion) => boundedTextLines(`• ${criterion}`, contentWidth, 10_000)));
  const reconciliation = reconciliationStatusForWork(task);
  lines.push("", `RECONCILIATION · ${fullTaskStatusLabel(reconciliation.overall)}`);
  lines.push(...reconciliation.steps.map((step) => `${step.status === "complete" ? "✓" : step.status === "blocked" ? "!" : "·"} ${step.label}: ${fullTaskStatusLabel(step.status)} · ${step.detail}`));
  // Wrap every logical line, including metadata and graph details. A long ID,
  // dependency title, or reconciliation detail must be reachable through the
  // same viewport offset as the prose sections.
  return lines.flatMap((line) => boundedTextLines(line, contentWidth, 10_000)).map((line) => fit(line, contentWidth));
}

export function taskDetailMaxScroll(body: RepoTaskDetailBody, width: number, height: number): number {
  const inner = Math.max(1, Math.floor(height) - 5);
  const actionLines = body.actions.length > 0 ? 2 : 0;
  return Math.max(0, buildTaskDetailLines(body, width).length - Math.max(1, inner - actionLines));
}

export function TaskDetailRoute({ body, width, selectedActionIndex, height, scrollOffset = 0 }: {
  readonly body: RepoTaskDetailBody;
  readonly width: number;
  readonly selectedActionIndex: number;
  readonly height?: number;
  readonly scrollOffset?: number;
}) {
  const task = body.work;
  const outerHeight = Math.max(1, Math.floor(height ?? 24));
  const contentWidth = Math.max(1, width - 4);
  const inner = Math.max(1, outerHeight - 5);
  const actionLines = body.actions.length > 0 ? 2 : 0;
  const viewport = Math.max(1, inner - actionLines);
  const lines = buildTaskDetailLines(body, width);
  const offset = Math.max(0, Math.min(Math.floor(scrollOffset), Math.max(0, lines.length - viewport)));
  const visible = lines.slice(offset, offset + viewport);
  const enabled = body.actions.filter((action) => !taskActionDisplay(action, task).disabled).length;
  const selected = body.actions[Math.max(0, Math.min(selectedActionIndex, body.actions.length - 1))];
  const maxScroll = Math.max(0, lines.length - viewport);
  return <Pane title={task.title} tone={statusColor(task.status)} width={width} height={height}>
    <Text color={statusColor(task.status)} wrap="truncate">{fit(`${fullTaskStatusLabel(task.status)} · ${task.kind} · ${task.priority} · ${offset}/${maxScroll}`, contentWidth)}</Text>
    <Box flexDirection="column" height={viewport}>
      {visible.map((line, index) => <Text key={index} color={COLOR.text} wrap="truncate">{fit(line, contentWidth)}</Text>)}
    </Box>
    <Box flexDirection="column" height={actionLines}>
      {body.actions.length > 0 ? <Text color={COLOR.faint} wrap="truncate">{fit(`ACTIONS · ${enabled} enabled · ${body.actions.length - enabled} unavailable`, contentWidth)}</Text> : null}
      {selected ? <Text color={taskActionDisplay(selected, task).disabled ? COLOR.faint : COLOR.accent} wrap="truncate">{fit(`▸ ${actionLine(selected, task)}`, contentWidth)}</Text> : null}
    </Box>
  </Pane>;
}
