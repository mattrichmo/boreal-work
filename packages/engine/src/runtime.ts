import {
  expireReservation,
  releaseReservation,
  renewReservation,
  reserveWork as reserveWorkDomain
} from "@boreal/agent-runtime";
import {
  BorealError,
  DEFAULT_RUNTIME_POLICY,
  assertValidRuntimePolicy,
  createRecordMeta,
  normalizeActorId,
  normalizeLabels,
  normalizeSearchQuery,
  nowIso,
  randomId,
  touchRecord,
  type ActorRef,
  type AgentId,
  type AgentReservation,
  type AgentSummaryId,
  type AgentSummaryRecord,
  type ClaimId,
  type ClaimRecord,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type EventId,
  type EvidenceId,
  type EvidenceRecord,
  type EnforcementGap,
  type RequiredCloseoutGate,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type OperationId,
  type ProjectionId,
  type RuntimeEvent,
  type RuntimePolicy,
  type VerificationId,
  type VerificationRecord,
  type WorkId,
  type WorkItem,
  withContentHash
} from "@boreal/core";
import { recordEvidence as recordEvidenceDomain, verifySubject } from "@boreal/evidence-engine";
import { createClaim, createDecision, createKnowledgeSource } from "@boreal/knowledge-engine";
import { buildContextPack, buildContextProjection } from "@boreal/search";
import type { BorealReader, BorealStore, BorealWriter } from "@boreal/storage";
import { InMemoryBorealStore } from "@boreal/storage";
import { toWorkItemView, type WorkItemView } from "@boreal/ui-model";
import {
  addBlockingDependency as addBlockingDependencyDomain,
  attachEvidenceToWork,
  attachVerificationToWork,
  closeoutGateSubjectTypeForWorkKind,
  closeWork as closeWorkDomain,
  createWorkItem,
  deriveReadinessStatus,
  markWorkReady,
  removeBlockingDependency as removeBlockingDependencyDomain
} from "@boreal/work-engine";

export interface BorealRuntimeOptions {
  readonly store?: BorealStore;
  readonly policy?: Partial<RuntimePolicy>;
  readonly actor?: ActorRef;
  readonly operationId?: OperationId;
  readonly clock?: () => Date;
}

export type CreateWorkInput = Omit<Parameters<typeof createWorkItem>[0], "actor" | "now">;

export interface CreateWorkRuntimeInput extends CreateWorkInput {
  readonly ready?: boolean;
}

export interface WorkspaceInitializationResult {
  readonly initialized: boolean;
  readonly event: RuntimeEvent;
}

export interface ClaimNextWorkInput {
  readonly agentId: AgentId | string;
  readonly labels?: readonly string[];
  readonly containerId?: WorkId;
  readonly purpose?: string;
  readonly expiresAt?: IsoTimestamp;
}

export interface ClaimWorkInput {
  readonly workId: WorkId;
  readonly agentId: AgentId | string;
  readonly purpose?: string;
  readonly expiresAt?: IsoTimestamp;
}

export interface ClaimNextWorkResult {
  readonly work: WorkItem;
  readonly reservation: AgentReservation;
  readonly releasedReservations: readonly AgentReservation[];
}

export interface ReservationLifecycleResult {
  readonly work: WorkItem;
  readonly reservation: AgentReservation;
}

export interface ExpireReservationsResult {
  readonly expired: readonly ReservationLifecycleResult[];
}

export interface RepairDependencyProjectionResult {
  readonly dependencyChanged: number;
  readonly readinessChanged: number;
}

export interface WorkReferenceCandidate {
  readonly workId: WorkId;
  readonly title: string;
  readonly status: WorkItem["status"];
  readonly match: "id" | "id_prefix" | "title" | "active";
}

export interface ResolveWorkReferenceOptions {
  readonly agentId?: AgentId | string;
}

export interface FinishReservedWorkInput {
  readonly workId: WorkId;
  readonly agentId: AgentId | string;
  readonly evidence: Omit<Parameters<typeof recordEvidenceDomain>[0], "actor" | "now" | "subjectId" | "subjectType">;
  readonly verification: {
    readonly verdict: VerificationRecord["verdict"];
    readonly notes?: string;
  };
  readonly close?: {
    readonly reason: string;
    readonly agentSummary?: FinishReservedWorkSummaryFactory;
    readonly agentSummaryIds?: readonly AgentSummaryId[];
  };
  readonly release?: boolean;
}

export interface FinishReservedWorkSummaryInput {
  readonly work: WorkItem;
  readonly evidence: EvidenceRecord;
  readonly verification: VerificationRecord;
  readonly closedWork: WorkItem;
  readonly reason: string;
  readonly now: IsoTimestamp;
  readonly actor: ActorRef;
}

export type FinishReservedWorkSummaryFactory = (
  input: FinishReservedWorkSummaryInput
) => AgentSummaryRecord | Promise<AgentSummaryRecord>;

export interface FinishReservedWorkResult {
  readonly work: WorkItem;
  readonly evidence: EvidenceRecord;
  readonly verification: VerificationRecord;
  readonly reservation: AgentReservation;
  readonly closedWork?: WorkItem;
  readonly agentSummary?: AgentSummaryRecord;
  readonly release: ReservationLifecycleResult;
}

export interface RebuildProjectionsOptions {
  readonly skipContextPackIds?: ReadonlySet<ProjectionId>;
  readonly skipProjectionIds?: ReadonlySet<ProjectionId>;
}

interface CloseoutGateEvaluationInput {
  readonly reader: BorealReader;
  readonly work: WorkItem;
  readonly now: IsoTimestamp;
  readonly actor: ActorRef;
  readonly pendingEvidence?: readonly EvidenceRecord[];
  readonly pendingVerifications?: readonly VerificationRecord[];
  readonly closeoutSummaries?: readonly AgentSummaryRecord[];
}

type CloseoutGateSatisfaction = NonNullable<RequiredCloseoutGate["satisfiedBy"]>;

interface CloseoutGateGap {
  readonly code: EnforcementGap["code"];
  readonly gateId: string;
  readonly gateKind: string;
  readonly gateScope: string;
  readonly subjectType: EnforcementGap["subjectType"];
  readonly subjectId: string;
  readonly targetId?: string;
  readonly reason: string;
  readonly data?: EnforcementGap["data"];
}

const CHECKPOINT_DIRTY_PATH_REASON_CODES = new Set([
  "no_repo_changes",
  "read_only_or_audit_only",
  "user_requested_review_first",
  "external_system_only",
  "validation_blocked",
  "unrelated_dirty_state",
  "git_unavailable",
  "out_of_scope_repository",
  "legacy_backfill"
]);

export interface BorealRuntime {
  readonly policy: RuntimePolicy;
  initWorkspace(): Promise<RuntimeEvent>;
  ensureWorkspaceInitialized(): Promise<WorkspaceInitializationResult>;
  resolveWorkReference(ref: string, options?: ResolveWorkReferenceOptions): Promise<WorkId>;
  createWork(input: CreateWorkRuntimeInput): Promise<WorkItem>;
  addBlockingDependency(input: {
    readonly blockedWorkId: WorkId;
    readonly blockingWorkId: WorkId;
  }): Promise<WorkItem>;
  removeBlockingDependency(input: {
    readonly blockedWorkId: WorkId;
    readonly blockingWorkId: WorkId;
  }): Promise<WorkItem>;
  markReady(workId: WorkId): Promise<WorkItem>;
  listReadyWork(): Promise<readonly WorkItemView[]>;
  claimWork(input: ClaimWorkInput): Promise<ClaimNextWorkResult>;
  claimNextWork(input: ClaimNextWorkInput): Promise<ClaimNextWorkResult | undefined>;
  reserveWork(input: {
    readonly workId: WorkId;
    readonly agentId: AgentId | string;
    readonly purpose?: string;
    readonly expiresAt?: IsoTimestamp;
    readonly force?: boolean;
    readonly forceReason?: string;
  }): Promise<WorkItem>;
  releaseWorkReservation(workId: WorkId): Promise<ReservationLifecycleResult>;
  renewWorkReservation(input: {
    readonly workId: WorkId;
    readonly expiresAt: IsoTimestamp;
  }): Promise<ReservationLifecycleResult>;
  expireStaleReservations(): Promise<ExpireReservationsResult>;
  repairDependencyProjection(): Promise<RepairDependencyProjectionResult>;
  recordEvidence(input: Omit<Parameters<typeof recordEvidenceDomain>[0], "actor" | "now">): Promise<EvidenceRecord>;
  verifyWork(input: {
    readonly workId: WorkId;
    readonly verdict: VerificationRecord["verdict"];
    readonly evidenceIds: readonly EvidenceId[];
    readonly notes?: string;
  }): Promise<VerificationRecord>;
  closeWork(input: {
    readonly workId: WorkId;
    readonly reason: string;
    readonly agentSummary?: AgentSummaryRecord;
    readonly agentSummaryIds?: readonly AgentSummaryId[];
  }): Promise<WorkItem>;
  finishReservedWork(input: FinishReservedWorkInput): Promise<FinishReservedWorkResult>;
  createKnowledgeSource(input: Omit<Parameters<typeof createKnowledgeSource>[0], "actor" | "now">): Promise<KnowledgeSource>;
  listKnowledgeSources(): Promise<readonly KnowledgeSource[]>;
  getKnowledgeSource(sourceId: KnowledgeSourceId): Promise<KnowledgeSource>;
  createClaim(input: Omit<Parameters<typeof createClaim>[0], "actor" | "now">): Promise<ClaimRecord>;
  listClaims(): Promise<readonly ClaimRecord[]>;
  getClaim(claimId: ClaimId): Promise<ClaimRecord>;
  createDecision(input: Omit<Parameters<typeof createDecision>[0], "actor" | "now">): Promise<DecisionRecord>;
  listDecisions(): Promise<readonly DecisionRecord[]>;
  getDecision(decisionId: DecisionId): Promise<DecisionRecord>;
  rebuildProjections(options?: RebuildProjectionsOptions): Promise<readonly WorkItemView[]>;
  getContextPack(workId: WorkId): Promise<ContextPack>;
  refreshWorkContext(workId: WorkId): Promise<ContextPack>;
  recomputeReadiness(): Promise<{ readonly changed: number }>;
  getWorkView(workId: WorkId): Promise<WorkItemView>;
  listEvents(): Promise<readonly RuntimeEvent[]>;
}

