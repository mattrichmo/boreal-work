import { Box, Text } from "ink";

import type { WorkItemView } from "@boreal/ui-model";
import type { RepoSprintBoardBody } from "../loaders.js";
import { reconciliationStatusForWork } from "../reconciliation.js";
import { COLOR, statusColor, statusLabel } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

function boardTasks(body: RepoSprintBoardBody): readonly WorkItemView[] {
  return body.board?.lanes.flatMap((lane) => lane.items) ?? [];
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
  const nameWidth = Math.max(20, width - 8 - 10 - 12);
  const columns: readonly TableColumn[] = [
    { header: "status", width: 8 },
    { header: "task", width: nameWidth },
    { header: "priority", width: 10 },
    { header: "reserved", width: 12 }
  ];
  const rows: readonly TableRow[] = tasks.map((task) => ({
    key: task.id,
    cells: [
      { text: statusLabel(task.status), color: statusColor(task.status) },
      { text: task.title, color: COLOR.text },
      { text: task.priority, color: COLOR.muted },
      { text: task.activeReservation ? task.activeReservation.agentId : "—", color: COLOR.faint }
    ]
  }));
  const activeLanes = body.board?.lanes.filter((lane) => lane.count > 0) ?? [];
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={COLOR.text} bold>
          {body.board?.sprint.title ?? "Sprint"}
        </Text>
        <Text color={COLOR.faint}>{`  ·  ${body.board?.summary.taskCount ?? 0} tasks  ·  ${body.board?.summary.activeBlockerCount ?? 0} blockers`}</Text>
      </Text>
      <Box marginBottom={1}>
        {activeLanes.length === 0 ? (
          <Text color={COLOR.muted}>no work yet</Text>
        ) : (
          activeLanes.map((lane, index) => (
            <Text key={lane.id} color={statusColor(lane.id)}>
              {`${index > 0 ? "  " : ""}${statusLabel(lane.id)} ${lane.count}`}
            </Text>
          ))
        )}
      </Box>
      {body.board?.sprint ? <SprintReconciliationStatus work={body.board.sprint} /> : null}
      <Table columns={columns} rows={rows} cursor={cursor} height={height - 5} emptyLabel="No work in this sprint yet." />
    </Box>
  );
}

function SprintReconciliationStatus({ work }: { readonly work: WorkItemView }) {
  const status = reconciliationStatusForWork(work);
  const pending = status.steps.filter((step) => step.status === "pending" || step.status === "blocked").length;
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text color={pending > 0 ? COLOR.warn : COLOR.accent}>
        {`RECONCILIATION · ${status.overall.replaceAll("_", " ")} · ${pending} follow-up step${pending === 1 ? "" : "s"}`}
      </Text>
      <Text color={COLOR.muted} wrap="truncate">
        {status.steps.map((step) => `${step.label}: ${step.status.replaceAll("_", " ")}`).join("  ·  ")}
      </Text>
    </Box>
  );
}
