import type { ContextPack, EvidenceRecord, SourceRef, VerificationRecord, WorkItem } from "@boreal/core";

export interface WorkItemView {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly kind: WorkItem["kind"];
  readonly status: WorkItem["status"];
  readonly priority: WorkItem["priority"];
  readonly acceptanceCriteria?: readonly string[];
  readonly labels: readonly string[];
  readonly sourceRefs?: readonly SourceRef[];
  readonly parentId?: WorkItem["parentId"];
  readonly dependencyIds: readonly string[];
  readonly activeBlockerIds: readonly string[];
  readonly blockedBy: readonly string[];
  readonly evidenceCount: number;
  readonly verificationCount: number;
  readonly requiredCloseoutGates: WorkItem["requiredCloseoutGates"];
  readonly activeReservationId?: string;
  readonly activeReservation?: WorkReservationView;
  readonly closedReason?: string;
  readonly git?: WorkItem["git"];
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

export type WorkDirectiveSeverity = "advisory" | "required" | "blocking";
export type WorkDirectiveLane = WorkDirectiveSeverity;

export interface WorkDirectiveItemView {
  readonly id: string;
  readonly registryId: string;
  readonly family?: string;
  readonly kind?: string;
  readonly title: string;
  readonly severity: WorkDirectiveSeverity;
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
  readonly advisory: number;
  readonly required: number;
  readonly blocking: number;
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
    description: input.work.description,
    kind: input.work.kind,
    status: input.work.status,
    priority: input.work.priority,
    acceptanceCriteria: input.work.acceptanceCriteria,
    labels: input.work.labels,
    sourceRefs: input.work.meta.sourceRefs,
    parentId: input.work.parentId,
    dependencyIds,
    activeBlockerIds,
    blockedBy: activeBlockerIds,
    evidenceCount: input.evidence?.length ?? input.work.evidenceIds.length,
    verificationCount: input.verifications?.length ?? input.work.verificationIds.length,
    requiredCloseoutGates: input.work.requiredCloseoutGates ?? [],
    activeReservationId: input.work.reservationId,
    closedReason: input.work.closedReason,
    git: input.work.git,
    contextSummary: input.contextPack?.summary
  };
}

function isTerminalDependencyStatus(status: WorkItem["status"]): boolean {
  return status === "closed" || status === "cancelled" || status === "verified";
}
