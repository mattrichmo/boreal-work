import { Box, Text } from "ink";

import type { GlobalWorkQueueItem, GlobalWorkQueuesView, TuiFilterState } from "@boreal/ui-model";
import { globalRouteState, globalStatusLabels, type GlobalRouteState } from "./global-overview.js";
import { COLOR, fit, statusColor } from "../theme.js";
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

export function fullQueueStatusLabel(status: string): string {
  return {
    in_progress: "in progress",
    needs_verification: "needs verification",
    reserved: "reserved",
    verified: "verified",
    cancelled: "cancelled"
  }[status] ?? status.replaceAll("_", " ");
}

function queueContext(item: GlobalWorkQueueItem): string {
  const work = item.work;
  if (work.activeBlockerIds.length > 0) return `${work.activeBlockerIds.length} blocker${work.activeBlockerIds.length === 1 ? "" : "s"}`;
  if (work.status === "ready") return item.claimCommand ? "claimable" : "ready to claim";
  if (work.status === "needs_verification") return "verification required";
  if (work.activeReservation) return `reserved · ${work.activeReservation.agentId}`;
  return "open task";
}

function queueColumnWidths(width: number): { readonly compact: boolean; readonly widths: readonly number[] } {
  const total = Math.max(1, width - 2);
  const compact = width < 76;
  if (compact) {
    const fixed = 8 + 5 + 10 + 6;
    return { compact, widths: [8, 5, 10, Math.max(1, total - fixed), 6] };
  }
  const fixed = 13 + 6 + 18 + 8;
  return { compact, widths: [13, 6, 18, Math.max(1, total - fixed), 8] };
}

export function GlobalQueuesRoute({
  body,
  cursor,
  height,
  width,
  filters,
  state
}: {
  readonly body: GlobalWorkQueuesView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
  readonly state?: GlobalRouteState;
}) {
  const items = filteredQueueItems(body, filters);
  const embedded = globalRouteState(body, state);
  const sampled = body.queues.some((queue) => queue.truncated === true || (queue.totalCount ?? queue.count) > queue.items.length);
  const derivedState = { ...embedded, sampled: embedded.sampled ?? sampled };
  const layout = queueColumnWidths(width);
  const [statusWidth, actionWidth, projectWidth, workWidth, priorityWidth] = layout.widths;
  const columns: readonly TableColumn[] = [
    { header: "status", width: statusWidth ?? 1 },
    { header: "action", width: actionWidth ?? 1 },
    { header: "project", width: projectWidth ?? 1 },
    { header: "work · context", width: workWidth ?? 1 },
    { header: "priority", width: priorityWidth ?? 1 }
  ];
  const rows: readonly TableRow[] = items.map((item) => ({
    key: item.id,
    cells: [
      { text: fullQueueStatusLabel(item.work.status), color: statusColor(item.work.status) },
      { text: "open", color: COLOR.accent },
      { text: fit(item.projectName, projectWidth ?? 1), color: COLOR.muted },
      { text: fit(`${item.work.title} · ${queueContext(item)}`, workWidth ?? 1), color: COLOR.text },
      { text: item.work.priority, color: COLOR.faint }
    ]
  }));
  const labels = globalStatusLabels(derivedState);
  const selectedQueueId = queueFilterValue(filters);
  const selectedQueues = body.queues.filter((queue) => !selectedQueueId || queue.id === selectedQueueId);
  const visibleCount = items.length;
  const totalCount = selectedQueues.reduce((total, queue) => total + (queue.totalCount ?? queue.count), 0);
  const selectedItem = items[cursor];
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint} wrap="truncate">
        {`QUEUES · showing ${visibleCount}/${totalCount} · ENTER opens task detail`}
      </Text>
      <Text wrap="truncate">
        {`READY ${body.summary.ready}  ·  BLOCKED ${body.summary.blocked}  ·  NEEDS VERIFICATION ${body.summary.needsVerification}`}
      </Text>
      {labels.length > 0 ? <Text color={derivedState.stale ? COLOR.warn : COLOR.faint}>{`DATA STATE · ${labels.join(" · ")}`}</Text> : null}
      {derivedState.warnings?.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{`⚠ ${warning}`}</Text>)}
      <Table columns={columns} rows={rows} cursor={cursor} height={Math.max(1, height - (labels.length > 0 ? 7 : 6))} width={width} emptyLabel="No actionable work across linked projects." />
      {selectedItem ? <Text color={COLOR.muted} wrap="truncate">{fit(`TARGET · ${selectedItem.projectRoot} · ${selectedItem.claimCommand ? "claim available" : "open task detail"}`, Math.max(1, width - 2))}</Text> : null}
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
