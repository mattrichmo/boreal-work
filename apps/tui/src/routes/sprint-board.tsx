import { Box, Text } from "ink";

import type { WorkItemView } from "@boreal/ui-model";
import type { RepoSprintBoardBody } from "../loaders.js";
import { reconciliationStatusForWork } from "../reconciliation.js";
import { COLOR, fit, statusColor } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

function boardTasks(body: RepoSprintBoardBody): readonly WorkItemView[] {
  return body.board?.lanes.flatMap((lane) => lane.items) ?? [];
}

export function fullSprintStatusLabel(status: string): string {
  return {
    in_progress: "in progress",
    needs_verification: "needs verification",
    reserved: "reserved",
    verified: "verified",
    cancelled: "cancelled"
  }[status] ?? status.replaceAll("_", " ");
}

export function sprintSelectionRows(body: RepoSprintBoardBody, maxRows = 5): readonly RepoSprintBoardBody["sprints"][number][] {
  if (body.sprints.length <= maxRows) return body.sprints;
  const selectedIndex = Math.max(0, body.sprints.findIndex((sprint) => sprint.view.id === body.selectedSprintId));
  const half = Math.floor(maxRows / 2);
  const start = Math.max(0, Math.min(selectedIndex - half, body.sprints.length - maxRows));
  return body.sprints.slice(start, start + maxRows);
}

function reservationContext(task: WorkItemView): string {
  if (!task.activeReservation && !task.activeReservationId) return "claimable";
  if (!task.activeReservation) return "reserved · details unavailable";
  if (task.activeReservation.expired) return "reservation expired";
  return `reserved · ${task.activeReservation.agentId}`;
}

function taskContext(task: WorkItemView): string {
  if (task.activeBlockerIds.length > 0) return `${task.activeBlockerIds.length} blocker${task.activeBlockerIds.length === 1 ? "" : "s"}`;
  if (task.status === "needs_verification") return "needs verification";
  return reservationContext(task);
}

function sprintColumnWidths(width: number): readonly [number, number, number, number, number] {
  const total = Math.max(1, width - 2);
  let taskWidth = Math.max(10, Math.floor(total * 0.4));
  const minimums = [6, 4, 8, 4] as const;
  const minimumFixed = minimums.reduce((sum, value) => sum + value, 0);
  if (total - taskWidth < minimumFixed) taskWidth = Math.max(1, total - minimumFixed);
  const fixedTotal = Math.max(minimumFixed, total - taskWidth);
  const extra = fixedTotal - minimumFixed;
  const weights = [0.27, 0.18, 0.37, 0.18] as const;
  const fixed = minimums.map((minimum, index) => minimum + Math.floor(extra * (weights[index] ?? 0))) as number[];
  let remainder = fixedTotal - fixed.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % fixed.length) {
    fixed[index] = (fixed[index] ?? 0) + 1;
    remainder -= 1;
  }
  return [fixed[0] ?? 1, taskWidth, fixed[1] ?? 1, fixed[2] ?? 1, fixed[3] ?? 1];
}

export function SprintBoardRoute({
  body,
  cursor,
  height,
  width
}: {
  readonly body: RepoSprintBoardBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  if (body.sprints.length === 0) {
    return <Text color={COLOR.muted}>No sprints. Create one with `bwrk work create … --kind sprint`.</Text>;
  }
  const tasks = boardTasks(body);
  const [statusWidth, nameWidth, priorityWidth, contextWidth, actionWidth] = sprintColumnWidths(width);
  const columns: readonly TableColumn[] = [
    { header: "status", width: statusWidth },
    { header: "task", width: nameWidth },
    { header: "priority", width: priorityWidth },
    { header: "context", width: contextWidth },
    { header: "open", width: actionWidth }
  ];
  const rows: readonly TableRow[] = tasks.map((task) => ({
    key: task.id,
    cells: [
      { text: fullSprintStatusLabel(task.status), color: statusColor(task.status) },
      { text: fit(task.title, nameWidth), color: COLOR.text },
      { text: task.priority, color: COLOR.muted },
      { text: fit(taskContext(task), contextWidth), color: task.activeBlockerIds.length > 0 ? COLOR.warn : COLOR.muted },
      { text: "open", color: COLOR.accent }
    ]
  }));
  const activeLanes = body.board?.lanes.filter((lane) => lane.count > 0) ?? [];
  const selectedSprintIndex = body.sprints.findIndex((sprint) => sprint.view.id === body.selectedSprintId);
  const visibleSprints = sprintSelectionRows(body);
  const selectedLabel = selectedSprintIndex >= 0 ? `${selectedSprintIndex + 1}/${body.sprints.length}` : "none selected";
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLOR.faint} wrap="truncate">
          {`SPRINT SELECTOR · ${selectedLabel} · selected sprint is highlighted`}
        </Text>
        {visibleSprints.map((sprint) => (
          <Text key={sprint.view.id} color={sprint.view.id === body.selectedSprintId ? COLOR.accent : COLOR.muted} wrap="truncate">
            {`${sprint.view.id === body.selectedSprintId ? "▸" : " "} ${sprint.active ? "active" : "available"}  ${sprint.view.title}  (${sprint.scopeCount} items)`}
          </Text>
        ))}
        {visibleSprints.length < body.sprints.length ? <Text color={COLOR.faint}>… more sprints available</Text> : null}
        <Text color={COLOR.faint}>[ / ] changes the selected sprint</Text>
      </Box>
      <Text wrap="truncate">
        <Text color={COLOR.text} bold>
          {body.board?.sprint.title ?? "No sprint selected"}
        </Text>
        <Text color={COLOR.faint}>{`  ·  ${body.board?.summary.taskCount ?? 0} tasks  ·  ${body.board?.summary.activeBlockerCount ?? 0} blockers  ·  Enter opens a task`}</Text>
      </Text>
      <Box marginBottom={1}>
        {activeLanes.length === 0 ? (
          <Text color={COLOR.muted}>no work yet</Text>
        ) : (
          activeLanes.map((lane, index) => (
            <Text key={lane.id} color={statusColor(lane.id)}>
              {`${index > 0 ? "  " : ""}${fullSprintStatusLabel(lane.id)} ${lane.count}`}
            </Text>
          ))
        )}
      </Box>
      {body.board?.sprint ? <SprintReconciliationStatus work={body.board.sprint} /> : null}
      <Table columns={columns} rows={rows} cursor={cursor} height={Math.max(1, height - 13)} width={width} emptyLabel="No work in this sprint yet." />
    </Box>
  );
}

function SprintReconciliationStatus({ work }: { readonly work: WorkItemView }) {
  const status = reconciliationStatusForWork(work);
  const pending = status.steps.filter((step) => step.status === "pending" || step.status === "blocked").length;
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text color={pending > 0 ? COLOR.warn : COLOR.accent}>
        {`RECONCILIATION · ${fullSprintStatusLabel(status.overall)} · ${pending} follow-up step${pending === 1 ? "" : "s"}`}
      </Text>
      <Text color={COLOR.muted} wrap="truncate">
        {status.steps.map((step) => `${step.label}: ${fullSprintStatusLabel(step.status)}`).join("  ·  ")}
      </Text>
    </Box>
  );
}
