import { Box, Text } from "ink";
import type { RollupNodeView, TuiCommandDescriptor, WorkCompletionView, WorkItemView } from "@boreal/ui-model";
import type { ReactNode } from "react";

import type { RepoTaskDetailBody, RepoTaskDetailHierarchy } from "../loaders.js";
import { reconciliationStatusForWork } from "../reconciliation.js";
import { displayStatusColor, displayStatusForNode, displayStatusGlyph, displayStatusLabel } from "../status-display.js";
import { cellWidth, COLOR, fit, graphemeClusters, statusColor } from "../theme.js";
import { Pane, fitTableColumnWidths, windowList, type TableColumn } from "../ui.js";

export type TaskDetailFocus = "scope" | "actions";
export type TaskDetailLayoutMode = "right" | "bottom";
export type TaskDetailMaximizedPane = "scope" | "detail";
export type TaskDetailPanel = "tree" | "xray";

export interface TaskDetailLayout {
  readonly split: boolean;
  readonly direction: TaskDetailLayoutMode;
  readonly detailWidth: number;
  readonly scopeWidth: number;
  readonly detailHeight: number;
  readonly scopeHeight: number;
}

/** Keep the description readable while giving container work a dedicated
 * hierarchy pane on the wider terminals this dashboard is designed for. */
export function taskDetailLayout(width: number, hasHierarchy: boolean, height = 24, requestedMode: TaskDetailLayoutMode = "right"): TaskDetailLayout {
  const total = Math.max(1, Math.floor(width));
  const outerHeight = Math.max(1, Math.floor(height));
  if (!hasHierarchy || total < 56 || outerHeight < 12) return { split: false, direction: requestedMode, detailWidth: total, scopeWidth: 0, detailHeight: outerHeight, scopeHeight: 0 };
  if (requestedMode === "bottom" || total < 88) {
    const detailHeight = Math.max(7, Math.floor((outerHeight - 1) * 0.58));
    return { split: true, direction: "bottom", detailWidth: total, scopeWidth: total, detailHeight, scopeHeight: Math.max(1, outerHeight - detailHeight - 1) };
  }
  const gap = 1;
  const scopeWidth = Math.max(32, Math.floor((total - gap) * 0.42));
  const detailWidth = total - gap - scopeWidth;
  if (detailWidth < 40) return { split: false, direction: requestedMode, detailWidth: total, scopeWidth: 0, detailHeight: outerHeight, scopeHeight: 0 };
  return { split: true, direction: "right", detailWidth, scopeWidth, detailHeight: outerHeight, scopeHeight: outerHeight };
}

export interface TaskDetailTreeRow {
  readonly node: RollupNodeView;
  readonly depth: number;
  readonly expanded: boolean;
}

export function defaultTaskDetailDisclosure(hierarchy: RepoTaskDetailHierarchy): ReadonlySet<string> {
  return new Set(hierarchy.nodes.filter((node) => node.childIds.length > 0 && node.expandedByDefault).map((node) => node.id));
}

export function visibleTaskDetailRows(
  hierarchy: RepoTaskDetailHierarchy,
  expandedIds: ReadonlySet<string>
): readonly TaskDetailTreeRow[] {
  const byId = new Map<string, RollupNodeView>([
    [hierarchy.root.id, hierarchy.root],
    ...hierarchy.nodes.map((node) => [node.id, node] as const)
  ]);
  const rows: TaskDetailTreeRow[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (!node) return;
    const expanded = node.childIds.length > 0 && expandedIds.has(node.id);
    rows.push({ node, depth, expanded });
    if (expanded) for (const childId of node.childIds) visit(childId, depth + 1);
  };
  for (const childId of hierarchy.root.childIds) visit(childId, 0);
  return rows;
}

export function taskDetailHasHierarchy(body: RepoTaskDetailBody): boolean {
  return Boolean(body.hierarchy && body.hierarchy.root.childIds.length > 0);
}

