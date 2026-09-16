import { MountedView, StatusItem, workflowDisplayState } from "./client.js";

export interface RenderOptions {
  readonly width?: number;
  readonly height?: number;
  readonly interactive?: boolean;
  readonly help_visible?: boolean;
  readonly pending_confirmation?: string | null;
  readonly status_message?: string | null;
}

function boundedDimension(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
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

function renderItem(item: StatusItem, narrow: boolean): string {
  const reason = item.reason_codes.length > 0 ? ` | ${item.reason_codes.join(", ")}` : "";
  const attempt = item.attempt ? ` | attempt ${item.attempt.attempt_id}@${item.attempt.fence}` : "";
  const state = workflowDisplayState(item);
  if (narrow) return `${state.toUpperCase().padEnd(9)} ${item.work_id}${item.title ? ` | ${item.title}` : ""}`;
  return `  ${state.toUpperCase().padEnd(17)} ${item.work_id}: ${state}${item.title ? ` | ${item.title}` : ""}${attempt}${reason}`;
}

function renderSelected(item: StatusItem | null, narrow: boolean): string[] {
  if (!item) return ["", "SELECTED", narrow ? "  None. Use j/k, Enter." : "  No work selected. Use: select WORK_ID"];
  const lines = ["", "SELECTED", `  ${selectedLabel(item)}`, `  state: ${workflowDisplayState(item)}  claimable: ${item.claimable ? "yes" : "no"}`];
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
  if (item.reason_codes.length) lines.push(`  reasons: ${item.reason_codes.join(", ")}`);
  return lines;
}

/** Render a deterministic dashboard snapshot that is useful in a pipe or a terminal. */
export function renderMountedView(view: MountedView, options: RenderOptions = {}): string {
  const width = boundedDimension(options.width, 120, 20);
  const height = boundedDimension(options.height, 200, 8);
  const narrow = width < 72;
  const lines = [
    narrow ? "BOREAL WORK" : "BOREAL / WORK DASHBOARD",
    `${routeLabel(view)}  |  ${view.mounted ? "CONNECTED" : "UNMOUNTED"}`,
  ];
  if (view.monitoring) {
    lines.push(narrow
      ? `rev ${view.monitoring.revision}  ${view.monitoring.as_of}`
      : `revision ${view.monitoring.revision}  |  as of ${view.monitoring.as_of}`);
    if (view.monitoring.next_status_change_at && !narrow) lines.push(`next status change ${view.monitoring.next_status_change_at}`);
    lines.push(stateSummary(view, narrow));
    if (view.monitoring.truncated) lines.push("RESULTS TRUNCATED: use a narrower view or detail read");
    lines.push("", "WORK QUEUE");
    const reservedRows = options.interactive ? 12 : 8;
    const availableRows = Math.max(1, height - lines.length - reservedRows);
    const visibleItems = view.monitoring.items.slice(0, availableRows);
    for (const item of visibleItems) {
      lines.push(renderItem(item, narrow));
    }
    if (visibleItems.length < view.monitoring.items.length) lines.push(`  … ${view.monitoring.items.length - visibleItems.length} more`);
  }
  lines.push(...renderSelected(view.selected_work, narrow));
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
  if (options.help_visible) {
    lines.push("", "KEYS", "  j/↓ next  k/↑ previous  Enter detail  Esc back", "  r refresh  c claim  s start  f finish  x release  ? help  q quit");
  } else if (options.interactive) {
    lines.push("", "j/k move  Enter detail  r refresh  ? help  q quit");
  } else {
    lines.push("", "COMMANDS", "  select WORK_ID  |  refresh  |  claim  |  accept-start  |  evidence  |  finish  |  release  |  quit");
  }
  if (view.pending_operations.length > 0) {
    lines.push("", "PENDING READBACK", ...view.pending_operations.map((operation) =>
      `  ${operation.action}${operation.work_id ? ` work=${operation.work_id}` : ""} operation=${operation.operation_id}`));
  }
  if (view.notice) lines.push("", `NOTICE: ${view.notice.kind}: ${view.notice.message}`);
  if (options.status_message) lines.push("", `STATUS: ${options.status_message}`);
  return `${fitHeight(lines.map((line) => clip(line, width)), height).join("\n")}\n`;
}
