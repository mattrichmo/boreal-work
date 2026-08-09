import type { WorkItemView } from "@boreal/ui-model";

export type ReconciliationStepId = "review" | "update" | "revalidate" | "reconcile" | "advance";
export type ReconciliationStepStatus = "complete" | "pending" | "blocked" | "not_modeled";

export interface ReconciliationStepView {
  readonly id: ReconciliationStepId;
  readonly label: string;
  readonly status: ReconciliationStepStatus;
  readonly detail: string;
}

export interface ReconciliationStatusView {
  readonly overall: ReconciliationStepStatus;
  readonly steps: readonly ReconciliationStepView[];
  readonly caveat: string;
}

/**
 * Derives the user-visible reconciliation chain from the persisted work view.
 * Missing optional fields remain explicitly `not_modeled` for legacy records.
 */
export function reconciliationStatusForWork(work: WorkItemView): ReconciliationStatusView {
  const gates = work.requiredCloseoutGates ?? [];
  const openGates = gates.filter((gate) => gate.status === "open");
  const reviewGates = gates.filter((gate) => gate.kind === "review");
  const verificationGates = gates.filter((gate) => gate.kind === "verification");
  const directiveSummary = work.directiveSummary;
  const blockingDirectives = (directiveSummary?.blocking ?? 0) + (directiveSummary?.conflictCount ?? 0);
  const requiredDirectives = directiveSummary?.required ?? 0;
  const activeBlockers = work.activeBlockerIds.length;
  const obligations = work.reconciliationObligations ?? [];
  const openObligations = obligations.filter((obligation) => obligation.status !== "reconciled");
  const unresolvedObligations = openObligations.length + activeBlockers + blockingDirectives + requiredDirectives;

  const review: ReconciliationStepView = reviewGates.length === 0
    ? step("review", "Review findings", "not_modeled", "No review gate is represented in this view.")
    : step(
        "review",
        "Review findings",
        allGatesSatisfied(reviewGates) ? "complete" : "pending",
        allGatesSatisfied(reviewGates) ? "Review gate satisfied." : `${openCount(reviewGates)} review gate${openCount(reviewGates) === 1 ? "" : "s"} open.`
      );

  const update: ReconciliationStepView = obligations.length === 0 && unresolvedObligations === 0 && work.evidenceCount === 0
    ? step("update", "Resolve / update", "not_modeled", "No finding or update obligation is represented in this view.")
    : step(
        "update",
        "Resolve / update",
        openObligations.length > 0 || unresolvedObligations > 0 ? "blocked" : "pending",
        openObligations.length > 0
          ? `${openObligations.length} reconciliation obligation${openObligations.length === 1 ? "" : "s"} remain open.`
          : unresolvedObligations > 0
            ? `${unresolvedObligations} blocker, directive, or conflict signal${unresolvedObligations === 1 ? "" : "s"} remain.`
            : "Evidence exists; the affected contract or artifact update is not reported here."
      );

  const revalidateOpen = verificationGates.filter((gate) => gate.status === "open").length;
  const revalidate: ReconciliationStepView = verificationGates.length === 0 && work.evidenceCount === 0
    ? step("revalidate", "Revalidate", "not_modeled", "No verification evidence is represented in this view.")
    : step(
        "revalidate",
        "Revalidate",
        revalidateOpen > 0 || work.evidenceCount > work.verificationCount ? "pending" : "complete",
        revalidateOpen > 0
          ? `${revalidateOpen} verification gate${revalidateOpen === 1 ? "" : "s"} still open.`
          : work.evidenceCount > work.verificationCount
            ? `${work.evidenceCount - work.verificationCount} evidence item${work.evidenceCount - work.verificationCount === 1 ? "" : "s"} await verification.`
            : "Verification evidence is current in this view."
      );

  const reconcile: ReconciliationStepView = gates.length === 0 && obligations.length === 0 && unresolvedObligations === 0
    ? step("reconcile", "Reconcile", "not_modeled", "No reconciliation receipt is represented in this view.")
    : step(
        "reconcile",
        "Reconcile",
        openGates.length > 0 || unresolvedObligations > 0 ? "blocked" : "complete",
        openGates.length > 0
          ? `${openGates.length} closeout gate${openGates.length === 1 ? "" : "s"} remain open.`
          : openObligations.length > 0
            ? `${openObligations.length} reconciliation obligation${openObligations.length === 1 ? "" : "s"} remain open.`
          : unresolvedObligations > 0
            ? "Resolve findings and update affected artifacts before advancing."
            : "All represented gates and blockers reconcile."
      );

  const advance: ReconciliationStepView = (work.status === "closed" || work.status === "verified") && unresolvedObligations === 0
    ? step("advance", "Advance", "complete", "Work is already in a terminal advancement state.")
    : step(
        "advance",
        "Advance",
        openGates.length > 0 || unresolvedObligations > 0 || revalidate.status === "pending" ? "blocked" : "pending",
        openGates.length > 0 || unresolvedObligations > 0 || revalidate.status === "pending"
          ? "Blocked until findings, updates, verification, and reconciliation are complete."
          : "Ready for the next workflow step once reconciliation is recorded."
      );

  const steps = [review, update, revalidate, reconcile, advance] as const;
  const overall = steps.some((item) => item.status === "blocked")
    ? "blocked"
    : steps.some((item) => item.status === "pending")
      ? "pending"
      : steps.every((item) => item.status === "complete")
        ? "complete"
        : "not_modeled";
  return {
    overall,
    steps,
    caveat: "Derived from persisted reconciliation obligations, evidence, verification, closeout-gate, blocker, and directive fields; missing legacy stages are shown as not modeled."
  };
}

function step(
  id: ReconciliationStepId,
  label: string,
  status: ReconciliationStepStatus,
  detail: string
): ReconciliationStepView {
  return { id, label, status, detail };
}

function allGatesSatisfied(gates: readonly NonNullable<WorkItemView["requiredCloseoutGates"]>[number][]): boolean {
  return gates.length > 0 && gates.every((gate) => gate.status === "satisfied" || gate.status === "forced");
}

function openCount(gates: readonly NonNullable<WorkItemView["requiredCloseoutGates"]>[number][]): number {
  return gates.filter((gate) => gate.status === "open").length;
}
