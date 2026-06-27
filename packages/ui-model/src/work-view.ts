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
  readonly activeReservationId?: string;
  readonly activeReservation?: WorkReservationView;
  readonly contextSummary?: string;
}

export interface WorkReservationView {
  readonly id: string;
  readonly agentId: string;
  readonly reservedAt?: string;
  readonly expiresAt?: string;
  readonly expired?: boolean;
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
    activeReservationId: input.work.reservationId,
    contextSummary: input.contextPack?.summary
  };
}

function isTerminalDependencyStatus(status: WorkItem["status"]): boolean {
  return status === "closed" || status === "cancelled" || status === "verified";
}
