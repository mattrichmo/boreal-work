import { DashboardFilter, MountedView, StatusItem, workflowDisplayState } from "./client.js";

export interface RenderOptions {
  readonly width?: number;
  readonly height?: number;
  readonly interactive?: boolean;
  readonly help_visible?: boolean;
  readonly pending_confirmation?: string | null;
  readonly status_message?: string | null;
  readonly filter?: DashboardFilter;
  readonly search_query?: string;
  readonly selected_index?: number;
  readonly palette_visible?: boolean;
  readonly search_editing?: boolean;
  readonly search_buffer?: string;
  readonly summary_editing?: boolean;
  readonly summary_buffer?: string;
}

function boundedDimension(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

/** Remove terminal-control and bidi characters from service/user text. */
export function sanitizeTerminalText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)) {
      return "�";
    }
    return character;
  }).join("");
}

function clip(line: string, width: number): string {
  if (line.length <= width) return line;
  if (width <= 1) return line.slice(0, width);
  return `${line.slice(0, width - 1)}…`;
}

function fitHeight(lines: string[], height: number): string[] {
  if (lines.length <= height) return lines;
  const head = Math.min(5, Math.max(1, height - 2));
  const tail = Math.max(0, height - head - 1);
  return [...lines.slice(0, head), "…", ...(tail > 0 ? lines.slice(-tail) : [])];
}

function selectedLabel(item: StatusItem | null): string {
  if (!item) return "(none)";
  return `${item.work_id}${item.title ? `: ${item.title}` : ""}`;
}

function routeLabel(view: MountedView): string {
  if (view.route.kind === "work") return `WORK DETAIL / ${view.route.work_id ?? "unknown"}`;
  if (view.route.kind === "project") return `PROJECT / ${view.route.project_id ?? "unknown"}`;
  return "NOW / MONITORING";
}

function filterLabel(filter: DashboardFilter): string {
  switch (filter) {
    case "all": return "ALL";
    case "active": return "ACTIVE";
    case "expired": return "EXPIRED REVIEW";
    case "milestones": return "MILESTONES";
    case "sprints": return "SPRINTS";
    case "tasks": return "TASKS";
    default: return filter.toUpperCase();
  }
}

function isActive(item: StatusItem): boolean {
  return ["claimed", "in_progress", "needs_verification", "awaiting_review", "complete"].includes(item.display_status ?? item.status);
}

function itemMatchesFilter(item: StatusItem, filter: DashboardFilter): boolean {
  const status = item.display_status ?? item.status;
  switch (filter) {
    case "all": return true;
    case "active": return isActive(item);
    case "expired": return status === "expired_review";
    case "milestones": return item.kind === "milestone";
    case "sprints": return item.kind === "sprint";
    case "tasks": return item.kind === "task";
    default: return status === filter;
  }
}

