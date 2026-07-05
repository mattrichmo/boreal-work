import { Box, Text } from "ink";

import type { GlobalWorkQueueItem, GlobalWorkQueuesView, TuiFilterState } from "@boreal/ui-model";
import { COLOR, statusColor } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

function queueFilterValue(filters: TuiFilterState | undefined): string | undefined {
  return filters?.clauses.find((clause) => clause.field === "queue" && clause.operator === "is")?.value;
}

export function queueFilterLabel(filters: TuiFilterState | undefined): string | undefined {
  const value = queueFilterValue(filters);
  return value ? `queue: ${value}` : undefined;
}

/** The exact filtered/flattened row list the table renders -- shared with
 * the shell's cursor-length and drill-target lookups so they never drift. */
export function filteredQueueItems(body: GlobalWorkQueuesView, filters?: TuiFilterState): readonly GlobalWorkQueueItem[] {
  const queueId = queueFilterValue(filters);
  return body.queues.filter((queue) => !queueId || queue.id === queueId).flatMap((queue) => queue.items);
}

export function GlobalQueuesRoute({
  body,
  cursor,
  height,
  width,
  filters
}: {
  readonly body: GlobalWorkQueuesView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
}) {
  const items = filteredQueueItems(body, filters);
  const nameWidth = Math.max(16, width - 8 - Math.floor(width * 0.22) - 8);
  const columns: readonly TableColumn[] = [
    { header: "queue", width: 8 },
    { header: "project", width: Math.floor(width * 0.22) },
    { header: "title", width: nameWidth },
    { header: "prio", width: 8 }
  ];
  const rows: readonly TableRow[] = items.map((item) => ({
    key: item.id,
    cells: [
      { text: item.work.status, color: statusColor(item.work.status) },
      { text: item.projectName, color: COLOR.muted },
      { text: item.work.title, color: COLOR.text },
      { text: item.work.priority, color: COLOR.faint }
    ]
  }));
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint}>
        {`READY ${body.summary.ready}  ·  BLOCKED ${body.summary.blocked}  ·  VERIFY ${body.summary.needsVerification}`}
      </Text>
      <Table columns={columns} rows={rows} cursor={cursor} height={height - 2} emptyLabel="No actionable work across linked projects." />
    </Box>
  );
}

/** Row lookup helper for the shell's drill dispatch, mirroring the filtered
 * list the table renders (same rationale as rollup.ts#rollupRowAt). */
export function queueRowAt(body: GlobalWorkQueuesView, index: number, filters?: TuiFilterState): GlobalWorkQueueItem | undefined {
  return filteredQueueItems(body, filters)[index];
}

export const QUEUE_FILTER_CYCLE: readonly (TuiFilterState | undefined)[] = [
  undefined,
  { clauses: [{ field: "queue", operator: "is", value: "ready" }], sort: [] },
  { clauses: [{ field: "queue", operator: "is", value: "blocked" }], sort: [] },
  { clauses: [{ field: "queue", operator: "is", value: "needs_verification" }], sort: [] }
];