export interface TaskDetailHealthSummary {
  readonly total: number;
  readonly done: number;
  readonly blocked: number;
  readonly inProgress: number;
  readonly needsVerification: number;
  readonly reservations: number;
  readonly blockerCount: number;
  readonly percentDone: number;
}

export function taskDetailHealthSummary(hierarchy: RepoTaskDetailHierarchy): TaskDetailHealthSummary {
  let blocked = 0;
  let inProgress = 0;
  let needsVerification = 0;
  let reservations = 0;
  for (const node of hierarchy.nodes) {
    const status = displayStatusForNode(node);
    if (status === "blocked") blocked += 1;
    if (status === "in_progress" || status === "reserved") inProgress += 1;
    if (status === "needs_verification") needsVerification += 1;
    if (node.reservation) reservations += 1;
  }
  const total = hierarchy.root.progress.total;
  return {
    total,
    done: hierarchy.root.progress.done,
    blocked,
    inProgress,
    needsVerification,
    reservations,
    blockerCount: hierarchy.root.blockerSummary.blockedDescendantCount + hierarchy.root.blockerSummary.activeBlockerCount,
    percentDone: hierarchy.root.progress.percentDone
  };
}

export function filterTaskDetailRows(rows: readonly TaskDetailTreeRow[], query: string): readonly TaskDetailTreeRow[] {
  const trimmed = query.trim().toLocaleLowerCase();
  if (!trimmed) return rows;
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    const status = displayStatusForNode(row.node);
    const haystack = [row.node.id, row.node.title, row.node.kind, status, ...row.node.labels].join(" ").toLocaleLowerCase();
    if (!haystack.includes(trimmed)) return;
    keep.add(index);
    for (let parent = index - 1; parent >= 0; parent -= 1) {
      if (rows[parent]!.depth < row.depth) {
        keep.add(parent);
        break;
      }
    }
  });
  return rows.filter((_, index) => keep.has(index));
}

export function fullTaskStatusLabel(status: string): string {
  return {
    in_progress: "in progress",
    needs_verification: "needs verification",
    reserved: "reserved",
    verified: "complete",
    closed: "complete",
    cancelled: "cancelled"
  }[status] ?? status.replaceAll("_", " ");
}

export interface ReservationDisplay {
  readonly label: string;
  readonly color: string;
}

export function reservationDisplay(task: WorkItemView): ReservationDisplay {
  if (!task.activeReservation && !task.activeReservationId) return { label: "unreserved", color: COLOR.muted };
  if (!task.activeReservation) {
    return { label: "reserved · details unavailable · refresh", color: COLOR.warn };
  }
  if (task.activeReservation.expired) {
    return { label: `expired · ${task.activeReservation.agentId}`, color: COLOR.warn };
  }
  return { label: `active · ${task.activeReservation.agentId}`, color: COLOR.accentSoft };
}

export interface TaskActionDisplay {
  readonly label: string;
  readonly disabled: boolean;
  readonly reason?: string;
}

export function taskActionDisplay(action: TuiCommandDescriptor, task: WorkItemView): TaskActionDisplay {
  if (action.id.startsWith("work.close:") && task.activeReservation?.expired) {
    return {
      label: action.label,
      disabled: true,
      reason: "reservation is expired; repair or release it before finishing"
    };
  }
  if (action.id.startsWith("work.close:") && task.activeReservation) {
    return {
      label: action.label,
      disabled: true,
      reason: "reserved work must finish through the agent evidence flow"
    };
  }
  if (action.id.startsWith("work.close:") && task.activeReservationId) {
    return {
      label: action.label,
      disabled: true,
      reason: "reservation state needs repair before finishing"
    };
  }
  if (action.disabled) return { label: action.label, disabled: true, reason: action.disabledReason ?? "action unavailable" };
  return { label: action.label, disabled: false };
}

