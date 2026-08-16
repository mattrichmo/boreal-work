import type { WorkItemView } from "@boreal/ui-model";

export type TuiReconciliationStepStatus = "complete" | "pending" | "blocked" | "not_modeled";

export interface TuiReconciliationStep {
  readonly id: "review" | "update" | "revalidate" | "reconcile" | "advance";
  readonly label: string;
  readonly status: TuiReconciliationStepStatus;
  readonly detail: string;
}

export interface TuiReconciliationStatus {
  readonly overall: TuiReconciliationStepStatus;
  readonly steps: readonly TuiReconciliationStep[];
}

/** Keep the TUI honest about what its current route envelope can prove. */
export function reconciliationStatusForWork(work: WorkItemView): TuiReconciliationStatus {
  const gates = work.requiredCloseoutGates ?? [];
  const openGates = gates.filter((gate) => gate.status === "open");
  const reviewGates = gates.filter((gate) => gate.kind === "review");
  const verificationGates = gates.filter((gate) => gate.kind === "verification");
  const directiveSummary = work.directiveSummary;
  // `toWorkItemView` folds named directive blockers into activeBlockerIds;
  // retain the aggregate signals as well so conflict and missing-required
  // directives remain blocking even when their bundle did not provide IDs.
  const directiveBlockers =
    (directiveSummary?.blocking ?? 0) +
    (directiveSummary?.conflictCount ?? 0) +
    (directiveSummary?.required ?? 0) +
    (directiveSummary?.missingRequiredCount ?? 0);
  const blockers = work.activeBlockerIds.length + directiveBlockers;
  const obligations = work.reconciliationObligations ?? [];
  const openObligations = obligations.filter((obligation) => obligation.status !== "reconciled");
  const unresolvedObligations = blockers + openObligations.length;

  const review = reviewGates.length === 0
    ? makeStep("review", "Review findings", "not_modeled", "no review gate in this route envelope")
    : makeStep(
        "review",
        "Review findings",
        satisfied(reviewGates) ? "complete" : "pending",
        satisfied(reviewGates) ? "review gate satisfied" : `${open(reviewGates)} review gate${open(reviewGates) === 1 ? "" : "s"} open`
      );
  const update = obligations.length === 0 && blockers === 0 && work.evidenceCount === 0
    ? makeStep("update", "Resolve / update", "not_modeled", "no finding or update obligation in this route envelope")
    : makeStep(
        "update",
        "Resolve / update",
        openObligations.length > 0 || blockers > 0 ? "blocked" : "pending",
        openObligations.length > 0
          ? `${openObligations.length} reconciliation obligation${openObligations.length === 1 ? "" : "s"} remain open`
          : blockers > 0 ? `${blockers} blocker, directive, or conflict signal${blockers === 1 ? "" : "s"} remain` : "evidence exists; artifact or contract update is not reported"
      );
  const verificationOpen = open(verificationGates);
  const revalidate = verificationGates.length === 0 && work.evidenceCount === 0
    ? makeStep("revalidate", "Revalidate", "not_modeled", "no verification evidence in this route envelope")
    : makeStep(
        "revalidate",
        "Revalidate",
        verificationOpen > 0 || work.evidenceCount > work.verificationCount ? "pending" : "complete",
        verificationOpen > 0
          ? `${verificationOpen} verification gate${verificationOpen === 1 ? "" : "s"} open`
          : work.evidenceCount > work.verificationCount
            ? `${work.evidenceCount - work.verificationCount} evidence item${work.evidenceCount - work.verificationCount === 1 ? "" : "s"} await verification`
            : "verification evidence is current"
      );
  const reconcile = gates.length === 0 && obligations.length === 0 && unresolvedObligations === 0
    ? makeStep("reconcile", "Reconcile", "not_modeled", "no reconciliation receipt in this route envelope")
    : makeStep(
        "reconcile",
        "Reconcile",
        openGates.length > 0 || unresolvedObligations > 0 ? "blocked" : "complete",
        openGates.length > 0
          ? `${openGates.length} closeout gate${openGates.length === 1 ? "" : "s"} open`
          : openObligations.length > 0
            ? `${openObligations.length} reconciliation obligation${openObligations.length === 1 ? "" : "s"} remain open`
            : blockers > 0 ? "resolve findings and update artifacts before advancing" : "represented gates and blockers reconcile"
      );
  const advance = (work.status === "closed" || work.status === "verified") && unresolvedObligations === 0
    ? makeStep("advance", "Advance", "complete", "work is already terminal")
    : makeStep(
        "advance",
        "Advance",
        openGates.length > 0 || unresolvedObligations > 0 || revalidate.status === "pending" ? "blocked" : "pending",
        openGates.length > 0 || unresolvedObligations > 0 || revalidate.status === "pending" ? "blocked until reconciliation is complete" : "ready for the next workflow step once reconciliation is recorded"
      );
  const steps = [review, update, revalidate, reconcile, advance] as const;
  return {
    overall: steps.some((step) => step.status === "blocked")
      ? "blocked"
      : steps.some((step) => step.status === "pending")
        ? "pending"
        : steps.every((step) => step.status === "complete")
          ? "complete"
          : "not_modeled",
    steps
  };
}

function makeStep(
  id: TuiReconciliationStep["id"],
  label: string,
  status: TuiReconciliationStepStatus,
  detail: string
): TuiReconciliationStep {
  return { id, label, status, detail };
}

function satisfied(gates: readonly NonNullable<WorkItemView["requiredCloseoutGates"]>[number][]): boolean {
  return gates.length > 0 && gates.every((gate) => gate.status === "satisfied" || gate.status === "forced");
}

function open(gates: readonly NonNullable<WorkItemView["requiredCloseoutGates"]>[number][]): number {
  return gates.filter((gate) => gate.status === "open").length;
}