export function createBorealRuntime(options: BorealRuntimeOptions = {}): BorealRuntime {
  const store = options.store ?? new InMemoryBorealStore();
  const policy: RuntimePolicy = { ...DEFAULT_RUNTIME_POLICY, ...options.policy };
  assertValidRuntimePolicy(policy);
  const actor = normalizeActorRef(options.actor ?? systemActor());
  const operationId = options.operationId;
  const clock = options.clock ?? (() => new Date());
  const now = () => nowIso(clock());

  async function appendEvent(
    writer: BorealWriter,
    type: string,
    subjectId: string,
    subjectType: string,
    payload: Record<string, unknown>
  ): Promise<RuntimeEvent> {
    const eventNow = now();
    const event = withContentHash({
      meta: createRecordMeta({
        id: randomId<EventId>("event"),
        now: eventNow,
        actor
      }),
      type,
      subjectId,
      subjectType,
      operationId,
      payload
    });
    await writer.putEvent(event);
    return event;
  }

  async function ensureInitialized(): Promise<WorkspaceInitializationResult> {
    return store.write(async (writer) => {
      const existing = (await writer.listEvents()).find(
        (event) => event.type === "workspace.initialized" && event.subjectId === "workspace"
      );
      if (existing) {
        return { initialized: false, event: existing };
      }

      const event = await appendEvent(writer, "workspace.initialized", "workspace", "workspace", {
        runtime: "boreal",
        policy
      });
      return { initialized: true, event };
    });
  }

  return {
    policy,

    async initWorkspace(): Promise<RuntimeEvent> {
      return (await ensureInitialized()).event;
    },

    async ensureWorkspaceInitialized(): Promise<WorkspaceInitializationResult> {
      return ensureInitialized();
    },

    async resolveWorkReference(ref, options): Promise<WorkId> {
      return store.read(async (reader) =>
        resolveWorkReference(reader, ref, {
          agentId: normalizeActorId(String(options?.agentId ?? actor.id)),
          now: now()
        })
      );
    },

    async createWork(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const { ready, ...workInput } = input;
        const createdAt = now();
        const work = await createUniqueWorkItem(writer, {
          ...workInput,
          actor,
          now: createdAt
        });
        await writer.putWorkItem(work);
        await appendEvent(writer, "work.created", work.meta.id, "work", { title: work.title, kind: work.kind });
        if (ready !== true) {
          return work;
        }

        const updated = markWorkReady(work, [], now(), actor);
        await writer.putWorkItem(updated);
        await appendEvent(writer, "work.readiness_recomputed", updated.meta.id, "work", { status: updated.status });
        return updated;
      });
    },

    async addBlockingDependency(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const blockedWork = await workWithGraphDependencies(writer, await requireWork(writer, input.blockedWorkId));
        const blockingWork = await requireWork(writer, input.blockingWorkId);
        const dependencies = await loadDependencies(writer, blockedWork);
        const existingEdges = await writer.listGraphEdges();
        const result = addBlockingDependencyDomain({
          blockedWork,
          blockingWork,
          dependencies,
          existingEdges,
          policy,
          actor,
          now: now()
        });
        await writer.putGraphEdge(result.edge);
        await writer.putWorkItem(result.blockedWork);
        await appendEvent(writer, "work.dependency_added", result.blockedWork.meta.id, "work", {
          blockingWorkId: blockingWork.meta.id,
          edgeId: result.edge.meta.id
        });
        return result.blockedWork;
      });
    },

    async removeBlockingDependency(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const blockedWork = await workWithGraphDependencies(writer, await requireWork(writer, input.blockedWorkId));
        const blockingWork = await requireWork(writer, input.blockingWorkId);
        const matchingEdges = (await writer.listGraphEdges()).filter(
          (edge) =>
            edge.kind === "blocks" &&
            edge.fromType === "work" &&
            edge.toType === "work" &&
            edge.fromId === blockingWork.meta.id &&
            edge.toId === blockedWork.meta.id
        );
        if (matchingEdges.length === 0) {
          throw new BorealError("BOREAL_NOT_FOUND", "Blocking dependency not found", {
            blockedWorkId: blockedWork.meta.id,
            blockingWorkId: blockingWork.meta.id
          });
        }
        if (matchingEdges.length > 1) {
          throw new BorealError("BOREAL_CONFLICT", "Multiple matching blocking dependency edges found", {
            blockedWorkId: blockedWork.meta.id,
            blockingWorkId: blockingWork.meta.id,
            edgeIds: matchingEdges.map((edge) => edge.meta.id)
          });
        }

        const edge = matchingEdges[0]!;
        await writer.deleteGraphEdge(edge.meta.id);
        const remainingDependencies = await loadDependencies(writer, {
          ...blockedWork,
          dependencyIds: blockedWork.dependencyIds.filter((dependencyId) => dependencyId !== blockingWork.meta.id)
        });
        const updatedWork = removeBlockingDependencyDomain({
          blockedWork,
          blockingWork,
          remainingDependencies,
          actor,
          now: now()
        });
        await writer.putWorkItem(updatedWork);
        await appendEvent(writer, "work.dependency_removed", updatedWork.meta.id, "work", {
          blockingWorkId: blockingWork.meta.id,
          edgeId: edge.meta.id
        });
        return updatedWork;
      });
    },

    async markReady(workId): Promise<WorkItem> {
      return store.write(async (writer) => {
        const work = await workWithGraphDependencies(writer, await requireWork(writer, workId));
        const dependencies = await loadDependencies(writer, work);
        const updated = markWorkReady(work, dependencies, now(), actor);
        await writer.putWorkItem(updated);
        await appendEvent(writer, "work.readiness_recomputed", updated.meta.id, "work", { status: updated.status });
        return updated;
      });
    },

    async listReadyWork(): Promise<readonly WorkItemView[]> {
      return store.read(async (reader) => {
        const items = await reader.listWorkItems();
        const readyItems: WorkItem[] = [];
        for (const item of items) {
          if (item.status !== "ready" || item.reservationId) {
            continue;
          }
          const graphItem = await workWithGraphDependencies(reader, item);
          const dependencies = await loadDependencies(reader, graphItem);
          if (deriveReadinessStatus(graphItem, dependencies) === "ready") {
            readyItems.push(graphItem);
          }
        }
        return Promise.all(readyItems.map((item) => makeWorkView(reader, item)));
      });
    },

    async claimWork(input): Promise<ClaimNextWorkResult> {
      return store.write(async (writer) => {
        const agentId = normalizeActorId(String(input.agentId));
        const work = await workWithGraphDependencies(writer, await requireWork(writer, input.workId));
        const dependencies = await loadDependencies(writer, work);
        const derivedStatus = deriveReadinessStatus(work, dependencies);
        const reservationResult = reserveWorkDomain({
          work: { ...work, status: derivedStatus },
          agentId,
          existingReservationsForWork: await writer.listReservationsForWork(input.workId),
          activeReservationsForAgent: await writer.listActiveReservationsForAgent(agentId),
          policy,
          actor,
          now: now(),
          purpose: input.purpose,
          expiresAt: input.expiresAt
        });
        for (const released of reservationResult.releasedReservations) {
          await writer.putReservation(released);
        }
        await writer.putReservation(reservationResult.reservation);
        await writer.putWorkItem(reservationResult.work);
        await appendEvent(writer, "work.claimed", work.meta.id, "work", {
          agentId,
          reservationId: reservationResult.reservation.meta.id,
          purpose: input.purpose,
          expiresAt: input.expiresAt,
          exact: true
        });
        return reservationResult;
      });
    },

    async claimNextWork(input): Promise<ClaimNextWorkResult | undefined> {
      return store.write(async (writer) => {
        const labels = normalizeLabels(input.labels ?? []);
        const agentId = normalizeActorId(String(input.agentId));
        const candidates: WorkItem[] = [];
        const items = await writer.listWorkItems();
        const scopedIds = input.containerId ? await workDependencyScopeIds(writer, input.containerId, items) : undefined;
        for (const item of items) {
          if (item.status !== "ready" || item.reservationId) {
            continue;
          }
          if (scopedIds && !scopedIds.has(item.meta.id)) {
            continue;
          }
          if (!labels.every((label) => item.labels.includes(label))) {
            continue;
          }
          const graphItem = await workWithGraphDependencies(writer, item);
          const dependencies = await loadDependencies(writer, graphItem);
          if (deriveReadinessStatus(graphItem, dependencies) === "ready") {
            candidates.push(graphItem);
          }
        }

        const work = candidates.sort(compareClaimCandidates)[0];
        if (!work) {
          return undefined;
        }

        const reservationResult = reserveWorkDomain({
          work,
          agentId,
          existingReservationsForWork: await writer.listReservationsForWork(work.meta.id),
          activeReservationsForAgent: await writer.listActiveReservationsForAgent(agentId),
          policy,
          actor,
          now: now(),
          purpose: input.purpose,
          expiresAt: input.expiresAt
        });
        for (const released of reservationResult.releasedReservations) {
          await writer.putReservation(released);
        }
        await writer.putReservation(reservationResult.reservation);
        await writer.putWorkItem(reservationResult.work);
        await appendEvent(writer, "work.claimed", work.meta.id, "work", {
          agentId,
          reservationId: reservationResult.reservation.meta.id,
          labels,
          purpose: input.purpose,
          expiresAt: input.expiresAt
        });
        return reservationResult;
      });
    },

    async reserveWork(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const agentId = normalizeActorId(String(input.agentId));
        const work = await requireWork(writer, input.workId);
        const reservationResult = reserveWorkDomain({
          work,
          agentId,
          existingReservationsForWork: await writer.listReservationsForWork(input.workId),
          activeReservationsForAgent: await writer.listActiveReservationsForAgent(agentId),
          policy,
          actor,
          now: now(),
          purpose: input.purpose,
          expiresAt: input.expiresAt,
          force: input.force,
          forceReason: input.forceReason
        });
        for (const released of reservationResult.releasedReservations) {
          await writer.putReservation(released);
        }
        await writer.putReservation(reservationResult.reservation);
        await writer.putWorkItem(reservationResult.work);
        await appendEvent(writer, "work.reserved", work.meta.id, "work", {
          agentId,
          reservationId: reservationResult.reservation.meta.id,
          forced: Boolean(input.force),
          forceReason: input.forceReason
        });
        return reservationResult.work;
      });
    },

    async releaseWorkReservation(workId): Promise<ReservationLifecycleResult> {
      return store.write(async (writer) => {
        const work = await requireWork(writer, workId);
        const reservation = await requireActiveWorkReservation(writer, work);
        const releasedAt = now();
        const released = releaseReservation(reservation, releasedAt, actor);
        const updatedWork = await clearWorkReservation(writer, work, releasedAt, actor);
        await writer.putReservation(released);
        await writer.putWorkItem(updatedWork);
        await appendEvent(writer, "work.reservation_released", work.meta.id, "work", {
          reservationId: released.meta.id,
          agentId: released.agentId
        });
        return { work: updatedWork, reservation: released };
      });
    },

    async renewWorkReservation(input): Promise<ReservationLifecycleResult> {
      return store.write(async (writer) => {
        const work = await requireWork(writer, input.workId);
        const reservation = await requireActiveWorkReservation(writer, work);
        const renewed = renewReservation({
          reservation,
          expiresAt: input.expiresAt,
          actor,
          now: now()
        });
        await writer.putReservation(renewed);
        await appendEvent(writer, "work.reservation_renewed", work.meta.id, "work", {
          reservationId: renewed.meta.id,
          agentId: renewed.agentId,
          expiresAt: renewed.expiresAt
        });
        return { work, reservation: renewed };
      });
    },

    async expireStaleReservations(): Promise<ExpireReservationsResult> {
      return store.write(async (writer) => {
        const current = now();
        const activeReservations = (await writer.listReservations()).filter((reservation) => reservation.status === "active");
        const expired: ReservationLifecycleResult[] = [];
        for (const reservation of activeReservations) {
          if (!reservation.expiresAt || Date.parse(reservation.expiresAt) > Date.parse(current)) {
            continue;
          }
          const work = await writer.getWorkItem(reservation.workId);
          const expiredReservation = expireReservation(reservation, current, actor);
          await writer.putReservation(expiredReservation);
          if (!work || work.reservationId !== reservation.meta.id) {
            continue;
          }
          const updatedWork = await clearWorkReservation(writer, work, current, actor);
          await writer.putWorkItem(updatedWork);
          await appendEvent(writer, "work.reservation_expired", work.meta.id, "work", {
            reservationId: expiredReservation.meta.id,
            agentId: expiredReservation.agentId,
            expiresAt: expiredReservation.expiresAt
          });
          expired.push({ work: updatedWork, reservation: expiredReservation });
        }
        return { expired };
      });
    },

    async repairDependencyProjection(): Promise<RepairDependencyProjectionResult> {
      return store.write(async (writer) => {
        const repaired = await repairDependencyProjection(writer);
        await appendEvent(writer, "work.dependencies_repaired", "work", "work", { ...repaired });
        return repaired;
      });
    },

    async recordEvidence(input): Promise<EvidenceRecord> {
      return store.write(async (writer) => {
        const current = now();
        const evidence = recordEvidenceDomain({ ...input, actor, now: current });
        await writer.putEvidence(evidence);
        if (input.subjectType === "work") {
          const work = await requireWork(writer, input.subjectId as WorkId);
          const updated = attachEvidenceToWork(work, evidence.meta.id, current, actor);
          await writer.putWorkItem(updated);
          await refreshWorkContext(writer, updated, actor, current);
        }
        await appendEvent(writer, "evidence.recorded", evidence.meta.id, "evidence", {
          subjectId: evidence.subjectId,
          kind: evidence.kind,
          outcome: evidence.outcome
        });
        return evidence;
      });
    },

    async verifyWork(input): Promise<VerificationRecord> {
      return store.write(async (writer) => {
        const current = now();
        const work = await requireWork(writer, input.workId);
        const availableEvidence = await loadEvidenceRecords(writer, input.evidenceIds);
        const verification = verifySubject({
          subjectId: input.workId,
          subjectType: "work",
          verdict: input.verdict,
          evidenceIds: input.evidenceIds,
          availableEvidence,
          notes: input.notes,
          policy,
          actor,
          now: current
        });
        await writer.putVerification(verification);
        const updated = attachVerificationToWork(work, verification, current, actor);
        await writer.putWorkItem(updated);
        await refreshWorkContext(writer, updated, actor, current);
        await appendEvent(writer, "work.verified", input.workId, "work", {
          verdict: verification.verdict,
          verificationId: verification.meta.id
        });
        return verification;
      });
    },

    async closeWork(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const current = now();
        let work = await requireWork(writer, input.workId);
        const reservation = await getActiveWorkReservation(writer, work);
        if (reservation) {
          if (!isReservationExpired(reservation, current)) {
            const gaps = [
              {
                code: "reservation.active-conflict",
                subjectType: closeoutGateSubjectTypeForWorkKind(work.kind),
                subjectId: work.meta.id,
                data: {
                  observed: [reservation.meta.id],
                  reason: "reserved work must be finished or released by its owning agent before direct close"
                }
              }
            ] satisfies readonly EnforcementGap[];
            throw new BorealError(
              "BOREAL_POLICY_VIOLATION",
              "Reserved work must be finished or released by its owning agent before direct close",
              {
                workId: work.meta.id,
                reservationId: reservation.meta.id,
                agentId: reservation.agentId,
                gaps
              },
              gaps
            );
          }
          const expiredReservation = expireReservation(reservation, current, actor);
          await writer.putReservation(expiredReservation);
          work = await clearWorkReservation(writer, work, current, actor);
          await appendEvent(writer, "work.reservation_expired", work.meta.id, "work", {
            reservationId: expiredReservation.meta.id,
            agentId: expiredReservation.agentId,
            expiresAt: expiredReservation.expiresAt
          });
        }
        const verifications = await writer.listVerificationsForSubject(input.workId);
        const closeoutSummaries = await resolveCloseoutSummaries(writer, input.agentSummaryIds, input.agentSummary);
        assertAgentSummaryClosePolicy(policy, work, closeoutSummaries);
        if (input.agentSummary) {
          await assertAgentSummaryReferences(writer, input.agentSummary);
        }
        const gatedWork = await applyRequiredCloseoutGatePolicy({
          reader: writer,
          work,
          now: current,
          actor,
          closeoutSummaries
        });
        const closed = closeWorkDomain(gatedWork, verifications, policy, current, actor, input.reason);
        if (input.agentSummary) {
          await writer.putAgentSummary(input.agentSummary);
          await appendEvent(
            writer,
            input.agentSummary.status === "forced" ? "agent_summary.forced_closeout" : "agent_summary.closeout_created",
            input.agentSummary.meta.id,
            "agent_summary",
            {
              subjectId: input.agentSummary.subjectId,
              subjectType: input.agentSummary.subjectType,
              workId: work.meta.id,
              closeReason: input.reason,
              forceReasonCode: input.agentSummary.forceReasonCode
            }
          );
        }
        await writer.putWorkItem(closed);
        await recomputeAllReadiness(writer);
        await refreshWorkContext(writer, closed, actor, current);
        await appendEvent(writer, "work.closed", closed.meta.id, "work", { reason: input.reason });
        return closed;
      });
    },

    async finishReservedWork(input): Promise<FinishReservedWorkResult> {
      if (input.close && input.release) {
        throw new BorealError("BOREAL_INVALID_INPUT", "finishReservedWork accepts close or release, not both");
      }
      if (!input.close && !input.release) {
        throw new BorealError("BOREAL_INVALID_INPUT", "finishReservedWork requires close or release");
      }

      return store.write(async (writer) => {
        const current = now();
        const work = await requireWork(writer, input.workId);
        const agentId = normalizeActorId(String(input.agentId));
        const reservation = await requireAgentWorkReservation(writer, work, agentId, current);

        const evidence = recordEvidenceDomain({
          ...input.evidence,
          subjectId: input.workId,
          subjectType: "work",
          actor,
          now: current
        });
        const workWithEvidence = attachEvidenceToWork(work, evidence.meta.id, current, actor);
        const availableEvidence = [...(await writer.listEvidenceForSubject(input.workId)), evidence];
        const verification = verifySubject({
          subjectId: input.workId,
          subjectType: "work",
          verdict: input.verification.verdict,
          evidenceIds: [evidence.meta.id],
          availableEvidence,
          notes: input.verification.notes,
          policy,
          actor,
          now: current
        });
        const workWithVerification = attachVerificationToWork(workWithEvidence, verification, current, actor);

        let finalWork = workWithVerification;
        let closedWork: WorkItem | undefined;
        let agentSummary: AgentSummaryRecord | undefined;
        if (input.close) {
          const availableVerifications = [...(await writer.listVerificationsForSubject(input.workId)), verification];
          const provisionalClosedWork = closeWorkDomain(workWithVerification, availableVerifications, policy, current, actor, input.close.reason);
          if (input.close.agentSummary) {
            agentSummary = await input.close.agentSummary({
              work: workWithVerification,
              evidence,
              verification,
              closedWork: provisionalClosedWork,
              reason: input.close.reason,
              now: current,
              actor
            });
          }
          const closeoutSummaries = await resolveCloseoutSummaries(writer, input.close.agentSummaryIds, agentSummary);
          assertAgentSummaryClosePolicy(policy, workWithVerification, closeoutSummaries);
          if (agentSummary) {
            await assertAgentSummaryReferences(writer, agentSummary, {
              evidence: [evidence],
              verifications: [verification]
            });
          }
          const gatedWork = await applyRequiredCloseoutGatePolicy({
            reader: writer,
            work: workWithVerification,
            now: current,
            actor,
            pendingEvidence: [evidence],
            pendingVerifications: [verification],
            closeoutSummaries
          });
          closedWork = closeWorkDomain(gatedWork, availableVerifications, policy, current, actor, input.close.reason);
          finalWork = closedWork;
        }

        const releasedReservation = releaseReservation(reservation, current, actor);
        finalWork = await clearWorkReservation(writer, finalWork, current, actor);
        closedWork = closedWork ? finalWork : undefined;

        await writer.putEvidence(evidence);
        await writer.putVerification(verification);
        await writer.putReservation(releasedReservation);
        if (agentSummary) {
          await writer.putAgentSummary(agentSummary);
        }
        await writer.putWorkItem(finalWork);
        if (input.close) {
          await recomputeAllReadiness(writer);
        }
        await refreshWorkContext(writer, finalWork, actor, current);
        await appendEvent(writer, "evidence.recorded", evidence.meta.id, "evidence", {
          subjectId: evidence.subjectId,
          kind: evidence.kind,
          outcome: evidence.outcome
        });
        await appendEvent(writer, "work.verified", input.workId, "work", {
          verdict: verification.verdict,
          verificationId: verification.meta.id
        });
        if (input.close) {
          if (agentSummary) {
            await appendEvent(
              writer,
              agentSummary.status === "forced" ? "agent_summary.forced_closeout" : "agent_summary.closeout_created",
              agentSummary.meta.id,
              "agent_summary",
              {
                subjectId: agentSummary.subjectId,
                subjectType: agentSummary.subjectType,
                workId: finalWork.meta.id,
                closeReason: input.close.reason,
                forceReasonCode: agentSummary.forceReasonCode
              }
            );
          }
          await appendEvent(writer, "work.closed", finalWork.meta.id, "work", { reason: input.close.reason });
        }
        await appendEvent(writer, "work.reservation_released", finalWork.meta.id, "work", {
          reservationId: releasedReservation.meta.id,
          agentId: releasedReservation.agentId
        });
        await appendEvent(writer, "agent.finished", finalWork.meta.id, "work", {
          agentId,
          evidenceId: evidence.meta.id,
          verificationId: verification.meta.id,
          reservationId: releasedReservation.meta.id,
          closed: Boolean(input.close)
        });

        return {
          work: finalWork,
          evidence,
          verification,
          reservation: releasedReservation,
          closedWork,
          agentSummary,
          release: { work: finalWork, reservation: releasedReservation }
        };
      });
    },

    async createKnowledgeSource(input): Promise<KnowledgeSource> {
      return store.write(async (writer) => {
        const source = createKnowledgeSource({ ...input, actor, now: now() });
        await writer.putKnowledgeSource(source);
        await appendEvent(writer, "knowledge.source_created", source.meta.id, "knowledge_source", {
          title: source.title
        });
        return source;
      });
    },

    async listKnowledgeSources(): Promise<readonly KnowledgeSource[]> {
      return store.read((reader) => reader.listKnowledgeSources());
    },

    async getKnowledgeSource(sourceId): Promise<KnowledgeSource> {
      return store.read((reader) => requireKnowledgeSource(reader, sourceId));
    },

    async createClaim(input): Promise<ClaimRecord> {
      return store.write(async (writer) => {
        await requireKnowledgeSources(writer, input.sourceIds ?? []);
        await requireEvidenceRecords(writer, input.evidenceIds ?? []);
        const claim = createClaim({ ...input, actor, now: now() });
        await writer.putClaim(claim);
        await appendEvent(writer, "knowledge.claim_created", claim.meta.id, "claim", { status: claim.status });
        return claim;
      });
    },

    async listClaims(): Promise<readonly ClaimRecord[]> {
      return store.read((reader) => reader.listClaims());
    },

    async getClaim(claimId): Promise<ClaimRecord> {
      return store.read((reader) => requireClaim(reader, claimId));
    },

    async createDecision(input): Promise<DecisionRecord> {
      return store.write(async (writer) => {
        await requireKnowledgeSources(writer, input.sourceIds ?? []);
        const decision = createDecision({ ...input, actor, now: now() });
        await writer.putDecision(decision);
        await appendEvent(writer, "knowledge.decision_created", decision.meta.id, "decision", {
          status: decision.status
        });
        return decision;
      });
    },

    async listDecisions(): Promise<readonly DecisionRecord[]> {
      return store.read((reader) => reader.listDecisions());
    },

    async getDecision(decisionId): Promise<DecisionRecord> {
      return store.read((reader) => requireDecision(reader, decisionId));
    },

    async rebuildProjections(options = {}): Promise<readonly WorkItemView[]> {
      return store.write(async (writer) => {
        const ledgerSeq = (await writer.listEvents()).length + 1;
        const workItems = await writer.listWorkItems();
        const sources = await writer.listKnowledgeSources();
        const claims = await writer.listClaims();
        const decisions = await writer.listDecisions();
        const views: WorkItemView[] = [];

        for (const work of workItems) {
          const graphWork = await workWithGraphDependencies(writer, work);
          const dependencies = graphWork.dependencyIds
            .map((dependencyId) => workItems.find((item) => item.meta.id === dependencyId))
            .filter(isWorkItem);
          const evidence = await writer.listEvidenceForSubject(work.meta.id);
          const contextPack = withContextPackLedgerSeq(
            buildContextPack({ work: graphWork, evidence, sources, claims, decisions, actor, now: now() }),
            ledgerSeq
          );
          const projection = buildContextProjection({ work: graphWork, evidence, sources, claims, decisions, actor, now: now() });
          const writeContextPack = !options.skipContextPackIds?.has(contextPack.id);
          const writeProjection = !options.skipProjectionIds?.has(projection.meta.id);
          if (writeContextPack) {
            await writer.putContextPack(contextPack);
          }
          if (writeProjection) {
            await writer.putProjection(projection);
          }
          views.push(toWorkItemView({ work: graphWork, dependencies, evidence, contextPack: writeContextPack ? contextPack : undefined }));
        }

        await appendEvent(writer, "projection.rebuilt", "projections", "projection", { count: views.length });
        return views;
      });
    },

    async getContextPack(workId): Promise<ContextPack> {
      return store.read(async (reader) => {
        await requireWork(reader, workId);
        const pack = await reader.getContextPackForSubject(workId);
        if (!pack) {
          throw new BorealError("BOREAL_NOT_FOUND", "Context pack not found; run `bwrk context rebuild`", { workId });
        }
        return pack;
      });
    },

    async refreshWorkContext(workId): Promise<ContextPack> {
      return store.write(async (writer) => {
        const current = now();
        const work = await requireWork(writer, workId);
        const pack = await refreshWorkContext(writer, work, actor, current);
        await appendEvent(writer, "context.refreshed", work.meta.id, "work", {
          contextPackId: pack.id
        });
        return pack;
      });
    },

    async recomputeReadiness(): Promise<{ readonly changed: number }> {
      return store.write(async (writer) => {
        const changed = await recomputeAllReadiness(writer);
        await appendEvent(writer, "work.readiness_recomputed_all", "work", "work", { changed });
        return { changed };
      });
    },

    async getWorkView(workId): Promise<WorkItemView> {
      return store.read(async (reader) => makeWorkView(reader, await requireWork(reader, workId)));
    },

    async listEvents(): Promise<readonly RuntimeEvent[]> {
      return store.read((reader) => reader.listEvents());
    }
  };
}