function visibleItems(view: MountedView, options: RenderOptions): StatusItem[] {
  const filter = options.filter ?? "all";
  const query = options.search_query?.trim().toLocaleLowerCase();
  return (view.monitoring?.items ?? []).filter((item) => {
    if (!itemMatchesFilter(item, filter)) return false;
    if (!query) return true;
    return [item.work_id, item.title, item.description, item.parent_id, item.kind]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
}

function stateSummary(view: MountedView, narrow: boolean): string {
  if (!view.monitoring) return "service unavailable";
  const counts = view.monitoring.counts;
  if (narrow) {
    return `R ${counts.ready}  Q ${counts.queued}  B ${counts.blocked}  A ${counts.in_progress}  X ${counts.expired_review}`;
  }
  return [
    `total ${view.monitoring.total}`,
    `ready ${counts.ready}`,
    `queued ${counts.queued}`,
    `blocked ${counts.blocked}`,
    `active ${counts.in_progress}`,
    `expired ${counts.expired_review}`,
    `closed ${counts.closed}`,
  ].join("  ");
}

function renderItem(item: StatusItem, narrow: boolean, selected: boolean): string {
  const reason = item.reason_codes.length > 0 ? ` | ${item.reason_codes.join(", ")}` : "";
  const attempt = item.attempt ? ` | attempt ${item.attempt.attempt_id}@${item.attempt.fence}` : "";
  const state = workflowDisplayState(item);
  const marker = selected ? ">" : " ";
  const kind = item.kind ? `[${item.kind}] ` : "";
  if (item.diagnostic) {
    const state = "CORRUPT";
    if (narrow) return `${marker}${state.padEnd(9)} ${kind}${item.work_id}${item.title ? ` | ${item.title}` : ""}`;
    return `${marker} ${state.padEnd(17)} ${kind}${item.work_id}: unreadable record | ${item.diagnostic.code}`;
  }
  if (narrow) return `${marker}${state.toUpperCase().padEnd(9)} ${kind}${item.work_id}${item.title ? ` | ${item.title}` : ""}`;
  const parent = item.parent_id ? ` | parent ${item.parent_id}` : "";
  const priority = item.priority === undefined ? "" : ` | p${item.priority}`;
  const due = item.due_at ? ` | due ${item.due_at}` : "";
  return `${marker} ${state.toUpperCase().padEnd(17)} ${kind}${item.work_id}: ${state}${item.title ? ` | ${item.title}` : ""}${parent}${priority}${due}${attempt}${reason}`;
}

function renderSelected(item: StatusItem | null, narrow: boolean, receiptAvailable = false): string[] {
  if (!item) return ["", "SELECTED", narrow ? "  None. Use j/k, Enter." : "  No work selected. Use: select WORK_ID"];
  const lines = ["", "SELECTED", `  ${selectedLabel(item)}`, `  state: ${workflowDisplayState(item)}  claimable: ${item.claimable ? "yes" : "no"}`];
  if (item.diagnostic) {
    lines.push(`  CORRUPT: ${item.diagnostic.code}`, `  ${item.diagnostic.detail}`, "  actions: unavailable until the record is repaired");
    return lines;
  }
  if (narrow) {
    if (item.next_action) lines.push(`  next: ${item.next_action}`);
    if (item.gates?.open.length) lines.push(`  gates: ${item.gates.open.map((gate) => gate.gate_id).join(", ")}`);
    return lines;
  }
  if (item.next_action) lines.push(`  next: ${item.next_action}`);
  if (item.attempt) {
    lines.push(`  attempt: ${item.attempt.attempt_id}@${item.attempt.fence} phase=${item.attempt.phase ?? "unknown"}`);
    if (item.attempt.actor_id) lines.push(`  owner: ${item.attempt.actor_id}`);
    if (item.attempt.session_id) lines.push(`  session: ${item.attempt.session_id}`);
    if (item.attempt.lease_deadline) lines.push(`  lease: ${item.attempt.lease_deadline}`);
    if (item.attempt.hard_deadline) lines.push(`  hard deadline: ${item.attempt.hard_deadline}`);
  }
  if (item.gates?.open.length) lines.push(`  open gates: ${item.gates.open.map((gate) => gate.gate_id).join(", ")}`);
  if (item.gates?.satisfied.length) lines.push(`  satisfied gates: ${item.gates.satisfied.map((gate) => gate.gate_id).join(", ")}`);
  if (item.kind) lines.push(`  kind: ${item.kind}${item.parent_id ? `  parent: ${item.parent_id}` : ""}`);
  if (item.priority !== undefined || item.dispatch_policy) {
    lines.push(`  planning: priority=${item.priority ?? "unknown"} dispatch=${item.dispatch_policy ?? "unknown"}`);
  }
  if (item.due_at) lines.push(`  due: ${item.due_at}`);
  if (item.description) lines.push(`  description: ${item.description}`);
  if (item.dependencies?.length) {
    lines.push("  dependencies:", ...item.dependencies.slice(0, 8).map((dependency) =>
      `    ${dependency.work_id}${dependency.status ? ` [${dependency.status}]` : ""}${dependency.satisfied === undefined ? "" : dependency.satisfied ? " ✓" : " · open"}`));
    if (item.dependencies.length > 8) lines.push(`    … ${item.dependencies.length - 8} more`);
  } else if (item.kind === "task") {
    lines.push("  dependencies: not included by the current status route");
  }
  if (item.activity?.length) {
    lines.push("  recent activity:", ...item.activity.slice(-5).map((event) =>
      `    ${event.occurred_at ?? "unknown time"} ${event.kind}${event.summary ? ` — ${event.summary}` : ""}`));
  } else {
    lines.push("  history: bounded activity route unavailable");
  }
  lines.push(`  evidence: ${receiptAvailable ? "current receipt captured in this session" : "no current receipt captured in this session"}`);
  if (item.reason_codes.length) lines.push(`  reasons: ${item.reason_codes.join(", ")}`);
  return lines;
}

/** Render a deterministic dashboard snapshot that is useful in a pipe or a terminal. */
export function renderMountedView(view: MountedView, options: RenderOptions = {}): string {
  const width = boundedDimension(options.width, 120, 20);
  const height = boundedDimension(options.height, 200, 8);
  const narrow = width < 72;
  const filter = options.filter ?? "all";
  const items = visibleItems(view, options);
  const selectedIndex = Math.min(Math.max(options.selected_index ?? 0, 0), Math.max(items.length - 1, 0));
  const lines = [
    narrow ? "BOREAL WORK" : "BOREAL / WORK DASHBOARD",
    `${routeLabel(view)}  |  ${view.mounted ? "CONNECTED" : "UNMOUNTED"}  |  ${filterLabel(filter)}`,
  ];
  if (view.monitoring) {
    lines.push(narrow
      ? `rev ${view.monitoring.revision}  ${view.monitoring.as_of}`
      : `revision ${view.monitoring.revision}  |  as of ${view.monitoring.as_of}`);
    if (view.monitoring.next_status_change_at && !narrow) lines.push(`next status change ${view.monitoring.next_status_change_at}`);
    lines.push(stateSummary(view, narrow));
    if (view.monitoring.truncated) lines.push("RESULTS TRUNCATED: use a narrower view or detail read");
    lines.push("", `WORK QUEUE (${items.length}${view.monitoring.total !== items.length ? ` of ${view.monitoring.total}` : ""})`);
    if (options.search_query) lines.push(`search: ${options.search_query}`);
    const reservedRows = options.interactive ? 12 : 8;
    const availableRows = Math.max(1, height - lines.length - reservedRows);
    const pageStart = Math.min(Math.max(selectedIndex - Math.floor(availableRows / 2), 0), Math.max(items.length - availableRows, 0));
    const pageItems = items.slice(pageStart, pageStart + availableRows);
    for (const [index, item] of pageItems.entries()) {
      lines.push(renderItem(item, narrow, pageStart + index === selectedIndex));
    }
    if (pageStart > 0 || pageStart + pageItems.length < items.length) {
      lines.push(`  … showing ${pageStart + 1}-${pageStart + pageItems.length} of ${items.length}`);
    }
  }
  lines.push(...renderSelected(view.selected_work, narrow, view.selected_receipt_available));
  if (view.selected_work) {
    const workActions = view.actions.filter((action) => action.action !== "create_project" && action.action !== "create_work");
    if (narrow) {
      lines.push("", `ACTIONS ${workActions.filter((action) => action.enabled).map((action) => action.action).join("  ") || "none available"}`);
    } else {
      lines.push("", "ACTIONS", ...workActions
        .map((action) => `  ${action.action.padEnd(14)} ${action.enabled ? "ready" : `disabled: ${action.reason ?? "unavailable"}`}`));
    }
  }
  if (options.pending_confirmation) lines.push("", `CONFIRM: ${options.pending_confirmation}  [y] yes  [n] no`);
  if (options.search_editing) lines.push("", `SEARCH: ${options.search_buffer ?? ""}_  [enter] apply  [esc] cancel  [backspace] delete`);
  if (options.summary_editing) lines.push("", `FINISH SUMMARY: ${options.summary_buffer ?? ""}_  [enter] continue  [esc] cancel`);
  if (options.palette_visible) {
    lines.push("", "COMMAND PALETTE", "  1 all   2 ready   3 active   4 blocked   5 expired   6 closed",
      "  7 milestones   8 sprints   9 tasks   / search   r refresh   ? help",
      "  edit/dependencies/cycles/intake/source/memory/session recovery: disabled until service routes exist");
  }
  if (options.help_visible) {
    lines.push("", "KEYS", "  j/↓ next  k/↑ previous  Enter detail  Esc back", "  1-9 filters  / search  p palette  r refresh  ] next page", "  c claim  s start  f finish  x release  ? help  q quit");
  } else if (options.interactive) {
    lines.push("", "j/k move  1-9 filters  / search  p palette  Enter detail  r refresh  ] next page  ? help  q quit");
  } else {
    lines.push("", "COMMANDS", "  select WORK_ID  |  refresh  |  claim  |  accept-start  |  evidence  |  finish  |  release  |  quit");
  }
  if (view.pending_operations.length > 0) {
    lines.push("", "PENDING READBACK", ...view.pending_operations.map((operation) =>
      `  ${operation.action}${operation.work_id ? ` work=${operation.work_id}` : ""} operation=${operation.operation_id}`));
  }
  if (view.notice) lines.push("", `NOTICE: ${view.notice.kind}: ${view.notice.message}`);
  const unavailable = (view.capabilities ?? []).filter((capability) => capability.status === "unavailable");
  if (unavailable.length && (options.palette_visible || options.help_visible || !options.interactive)) {
    lines.push("", "SERVICE ROUTES NOT YET AVAILABLE", ...unavailable.slice(0, 5).map((capability) =>
      `  ${capability.route}: ${capability.reason}`));
  }
  if (options.status_message) lines.push("", `STATUS: ${options.status_message}`);
  return `${fitHeight(lines.map((line) => clip(sanitizeTerminalText(line), width)), height).join("\n")}\n`;
}
