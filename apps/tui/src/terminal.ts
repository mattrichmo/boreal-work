import { MountedView, StatusItem, workflowDisplayState } from "./client.js";

function selectedLabel(item: StatusItem | null): string {
  if (!item) return "(none)";
  return `${item.work_id}${item.title ? ` — ${item.title}` : ""}`;
}

/** Render one deterministic, pipe-friendly terminal snapshot. */
export function renderMountedView(view: MountedView): string {
  const lines = [
    "Boreal v2 TUI",
    `route: ${view.route.kind}${view.route.project_id ? ` project=${view.route.project_id}` : ""}${view.route.work_id ? ` work=${view.route.work_id}` : ""}`,
    `mounted: ${view.mounted}`,
  ];
  if (view.monitoring) {
    lines.push(`revision: ${view.monitoring.revision} as_of=${view.monitoring.as_of}`);
    lines.push(`counts: total=${view.monitoring.total} ready=${view.monitoring.counts.ready} queued=${view.monitoring.counts.queued} blocked=${view.monitoring.counts.blocked} in_progress=${view.monitoring.counts.in_progress} closed=${view.monitoring.counts.closed}`);
    for (const item of view.monitoring.items) {
      lines.push(`- ${item.work_id}: ${workflowDisplayState(item)} (${item.claimable ? "claimable" : "not claimable"}) — ${item.next_action ?? "inspect"}`);
    }
  }
  lines.push(`selected: ${selectedLabel(view.selected_work)}`);
  if (view.selected_work) {
    lines.push(`actions: ${view.actions.filter((action) => action.action !== "create_project" && action.action !== "create_work").map((action) => `${action.action}=${action.enabled ? "enabled" : `disabled:${action.reason ?? "unavailable"}`}`).join(" ")}`);
  }
  if (view.notice) lines.push(`notice: ${view.notice.kind} — ${view.notice.message}`);
  return `${lines.join("\n")}\n`;
}