export function boundedTextLines(value: string, width: number, maxLines: number): readonly string[] {
  const maxWidth = Math.max(1, width);
  const lineLimit = Math.max(1, maxLines);
  const chunks = value.split(/\r?\n/).flatMap((line) => {
    if (line.length === 0) return [""];
    const parts: string[] = [];
    let remaining = line.trimStart();
    while (remaining.length > 0) {
      const characters = graphemeClusters(remaining);
      let end = 0;
      while (end < characters.length && cellWidth(characters.slice(0, end + 1).join("")) <= maxWidth) end += 1;
      if (end === 0) end = 1;
      let breakAt = end;
      // Prefer a word boundary when one is available. Long identifiers and
      // URLs still split at the cell boundary so every line remains bounded.
      if (end < characters.length) {
        let whitespace = -1;
        for (let index = end - 1; index >= 0; index -= 1) {
          if (/\s/u.test(characters[index] ?? "")) {
            whitespace = index;
            break;
          }
        }
        if (whitespace > 0) breakAt = whitespace;
      }
      const part = characters.slice(0, breakAt).join("").trimEnd();
      if (part.length > 0) parts.push(part);
      remaining = characters.slice(breakAt).join("").trimStart();
    }
    return parts;
  });
  if (chunks.length <= lineLimit) return chunks;
  const visible = chunks.slice(0, lineLimit);
  const last = visible.at(-1) ?? "";
  const suffixWidth = Math.max(0, maxWidth - 1);
  let suffix = "";
  for (const character of graphemeClusters(last)) {
    if (cellWidth(`${suffix}${character}`) > suffixWidth) break;
    suffix += character;
  }
  visible[visible.length - 1] = `${suffix}…`;
  return visible;
}

function actionLine(action: TuiCommandDescriptor, task: WorkItemView): string {
  const display = taskActionDisplay(action, task);
  if (display.disabled) return `${display.label} · unavailable: ${display.reason ?? "refresh required"}`;
  return `${display.label} · ${action.mutatesState ? "confirmation required" : "read-only"} · ${action.displayCommand}`;
}

