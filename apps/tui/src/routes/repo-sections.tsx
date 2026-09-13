import { Box, Text } from "ink";

import type { TuiFilterState, RollupNodeView } from "@boreal/ui-model";
import type { RepoMilestonesBody, RepoNowBody, RepoOpsBody, RepoSprintBoardBody, RepoWorkBody } from "../loaders.js";
import { displayStatusColor, displayStatusForNode, displayStatusGlyph, displayStatusLabel } from "../status-display.js";
import { sprintTitleLabel } from "./sprint-board.js";
import { COLOR, fit } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

export const WORK_FILTERS = ["open", "all", "ready", "in_progress", "blocked", "needs_verification", "closed"] as const;

export function workFilterLabel(filters?: TuiFilterState): string {
  return filters?.query ?? "open";
}

export function visibleWorkRows(body: RepoWorkBody, filters?: TuiFilterState): readonly RollupNodeView[] {
  const filter = workFilterLabel(filters);
  return body.items.filter((node) => {
    const status = node.workStatus ?? "draft";
    if (filter === "all") return status !== "cancelled";
    if (filter === "open") return !["verified", "closed", "cancelled"].includes(status);
    if (filter === "closed") return status === "closed" || status === "verified";
    return status === filter;
  });
}

function typeLabel(kind: RollupNodeView["kind"]): string {
  return { task: "TK", issue: "IS", milestone: "MS", sprint: "SP", project: "PR" }[kind] ?? "WK";
}

function nodeContext(node: RollupNodeView): string {
  if (node.blockerSummary.activeBlockerCount > 0) return `${node.blockerSummary.activeBlockerCount} blockers`;
  if (node.reservation?.expired) return "reservation expired";
  if (node.reservation) return node.reservation.agentId;
  if (node.progress.total > 0) return `${node.progress.done}/${node.progress.total}`;
  return node.labels[0] ?? "—";
}

function nodeState(node: RollupNodeView): { readonly text: string; readonly color: string } {
  return stateFor(displayStatusForNode(node));
}

function stateFor(statusValue: string | undefined): { readonly text: string; readonly color: string } {
  const status = statusValue ?? "draft";
  return { text: `${displayStatusGlyph(status)} ${displayStatusLabel(status)}`, color: displayStatusColor(status) };
}

function nodeWorkCell(node: RollupNodeView): string {
  return `${typeLabel(node.kind)} ${node.title}`;
}

function repoTableColumns(width: number, contextWidth = 18): readonly TableColumn[] {
  return [
    { header: "state", width: 15, minWidth: 8, priority: 1 },
    { header: "work", width: Math.max(12, width - contextWidth - 18), minWidth: 12, priority: 0 },
    { header: "context", width: contextWidth, minWidth: 8, priority: 2 }
  ];
}

function nodeRows(nodes: readonly RollupNodeView[]): readonly TableRow[] {
  return nodes.map((node) => {
    const state = nodeState(node);
    return {
      key: node.id,
      cells: [
        { text: state.text, color: state.color },
        { text: nodeWorkCell(node), color: COLOR.text },
        { text: nodeContext(node), color: node.blockerSummary.activeBlockerCount > 0 ? COLOR.warn : COLOR.muted }
      ]
    };
  });
}

