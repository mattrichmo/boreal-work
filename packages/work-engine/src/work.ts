import {
  BorealError,
  createRecordMeta,
  deterministicId,
  normalizeActorId,
  normalizeLabels,
  normalizeMachineString,
  touchRecord,
  type ActorRef,
  type CloseoutGateId,
  type CloseoutGateKind,
  type CloseoutGateScope,
  type CloseoutGateSubjectType,
  type EvidenceKind,
  type EvidenceId,
  type EnforcementGap,
  type EvidenceTrustLevel,
  type GraphEdge,
  type IsoTimestamp,
  type RequiredCloseoutGate,
  type RuntimePolicy,
  type SourceRef,
  type VerificationRecord,
  type WorkId,
  type WorkItem,
  type WorkBinding,
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
  readonly binding?: WorkBinding;
  readonly requiredCloseoutGates?: readonly RequiredCloseoutGateInput[];
  readonly parentId?: WorkId;
  readonly sourceRefs?: readonly SourceRef[];
  readonly nonce?: number;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface RequiredCloseoutGateInput {
  readonly kind: CloseoutGateKind;
  readonly scope?: CloseoutGateScope;
  readonly requiredEvidenceKinds?: readonly EvidenceKind[];
  readonly minEvidenceCount?: number;
  readonly declaredCommand?: string;
  readonly expectedObservable?: string;
  readonly requiredTrustLevels?: readonly EvidenceTrustLevel[];
  readonly requireCurrentRevision?: boolean;
  readonly requireCurrentGitHead?: boolean;
}

export interface AddBlockingDependencyInput {
  readonly blockedWork: WorkItem;
  readonly blockingWork: WorkItem;
  readonly dependencies: readonly WorkItem[];
  readonly existingEdges: readonly GraphEdge[];
  readonly policy: Pick<RuntimePolicy, "preventDependencyCycles">;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface RemoveBlockingDependencyInput {
  readonly blockedWork: WorkItem;
  readonly blockingWork: WorkItem;
  readonly remainingDependencies: readonly WorkItem[];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function createWorkItem(input: CreateWorkItemInput): WorkItem {
  const title = normalizeMachineString(input.title, "title");
  const description = input.description?.trim() ?? "";
  const kind = input.kind ?? "task";
  const labels = normalizeLabels(input.labels ?? []);
  const sourceRefs = normalizeSourceRefs(input.sourceRefs ?? []);
  const actorId = normalizeActorId(String(input.actor.id));
  const id = deterministicId<WorkId>("work", {
    title,
    kind,
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
      sourceRefs,
      tags: labels
    }),
    kind,
    title,
    description,
    status: "draft",
    priority: input.priority ?? "normal",
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    labels,
    ...(input.binding ? { binding: input.binding } : {}),
    requiredCloseoutGates: createRequiredCloseoutGates({
      subjectId: id,
      subjectType: closeoutGateSubjectTypeForWorkKind(kind),
      inputs: input.requiredCloseoutGates ?? [],
      actor: input.actor,
      now: input.now
    }),
    parentId: input.parentId,
    dependencyIds: [],
    evidenceIds: [],
    verificationIds: []
  });
}

export function createRequiredCloseoutGates(input: {
  readonly subjectId: string;
  readonly subjectType: CloseoutGateSubjectType;
  readonly inputs: readonly RequiredCloseoutGateInput[];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}): readonly RequiredCloseoutGate[] | undefined {
  const gates = input.inputs.map((gate, index) => {
    const scope = gate.scope ?? "self";
    const requiredEvidenceKinds = gate.requiredEvidenceKinds ?? defaultRequiredEvidenceKinds(gate.kind);
    const minEvidenceCount = gate.minEvidenceCount ?? 1;
    const declaredCommand = optionalNonEmptyString(gate.declaredCommand, "declared command");
    const expectedObservable = optionalNonEmptyString(gate.expectedObservable, "expected observable");
    const requiredTrustLevels = gate.requiredTrustLevels === undefined
      ? undefined
      : [...new Set(gate.requiredTrustLevels)].sort();
    if (requiredTrustLevels?.length === 0) {
      throw new BorealError("BOREAL_INVALID_INPUT", "required trust levels must not be empty");
    }
    return {
      id: deterministicId<CloseoutGateId>("gate", {
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        kind: gate.kind,
        scope,
        requiredEvidenceKinds,
        minEvidenceCount,
        declaredCommand,
        expectedObservable,
        requiredTrustLevels,
        requireCurrentRevision: gate.requireCurrentRevision ?? false,
        requireCurrentGitHead: gate.requireCurrentGitHead ?? false,
        index
      }),
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: gate.kind,
      scope,
      status: "open" as const,
      requiredEvidenceKinds,
      requiredOutcome: "passed" as const,
      minEvidenceCount,
      ...(declaredCommand ? { declaredCommand } : {}),
      ...(expectedObservable ? { expectedObservable } : {}),
      ...(requiredTrustLevels ? { requiredTrustLevels } : {}),
      ...(gate.requireCurrentRevision ? { requireCurrentRevision: true } : {}),
      ...(gate.requireCurrentGitHead ? { requireCurrentGitHead: true } : {}),
      createdAt: input.now,
      createdBy: input.actor
    };
  });
  return gates.length > 0 ? gates : undefined;
}

function optionalNonEmptyString(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${fieldName} must be non-empty when provided`);
  }
  return normalized;
}

export function closeoutGateSubjectTypeForWorkKind(kind: WorkKind): CloseoutGateSubjectType {
  if (kind === "sprint" || kind === "milestone") {
    return kind;
  }
  return "work";
}

function defaultRequiredEvidenceKinds(kind: CloseoutGateKind): readonly EvidenceKind[] {
  switch (kind) {
    case "review":
      return ["review"];
    case "audit":
      return ["review", "command", "artifact"];
    case "verification":
      return ["command", "test", "diff", "review", "artifact"];
    case "checkpoint":
      return [];
  }
}

function normalizeSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
  const seen = new Set<string>();
  const normalized: SourceRef[] = [];
  for (const sourceRef of sourceRefs) {
    const uri = normalizeMachineString(sourceRef.uri, "source ref uri");
    const label = sourceRef.label ? normalizeMachineString(sourceRef.label, "source ref label") : undefined;
    const key = `${uri}\u0000${label ?? ""}\u0000${sourceRef.contentHash ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ uri, label, contentHash: sourceRef.contentHash });
  }
  return normalized;
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
        status: deriveReadinessStatus({ ...input.blockedWork, dependencyIds }, uniqueWorkItems([...input.dependencies, input.blockingWork]))
      },
      input.now,
      input.actor
    ),
    edge
  };
}