export function buildTaskDetailLines(body: RepoTaskDetailBody, width: number): readonly string[] {
  const task = body.work;
  const contentWidth = Math.max(1, Math.floor(width) - 4);
  const reservation = reservationDisplay(task);
  const lines = [
    `labels      ${task.labels.length > 0 ? task.labels.join(", ") : "none"}`,
    `blockers    ${task.activeBlockerIds.length > 0 ? task.activeBlockerIds.join(", ") : "none"}`,
    `reservation ${reservation.label}`,
    `evidence    ${task.evidenceCount} · verifications ${task.verificationCount}`,
    `depends on  ${body.dependencyTitles.length > 0 ? body.dependencyTitles.join(", ") : "none"}`
  ];
  if (body.blockerTitles?.length) lines.push(`blocked by  ${body.blockerTitles.join(", ")}`);
  if (task.directiveSummary) lines.push(`directives   ${task.directiveSummary.blocking} blocking · ${task.directiveSummary.required} required · ${task.directiveSummary.conflictCount} conflicts`);
  if (task.closedReason) lines.push(`closed      ${task.closedReason}`);
  const completion: WorkCompletionView | undefined = task.completion;
  if (task.status === "closed" || task.status === "verified" || task.status === "cancelled") {
    lines.push("", "COMPLETION");
    if (task.closedAt) lines.push(`completed   ${task.closedAt}`);
    if (!completion || (!completion.summary && completion.evidence.length === 0 && completion.verifications.length === 0)) {
      lines.push("No closeout summary recorded.");
    } else {
      if (completion.summary) {
        lines.push(`outcome     ${completion.summary.outcome}`);
        lines.push(...boundedTextLines(`summary     ${completion.summary.title}`, contentWidth, 10_000));
        lines.push(...boundedTextLines(completion.summary.body, contentWidth, 10_000));
        if (completion.summary.completedWork.length > 0) {
          lines.push("completed work");
          for (const item of completion.summary.completedWork) {
            lines.push(...boundedTextLines(`• ${item.title} · ${item.outcome}: ${item.notes}`, contentWidth, 10_000));
          }
        }
        if (completion.summary.commitShas.length > 0) lines.push(`commits     ${completion.summary.commitShas.join(", ")}`);
        if (completion.summary.dirtyPathNotes.length > 0) {
          lines.push("working tree notes");
          for (const note of completion.summary.dirtyPathNotes) lines.push(...boundedTextLines(`• ${note}`, contentWidth, 10_000));
        }
        if (completion.summary.artifactUri) lines.push(...boundedTextLines(`artifact    ${completion.summary.artifactUri}`, contentWidth, 10_000));
      }
      lines.push(`proof       ${completion.evidence.length} evidence · ${completion.verifications.length} verifications`);
      if (completion.evidence.length > 0) lines.push("evidence");
      for (const evidence of completion.evidence) lines.push(...boundedTextLines(`• ${evidence.kind} · ${evidence.outcome}: ${evidence.summary}`, contentWidth, 10_000));
      if (completion.verifications.length > 0) lines.push("verifications");
      for (const verification of completion.verifications) lines.push(...boundedTextLines(`• ${verification.verdict}${verification.notes ? `: ${verification.notes}` : ""}`, contentWidth, 10_000));
    }
  }
  if (task.description) lines.push("", "DESCRIPTION", ...boundedTextLines(task.description, contentWidth, 10_000));
  if (task.acceptanceCriteria?.length) lines.push("", `ACCEPTANCE · ${task.acceptanceCriteria.length} criteria`, ...task.acceptanceCriteria.flatMap((criterion) => boundedTextLines(`• ${criterion}`, contentWidth, 10_000)));
  const reconciliation = reconciliationStatusForWork(task);
  lines.push("", `RECONCILIATION · ${fullTaskStatusLabel(reconciliation.overall)}`);
  lines.push(...reconciliation.steps.map((step) => `${step.status === "complete" ? "✓" : step.status === "blocked" ? "!" : "·"} ${step.label}: ${fullTaskStatusLabel(step.status)} · ${step.detail}`));
  // Wrap every logical line, including metadata and graph details. A long ID,
  // dependency title, or reconciliation detail must be reachable through the
  // same viewport offset as the prose sections.
  return lines.flatMap((line) => boundedTextLines(line, contentWidth, 10_000)).map((line) => fit(line, contentWidth));
}

export function taskDetailMaxScroll(body: RepoTaskDetailBody, width: number, height: number): number {
  const inner = Math.max(1, Math.floor(height) - 5);
  const actionLines = body.actions.length > 0 ? 2 : 0;
  return Math.max(0, buildTaskDetailLines(body, width).length - Math.max(1, inner - actionLines));
}

