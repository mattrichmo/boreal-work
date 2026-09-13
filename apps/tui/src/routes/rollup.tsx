import { Box, Text } from "ink";

import type { RepoRollupView, RollupNodeView, TuiFilterState } from "@boreal/ui-model";
import { COLOR, statusColor } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

export type RollupDisclosureState = ReadonlySet<string>;

type RollupFilterMode = "milestones-open" | "blocked" | "actionable" | "ready";

function rollupFilterMode(filters: TuiFilterState | undefined): RollupFilterMode | undefined {
  const value = filters?.clauses.find((clause) => clause.field === "rollup" && clause.operator === "is")?.value;
  return value === "milestones-open" || value === "blocked" || value === "actionable" || value === "ready" ? value : undefined;
}

function passesStatusFilter(node: RollupNodeView, filters: TuiFilterState | undefined): boolean {
  if (!filters || node.childIds.length > 0) return true;
  if (node.workStatus === "closed" || node.workStatus === "verified") return filters.showClosed !== false;
  if (node.workStatus === "cancelled") return filters.showCancelled !== false;
  return true;
}

function isOpen(node: RollupNodeView): boolean {
  return node.workStatus !== "closed" && node.workStatus !== "verified" && node.workStatus !== "cancelled";
}

function matchesLeafMode(node: RollupNodeView, mode: RollupFilterMode): boolean {
  // Container rows can carry their own status/blockers. Descendants are
  // matched separately, so a blocked milestone remains discoverable even if
  // its child tasks are not themselves marked blocked.
  if (mode === "milestones-open") return false;
  if (mode === "blocked") return node.workStatus === "blocked" || node.blockerSummary.activeBlockerCount > 0;
  if (mode === "ready") return node.workStatus === "ready" && node.blockerSummary.activeBlockerCount === 0;
  if (mode === "actionable") return isOpen(node) && node.workStatus !== "blocked" && node.blockerSummary.activeBlockerCount === 0;
  return false;
}

function hasVisibilityFilter(filters: TuiFilterState | undefined, mode: RollupFilterMode | undefined): boolean {
  return Boolean(mode || filters?.showClosed === false || filters?.showCancelled === false);
}

/** Depth-first, expanded-by-default flattening for the tree table, with the
 * v1 status facet (`f` cycles status and roll-up presets). Filters are
 * descendant-aware: a container remains visible only when it contains a
 * matching descendant, avoiding empty hierarchy rows. */
export function visibleRollupRows(
  body: RepoRollupView,
  filters?: TuiFilterState,
  expandedIds?: RollupDisclosureState
): readonly RollupNodeView[] {
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  const mode = rollupFilterMode(filters);
  const matches = new Map<string, boolean>();
  const openDescendant = new Map<string, boolean>();
  const hasOpenDescendant = (node: RollupNodeView): boolean => {
    const cached = openDescendant.get(node.id);
    if (cached !== undefined) return cached;
    const result = node.childIds.some((childId) => {
      const child = byId.get(childId);
      return Boolean(child && (isOpen(child) || hasOpenDescendant(child)));
    });
    openDescendant.set(node.id, result);
    return result;
  };
  const matching = (node: RollupNodeView): boolean => {
    const cached = matches.get(node.id);
    if (cached !== undefined) return cached;
    const descendant = node.childIds.some((childId) => {
      const child = byId.get(childId);
      return child ? matching(child) : false;
    });
    const direct = mode ? matchesLeafMode(node, mode) : node.childIds.length === 0 ? passesStatusFilter(node, filters) : false;
    const result = mode === "milestones-open"
      ? (node.kind === "milestone" && hasOpenDescendant(node))
      : mode
        ? direct || descendant
        : hasVisibilityFilter(filters, mode)
          ? direct || descendant
          : true;
    matches.set(node.id, result);
    return result;
  };
  for (const node of body.flatRows) matching(node);
  return visibleRows(body.root, byId, filters, expandedIds, matches, hasVisibilityFilter(filters, mode));
}

function visibleRows(
  root: RollupNodeView,
  byId: ReadonlyMap<string, RollupNodeView>,
  filters: TuiFilterState | undefined,
  expandedIds: RollupDisclosureState | undefined,
  matches: ReadonlyMap<string, boolean>,
  hasFilter: boolean
): readonly RollupNodeView[] {
  const rows: RollupNodeView[] = [];
  const seen = new Set<string>();
  const visit = (node: RollupNodeView): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (hasFilter ? !matches.get(node.id) : !passesStatusFilter(node, filters)) return;
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
  // Keep the roll-up useful at a glance: milestones are the primary drill-in
  // boundary and should start folded, while sprint/task trees retain their
  // existing defaults.
  return new Set(body.flatRows.filter((node) => node.expandedByDefault && node.kind !== "milestone").map((node) => node.id));
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
  return node.kind === "milestone" || node.kind === "sprint" || node.kind === "task" || node.kind === "issue";
}

