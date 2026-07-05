import { Box, Text } from "ink";

import type { RepoRollupView, RollupNodeView } from "@boreal/ui-model";
import { COLOR, fit, statusColor, statusLabel } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

/** Depth-first, expanded-by-default flattening for the tree table. Collapsed
 * subtrees are simply omitted (v1 has no collapse toggle yet -- everything
 * marked `expandedByDefault` renders; deep closed/cancelled branches are
 * pruned by the builder's `expandedByDefault` flag instead). */
function visibleRows(root: RollupNodeView, byId: ReadonlyMap<string, RollupNodeView>): readonly RollupNodeView[] {
  const rows: RollupNodeView[] = [];
  const visit = (node: RollupNodeView): void => {
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

export function RepoRollupRoute({
  body,
  cursor,
  height,
  width
}: {
  readonly body: RepoRollupView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  const rows = visibleRows(body.root, byId);
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

/** Row lookup helper for the shell's drill/action dispatch. */
export function rollupRowAt(body: RepoRollupView, index: number): RollupNodeView | undefined {
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  return visibleRows(body.root, byId)[index];
}
