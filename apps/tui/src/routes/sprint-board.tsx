import { Box, Text } from "ink";
import type { TuiFilterState, WorkItemView } from "@boreal/ui-model";
import type { RepoSprintBoardBody } from "../loaders.js";
import { COLOR, fit, statusColor, statusLabel } from "../theme.js";
import { Table, type TableColumn } from "../ui.js";

export const SPRINT_FILTERS = ["open", "all", "ready", "blocked", "in_progress", "needs_verification", "complete"] as const;
export function sprintFilterLabel(filters?: TuiFilterState): string {
  return filters?.query ?? "open";
}
export function fullSprintStatusLabel(status: string): string { return statusLabel(status); }
export function compactStatusLabel(status: string): string {
  return ({ needs_verification: "verify", in_progress: "working" } as Record<string, string>)[status] ?? statusLabel(status);
}
export function visibleSprintRows(body: RepoSprintBoardBody, filters?: TuiFilterState): readonly WorkItemView[] {
  const filter = sprintFilterLabel(filters);
  const scope = filters?.clauses.find((clause) => clause.field === "scope")?.value;
  const scopeIds = scope === "assigned" ? body.assignedWorkIds : scope === "dependencies" ? body.dependencyWorkIds : undefined;
  return (body.board?.lanes.flatMap((lane) => lane.items) ?? []).filter((item) => {
    if (scopeIds && !scopeIds.includes(item.id)) return false;
    const terminal = ["closed", "verified", "cancelled"].includes(item.status);
    return filter === "all" || (filter === "open" ? !terminal : filter === "complete" ? terminal : item.status === filter);
  });
}
export function sprintSelectionRows(body: RepoSprintBoardBody, maxRows = 5): readonly RepoSprintBoardBody["sprints"][number][] {
  const count = Math.max(0, maxRows);
  const selected = Math.max(0, body.sprints.findIndex((sprint) => sprint.view.id === body.selectedSprintId));
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), body.sprints.length - count));
  return body.sprints.slice(start, start + count);
}
function context(item: WorkItemView): string {
  if (item.activeBlockerIds.length) return `${item.activeBlockerIds.length} blockers`;
  if (item.activeReservation?.expired) return "reservation expired";
  if (item.activeReservation) return item.activeReservation.agentId;
  if (item.activeReservationId) return "reserved";
  return item.kind === "task" || item.kind === "issue" ? "—" : item.kind;
}

export function SprintBoardRoute({ body, cursor, height, width, filters }: {
  readonly body: RepoSprintBoardBody; readonly cursor: number; readonly height: number; readonly width: number; readonly filters?: TuiFilterState;
}) {
  const budget = Math.max(0, height);
  if (!budget) return <Box />;
  if (!body.sprints.length) return <Text wrap="truncate" color={COLOR.muted}>{fit("No sprints yet. Create one with bwrk work create --kind sprint.", width)}</Text>;
  const items = visibleSprintRows(body, filters);
  const scope = filters?.clauses.find((clause) => clause.field === "scope")?.value ?? "all";
  const dependencies = new Set(body.dependencyWorkIds ?? []);
  const all = body.board?.lanes.flatMap((lane) => lane.items) ?? [];
  const headerLines = Math.min(3, Math.max(1, budget - 2));
  const columns: TableColumn[] = [
    { header: "state", width: 10, minWidth: 7, priority: 1 },
    { header: "work", width: Math.max(10, width - 32), minWidth: 10, priority: 0 },
    { header: "context", width: 17, minWidth: 9, priority: 2 }
  ];
  return <Box flexDirection="column" width={width} height={budget} overflow="hidden">
    <Text bold color={COLOR.text} wrap="truncate">{fit(`Sprint: ${body.board?.sprint.title ?? "Unavailable"}${body.selectedSprintId === body.activeSprintId ? " · active" : ""}  [s change]`, width)}</Text>
    {headerLines >= 2 ? <Text color={COLOR.muted} wrap="truncate">{fit(`View: ${sprintFilterLabel(filters).replaceAll("_", " ")} · ${items.length}/${all.length} work items · ${body.board?.summary.activeBlockerCount ?? 0} blockers`, width)}</Text> : null}
    {headerLines >= 3 ? <Text color={COLOR.faint} wrap="truncate">{fit(`Scope: ${scope} · ${body.assignedWorkIds?.length ?? 0} assigned + ${dependencies.size} dependencies · d scope`, width)}</Text> : null}
    <Table columns={columns} rows={items.map((item) => ({ key: item.id, cells: [
      { text: compactStatusLabel(item.status), color: statusColor(item.status) },
      { text: `${dependencies.has(item.id) ? "↳ " : ""}${item.title}`, color: COLOR.text },
      { text: context(item), color: item.activeBlockerIds.length ? COLOR.warn : COLOR.muted }
    ] }))} cursor={cursor} height={Math.max(0, budget - headerLines)} width={width} emptyLabel={all.length ? "No work matches this view. Press f for another view." : "No work assigned to this sprint yet."} />
  </Box>;
}
