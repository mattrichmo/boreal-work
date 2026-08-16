import { Box, Text } from "ink";

import type { RepoRollupView, RollupNodeView, TuiFilterState } from "@boreal/ui-model";
import { COLOR, fit, statusColor } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

export type RollupDisclosureState = ReadonlySet<string>;

function passesStatusFilter(node: RollupNodeView, filters: TuiFilterState | undefined): boolean {
  if (!filters || node.childIds.length > 0) return true; // containers always show; only leaves are hidden
  if (node.workStatus === "closed" || node.workStatus === "verified") return filters.showClosed !== false;
  if (node.workStatus === "cancelled") return filters.showCancelled !== false;
  return true;
}

/** Depth-first, expanded-by-default flattening for the tree table, with the
 * v1 status facet (`f` cycles `showClosed`/`showCancelled`) applied as a
 * leaf-level filter -- containers (project/milestone/sprint) always stay
 * visible so the hierarchy doesn't collapse out from under a hidden leaf. */
export function visibleRollupRows(
  body: RepoRollupView,
  filters?: TuiFilterState,
  expandedIds?: RollupDisclosureState
): readonly RollupNodeView[] {
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  return visibleRows(body.root, byId, filters, expandedIds);
}

function visibleRows(
  root: RollupNodeView,
  byId: ReadonlyMap<string, RollupNodeView>,
  filters: TuiFilterState | undefined,
  expandedIds: RollupDisclosureState | undefined
): readonly RollupNodeView[] {
  const rows: RollupNodeView[] = [];
  const seen = new Set<string>();
  const visit = (node: RollupNodeView): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (!passesStatusFilter(node, filters)) return;
    rows.push(node);
    if (!isRollupNodeExpanded(node, expandedIds) && node.depth > 0) return;
    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (child) visit(child);
    }
  };
  for (const childId of root.childIds) {
    const child = byId.get(childId);
    if (child) visit(child);
  }
  return rows;
}

export function defaultRollupDisclosure(body: RepoRollupView): RollupDisclosureState {
  return new Set(body.flatRows.filter((node) => node.expandedByDefault).map((node) => node.id));
}

export function toggleRollupDisclosure(expandedIds: RollupDisclosureState, nodeId: string): RollupDisclosureState {
  const next = new Set(expandedIds);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return next;
}

export function isRollupNodeExpanded(node: RollupNodeView, expandedIds?: RollupDisclosureState): boolean {
  return expandedIds ? expandedIds.has(node.id) : node.expandedByDefault;
}

export function hiddenRollupDescendantCount(
  node: RollupNodeView,
  byId: ReadonlyMap<string, RollupNodeView>,
  expandedIds?: RollupDisclosureState
): number {
  if (node.childIds.length === 0 || isRollupNodeExpanded(node, expandedIds)) return 0;
  const seen = new Set<string>();
  const count = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const child = byId.get(id);
    return child ? 1 + child.childIds.reduce((total, childId) => total + count(childId), 0) : 0;
  };
  return node.childIds.reduce((total, childId) => total + count(childId), 0);
}

export function rollupNodeCanOpen(node: RollupNodeView): boolean {
  return node.kind === "sprint" || node.kind === "task" || node.kind === "issue" || (node.kind === "milestone" && node.childIds.length === 0);
}

export function fullRollupStatusLabel(status: string | undefined): string {
  if (!status) return "—";
  return {
    in_progress: "in progress",
    needs_verification: "needs verification",
    reserved: "reserved",
    verified: "verified",
    cancelled: "cancelled"
  }[status] ?? status.replaceAll("_", " ");
}

function rollupColumnWidths(width: number): readonly [number, number, number, number, number, number] {
  const total = Math.max(1, width - 2); // Table reserves two cells for its cursor marker.
  let titleWidth = Math.max(10, Math.floor(total * 0.42));
  const minimums = [4, 6, 4, 4, 3] as const;
  const minimumFixed = minimums.reduce((sum, value) => sum + value, 0);
  if (total - titleWidth < minimumFixed) titleWidth = Math.max(1, total - minimumFixed);
  const fixedTotal = Math.max(minimumFixed, total - titleWidth);
  const extra = fixedTotal - minimumFixed;
  const weights = [0.2, 0.27, 0.18, 0.2, 0.15] as const;
  const fixed = minimums.map((minimum, index) => minimum + Math.floor(extra * (weights[index] ?? 0))) as number[];
  let remainder = fixedTotal - fixed.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % fixed.length) {
    fixed[index] = (fixed[index] ?? 0) + 1;
    remainder -= 1;
  }
  return [fixed[0] ?? 1, fixed[1] ?? 1, fixed[2] ?? 1, fixed[3] ?? 1, fixed[4] ?? 1, titleWidth];
}