function progressText(done: number, total: number, width = 9): string {
  if (total <= 0) return "—";
  const filled = Math.max(0, Math.min(width, Math.round((done / total) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${done}/${total}`;
}

function progressColor(status: string): string {
  if (status === "blocked") return COLOR.danger;
  if (status === "complete") return COLOR.accent;
  if (status === "in_progress" || status === "reserved") return COLOR.accentSoft;
  return COLOR.muted;
}

type MilestoneGroupKey = "blocked" | "active" | "ready" | "complete" | "other";

function milestoneGroupKey(status: string): MilestoneGroupKey {
  if (status === "blocked") return "blocked";
  if (status === "in_progress" || status === "needs_verification" || status === "reserved") return "active";
  if (status === "ready") return "ready";
  if (status === "complete") return "complete";
  return "other";
}

function milestoneGroupTitle(key: MilestoneGroupKey, count: number): string {
  const title = key === "blocked" ? "BLOCKED" : key === "active" ? "IN PROGRESS" : key === "ready" ? "READY" : key === "complete" ? "COMPLETE" : "OTHER";
  return `${title} · ${count}`;
}

function milestoneGroupHeights(groupSizes: readonly number[], available: number): readonly number[] {
  const desired = groupSizes.map((size) => size + 1); // table header plus rows
  const totalDesired = desired.reduce((sum, size) => sum + size, 0);
  if (totalDesired <= available) return desired;
  const heights = desired.map(() => 1);
  let remaining = Math.max(0, available - heights.length);
  while (remaining > 0) {
    const target = desired
      .map((size, index) => ({ index, room: size - (heights[index] ?? 1) }))
      .sort((left, right) => right.room - left.room)[0];
    if (!target || target.room <= 0) break;
    heights[target.index] = (heights[target.index] ?? 1) + 1;
    remaining -= 1;
  }
  return heights;
}

function sprintDisplayStatus(sprint: RepoSprintBoardBody["sprints"][number]): string {
  const blocked = sprint.blockedCount ?? 0;
  const activeBlockers = Math.max(blocked, sprint.view.activeBlockerIds.length);
  const done = sprint.doneCount ?? 0;
  const open = sprint.openCount ?? Math.max(0, sprint.scopeCount - done);
  if (activeBlockers > 0 || sprint.view.status === "blocked") return "blocked";
  if (sprint.view.status === "needs_verification") return "needs_verification";
  if (sprint.scopeCount > 0 && open === 0) return "complete";
  if (done > 0) return "in_progress";
  if (sprint.view.status === "closed" || sprint.view.status === "verified") return "complete";
  return sprint.view.status;
}

function nowGroupTitle(lane: "in flight" | "attention" | "next", count: number, total: number): string {
  const label = lane === "in flight" ? "IN FLIGHT" : lane === "attention" ? "NEEDS ATTENTION" : "NEXT UP";
  return `${label} · ${count}${total > count ? ` of ${total}` : ""}`;
}

function nowGroupTone(lane: "in flight" | "attention" | "next"): string {
  return lane === "attention" ? COLOR.warn : lane === "in flight" ? COLOR.accentSoft : COLOR.accent;
}

export function RepoNowRoute({ body, cursor, height, width }: {
  readonly body: RepoNowBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const current = body.currentSprint;
  const rows = body.rows;
  const groups = (["in flight", "attention", "next"] as const)
    .map((lane) => ({
      lane,
      rows: rows.filter((row) => row.lane === lane),
      total: lane === "in flight" ? body.workingCount : lane === "attention" ? body.attentionCount : body.nextCount
    }))
    .filter((group) => group.rows.length > 0);
  const columns = repoTableColumns(width, 20);
  const summary = `OPEN ${body.summary.open} · IN FLIGHT ${body.workingCount} · BLOCKED ${body.summary.blocked} · VERIFY ${body.summary.needsVerification}`;
  const headerLines = 5;
  const groupHeight = groups.length > 0
    ? Math.max(2, Math.floor(Math.max(2, height - headerLines - groups.length) / groups.length))
    : 1;
  let offset = 0;
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={COLOR.faint} bold wrap="truncate">CURRENT SPRINT</Text>
      <Text color={COLOR.text} wrap="truncate">
        {current ? `${sprintTitleLabel(current.view.title)} · ${current.scopeCount} scoped items${current.active ? " · active" : ""} · ${displayStatusLabel(sprintDisplayStatus(current))}` : "No active sprint selected · press 4 for Sprints"}
      </Text>
      {current ? <Text color={COLOR.faint} wrap="truncate">{fit(`ID ${current.view.id} · ${progressText(current.doneCount ?? 0, current.scopeCount, 7)}`, width)}</Text> : null}
      <Text color={COLOR.muted} wrap="truncate">{fit(summary, width)}</Text>
      <Text color={COLOR.faint} wrap="truncate">QUEUE · {rows.length} surfaced{body.overflowCount > 0 ? ` · ${body.overflowCount} more in Work` : ""} · Enter opens work</Text>
      {groups.length === 0 ? <Text color={COLOR.muted}>No active, blocked, or ready work to surface.</Text> : null}
      {groups.map((group) => {
        const start = offset;
        offset += group.rows.length;
        const tableRows = group.rows.map((row) => {
          const state = nodeState(row.node);
          return {
            key: row.id,
            cells: [
              { text: state.text, color: state.color },
              { text: nodeWorkCell(row.node), color: COLOR.text },
              { text: nodeContext(row.node), color: row.node.blockerSummary.activeBlockerCount > 0 ? COLOR.warn : COLOR.muted }
            ]
          };
        });
        return <Box key={group.lane} flexDirection="column">
          <Text color={nowGroupTone(group.lane)} bold wrap="truncate">{nowGroupTitle(group.lane, group.rows.length, group.total)}</Text>
          <Table columns={columns} rows={tableRows} cursor={cursor - start} height={groupHeight} width={width} emptyLabel="No work in this lane." />
        </Box>;
      })}
    </Box>
  );
}

export function RepoMilestonesRoute({ body, cursor, height, width }: {
  readonly body: RepoMilestonesBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const milestoneStatuses = body.milestones.map(displayStatusForNode);
  const completeCount = milestoneStatuses.filter((status) => status === "complete").length;
  const blockedCount = milestoneStatuses.filter((status) => status === "blocked").length;
  const activeCount = milestoneStatuses.filter((status) => status === "in_progress" || status === "needs_verification" || status === "reserved").length;
  const columns: readonly TableColumn[] = [
    { header: "state", width: 15, minWidth: 8, priority: 1 },
    { header: "milestone", width: Math.max(12, width - 46), minWidth: 12, priority: 0 },
    { header: "progress", width: 17, align: "right", minWidth: 7, priority: 2 },
    { header: "blockers", width: 10, align: "right", minWidth: 4, priority: 3 }
  ];
  const grouped = (["blocked", "active", "ready", "complete", "other"] as const)
    .map((key) => ({
      key,
      nodes: body.milestones.filter((node) => milestoneGroupKey(displayStatusForNode(node)) === key)
    }))
    .filter((group) => group.nodes.length > 0);
  const rowsFor = (nodes: readonly RollupNodeView[]): readonly TableRow[] => nodes.map((node) => {
    const state = nodeState(node);
    const displayStatus = displayStatusForNode(node);
    return {
      key: node.id,
      cells: [
        { text: state.text, color: state.color },
        { text: node.title, color: COLOR.text },
        { text: progressText(node.progress.done, node.progress.total), color: progressColor(displayStatus), bold: false },
        { text: String(node.blockerSummary.activeBlockerCount), color: node.blockerSummary.activeBlockerCount > 0 ? COLOR.warn : COLOR.faint }
      ]
    };
  });
  const warningLines = (body.warnings ?? []).slice(0, 1);
  const available = Math.max(1, height - 1 - warningLines.length - grouped.length);
  const groupHeights = milestoneGroupHeights(grouped.map((group) => group.nodes.length), available);
  let offset = 0;
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={COLOR.faint} wrap="truncate">MILESTONES · {body.milestones.length} top-level · {activeCount} active · {blockedCount} blocked · {completeCount} complete · Enter opens detail</Text>
      {warningLines.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{fit(`⚠ ${warning}`, width)}</Text>)}
      {grouped.map((group, groupIndex) => {
        const start = offset;
        offset += group.nodes.length;
        return <Box key={group.key} flexDirection="column">
          <Text color={group.key === "blocked" ? COLOR.danger : group.key === "complete" ? COLOR.accent : COLOR.muted} bold wrap="truncate">{milestoneGroupTitle(group.key, group.nodes.length)}</Text>
          <Table columns={columns} rows={rowsFor(group.nodes)} cursor={cursor - start} height={groupHeights[groupIndex] ?? 1} width={width} emptyLabel="No milestones in this group." />
        </Box>;
      })}
      {grouped.length === 0 ? <Text color={COLOR.muted}>No top-level milestones. Create one with bwrk work create --kind milestone.</Text> : null}
    </Box>
  );
}

export function RepoSprintsRoute({ body, cursor, height, width }: {
  readonly body: RepoSprintBoardBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const columns: readonly TableColumn[] = [
    { header: "state", width: 15, minWidth: 8, priority: 1 },
    { header: "sprint", width: Math.max(12, width - 56), minWidth: 12, priority: 0 },
    { header: "progress", width: 17, align: "right", minWidth: 7, priority: 2 },
    { header: "blockers", width: 10, align: "right", minWidth: 4, priority: 3 },
    { header: "active", width: 8, minWidth: 5, priority: 4 }
  ];
  const rows = body.sprints.map((sprint) => {
    const displayStatus = sprintDisplayStatus(sprint);
    const state = stateFor(displayStatus);
    const done = sprint.doneCount ?? 0;
    const total = sprint.doneCount !== undefined && sprint.openCount !== undefined ? done + sprint.openCount : sprint.scopeCount;
    const blocked = Math.max(sprint.blockedCount ?? 0, sprint.view.activeBlockerIds.length);
    return {
      key: sprint.view.id,
      cells: [
        { text: state.text, color: state.color },
        { text: sprintTitleLabel(sprint.view.title), color: COLOR.text },
        { text: progressText(done, total), color: progressColor(displayStatus) },
        { text: String(blocked), color: blocked > 0 ? COLOR.warn : COLOR.faint },
        { text: sprint.active ? "active" : "—", color: sprint.active ? COLOR.accent : COLOR.faint }
      ]
    };
  });
  const active = body.sprints.find((sprint) => sprint.active);
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={COLOR.faint} wrap="truncate">SPRINTS · {body.sprints.length} total · {active ? `active: ${sprintTitleLabel(active.view.title)} · ID ${active.view.id}` : "no active sprint"}</Text>
      <Table columns={columns} rows={rows} cursor={cursor} height={Math.max(1, height - 1)} width={width} emptyLabel="No sprints yet. Create one with bwrk work create --kind sprint." />
    </Box>
  );
}

export function RepoWorkRoute({ body, cursor, height, width, filters }: {
  readonly body: RepoWorkBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
}) {
  const items = visibleWorkRows(body, filters);
  const rows = nodeRows(items);
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={COLOR.faint} wrap="truncate">WORK · {workFilterLabel(filters)} · {items.length}/{body.items.length} task and issue rows · f changes view</Text>
      <Table columns={repoTableColumns(width)} rows={rows} cursor={cursor} height={Math.max(1, height - 1)} width={width} emptyLabel="No work matches this view." />
    </Box>
  );
}

function reservationStatusColor(status: string): string {
  if (status === "active") return COLOR.accent;
  if (status === "expired") return COLOR.warn;
  return COLOR.muted;
}

function reservationExpiry(expiresAt: string | undefined): string {
  if (!expiresAt) return "no expiry";
  return expiresAt.replace("T", " ").slice(0, 16);
}

export function RepoOpsRoute({ body, cursor, height, width }: {
  readonly body: RepoOpsBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const columns: readonly TableColumn[] = [
    { header: "state", width: 11, minWidth: 7, priority: 1 },
    { header: "work", width: Math.max(12, width - 45), minWidth: 12, priority: 0 },
    { header: "agent", width: 13, minWidth: 8, priority: 2 },
    { header: "expires", width: 17, minWidth: 8, priority: 3 }
  ];
  const rows = body.reservations.map((reservation) => ({
    key: reservation.id,
    cells: [
      { text: reservation.status, color: reservationStatusColor(reservation.status) },
      { text: reservation.title, color: COLOR.text },
      { text: reservation.agentId, color: COLOR.muted },
      { text: reservationExpiry(reservation.expiresAt), color: reservation.expired ? COLOR.warn : COLOR.muted }
    ]
  }));
  const warningLines = body.warnings.slice(0, 2);
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color={COLOR.faint} wrap="truncate">OPS · {body.reservations.filter((reservation) => reservation.status === "active").length} active · {body.reservations.filter((reservation) => reservation.status === "expired").length} expired · {body.historicalReservationCount} historical hidden · {body.warnings.length} warnings</Text>
      {warningLines.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{fit(`⚠ ${warning}`, width)}</Text>)}
      <Text color={COLOR.faint} wrap="truncate">RESERVATIONS · Enter opens work</Text>
      <Table columns={columns} rows={rows} cursor={cursor} height={Math.max(1, height - 2 - warningLines.length)} width={width} emptyLabel="No reservations recorded in this workspace." />
    </Box>
  );
}
