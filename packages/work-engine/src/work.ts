import {
  BorealError,
  createRecordMeta,
  deterministicId,
  normalizeActorId,
  normalizeLabels,
  normalizeMachineString,
  touchRecord,
  type ActorRef,
  type EvidenceId,
  type GraphEdge,
  type IsoTimestamp,
  type RuntimePolicy,
  type VerificationRecord,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus,
  withContentHash
} from "@boreal/core";
import { createGraphEdge, wouldCreateCycle } from "@boreal/graph-engine";

export interface CreateWorkItemInput {
  readonly title: string;
  readonly description?: string;
  readonly kind?: WorkKind;
  readonly priority?: WorkPriority;
  readonly acceptanceCriteria?: readonly string[];
  readonly labels?: readonly string[];
  readonly parentId?: WorkId;
  readonly nonce?: number;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface AddBlockingDependencyInput {
  readonly blockedWork: WorkItem;
  readonly blockingWork: WorkItem;
  readonly existingEdges: readonly GraphEdge[];
  readonly policy: Pick<RuntimePolicy, "preventDependencyCycles">;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function createWorkItem(input: CreateWorkItemInput): WorkItem {
  const title = normalizeMachineString(input.title, "title");
  const description = input.description?.trim() ?? "";
  const labels = normalizeLabels(input.labels ?? []);
  const actorId = normalizeActorId(String(input.actor.id));
  const id = deterministicId<WorkId>("work", {
    title,
    kind: input.kind ?? "task",
    description,
    actorId,
    createdAt: input.now,
    parentId: input.parentId ?? null,
    nonce: input.nonce ?? 0
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor,
      tags: labels
    }),
    kind: input.kind ?? "task",
    title,
    description,
    status: "draft",
    priority: input.priority ?? "normal",
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    labels,
    parentId: input.parentId,
    dependencyIds: [],
    evidenceIds: [],
    verificationIds: []
  });
}

export function markWorkReady(work: WorkItem, dependencies: readonly WorkItem[], now: IsoTimestamp, actor: ActorRef): WorkItem {
  const nextStatus = deriveReadinessStatus(work, dependencies);
  return setWorkStatus(work, nextStatus, now, actor);
}

export function addBlockingDependency(input: AddBlockingDependencyInput): {
  readonly blockedWork: WorkItem;
  readonly edge: GraphEdge;
} {
  if (input.blockedWork.meta.id === input.blockingWork.meta.id) {
    throw new BorealError("BOREAL_INVALID_INPUT", "A work item cannot block itself");
  }

  if (
    input.policy.preventDependencyCycles &&
    wouldCreateCycle(
      input.existingEdges.filter((edge) => edge.kind === "blocks"),
      input.blockingWork.meta.id,
      input.blockedWork.meta.id
    )
  ) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Blocking dependency would create a cycle");
  }

  const dependencyIds = unique([...input.blockedWork.dependencyIds, input.blockingWork.meta.id]);
  const edge = createGraphEdge({
    kind: "blocks",
    fromId: input.blockingWork.meta.id,
    fromType: "work",
    toId: input.blockedWork.meta.id,
    toType: "work",
    actor: input.actor,
    now: input.now
  });

  return {
    blockedWork: touchRecord(
      {
        ...input.blockedWork,
        dependencyIds,
        status: deriveReadinessStatus({ ...input.blockedWork, dependencyIds }, [input.blockingWork])
      },
      input.now,
      input.actor
    ),
    edge
  };
}

export function attachEvidenceToWork(
  work: WorkItem,
  evidenceId: EvidenceId,
  now: IsoTimestamp,
  actor: ActorRef
): WorkItem {
  return touchRecord(
    {
      ...work,
      evidenceIds: unique([...work.evidenceIds, evidenceId]),
      status: work.status === "closed" ? work.status : "needs_verification"
    },
    now,
    actor
  );
}

export function attachVerificationToWork(
  work: WorkItem,
  verification: VerificationRecord,
  now: IsoTimestamp,
  actor: ActorRef
): WorkItem {
  return touchRecord(
    {
      ...work,
      verificationIds: unique([...work.verificationIds, verification.meta.id]),
      status: verification.verdict === "passed" ? "verified" : "needs_verification"
    },
    now,
    actor
  );
}

export function closeWork(
  work: WorkItem,
  verifications: readonly VerificationRecord[],
  policy: Pick<RuntimePolicy, "requirePassingVerificationForClose">,
  now: IsoTimestamp,
  actor: ActorRef,
  reason: string
): WorkItem {
  const hasPassingVerification = verifications.some((verification) => verification.verdict === "passed");
  if (policy.requirePassingVerificationForClose && !hasPassingVerification) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Work cannot close without a passing verification");
  }

  return touchRecord(
    {
      ...work,
      status: "closed",
      closedAt: now,
      closedReason: reason.trim()
    },
    now,
    actor
  );
}

export function deriveReadinessStatus(work: WorkItem, dependencies: readonly WorkItem[]): WorkStatus {
  if (work.status === "closed" || work.status === "cancelled" || work.status === "verified") {
    return work.status;
  }

  const openDependency = dependencies.some(
    (dependency) =>
      dependency.status !== "closed" && dependency.status !== "cancelled" && dependency.status !== "verified"
  );

  if (openDependency) {
    return "blocked";
  }

  return work.status === "draft" || work.status === "blocked" ? "ready" : work.status;
}

export function setWorkStatus(work: WorkItem, status: WorkStatus, now: IsoTimestamp, actor: ActorRef): WorkItem {
  return touchRecord({ ...work, status }, now, actor);
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