async function createUniqueWorkItem(
  reader: BorealReader,
  input: Parameters<typeof createWorkItem>[0]
): Promise<WorkItem> {
  for (let nonce = 0; nonce < 100; nonce += 1) {
    const work = createWorkItem({ ...input, nonce });
    if (!(await reader.getWorkItem(work.meta.id))) {
      return work;
    }
  }
  throw new BorealError("BOREAL_CONFLICT", "Unable to generate a unique work id after nonce retries");
}

async function requireWork(reader: BorealReader, workId: WorkId): Promise<WorkItem> {
  const work = await reader.getWorkItem(workId);
  if (!work) {
    throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId });
  }
  return work;
}

interface ResolveWorkReferenceInternalOptions {
  readonly agentId: string;
  readonly now: IsoTimestamp;
}

const ACTIVE_WORK_REFERENCE_ALIASES = new Set(["active", "current"]);

async function resolveWorkReference(
  reader: BorealReader,
  ref: string,
  options: ResolveWorkReferenceInternalOptions
): Promise<WorkId> {
  const normalizedRef = normalizeSearchQuery(ref);
  const normalizedLower = normalizedRef.toLocaleLowerCase("en-US");
  if (ACTIVE_WORK_REFERENCE_ALIASES.has(normalizedLower)) {
    return resolveActiveWorkReference(reader, normalizedRef, options);
  }

  const items = await reader.listWorkItems();
  const candidates: WorkReferenceCandidate[] = [];

  for (const work of items) {
    if (work.meta.id === normalizedLower) {
      candidates.push(workReferenceCandidate(work, "id"));
      continue;
    }
    if (normalizedLower.length >= 12 && work.meta.id.startsWith(normalizedLower)) {
      candidates.push(workReferenceCandidate(work, "id_prefix"));
      continue;
    }
    if (normalizedTitle(work.title) === normalizedLower) {
      candidates.push(workReferenceCandidate(work, "title"));
    }
  }

  const uniqueCandidates = uniqueCandidatesById(candidates);
  const onlyCandidate = uniqueCandidates[0];
  if (uniqueCandidates.length === 1 && onlyCandidate) {
    return onlyCandidate.workId;
  }
  if (uniqueCandidates.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Work reference is ambiguous", {
      ref: normalizedRef,
      candidates: uniqueCandidates
    });
  }
  throw new BorealError("BOREAL_NOT_FOUND", "Work reference did not match any work item", { ref: normalizedRef });
}

