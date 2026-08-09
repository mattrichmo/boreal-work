import { deterministicId, type OperationId } from "./ids.js";
import type { ReconciliationObligationId, WorkId } from "./ids.js";
import type { EnforcementGap } from "./enforcement-gaps.js";
import { BorealError } from "./errors.js";
import type { ActorRef, WorkItem } from "./records.js";
import type { IsoTimestamp } from "./time.js";
import { touchRecord } from "./factory.js";

export type ReconciliationObligationStatus =
  | "open"
  | "remediation-in-progress"
  | "revalidation-failed"
  | "reconciled"
  | "deferred"
  | "blocked";

export type ReconciliationRequiredChangeKind =
  | "code"
  | "contract"
  | "data"
  | "documentation"
  | "configuration"
  | "generated-artifact";

export interface ReconciliationRequiredChange {
  readonly kind: ReconciliationRequiredChangeKind;
  readonly description: string;
  readonly target?: string;
}

export interface ReconciliationSubjectScope {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly projectId?: string;
}

export type ReconciliationInputValue = string | number | boolean;

export interface ReconciliationObligationDraft {
  readonly findingId: string;
  readonly producerOperationId?: OperationId;
  readonly subjectScope: ReconciliationSubjectScope;
  readonly requiredChanges: readonly ReconciliationRequiredChange[];
  readonly revalidationCommand: string;
  readonly reconciliationInputs: Readonly<Record<string, ReconciliationInputValue>>;
  readonly unlocks?: readonly WorkId[];
}

export interface ReconciliationObligation {
  readonly id: ReconciliationObligationId;
  readonly findingId: string;
  readonly producerOperationId?: OperationId;
  readonly subjectScope: ReconciliationSubjectScope;
  readonly requiredChanges: readonly ReconciliationRequiredChange[];
  readonly revalidationCommand: string;
  readonly reconciliationInputs: Readonly<Record<string, ReconciliationInputValue>>;
  readonly status: ReconciliationObligationStatus;
  readonly resolvedBy?: OperationId;
  readonly revalidatedBy?: OperationId;
  readonly reconciledBy?: OperationId;
  readonly unlocks: readonly WorkId[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly createdBy: ActorRef;
  readonly updatedBy: ActorRef;
}

export type ReconciliationTransition = "resolve" | "revalidate" | "reconcile" | "defer";

export interface ReconciliationTransitionInput {
  readonly obligationId: ReconciliationObligationId;
  readonly transition: ReconciliationTransition;
  readonly operationId: OperationId;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
  readonly revalidationPassed?: boolean;
}

export function createReconciliationObligation(input: {
  readonly workId: WorkId;
  readonly draft: ReconciliationObligationDraft;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}): ReconciliationObligation {
  if (!input.draft.findingId.trim()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reconciliation finding id is required");
  }
  if (!input.draft.subjectScope.subjectType.trim() || !input.draft.subjectScope.subjectId.trim()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reconciliation subject scope requires a type and id");
  }
  if (input.draft.requiredChanges.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reconciliation obligation requires at least one required change");
  }
  if (!input.draft.revalidationCommand.trim()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reconciliation revalidation command is required");
  }

  const id = deterministicId<ReconciliationObligationId>("obligation", {
    workId: input.workId,
    findingId: input.draft.findingId,
    producerOperationId: input.draft.producerOperationId ?? null,
    subjectScope: input.draft.subjectScope,
    requiredChanges: input.draft.requiredChanges,
    revalidationCommand: input.draft.revalidationCommand,
    reconciliationInputs: input.draft.reconciliationInputs,
    unlocks: input.draft.unlocks ?? []
  });

  return {
    id,
    findingId: input.draft.findingId,
    ...(input.draft.producerOperationId ? { producerOperationId: input.draft.producerOperationId } : {}),
    subjectScope: input.draft.subjectScope,
    requiredChanges: input.draft.requiredChanges,
    revalidationCommand: input.draft.revalidationCommand,
    reconciliationInputs: input.draft.reconciliationInputs,
    status: "open",
    unlocks: [...new Set(input.draft.unlocks ?? [])],
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actor,
    updatedBy: input.actor
  };
}

export function transitionReconciliationObligation(
  work: WorkItem,
  input: ReconciliationTransitionInput
): WorkItem {
  const obligations = work.reconciliationObligations ?? [];
  const index = obligations.findIndex((obligation) => obligation.id === input.obligationId);
  if (index < 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Reconciliation obligation not found", {
      workId: work.meta.id,
      obligationId: input.obligationId,
      domain: "reconciliation"
    });
  }
  const current = obligations[index]!;
  if (current.status === "reconciled") {
    if (input.transition === "reconcile") {
      return work;
    }
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Reconciled obligations cannot transition backward", {
      workId: work.meta.id,
      obligationId: input.obligationId,
      status: current.status,
      transition: input.transition
    });
  }

  let next: ReconciliationObligation = current;
  switch (input.transition) {
    case "resolve":
      next = { ...current, status: "remediation-in-progress", resolvedBy: input.operationId };
      break;
    case "revalidate":
      if (!current.resolvedBy) {
        throw new BorealError("BOREAL_POLICY_VIOLATION", "Reconciliation must be resolved before revalidation", {
          workId: work.meta.id,
          obligationId: input.obligationId
        });
      }
      if (input.revalidationPassed === undefined) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Revalidation requires an explicit passed or failed outcome", {
          workId: work.meta.id,
          obligationId: input.obligationId
        });
      }
      next = {
        ...current,
        status: input.revalidationPassed === false ? "revalidation-failed" : "remediation-in-progress",
        revalidatedBy: input.operationId
      };
      break;
    case "reconcile":
      if (!current.resolvedBy || !current.revalidatedBy || current.status !== "remediation-in-progress" || input.revalidationPassed === false) {
        throw new BorealError("BOREAL_POLICY_VIOLATION", "Reconciliation requires resolved and passed revalidation evidence", {
          workId: work.meta.id,
          obligationId: input.obligationId
        });
      }
      next = { ...current, status: "reconciled", reconciledBy: input.operationId };
      break;
    case "defer":
      next = { ...current, status: "deferred" };
      break;
  }

  const nextObligations = obligations.slice();
  nextObligations[index] = { ...next, updatedAt: input.now, updatedBy: input.actor };
  return touchRecord({ ...work, reconciliationObligations: nextObligations }, input.now, input.actor);
}