function TaskDetailPane({ body, width, height, selectedActionIndex, scrollOffset, focus }: {
  readonly body: RepoTaskDetailBody;
  readonly width: number;
  readonly selectedActionIndex: number;
  readonly height?: number;
  readonly scrollOffset: number;
  readonly focus: TaskDetailFocus;
}) {
  const task = body.work;
  const outerHeight = Math.max(1, Math.floor(height ?? 24));
  const contentWidth = Math.max(1, width - 4);
  const inner = Math.max(1, outerHeight - 5);
  const actionLines = body.actions.length > 0 ? 2 : 0;
  const viewport = Math.max(1, inner - actionLines);
  const lines = buildTaskDetailLines(body, width);
  const offset = Math.max(0, Math.min(Math.floor(scrollOffset), Math.max(0, lines.length - viewport)));
  const visible = lines.slice(offset, offset + viewport);
  const enabled = body.actions.filter((action) => !taskActionDisplay(action, task).disabled).length;
  const selected = body.actions[Math.max(0, Math.min(selectedActionIndex, body.actions.length - 1))];
  const maxScroll = Math.max(0, lines.length - viewport);
  const above = offset;
  const below = Math.max(0, maxScroll - offset);
  const scrollLabel = maxScroll > 0 ? `↑ ${above} above · ↓ ${below} below` : "all content visible";
  return <Pane title={focus === "actions" ? `DETAILS · FOCUS · ${task.title}` : `DETAILS · ${task.title}`} tone={focus === "actions" ? COLOR.accent : statusColor(task.status)} width={width} height={height}>
    <Text color={COLOR.accent} bold wrap="truncate">{fit(`ID  ${task.id}`, contentWidth)}</Text>
    <Text color={statusColor(task.status)} wrap="truncate">{fit(`${fullTaskStatusLabel(task.status)} · ${task.kind} · ${task.priority} · ${scrollLabel}`, contentWidth)}</Text>
    <Box flexDirection="column" height={viewport}>
      {visible.map((line, index) => <Text key={index} color={/^(DESCRIPTION|ACCEPTANCE|RECONCILIATION|COMPLETION|ACTIONS)/u.test(line) ? COLOR.accent : COLOR.text} bold={/^(DESCRIPTION|ACCEPTANCE|RECONCILIATION|COMPLETION|ACTIONS)/u.test(line)} wrap="truncate">{fit(line, contentWidth)}</Text>)}
    </Box>
    <Box flexDirection="column" height={actionLines}>
      {body.actions.length > 0 ? <Text color={COLOR.faint} wrap="truncate">{fit(`ACTIONS · ${enabled} enabled · ${body.actions.length - enabled} unavailable`, contentWidth)}</Text> : null}
      {selected ? <Text color={taskActionDisplay(selected, task).disabled ? COLOR.faint : COLOR.accent} wrap="truncate">{fit(`▸ ${actionLine(selected, task)}`, contentWidth)}</Text> : null}
    </Box>
  </Pane>;
}

function treeTypeLabel(kind: RollupNodeView["kind"]): string {
  return { milestone: "MS", sprint: "SP", task: "TK", issue: "IS", project: "PR" }[kind] ?? "WK";
}

function taskTreeCells(row: TaskDetailTreeRow, marked: boolean, focused: boolean): readonly string[] {
  const { node } = row;
  const indent = "  ".repeat(row.depth);
  const disclosure = node.childIds.length === 0 ? "  " : row.expanded ? "▼ " : "▶ ";
  const status = displayStatusForNode(node);
  return [
    `${focused ? "▸ " : marked ? "✓ " : "  "}${indent}${disclosure}${treeTypeLabel(node.kind)} ${node.title}`,
    `${displayStatusGlyph(status)} ${displayStatusLabel(status)}`,
    node.progress.total > 0 ? `${node.progress.done}/${node.progress.total}` : "—",
    node.blockerSummary.activeBlockerCount > 0 ? `!${node.blockerSummary.activeBlockerCount}` : "—"
  ];
}

