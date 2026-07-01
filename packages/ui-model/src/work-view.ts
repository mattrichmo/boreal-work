import type { ContextPack, EvidenceRecord, VerificationRecord, WorkItem } from "@boreal/core";

export interface WorkItemView {
  readonly id: string;
  readonly title: string;
  readonly kind: WorkItem["kind"];
  readonly status: WorkItem["status"];
  readonly priority: WorkItem["priority"];
  readonly labels: readonly string[];
  readonly dependencyIds: readonly string[];
  readonly activeBlockerIds: readonly string[];
  readonly blockedBy: readonly string[];
  readonly evidenceCount: number;
  readonly verificationCount: number;
  readonly requiredCloseoutGates: WorkItem["requiredCloseoutGates"];
  readonly activeReservationId?: string;
  readonly activeReservation?: WorkReservationView;
  readonly contextSummary?: string;
  readonly directiveSummary?: WorkDirectiveSummaryView;
}

export interface WorkReservationView {
  readonly id: string;
  readonly agentId: string;
  readonly reservedAt?: string;
  readonly expiresAt?: string;
  readonly expired?: boolean;
}

export type WorkDirectiveSeverity = "info" | "action" | "required" | "blocking";
export type WorkDirectiveLane = "informational" | "recommended" | "required" | "blocked";

export interface WorkDirectiveItemView {
  readonly id: string;
  readonly registryId: string;
  readonly family?: string;
  readonly kind?: string;
  readonly title: string;
  readonly severity: WorkDirectiveSeverity;
  readonly lifecycle: string;
  readonly lane: WorkDirectiveLane;
  readonly reason: string;
  readonly sourceCommand?: string;
  readonly nextCommand?: string;
  readonly workflowRef?: string;
  readonly recoveryWorkflow?: string;
  readonly blocksCloseout?: boolean;
  readonly acknowledgement?: WorkDirectiveAcknowledgementView;
  readonly requiredInputs: readonly string[];
  readonly relatedIds: readonly string[];
}

export interface WorkDirectiveAcknowledgementView {
  readonly requiredBefore: string;
  readonly evidenceKind?: string;
  readonly message: string;
}

export interface WorkDirectiveConflictView {
  readonly id: string;
  readonly directiveIds: readonly string[];
  readonly reason: string;
  readonly resolution: string;
  readonly resolvedDirectiveId?: string;
  readonly severity: WorkDirectiveSeverity;
  readonly lane: WorkDirectiveLane;
}

export interface WorkDirectiveMissingRequiredView {
  readonly id: string;
  readonly registryId: string;
  readonly family?: string;
  readonly requirement: string;
  readonly message: string;
  readonly subjectId?: string;
  readonly subjectType?: string;
}

export interface WorkDirectiveNextStepView {
  readonly id: string;
  readonly title: string;
  readonly lane: WorkDirectiveLane;
  readonly command?: string;
  readonly workflowRef?: string;
  readonly reason: string;
  readonly relatedIds: readonly string[];
}

export interface WorkDirectiveSummaryView {
  readonly total: number;
  readonly informational: number;
  readonly recommended: number;
  readonly required: number;
  readonly blocked: number;
  readonly conflictCount: number;
  readonly missingRequiredCount: number;
  readonly acknowledgementCount: number;
  readonly blockerIds: readonly string[];
  readonly sourceCommands: readonly string[];
  readonly safeCommands: readonly string[];
  readonly nextSteps: readonly WorkDirectiveNextStepView[];
  readonly conflicts: readonly WorkDirectiveConflictView[];
  readonly missingRequired: readonly WorkDirectiveMissingRequiredView[];
  readonly items: readonly WorkDirectiveItemView[];
}

export function toWorkItemView(input: {
  readonly work: WorkItem;
  readonly dependencies?: readonly WorkItem[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly verifications?: readonly VerificationRecord[];
  readonly contextPack?: ContextPack;
}): WorkItemView {
  const dependencyIds = input.work.dependencyIds;
  const dependencies = input.dependencies;
  const activeBlockerIds = dependencies
    ? dependencyIds.filter((dependencyId) => {
        const dependency = dependencies.find((candidate) => candidate.meta.id === dependencyId);
        return dependency ? !isTerminalDependencyStatus(dependency.status) : true;
      })
    : dependencyIds;
  return {
    id: input.work.meta.id,
    title: input.work.title,
    kind: input.work.kind,
    status: input.work.status,
    priority: input.work.priority,
    labels: input.work.labels,
    dependencyIds,
    activeBlockerIds,
    blockedBy: activeBlockerIds,
    evidenceCount: input.evidence?.length ?? input.work.evidenceIds.length,
    verificationCount: input.verifications?.length ?? input.work.verificationIds.length,
    requiredCloseoutGates: input.work.requiredCloseoutGates ?? [],
    activeReservationId: input.work.reservationId,
    contextSummary: input.contextPack?.summary
  };
}

function isTerminalDependencyStatus(status: WorkItem["status"]): boolean {
  return status === "closed" || status === "cancelled" || status === "verified";
}