export function openReconciliationObligations(
  work: Pick<WorkItem, "reconciliationObligations">
): readonly ReconciliationObligation[] {
  return (work.reconciliationObligations ?? []).filter((obligation) => obligation.status !== "reconciled");
}

export function hasOpenReconciliationObligations(
  work: Pick<WorkItem, "reconciliationObligations">
): boolean {
  return openReconciliationObligations(work).length > 0;
}

export function reconciliationObligationGaps(
  work: Pick<WorkItem, "kind" | "meta" | "reconciliationObligations">
): readonly EnforcementGap[] {
  const open = openReconciliationObligations(work);
  if (open.length === 0) {
    return [];
  }

  return [{
    code: "reconciliation.obligation.open",
    subjectType: work.kind === "sprint" || work.kind === "milestone" ? work.kind : "work",
    subjectId: work.meta.id,
    data: {
      obligationIds: open.map((obligation) => obligation.id),
      findingIds: open.map((obligation) => obligation.findingId),
      revalidationCommands: open.map((obligation) => obligation.revalidationCommand),
      reason: "required reconciliation obligations must be reconciled before advancement"
    }
  }];
}

export function assertReconciliationObligationsReconciled(
  work: Pick<WorkItem, "kind" | "meta" | "reconciliationObligations">,
  action: string
): void {
  const gaps = reconciliationObligationGaps(work);
  if (gaps.length === 0) {
    return;
  }
  throw new BorealError(
    "BOREAL_POLICY_VIOLATION",
    `Work cannot ${action} while reconciliation obligations are open`,
    { workId: work.meta.id, action, gaps, domain: "work" },
    gaps,
    "work"
  );
}