export function fullRollupStatusLabel(status: string | undefined): string {
  if (!status) return "—";
  return {
    in_progress: "in progress",
    needs_verification: "needs verification",
    reserved: "reserved",
    verified: "complete",
    cancelled: "cancelled"
  }[status] ?? status.replaceAll("_", " ");
}

function rollupTypeLabel(kind: RollupNodeView["kind"]): string {
  return { milestone: "MS", sprint: "SP", task: "TK", issue: "IS", project: "PR" }[kind] ?? "WK";
}

function rollupStatusLabel(status: string | undefined): string {
  if (!status) return "—";
  const icon = { ready: "○", in_progress: "●", reserved: "◉", needs_verification: "◇", blocked: "!", verified: "✓", closed: "■", cancelled: "×" }[status] ?? "·";
  const label = status === "needs_verification" ? "verify" : status === "in_progress" ? "working" : fullRollupStatusLabel(status);
  return `${icon} ${label}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function rollupFilterLabel(filters: TuiFilterState | undefined): string | undefined {
  if (!filters) return undefined;
  const mode = rollupFilterMode(filters);
  if (mode === "milestones-open") return "milestones with open work";
  if (mode === "blocked") return "blocked work";
  if (mode === "actionable") return "actionable work";
  if (mode === "ready") return "ready to claim";
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
  const readyCount = body.flatRows.filter((node) => node.childIds.length === 0 && node.workStatus === "ready").length;
  // Keep the identity column as the last column to compress. Table's fitting
  // logic can then hide secondary metrics on small terminals rather than
  // turning the title into an unreadable sliver.
  const nameWidth = Math.max(12, width - 35);
  const columns: readonly TableColumn[] = [
    { header: "work", width: nameWidth, minWidth: 12, priority: 0 },
    { header: "state", width: 12, minWidth: 7, priority: 1 },
    { header: "done", width: 7, minWidth: 4, align: "right", priority: 2 },
    { header: "active blockers", width: 15, minWidth: 3, align: "right", priority: 3 }
  ];
  const tableRows: readonly TableRow[] = rows.map((node): TableRow => {
    const indent = node.depth > 1 ? "│ ".repeat(node.depth - 1) : "";
    const hiddenDescendants = hiddenRollupDescendantCount(node, byId, expandedIds);
    const disclosure = node.childIds.length === 0 ? "  " : isRollupNodeExpanded(node, expandedIds) ? "▾ " : "▸ ";
    const context = hiddenDescendants > 0 ? ` · ${hiddenDescendants} hidden` : "";
    return {
      key: node.id,
      cells: [
        { text: `${indent}${disclosure}${rollupTypeLabel(node.kind)} ${node.title}${context}`, color: COLOR.text },
        { text: rollupStatusLabel(node.workStatus), color: node.workStatus ? statusColor(node.workStatus) : COLOR.faint },
        { text: `${node.progress.done}/${node.progress.total}`, color: COLOR.muted },
        { text: String(node.blockerSummary.activeBlockerCount), color: node.blockerSummary.activeBlockerCount > 0 ? COLOR.warn : COLOR.faint }
      ]
    };
  });
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={COLOR.faint} wrap="truncate">
        {`ROLL-UP · READY ${readyCount} · ${pluralize(body.summary.milestones, "milestone")} · ${pluralize(body.summary.sprints, "sprint")} · ${pluralize(body.summary.tasks, "task")} · ${body.summary.blocked} blocked status · ${pluralize(body.summary.cancelled, "cancelled item")}`}
      </Text>
      <Table columns={columns} rows={tableRows} cursor={cursor} height={Math.max(0, height - 1)} width={width} emptyLabel="No work in this repo yet. Create work with bwrk work create." />
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
  { clauses: [], sort: [], showClosed: false, showCancelled: false },
  { clauses: [{ field: "rollup", operator: "is", value: "milestones-open" }], sort: [] },
  { clauses: [{ field: "rollup", operator: "is", value: "blocked" }], sort: [] },
  { clauses: [{ field: "rollup", operator: "is", value: "actionable" }], sort: [] },
  { clauses: [{ field: "rollup", operator: "is", value: "ready" }], sort: [] }
];
