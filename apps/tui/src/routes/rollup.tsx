import { Box, Text } from "ink";

import type { RepoRollupView, RollupNodeView, TuiFilterState } from "@boreal/ui-model";
import { COLOR, fit, statusColor, statusLabel } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

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
export function visibleRollupRows(body: RepoRollupView, filters?: TuiFilterState): readonly RollupNodeView[] {
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  return visibleRows(body.root, byId, filters);
}

function visibleRows(root: RollupNodeView, byId: ReadonlyMap<string, RollupNodeView>, filters: TuiFilterState | undefined): readonly RollupNodeView[] {
  const rows: RollupNodeView[] = [];
  const visit = (node: RollupNodeView): void => {
    if (!passesStatusFilter(node, filters)) return;
    rows.push(node);
    if (!node.expandedByDefault && node.depth > 0) return;
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
  filters
}: {
  readonly body: RepoRollupView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
}) {
  const rows = visibleRollupRows(body, filters);
  const nameWidth = Math.max(20, width - 9 - 8 - 10 - 8);
  const columns: readonly TableColumn[] = [
    { header: "kind", width: 9 },
    { header: "status", width: 8 },
    { header: "title", width: nameWidth },
    { header: "done", width: 10, align: "right" },
    { header: "blk", width: 4, align: "right" }
  ];
  const tableRows: readonly TableRow[] = rows.map((node): TableRow => {
    const indent = "  ".repeat(node.depth - 1);
    return {
      key: node.id,
      cells: [
        { text: node.kind, color: COLOR.muted },
        { text: node.workStatus ? statusLabel(node.workStatus) : "-", color: node.workStatus ? statusColor(node.workStatus) : COLOR.faint },
        { text: fit(`${indent}${node.title}`, nameWidth), color: COLOR.text },
        { text: `${node.progress.done}/${node.progress.total}`, color: COLOR.muted },
        { text: String(node.blockerSummary.activeBlockerCount), color: node.blockerSummary.activeBlockerCount > 0 ? COLOR.warn : COLOR.faint }
      ]
    };
  });
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint} wrap="truncate">
        {`ROLL-UP · ${body.summary.milestones} milestones · ${body.summary.sprints} sprints · ${body.summary.tasks} tasks · ${body.summary.blocked} blocked · ${body.summary.cancelled} cancelled`}
      </Text>
      <Table columns={columns} rows={tableRows} cursor={cursor} height={height - 2} emptyLabel="No work in this repo yet." />
    </Box>
  );
}

/** Row lookup helper for the shell's drill/action dispatch. Uses the same
 * `visibleRollupRows` list the table renders, so the cursor length the shell
 * computes and the rows actually on screen never drift apart. */
export function rollupRowAt(body: RepoRollupView, index: number, filters?: TuiFilterState): RollupNodeView | undefined {
  return visibleRollupRows(body, filters)[index];
}

export const ROLLUP_FILTER_CYCLE: readonly (TuiFilterState | undefined)[] = [
  undefined,
  { clauses: [], sort: [], showClosed: false },
  { clauses: [], sort: [], showClosed: false, showCancelled: false }
];