async function resolveActiveWorkReference(
  reader: BorealReader,
  ref: string,
  options: ResolveWorkReferenceInternalOptions
): Promise<WorkId> {
  const activeReservations = (await reader.listActiveReservationsForAgent(options.agentId))
    .filter((reservation) => !reservation.expiresAt || Date.parse(reservation.expiresAt) > Date.parse(options.now))
    .sort((left, right) => left.reservedAt.localeCompare(right.reservedAt) || left.meta.id.localeCompare(right.meta.id));
  const candidates: WorkReferenceCandidate[] = [];
  for (const reservation of activeReservations) {
    const work = await reader.getWorkItem(reservation.workId);
    if (work) {
      candidates.push(workReferenceCandidate(work, "active"));
    }
  }

  const uniqueCandidates = uniqueCandidatesById(candidates);
  const onlyCandidate = uniqueCandidates[0];
  if (uniqueCandidates.length === 1 && onlyCandidate) {
    return onlyCandidate.workId;
  }
  if (uniqueCandidates.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Active work reference is ambiguous", {
      ref,
      agentId: options.agentId,
      candidates: uniqueCandidates
    });
  }
  throw new BorealError("BOREAL_NOT_FOUND", "Active work reference did not match any non-expired reservation", {
    ref,
    agentId: options.agentId
  });
}