function TaskScopePane({
  hierarchy,
  rows,
  cursor,
  width,
  height,
  focus,
  selectedIds,
  filterQuery,
  filterOpen
}: {
  readonly hierarchy: RepoTaskDetailHierarchy;
  readonly rows: readonly TaskDetailTreeRow[];
  readonly cursor: number;
  readonly width: number;
  readonly height?: number;
  readonly focus: TaskDetailFocus;
  readonly selectedIds: ReadonlySet<string>;
  readonly filterQuery: string;
  readonly filterOpen: boolean;
}) {
  const outerHeight = Math.max(1, Math.floor(height ?? 24));
  const contentWidth = Math.max(1, width - 4);
  const listHeight = Math.max(1, outerHeight - 9);
  const windowed = windowList(rows, cursor, listHeight);
  const columns: readonly TableColumn[] = [
    { header: "work", width: Math.max(20, contentWidth - 24), minWidth: 17, priority: 0 },
    { header: "status", width: 8, minWidth: 6, priority: 1 },
    { header: "done", width: 5, minWidth: 4, priority: 2 },
    { header: "block", width: 5, minWidth: 4, priority: 3 }
  ];
  const widths = fitTableColumnWidths(columns, contentWidth, 0, 1);
  const visibleColumns = columns.flatMap((column, columnIndex) => widths[columnIndex]! > 0 ? [{ column, columnIndex, width: widths[columnIndex]! }] : []);
  const navigationHint = focus === "scope"
    ? "j/k move · PgUp/PgDn page · g/G top/end · click focus"
    : "tab to focus tree · detail scroll active";
  const disclosureHint = focus === "scope"
    ? "space fold · ←/→ disclose · v mark · enter open"
    : "tab focus tree · enter action";
  const header = visibleColumns.map(({ column, width: columnWidth }, index) => <Box key={column.header} width={columnWidth} marginLeft={index > 0 ? 1 : 0}><Text color={COLOR.faint}>{fit(column.header.toUpperCase(), columnWidth)}</Text></Box>);
  return <Pane title={`${focus === "scope" ? "CHILD WORK · FOCUS" : "CHILD WORK"} · ${hierarchy.nodes.length} items${filterOpen ? " · FILTER · type" : filterQuery.trim() ? ` · filter: ${filterQuery.trim()}` : ""}`} tone={focus === "scope" ? COLOR.accent : COLOR.muted} width={width} height={height}>
    <Text color={COLOR.faint} wrap="truncate">{fit(`${hierarchy.root.title} · ${hierarchy.root.progress.done}/${hierarchy.root.progress.total} done${filterQuery.trim() ? ` · ${rows.length} shown` : ""}`, contentWidth)}</Text>
    <Text color={focus === "scope" ? COLOR.accent : COLOR.faint} wrap="truncate">{fit(navigationHint, contentWidth)}</Text>
    <Text color={focus === "scope" ? COLOR.accent : COLOR.faint} wrap="truncate">{fit(disclosureHint, contentWidth)}</Text>
    <Box width={contentWidth} overflow="hidden">{header}</Box>
    <Box flexDirection="column" height={listHeight}>
      {windowed.above > 0 ? <Text color={COLOR.faint}>{fit(`↑ ${windowed.above} more`, contentWidth)}</Text> : null}
      {windowed.rows.map(({ item, index }) => <Box key={item.node.id} width={contentWidth} backgroundColor={focus === "scope" && index === cursor ? COLOR.selectionBg : undefined}>
        {visibleColumns.map(({ columnIndex, width: columnWidth }, columnPosition) => {
          const selected = index === cursor && focus === "scope";
          const cells = taskTreeCells(item, selectedIds.has(item.node.id), selected);
          const cell = cells[columnIndex] ?? "";
          return <Box key={columnIndex} width={columnWidth} marginLeft={columnPosition > 0 ? 1 : 0}><Text color={selected ? COLOR.accent : columnIndex === 1 ? displayStatusColor(displayStatusForNode(item.node)) : selectedIds.has(item.node.id) ? COLOR.accentSoft : COLOR.text} bold={selected || selectedIds.has(item.node.id)} wrap="truncate">{fit(cell, columnWidth, columnIndex === 2 || columnIndex === 3 ? "right" : undefined)}</Text></Box>;
        })}
      </Box>)}
      {windowed.below > 0 ? <Text color={COLOR.faint}>{fit(`↓ ${windowed.below} more`, contentWidth)}</Text> : null}
      {rows.length === 0 ? <Text color={COLOR.muted}>No child work.</Text> : null}
    </Box>
  </Pane>;
}

export interface TaskDetailXrayRow {
  readonly id: string;
  readonly nodeId?: string;
  readonly text: string;
  readonly color?: string;
}