export function removeBlockingDependency(input: RemoveBlockingDependencyInput): WorkItem {
  const dependencyIds = input.blockedWork.dependencyIds.filter((id) => id !== input.blockingWork.meta.id);
  return touchRecord(
    {
      ...input.blockedWork,
      dependencyIds,
      status: deriveReadinessStatus({ ...input.blockedWork, dependencyIds }, input.remainingDependencies)
    },
    input.now,
    input.actor
  );
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
    const gaps = [
      {
        code: "close.no-passing-verification",
        subjectType: workSubjectType(work),
        subjectId: work.meta.id,
        data: { reason: "no passing verification is attached to this work item" }
      }
    ] satisfies readonly EnforcementGap[];
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Work cannot close without a passing verification",
      { gaps },
      gaps
    );
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

  if (workReadinessGaps(work, dependencies).length > 0) {
    return "blocked";
  }

  return work.status === "draft" || work.status === "blocked" ? "ready" : work.status;
}

export function workReadinessGaps(work: WorkItem, dependencies: readonly WorkItem[]): readonly EnforcementGap[] {
  const blockerIds = dependencies
    .filter((dependency) => dependency.status !== "closed" && dependency.status !== "cancelled" && dependency.status !== "verified")
    .map((dependency) => dependency.meta.id);
  if (blockerIds.length === 0) {
    return [];
  }
  return [
    {
      code: "work.blocked.open-dependency",
      subjectType: workSubjectType(work),
      subjectId: work.meta.id,
      data: { blockerIds }
    }
  ];
}

export function setWorkStatus(work: WorkItem, status: WorkStatus, now: IsoTimestamp, actor: ActorRef): WorkItem {
  return touchRecord({ ...work, status }, now, actor);
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function uniqueWorkItems(values: readonly WorkItem[]): readonly WorkItem[] {
  const byId = new Map<WorkId, WorkItem>();
  for (const value of values) {
    byId.set(value.meta.id, value);
  }
  return [...byId.values()];
}

function workSubjectType(work: WorkItem): EnforcementGap["subjectType"] {
  return closeoutGateSubjectTypeForWorkKind(work.kind);
}