function workReferenceCandidate(work: WorkItem, match: WorkReferenceCandidate["match"]): WorkReferenceCandidate {
  return {
    workId: work.meta.id,
    title: work.title,
    status: work.status,
    match
  };
}

function normalizedTitle(value: string): string | undefined {
  try {
    return normalizeSearchQuery(value).toLocaleLowerCase("en-US");
  } catch {
    return undefined;
  }
}

function uniqueCandidatesById(candidates: readonly WorkReferenceCandidate[]): readonly WorkReferenceCandidate[] {
  const byId = new Map<WorkId, WorkReferenceCandidate>();
  for (const candidate of candidates) {
    byId.set(candidate.workId, byId.get(candidate.workId) ?? candidate);
  }
  return [...byId.values()].sort((left, right) => left.workId.localeCompare(right.workId));
}

async function requireActiveWorkReservation(reader: BorealReader, work: WorkItem): Promise<AgentReservation> {
  const reservation = await getActiveWorkReservation(reader, work);
  if (!reservation) {
    throw new BorealError("BOREAL_NOT_FOUND", "Work item does not have an active reservation", {
      workId: work.meta.id,
      reservationId: work.reservationId
    });
  }
  return reservation;
}

async function getActiveWorkReservation(reader: BorealReader, work: WorkItem): Promise<AgentReservation | undefined> {
  const activeReservations = (await reader.listReservationsForWork(work.meta.id)).filter(
    (reservation) => reservation.status === "active"
  );
  return work.reservationId
    ? activeReservations.find((entry) => entry.meta.id === work.reservationId)
    : activeReservations[0];
}

async function requireAgentWorkReservation(
  reader: BorealReader,
  work: WorkItem,
  agentId: AgentId | string,
  current: IsoTimestamp
): Promise<AgentReservation> {
  const normalizedAgentId = normalizeActorId(String(agentId));
  const reservation = await getActiveWorkReservation(reader, work);
  if (!reservation) {
    const terminalReservation = (await reader.listReservationsForWork(work.meta.id))
      .filter((entry) => String(entry.agentId) === normalizedAgentId)
      .filter((entry) => entry.status === "expired" || entry.status === "released")
      .sort((left, right) => right.meta.updatedAt.localeCompare(left.meta.updatedAt))
      .at(0);
    if (terminalReservation?.status === "expired") {
      const gaps = [
        {
          code: "reservation.not-ready",
          subjectType: closeoutGateSubjectTypeForWorkKind(work.kind),
          subjectId: work.meta.id,
          data: {
            observed: [terminalReservation.expiresAt ?? terminalReservation.meta.updatedAt],
            reason: "agent reservation was reaped after expiry"
          }
        }
      ] satisfies readonly EnforcementGap[];
      throw new BorealError(
        "BOREAL_POLICY_VIOLATION",
        "Agent reservation was reaped after expiry; claim the work again before finishing",
        {
          workId: work.meta.id,
          agentId: normalizedAgentId,
          reservationId: terminalReservation.meta.id,
          reservationStatus: terminalReservation.status,
          originalOwner: terminalReservation.agentId,
          expiresAt: terminalReservation.expiresAt,
          reapedAt: terminalReservation.meta.updatedAt,
          repairCommand: `bwrk agent start ${work.meta.id} --agent ${normalizedAgentId} --json`,
          gaps
        },
        gaps
      );
    }
    throw new BorealError("BOREAL_NOT_FOUND", "Work item does not have an active reservation", {
      workId: work.meta.id,
      agentId: normalizedAgentId,
      reservationId: work.reservationId,
      latestReservationId: terminalReservation?.meta.id,
      latestReservationStatus: terminalReservation?.status
    });
  }
  if (String(reservation.agentId) !== normalizedAgentId) {
    const gaps = [
      {
        code: "reservation.active-conflict",
        subjectType: closeoutGateSubjectTypeForWorkKind(work.kind),
        subjectId: work.meta.id,
        data: {
          observed: [String(reservation.agentId)],
          reason: "agent does not own the active reservation"
        }
      }
    ] satisfies readonly EnforcementGap[];
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Agent does not own the active reservation",
      {
        workId: work.meta.id,
        agentId: normalizedAgentId,
        reservationAgentId: reservation.agentId,
        reservationId: reservation.meta.id,
        gaps
      },
      gaps
    );
  }
  if (reservation.expiresAt && Date.parse(reservation.expiresAt) <= Date.parse(current)) {
    const gaps = [
      {
        code: "reservation.not-ready",
        subjectType: closeoutGateSubjectTypeForWorkKind(work.kind),
        subjectId: work.meta.id,
        data: {
          observed: [reservation.expiresAt],
          reason: "agent reservation is expired"
        }
      }
    ] satisfies readonly EnforcementGap[];
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Agent reservation is expired; run `bwrk doctor --fix`",
      {
        workId: work.meta.id,
        agentId: normalizedAgentId,
        reservationId: reservation.meta.id,
        expiresAt: reservation.expiresAt,
        gaps
      },
      gaps
    );
  }
  return reservation;
}

function isReservationExpired(reservation: AgentReservation, current: IsoTimestamp): boolean {
  return Boolean(reservation.expiresAt && Date.parse(reservation.expiresAt) <= Date.parse(current));
}

