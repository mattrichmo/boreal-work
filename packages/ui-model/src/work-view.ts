import type { ContextPack, EvidenceRecord, VerificationRecord, WorkItem } from "@boreal/core";

export interface WorkItemView {
  readonly id: string;
  readonly title: string;
  readonly kind: WorkItem["kind"];
  readonly status: WorkItem["status"];
  readonly priority: WorkItem["priority"];
  readonly labels: readonly string[];
  readonly blockedBy: readonly string[];
  readonly evidenceCount: number;
  readonly verificationCount: number;
  readonly activeReservationId?: string;
  readonly contextSummary?: string;
}

export function toWorkItemView(input: {
  readonly work: WorkItem;
  readonly evidence?: readonly EvidenceRecord[];
  readonly verifications?: readonly VerificationRecord[];
  readonly contextPack?: ContextPack;
}): WorkItemView {
  return {
    id: input.work.meta.id,
    title: input.work.title,
    kind: input.work.kind,
    status: input.work.status,
    priority: input.work.priority,
    labels: input.work.labels,
    blockedBy: input.work.dependencyIds,
    evidenceCount: input.evidence?.length ?? input.work.evidenceIds.length,
    verificationCount: input.verifications?.length ?? input.work.verificationIds.length,
    activeReservationId: input.work.reservationId,
    contextSummary: input.contextPack?.summary
  };
}

