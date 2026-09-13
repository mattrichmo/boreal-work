import type { RollupNodeView } from "@boreal/ui-model";

import { COLOR, statusColor, statusGlyph, statusLabel } from "./theme.js";

/**
 * Persisted work statuses describe a record. Container rows need a semantic
 * status derived from their descendants so a closed milestone with open work
 * cannot present itself as complete.
 */
export function displayStatusForNode(node: Pick<RollupNodeView, "workStatus" | "childIds" | "progress" | "blockerSummary">): string {
  const raw = node.workStatus;
  if (raw === "blocked" || node.blockerSummary.activeBlockerCount > 0) return "blocked";
  if (raw === "needs_verification") return "needs_verification";
  if (node.childIds.length > 0) {
    if (node.progress.total > 0 && node.progress.open === 0) return "complete";
    if (node.progress.done > 0 || raw === "closed" || raw === "verified") return "in_progress";
  }
  if (raw === "closed" || raw === "verified") return "complete";
  return raw ?? "draft";
}

export function displayStatusLabel(status: string): string {
  return statusLabel(status);
}

export function displayStatusGlyph(status: string): string {
  return statusGlyph(status);
}

export function displayStatusColor(status: string): string {
  return status === "complete" ? COLOR.accent : statusColor(status);
}