async function clearWorkReservation(
  reader: BorealReader,
  work: WorkItem,
  now: IsoTimestamp,
  actor: ActorRef
): Promise<WorkItem> {
  const base = {
    ...work,
    status: work.status === "reserved" || work.status === "in_progress" ? ("draft" as const) : work.status,
    reservationId: undefined
  };
  const graphBase = await workWithGraphDependencies(reader, base);
  const dependencies = await loadDependencies(reader, graphBase);
  return touchRecord({ ...graphBase, status: deriveReadinessStatus(graphBase, dependencies) }, now, actor);
}

async function resolveCloseoutSummaries(
  reader: BorealReader,
  summaryIds: readonly AgentSummaryId[] | undefined,
  pendingSummary: AgentSummaryRecord | undefined
): Promise<readonly AgentSummaryRecord[]> {
  const summaries: AgentSummaryRecord[] = pendingSummary ? [pendingSummary] : [];
  const missingSummaryIds: AgentSummaryId[] = [];
  for (const summaryId of summaryIds ?? []) {
    if (pendingSummary?.meta.id === summaryId) {
      continue;
    }
    const summary = await reader.getAgentSummary(summaryId);
    if (summary) {
      summaries.push(summary);
    } else {
      missingSummaryIds.push(summaryId);
    }
  }
  if (missingSummaryIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Closeout references missing agent summary", { missingSummaryIds });
  }
  return summaries;
}

function assertAgentSummaryClosePolicy(
  runtimePolicy: RuntimePolicy,
  work: WorkItem,
  summaries: readonly AgentSummaryRecord[]
): void {
  if (!runtimePolicy.requireAgentSummaryForClose) {
    return;
  }
  const expectedSubjectType = agentSummarySubjectTypeForWork(work);
  const matching = summaries.filter(
    (summary) =>
      summary.subjectId === work.meta.id &&
      summary.subjectType === expectedSubjectType &&
      (summary.status === "final" || summary.status === "forced")
  );
  if (matching.length === 0) {
    const gaps = [
      {
        code: "summary.missing",
        subjectType: closeoutGateSubjectTypeForWorkKind(work.kind),
        subjectId: work.meta.id,
        data: {
          observed: summaries.map((summary) => `${summary.subjectType}:${summary.status}:${summary.meta.id}`),
          reason: "no final or forced agent summary matches the work subject"
        }
      }
    ] satisfies readonly EnforcementGap[];
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Closeout requires a final or forced agent summary matching the work subject",
      {
        workId: work.meta.id,
        expectedSubjectType,
        summaryIds: summaries.map((summary) => summary.meta.id),
        gaps
      },
      gaps
    );
  }
}

async function assertAgentSummaryReferences(
  reader: BorealReader,
  summary: AgentSummaryRecord,
  extras: {
    readonly evidence?: readonly EvidenceRecord[];
    readonly verifications?: readonly VerificationRecord[];
  } = {}
): Promise<void> {
  const extraEvidenceIds = new Set((extras.evidence ?? []).map((evidence) => evidence.meta.id));
  const missingEvidenceIds: EvidenceId[] = [];
  for (const evidenceId of summary.evidenceIds) {
    if (extraEvidenceIds.has(evidenceId)) {
      continue;
    }
    if (!(await reader.getEvidence(evidenceId))) {
      missingEvidenceIds.push(evidenceId);
    }
  }
  if (missingEvidenceIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing evidence", { missingEvidenceIds });
  }

  const extraVerificationIds = new Set((extras.verifications ?? []).map((verification) => verification.meta.id));
  const missingVerificationIds: VerificationId[] = [];
  for (const verificationId of summary.verificationIds) {
    if (extraVerificationIds.has(verificationId)) {
      continue;
    }
    if (!(await reader.getVerification(verificationId))) {
      missingVerificationIds.push(verificationId);
    }
  }
  if (missingVerificationIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing verification", { missingVerificationIds });
  }

  const summaryIds = [...summary.childSummaryIds, ...(summary.parentSummaryId ? [summary.parentSummaryId] : [])];
  const missingSummaryIds: AgentSummaryId[] = [];
  for (const summaryId of summaryIds) {
    if (!(await reader.getAgentSummary(summaryId))) {
      missingSummaryIds.push(summaryId);
    }
  }
  if (missingSummaryIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing summary", { missingSummaryIds });
  }
}

function agentSummarySubjectTypeForWork(work: WorkItem): AgentSummaryRecord["subjectType"] {
  return work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work";
}

async function applyRequiredCloseoutGatePolicy(input: CloseoutGateEvaluationInput): Promise<WorkItem> {
  const workItems = await input.reader.listWorkItems();
  const evidence = [...(await input.reader.listEvidence()), ...(input.pendingEvidence ?? [])];
  const verifications = [...(await input.reader.listVerifications()), ...(input.pendingVerifications ?? [])];
  const summaries = uniqueAgentSummaries([...(await input.reader.listAgentSummaries()), ...(input.closeoutSummaries ?? [])]);
  const descendants = dependencyDescendants(input.work, workItems);
  const gaps: CloseoutGateGap[] = [];

  if (isContainerWork(input.work)) {
    for (const descendant of descendants) {
      if (!isResolvedForContainerClose(descendant)) {
        gaps.push({
          code: "work.container.open-descendant",
          gateId: "descendant-work",
          gateKind: "descendant_work",
          gateScope: "descendants",
          subjectType: closeoutGateSubjectTypeForWorkKind(input.work.kind),
          subjectId: input.work.meta.id,
          targetId: descendant.meta.id,
          reason: `descendant work is ${descendant.status}`,
          data: {
            blockerIds: [descendant.meta.id],
            reason: `descendant work is ${descendant.status}`
          }
        });
      }
    }
  }

  const evaluatedGates = (input.work.requiredCloseoutGates ?? []).map((gate) => {
    const evaluation = evaluateRequiredCloseoutGate({
      gate,
      owner: input.work,
      workItems,
      evidence,
      verifications,
      summaries
    });
    gaps.push(...evaluation.gaps);
    return evaluation.gate;
  });

  if (isContainerWork(input.work)) {
    for (const descendant of descendants) {
      for (const gate of descendant.requiredCloseoutGates ?? []) {
        const evaluation = evaluateRequiredCloseoutGate({
          gate,
          owner: descendant,
          workItems,
          evidence,
          verifications,
          summaries
        });
        gaps.push(...evaluation.gaps);
      }
    }
  }

  if (gaps.length > 0) {
    const enforcementGaps = gaps.map(enforcementGapFromCloseoutGateGap);
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Closeout requires satisfied required gates and resolved descendant work", {
      workId: input.work.meta.id,
      gateGaps: gaps.map(legacyCloseoutGateGap),
      gaps: enforcementGaps
    }, enforcementGaps);
  }

  if (JSON.stringify(input.work.requiredCloseoutGates ?? []) === JSON.stringify(evaluatedGates)) {
    return input.work;
  }

  return touchRecord(
    {
      ...input.work,
      requiredCloseoutGates: evaluatedGates.length > 0 ? evaluatedGates : undefined
    },
    input.now,
    input.actor
  );
}

function evaluateRequiredCloseoutGate(input: {
  readonly gate: RequiredCloseoutGate;
  readonly owner: WorkItem;
  readonly workItems: readonly WorkItem[];
  readonly evidence: readonly EvidenceRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly summaries: readonly AgentSummaryRecord[];
}): { readonly gate: RequiredCloseoutGate; readonly gaps: readonly CloseoutGateGap[] } {
  if (input.gate.status === "forced") {
    return forcedRequiredGateIsValid(input.gate)
      ? { gate: input.gate, gaps: [] }
      : {
          gate: input.gate,
          gaps: [
            gateGap(input.gate, input.owner, undefined, "forced gate is missing a reason, comment, actor, or forced timestamp", {
              code: "gate.force.invalid"
            })
          ]
        };
  }

  const targets = requiredGateTargets(input.gate, input.owner, input.workItems);
  const gaps: CloseoutGateGap[] = [];
  const satisfactions: CloseoutGateSatisfaction[] = [];

  for (const target of targets) {
    const satisfaction = targetCloseoutGateSatisfaction(input.gate, target, input.evidence, input.verifications, input.summaries);
    if (!satisfaction) {
      gaps.push(unsatisfiedGateGap(input.gate, input.owner, target, input.evidence, input.verifications));
    } else {
      satisfactions.push(satisfaction);
    }
  }

  if (gaps.length > 0) {
    return { gate: input.gate, gaps };
  }

  return {
    gate: {
      ...input.gate,
      status: "satisfied",
      satisfiedBy: mergeGateSatisfactions(input.gate.satisfiedBy ? [input.gate.satisfiedBy, ...satisfactions] : satisfactions)
    },
    gaps: []
  };
}

function targetCloseoutGateSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): CloseoutGateSatisfaction | undefined {
  switch (gate.kind) {
    case "verification":
      return verificationGateSatisfaction(gate, target, evidence, verifications);
    case "checkpoint":
      return checkpointGateSatisfaction(gate, target, summaries);
    case "review":
    case "audit":
      return evidenceGateSatisfaction(gate, target, evidence);
  }
}

function verificationGateSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[]
): CloseoutGateSatisfaction | undefined {
  const evidenceById = new Map(evidence.map((record) => [record.meta.id, record]));
  const matches = verifications.filter((verification) => {
    if (verification.subjectId !== target.meta.id || verification.verdict !== "passed") {
      return false;
    }
    return verification.evidenceIds.some((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return (
        record?.subjectId === target.meta.id &&
        (record.outcome === "passed" || record.outcome === "observed") &&
        evidenceSatisfiesDeclaredGate(gate, record)
      );
    });
  });
  const evidenceIds = uniqueValues(matches.flatMap((verification) =>
    verification.evidenceIds.filter((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return (
        record?.subjectId === target.meta.id &&
        (record.outcome === "passed" || record.outcome === "observed") &&
        evidenceSatisfiesDeclaredGate(gate, record)
      );
    })
  ));
  if (evidenceIds.length < gate.minEvidenceCount) {
    return undefined;
  }
  return {
    evidenceIds,
    verificationIds: uniqueValues(matches.map((verification) => verification.meta.id)),
    agentSummaryIds: [],
    commitShas: [],
    dirtyPathNotes: []
  };
}

function checkpointGateSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  summaries: readonly AgentSummaryRecord[]
): CloseoutGateSatisfaction | undefined {
  const matches = summaries.filter(
    (summary) =>
      summary.subjectId === target.meta.id &&
      (summary.status === "final" || summary.status === "forced") &&
      (summary.commitShas.length > 0 || dirtyPathNotesHaveReasonCode(summary.dirtyPathNotes))
  );
  if (matches.length < gate.minEvidenceCount) {
    return undefined;
  }
  return {
    evidenceIds: uniqueValues(matches.flatMap((summary) => summary.evidenceIds)),
    verificationIds: uniqueValues(matches.flatMap((summary) => summary.verificationIds)),
    agentSummaryIds: uniqueValues(matches.map((summary) => summary.meta.id)),
    commitShas: uniqueStrings(matches.flatMap((summary) => summary.commitShas)),
    dirtyPathNotes: uniqueStrings(matches.flatMap((summary) => summary.dirtyPathNotes))
  };
}

function evidenceGateSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[]
): CloseoutGateSatisfaction | undefined {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  const matches = evidence.filter(
    (record) =>
      record.subjectId === target.meta.id &&
      record.outcome === gate.requiredOutcome &&
      allowedKinds.has(record.kind) &&
      evidenceSatisfiesDeclaredGate(gate, record)
  );
  if (matches.length < gate.minEvidenceCount) {
    return undefined;
  }
  return {
    evidenceIds: uniqueValues(matches.map((record) => record.meta.id)),
    verificationIds: [],
    agentSummaryIds: [],
    commitShas: [],
    dirtyPathNotes: []
  };
}

function requiredGateTargets(gate: RequiredCloseoutGate, owner: WorkItem, workItems: readonly WorkItem[]): readonly WorkItem[] {
  switch (gate.scope) {
    case "self":
      return [owner];
    case "direct_children":
      return owner.dependencyIds
        .map((id) => workItems.find((item) => item.meta.id === id))
        .filter(isWorkItem);
    case "descendants":
      return dependencyDescendants(owner, workItems);
  }
}

function dependencyDescendants(work: WorkItem, workItems: readonly WorkItem[]): readonly WorkItem[] {
  const byId = new Map(workItems.map((item) => [item.meta.id, item]));
  const descendants: WorkItem[] = [];
  const visited = new Set<string>();
  const visit = (item: WorkItem): void => {
    for (const dependencyId of item.dependencyIds) {
      if (visited.has(dependencyId)) {
        continue;
      }
      visited.add(dependencyId);
      const child = byId.get(dependencyId);
      if (!child) {
        continue;
      }
      descendants.push(child);
      visit(child);
    }
  };
  visit(work);
  return descendants;
}

function forcedRequiredGateIsValid(gate: RequiredCloseoutGate): boolean {
  return Boolean(gate.force?.reason && gate.force.comment.trim() && gate.force.actor && gate.force.forcedAt);
}

function evidenceSatisfiesDeclaredGate(gate: RequiredCloseoutGate, record: EvidenceRecord): boolean {
  if (gate.declaredCommand && record.command !== gate.declaredCommand) {
    return false;
  }
  if (gate.expectedObservable && !record.summary.includes(gate.expectedObservable)) {
    return false;
  }
  return true;
}

function unsatisfiedGateGap(
  gate: RequiredCloseoutGate,
  owner: WorkItem,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[]
): CloseoutGateGap {
  const targetEvidence = candidateEvidenceForGate(gate, target, evidence, verifications);
  if (gate.declaredCommand) {
    const observed = uniqueStrings(targetEvidence.map((record) => record.command ?? "<missing>"));
    if (!targetEvidence.some((record) => record.command === gate.declaredCommand)) {
      return gateGap(gate, owner, target, "required gate has no evidence matching declaredCommand", {
        code: observed.includes("<missing>") ? "gate.declared-command.missing" : "gate.declared-command.mismatch",
        data: {
          declaredCommand: gate.declaredCommand,
          observed,
          evidenceIds: targetEvidence.map((record) => record.meta.id)
        }
      });
    }
  }
  if (gate.expectedObservable) {
    const expectedObservable = gate.expectedObservable;
    const evidenceWithDeclaredCommand = gate.declaredCommand
      ? targetEvidence.filter((record) => record.command === gate.declaredCommand)
      : targetEvidence;
    if (!evidenceWithDeclaredCommand.some((record) => record.summary.includes(expectedObservable))) {
      return gateGap(gate, owner, target, "required gate has no evidence summary containing expectedObservable", {
        code: evidenceWithDeclaredCommand.length > 0 ? "gate.expected-observable.mismatch" : "gate.expected-observable.missing",
        data: {
          expectedObservable,
          observed: evidenceWithDeclaredCommand.map((record) => record.summary),
          evidenceIds: evidenceWithDeclaredCommand.map((record) => record.meta.id)
        }
      });
    }
  }
  return gateGap(gate, owner, target, "required gate has no satisfying evidence");
}

function candidateEvidenceForGate(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[]
): readonly EvidenceRecord[] {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  if (gate.kind === "verification") {
    const passedEvidenceIds = new Set(
      verifications
        .filter((verification) => verification.subjectId === target.meta.id && verification.verdict === "passed")
        .flatMap((verification) => verification.evidenceIds)
    );
    return evidence.filter(
      (record) =>
        passedEvidenceIds.has(record.meta.id) &&
        record.subjectId === target.meta.id &&
        (record.outcome === "passed" || record.outcome === "observed")
    );
  }
  return evidence.filter(
    (record) =>
      record.subjectId === target.meta.id &&
      record.outcome === gate.requiredOutcome &&
      allowedKinds.has(record.kind)
  );
}

function gateGap(
  gate: RequiredCloseoutGate,
  owner: WorkItem,
  target: WorkItem | undefined,
  reason: string,
  options: {
    readonly code?: EnforcementGap["code"];
    readonly data?: EnforcementGap["data"];
  } = {}
): CloseoutGateGap {
  return {
    code: options.code ?? defaultGateGapCode(gate.kind),
    gateId: gate.id,
    gateKind: gate.kind,
    gateScope: gate.scope,
    subjectType: closeoutGateSubjectTypeForWorkKind(owner.kind),
    subjectId: owner.meta.id,
    targetId: target?.meta.id,
    reason,
    data: {
      gateIds: [gate.id],
      requiredEvidenceKinds: gate.requiredEvidenceKinds,
      minEvidenceCount: gate.minEvidenceCount,
      ...(gate.declaredCommand ? { declaredCommand: gate.declaredCommand } : {}),
      ...(gate.expectedObservable ? { expectedObservable: gate.expectedObservable } : {}),
      ...options.data,
      reason
    }
  };
}

function defaultGateGapCode(kind: RequiredCloseoutGate["kind"]): EnforcementGap["code"] {
  switch (kind) {
    case "verification":
      return "gate.verification.unsatisfied";
    case "checkpoint":
      return "gate.checkpoint.unsatisfied";
    case "review":
      return "gate.review.unsatisfied";
    case "audit":
      return "gate.audit.unsatisfied";
  }
}

function enforcementGapFromCloseoutGateGap(gap: CloseoutGateGap): EnforcementGap {
  return {
    code: gap.code,
    subjectType: gap.subjectType,
    subjectId: gap.subjectId,
    targetId: gap.targetId,
    data: gap.data ?? { reason: gap.reason }
  };
}

function legacyCloseoutGateGap(gap: CloseoutGateGap): Omit<CloseoutGateGap, "code" | "data"> & {
  readonly code: EnforcementGap["code"];
  readonly data?: EnforcementGap["data"];
} {
  return gap;
}

function mergeGateSatisfactions(values: readonly CloseoutGateSatisfaction[]): RequiredCloseoutGate["satisfiedBy"] {
  const directiveIds = uniqueValues(values.flatMap((value) => value.directiveIds ?? []));
  const acknowledgementIds = uniqueStrings(values.flatMap((value) => value.acknowledgementIds ?? []));
  return {
    evidenceIds: uniqueValues(values.flatMap((value) => value.evidenceIds ?? [])),
    verificationIds: uniqueValues(values.flatMap((value) => value.verificationIds ?? [])),
    agentSummaryIds: uniqueValues(values.flatMap((value) => value.agentSummaryIds ?? [])),
    commitShas: uniqueStrings(values.flatMap((value) => value.commitShas ?? [])),
    dirtyPathNotes: uniqueStrings(values.flatMap((value) => value.dirtyPathNotes ?? [])),
    ...(directiveIds.length > 0 ? { directiveIds } : {}),
    ...(acknowledgementIds.length > 0 ? { acknowledgementIds } : {})
  };
}