export function rollupFilterLabel(filters: TuiFilterState | undefined): string | undefined {
  if (!filters) return undefined;
  if (filters.showClosed === false && filters.showCancelled === false) return "open only";
  if (filters.showClosed === false) return "hide closed";
  if (filters.showCancelled === false) return "hide cancelled";
  return undefined;
}

export function RepoRollupRoute({
  body,
  cursor,
  height,
  width,
  filters,
  expandedIds
}: {
  readonly body: RepoRollupView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
  /** Route-local disclosure state owned by the shell. */
  readonly expandedIds?: RollupDisclosureState;
}) {
  const rows = visibleRollupRows(body, filters, expandedIds);
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  const [kindWidth, statusWidth, actionWidth, doneWidth, blockerWidth, nameWidth] = rollupColumnWidths(width);
  const columns: readonly TableColumn[] = [
    { header: "kind", width: kindWidth },
    { header: "status", width: statusWidth },
    { header: "open", width: actionWidth },
    { header: "done", width: doneWidth, align: "right" },
    { header: "blk", width: blockerWidth, align: "right" },
    { header: "title", width: nameWidth }
  ];
  const tableRows: readonly TableRow[] = rows.map((node): TableRow => {
    const indent = "  ".repeat(node.depth - 1);
    const hiddenDescendants = hiddenRollupDescendantCount(node, byId, expandedIds);
    const disclosure = node.childIds.length === 0 ? "  " : isRollupNodeExpanded(node, expandedIds) ? "▾ " : "▸ ";
    const context = hiddenDescendants > 0 ? ` · ${hiddenDescendants} hidden` : "";
    return {
      key: node.id,
      cells: [
        { text: node.kind, color: COLOR.muted },
        { text: fullRollupStatusLabel(node.workStatus), color: node.workStatus ? statusColor(node.workStatus) : COLOR.faint },
        { text: node.kind === "milestone" && node.childIds.length > 0 ? "expand" : rollupNodeCanOpen(node) ? "open" : "view only", color: rollupNodeCanOpen(node) || node.kind === "milestone" ? COLOR.accent : COLOR.faint },
        { text: `${node.progress.done}/${node.progress.total}`, color: COLOR.muted },
        { text: String(node.blockerSummary.activeBlockerCount), color: node.blockerSummary.activeBlockerCount > 0 ? COLOR.warn : COLOR.faint },
        { text: fit(`${disclosure}${indent}${node.title}${context}`, nameWidth), color: COLOR.text }
      ]
    };
  });
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint} wrap="truncate">
        {`ROLL-UP · ${body.summary.milestones} milestones · ${body.summary.sprints} sprints · ${body.summary.tasks} tasks · ${body.summary.blocked} blocked · ${body.summary.cancelled} cancelled`}
      </Text>
      <Text color={COLOR.muted} wrap="truncate">
        {"ENTER open/expand  ·  view only rows are not drillable  ·  ▸ means descendants are hidden"}
      </Text>
      <Table columns={columns} rows={tableRows} cursor={cursor} height={Math.max(1, height - 5)} width={width} emptyLabel="No work in this repo yet." />
    </Box>
  );
}

/** Row lookup helper for the shell's drill/action dispatch. Uses the same
 * `visibleRollupRows` list the table renders, so the cursor length the shell
 * computes and the rows actually on screen never drift apart. */
export function rollupRowAt(
  body: RepoRollupView,
  index: number,
  filters?: TuiFilterState,
  expandedIds?: RollupDisclosureState
): RollupNodeView | undefined {
  return visibleRollupRows(body, filters, expandedIds)[index];
}

export const ROLLUP_FILTER_CYCLE: readonly (TuiFilterState | undefined)[] = [
  undefined,
  { clauses: [], sort: [], showClosed: false },
  { clauses: [], sort: [], showClosed: false, showCancelled: false }
];