export function taskDetailXrayRows(hierarchy: RepoTaskDetailHierarchy): readonly TaskDetailXrayRow[] {
  const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]));
  const rows: TaskDetailXrayRow[] = [{ id: `root:${hierarchy.root.id}`, nodeId: hierarchy.root.id, text: `ROOT ${hierarchy.root.title}` }];
  const seen = new Set<string>();
  const seenRelations = new Set<string>();
  const relationRowsFor = (subjectId: string): void => {
    for (const relation of hierarchy.relations ?? []) {
      if (relation.kind === "contains" || (relation.fromId !== subjectId && relation.toId !== subjectId) || seenRelations.has(relation.id)) continue;
      seenRelations.add(relation.id);
      const outgoing = relation.fromId === subjectId;
      let text: string;
      let color: string | undefined;
      if (relation.kind === "blocks") {
        text = outgoing ? `  ! blocks ${relation.toTitle}` : `  ! blocked by ${relation.fromTitle}`;
        color = COLOR.danger;
      } else if (relation.kind === "depends_on") {
        text = outgoing ? `  → depends on ${relation.toTitle}` : `  ← dependency of ${relation.fromTitle}`;
        color = COLOR.warn;
      } else {
        const marker = relation.directed ? (outgoing ? "→" : "←") : "↔";
        text = `  ${marker} ${relation.kind.replaceAll("_", " ")} ${outgoing ? relation.toTitle : relation.fromTitle}`;
        color = COLOR.muted;
      }
      rows.push({ id: relation.id, text, color });
    }
  };
  relationRowsFor(hierarchy.root.id);
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (!node) return;
    const status = displayStatusForNode(node);
    rows.push({ id: `contains:${node.id}`, nodeId: node.id, text: `${"  ".repeat(Math.max(0, node.depth - hierarchy.root.depth))}↓ contains ${treeTypeLabel(node.kind)} ${node.title} · ${displayStatusLabel(status)}`, color: displayStatusColor(status) });
    relationRowsFor(node.id);
    for (const childId of node.childIds) visit(childId);
  };
  for (const childId of hierarchy.root.childIds) visit(childId);
  return rows;
}

function TaskHealthStrip({ summary, width }: { readonly summary: TaskDetailHealthSummary; readonly width: number }) {
  const barWidth = Math.min(18, Math.max(6, width - 62));
  const filled = Math.round((Math.max(0, Math.min(100, summary.percentDone)) / 100) * barWidth);
  const bar = `${"━".repeat(filled)}${"·".repeat(Math.max(0, barWidth - filled))}`;
  return <Box width={width}>
    <Text color={COLOR.accent} bold wrap="truncate">{fit(`HEALTH ${bar} ${summary.done}/${summary.total} · ${summary.percentDone}% · !${summary.blockerCount} blocked · ${summary.inProgress} active · ${summary.needsVerification} verify · ${summary.reservations} reserved`, width)}</Text>
  </Box>;
}

function TaskXrayPane({ hierarchy, width, height, focus, cursor }: { readonly hierarchy: RepoTaskDetailHierarchy; readonly width: number; readonly height?: number; readonly focus: TaskDetailFocus; readonly cursor: number }) {
  const outerHeight = Math.max(1, Math.floor(height ?? 24));
  const contentWidth = Math.max(1, width - 4);
  const rows = taskDetailXrayRows(hierarchy);
  const selectedIndex = Math.max(0, Math.min(cursor, Math.max(0, rows.length - 1)));
  const listHeight = Math.max(1, outerHeight - 6);
  const windowed = windowList(rows, selectedIndex, listHeight);
  return <Pane title={`${focus === "scope" ? "X-RAY · FOCUS" : "X-RAY"} · dependencies`} tone={focus === "scope" ? COLOR.accent : COLOR.muted} width={width} height={height}>
    <Text color={COLOR.faint} wrap="truncate">{fit(`${hierarchy.nodes.length} descendants · relationship view`, contentWidth)}</Text>
    <Text color={focus === "scope" ? COLOR.accent : COLOR.faint} wrap="truncate">{fit(focus === "scope" ? "j/k move · PgUp/PgDn page · x tree · enter open" : "tab to focus dependencies", contentWidth)}</Text>
    <Box flexDirection="column" height={listHeight}>
      {windowed.above > 0 ? <Text color={COLOR.faint}>{fit(`↑ ${windowed.above} more`, contentWidth)}</Text> : null}
      {windowed.rows.map(({ item, index }) => <Text key={item.id} color={index === selectedIndex && focus === "scope" ? COLOR.accent : item.color ?? COLOR.text} bold={index === selectedIndex && focus === "scope"} wrap="truncate">{fit(`${index === selectedIndex && focus === "scope" ? "▸ " : "  "}${item.text}`, contentWidth)}</Text>)}
      {windowed.below > 0 ? <Text color={COLOR.faint}>{fit(`↓ ${windowed.below} more`, contentWidth)}</Text> : null}
    </Box>
  </Pane>;
}