function uniqueValues<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function uniqueAgentSummaries(values: readonly AgentSummaryRecord[]): readonly AgentSummaryRecord[] {
  const byId = new Map<AgentSummaryId, AgentSummaryRecord>();
  for (const value of values) {
    byId.set(value.meta.id, value);
  }
  return [...byId.values()];
}

function dirtyPathNotesHaveReasonCode(notes: readonly string[]): boolean {
  return notes.some((note) => {
    const [code] = note.trim().split(":", 1);
    return code !== undefined && CHECKPOINT_DIRTY_PATH_REASON_CODES.has(code);
  });
}

function isContainerWork(work: WorkItem): boolean {
  return work.kind === "sprint" || work.kind === "milestone";
}

function isResolvedForContainerClose(work: WorkItem): boolean {
  return work.status === "closed" || work.status === "cancelled" || work.status === "verified";
}

async function requireKnowledgeSource(reader: BorealReader, sourceId: KnowledgeSourceId): Promise<KnowledgeSource> {
  const source = await reader.getKnowledgeSource(sourceId);
  if (!source) {
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge source not found", { sourceId });
  }
  return source;
}

async function requireClaim(reader: BorealReader, claimId: ClaimId): Promise<ClaimRecord> {
  const claim = await reader.getClaim(claimId);
  if (!claim) {
    throw new BorealError("BOREAL_NOT_FOUND", "Claim not found", { claimId });
  }
  return claim;
}

async function requireDecision(reader: BorealReader, decisionId: DecisionId): Promise<DecisionRecord> {
  const decision = await reader.getDecision(decisionId);
  if (!decision) {
    throw new BorealError("BOREAL_NOT_FOUND", "Decision not found", { decisionId });
  }
  return decision;
}

async function requireKnowledgeSources(
  reader: BorealReader,
  sourceIds: readonly KnowledgeSourceId[]
): Promise<void> {
  const missingSourceIds: KnowledgeSourceId[] = [];
  for (const sourceId of sourceIds) {
    if (!(await reader.getKnowledgeSource(sourceId))) {
      missingSourceIds.push(sourceId);
    }
  }
  if (missingSourceIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge record references missing source", { missingSourceIds });
  }
}

async function requireEvidenceRecords(reader: BorealReader, evidenceIds: readonly EvidenceId[]): Promise<void> {
  const missingEvidenceIds: EvidenceId[] = [];
  for (const evidenceId of evidenceIds) {
    if (!(await reader.getEvidence(evidenceId))) {
      missingEvidenceIds.push(evidenceId);
    }
  }
  if (missingEvidenceIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge record references missing evidence", { missingEvidenceIds });
  }
}

async function loadEvidenceRecords(reader: BorealReader, evidenceIds: readonly EvidenceId[]): Promise<readonly EvidenceRecord[]> {
  const records: EvidenceRecord[] = [];
  const missingEvidence: EvidenceId[] = [];
  for (const evidenceId of evidenceIds) {
    const record = await reader.getEvidence(evidenceId);
    if (record) {
      records.push(record);
    } else {
      missingEvidence.push(evidenceId);
    }
  }
  if (missingEvidence.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Verification references missing evidence", { missingEvidence });
  }
  return records;
}

async function loadDependencies(reader: BorealReader, work: WorkItem): Promise<readonly WorkItem[]> {
  return Promise.all((await graphDependencyIds(reader, work.meta.id)).map((dependencyId) => requireWork(reader, dependencyId)));
}

async function graphDependencyIds(reader: BorealReader, workId: WorkId): Promise<readonly WorkId[]> {
  const edges = await reader.listGraphEdges();
  return unique(
    edges
      .filter((edge) => edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work" && edge.toId === workId)
      .map((edge) => edge.fromId as WorkId)
  ).sort((left, right) => left.localeCompare(right));
}

async function workDependencyScopeIds(
  reader: BorealReader,
  containerId: WorkId,
  workItems: readonly WorkItem[]
): Promise<ReadonlySet<WorkId>> {
  const edges = await reader.listGraphEdges();
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const ids = new Set<WorkId>([containerId]);
  const visit = (workId: WorkId): void => {
    const work = workById.get(workId);
    if (!work) {
      return;
    }
    const dependencyIds = unique([
      ...work.dependencyIds,
      ...edges
        .filter((edge) => edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work" && edge.toId === workId)
        .map((edge) => edge.fromId as WorkId)
    ]);
    for (const dependencyId of dependencyIds) {
      if (ids.has(dependencyId)) {
        continue;
      }
      ids.add(dependencyId);
      visit(dependencyId);
    }
  };
  visit(containerId);
  return ids;
}

async function workWithGraphDependencies(reader: BorealReader, work: WorkItem): Promise<WorkItem> {
  return { ...work, dependencyIds: await graphDependencyIds(reader, work.meta.id) };
}

async function repairDependencyProjection(writer: BorealWriter): Promise<RepairDependencyProjectionResult> {
  const workItems = await writer.listWorkItems();
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const graphEdges = await writer.listGraphEdges();
  let dependencyChanged = 0;
  let readinessChanged = 0;

  for (const work of workItems) {
    const dependencyIds = unique(
      graphEdges
        .filter((edge) => edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work" && edge.toId === work.meta.id)
        .map((edge) => edge.fromId as WorkId)
        .filter((dependencyId) => workById.has(dependencyId))
    ).sort((left, right) => left.localeCompare(right));
    const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
    const status = deriveReadinessStatus({ ...work, dependencyIds }, dependencies);
    const changedDependencies = !arraysEqual(work.dependencyIds, dependencyIds);
    const changedReadiness = status !== work.status;
    if (changedDependencies || changedReadiness) {
      await writer.putWorkItem({ ...work, dependencyIds, status });
      dependencyChanged += changedDependencies ? 1 : 0;
      readinessChanged += changedReadiness ? 1 : 0;
    }
  }

  return { dependencyChanged, readinessChanged };
}

async function recomputeAllReadiness(writer: BorealWriter): Promise<number> {
  let changedTotal = 0;

  for (let pass = 0; pass < 100; pass += 1) {
    const items = await writer.listWorkItems();
    let changedThisPass = 0;

    for (const item of items) {
      const dependencies = await loadDependencies(writer, item);
      const status = deriveReadinessStatus(item, dependencies);
      if (status !== item.status) {
        await writer.putWorkItem({ ...item, status });
        changedThisPass += 1;
      }
    }

    changedTotal += changedThisPass;
    if (changedThisPass === 0) {
      return changedTotal;
    }
  }

  throw new BorealError("BOREAL_INVARIANT", "Readiness recompute did not converge");
}

async function makeWorkView(reader: BorealReader, work: WorkItem): Promise<WorkItemView> {
  const workItems = await reader.listWorkItems();
  const graphWork = await workWithGraphDependencies(reader, work);
  const dependencies = graphWork.dependencyIds
    .map((dependencyId) => workItems.find((item) => item.meta.id === dependencyId))
    .filter(isWorkItem);
  const evidence = await reader.listEvidenceForSubject(work.meta.id);
  const verifications = await reader.listVerificationsForSubject(work.meta.id);
  const packs = await reader.listContextPacks();
  const contextPack = packs.find((pack) => pack.subjectId === work.meta.id);
  return toWorkItemView({ work: graphWork, dependencies, evidence, verifications, contextPack });
}

async function refreshWorkContext(
  writer: BorealWriter,
  work: WorkItem,
  actor: ActorRef,
  current: IsoTimestamp
): Promise<ContextPack> {
  const ledgerSeq = (await writer.listEvents()).length + 1;
  const graphWork = await workWithGraphDependencies(writer, work);
  const evidence = await writer.listEvidenceForSubject(work.meta.id);
  const sources = await writer.listKnowledgeSources();
  const claims = await writer.listClaims();
  const decisions = await writer.listDecisions();
  const pack = withContextPackLedgerSeq(
    buildContextPack({ work: graphWork, evidence, sources, claims, decisions, actor, now: current }),
    ledgerSeq
  );
  await writer.putContextPack(pack);
  await writer.putProjection(buildContextProjection({ work: graphWork, evidence, sources, claims, decisions, actor, now: current }));
  return pack;
}

function withContextPackLedgerSeq(pack: ContextPack, ledgerSeq: number): ContextPack {
  return {
    ...pack,
    ledgerSeq
  };
}

function compareClaimCandidates(left: WorkItem, right: WorkItem): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    left.title.localeCompare(right.title) ||
    left.meta.id.localeCompare(right.meta.id)
  );
}

function priorityRank(priority: WorkItem["priority"]): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
  }
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function systemActor(): ActorRef {
  return {
    id: "boreal-system",
    kind: "system",
    displayName: "Boreal Runtime"
  };
}

function normalizeActorRef(actor: ActorRef): ActorRef {
  const id = normalizeActorId(String(actor.id));
  return {
    ...actor,
    id,
    displayName: actor.displayName ?? id
  };
}