export function TaskDetailRoute({ body, width, selectedActionIndex, height, scrollOffset = 0, treeCursor = 0, expandedIds, focus = "actions", paneVisible = true, maximized, layoutMode = "right", panel = "tree", selectedIds = new Set<string>(), filterQuery = "", filterOpen = false }: {
  readonly body: RepoTaskDetailBody;
  readonly width: number;
  readonly selectedActionIndex: number;
  readonly height?: number;
  readonly scrollOffset?: number;
  readonly treeCursor?: number;
  readonly expandedIds?: ReadonlySet<string>;
  readonly focus?: TaskDetailFocus;
  readonly paneVisible?: boolean;
  readonly maximized?: TaskDetailMaximizedPane;
  readonly layoutMode?: TaskDetailLayoutMode;
  readonly panel?: TaskDetailPanel;
  readonly selectedIds?: ReadonlySet<string>;
  readonly filterQuery?: string;
  readonly filterOpen?: boolean;
}) {
  const hasHierarchy = taskDetailHasHierarchy(body);
  const outerHeight = Math.max(1, Math.floor(height ?? 24));
  const hierarchy = body.hierarchy;
  const health = hierarchy ? taskDetailHealthSummary(hierarchy) : undefined;
  const chromeHeight = health ? 1 : 0;
  const contentHeight = Math.max(1, outerHeight - chromeHeight);
  const layout = taskDetailLayout(width, hasHierarchy && paneVisible && !maximized, contentHeight, layoutMode);
  const detail = <TaskDetailPane body={body} width={maximized === "detail" || !layout.split ? width : layout.detailWidth} height={maximized === "detail" || !layout.split ? contentHeight : layout.detailHeight} selectedActionIndex={selectedActionIndex} scrollOffset={scrollOffset} focus={focus} />;
  const rows = hierarchy ? visibleTaskDetailRows(hierarchy, expandedIds ?? defaultTaskDetailDisclosure(hierarchy)) : [];
  const filteredRows = filterTaskDetailRows(rows, filterQuery);
  const scope = hierarchy && paneVisible ? panel === "xray"
    ? <TaskXrayPane hierarchy={hierarchy} cursor={treeCursor} width={layout.scopeWidth || width} height={layout.scopeHeight || contentHeight} focus={focus} />
    : <TaskScopePane hierarchy={hierarchy} rows={filteredRows} cursor={treeCursor} width={layout.scopeWidth || width} height={layout.scopeHeight || contentHeight} focus={focus} selectedIds={selectedIds} filterQuery={filterQuery} filterOpen={filterOpen} />
    : null;
  let content: ReactNode = detail;
  if (maximized === "scope" && hierarchy && paneVisible) content = scope;
  else if (layout.split && scope) content = layout.direction === "bottom"
    ? <Box flexDirection="column" width={width} height={contentHeight} overflow="hidden">{detail}<Box height={1} />{scope}</Box>
    : <Box flexDirection="row" width={width} height={contentHeight} overflow="hidden">{detail}<Box width={1} />{scope}</Box>;
  return <Box flexDirection="column" width={width} height={height} overflow="hidden">
    {health ? <TaskHealthStrip summary={health} width={width} /> : null}
    {content}
  </Box>;
}
