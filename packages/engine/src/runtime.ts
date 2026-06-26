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
  type ClaimId,
  type ClaimRecord,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type EventId,
  type EvidenceId,
  type EvidenceRecord,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type OperationId,
  type ProjectionId,
  type RuntimeEvent,
  type RuntimePolicy,
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
  closeWork as closeWorkDomain,
  createWorkItem,
  deriveReadinessStatus,
  markWorkReady
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
  readonly match: "id" | "id_prefix" | "title";
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
  };
  readonly release?: boolean;
}

export interface FinishReservedWorkResult {
  readonly work: WorkItem;
  readonly evidence: EvidenceRecord;
  readonly verification: VerificationRecord;
  readonly reservation: AgentReservation;
  readonly closedWork?: WorkItem;
  readonly release: ReservationLifecycleResult;
}

export interface RebuildProjectionsOptions {
  readonly skipContextPackIds?: ReadonlySet<ProjectionId>;
  readonly skipProjectionIds?: ReadonlySet<ProjectionId>;
}

export interface BorealRuntime {
  readonly policy: RuntimePolicy;
  initWorkspace(): Promise<RuntimeEvent>;
  ensureWorkspaceInitialized(): Promise<WorkspaceInitializationResult>;
  resolveWorkReference(ref: string): Promise<WorkId>;
  createWork(input: CreateWorkRuntimeInput): Promise<WorkItem>;
  addBlockingDependency(input: {
    readonly blockedWorkId: WorkId;
    readonly blockingWorkId: WorkId;
  }): Promise<WorkItem>;
  markReady(workId: WorkId): Promise<WorkItem>;
  listReadyWork(): Promise<readonly WorkItemView[]>;
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

    async resolveWorkReference(ref): Promise<WorkId> {
      return store.read(async (reader) => resolveWorkReference(reader, ref));
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
        const existingEdges = await writer.listGraphEdges();
        const result = addBlockingDependencyDomain({
          blockedWork,
          blockingWork,
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

    async claimNextWork(input): Promise<ClaimNextWorkResult | undefined> {
      return store.write(async (writer) => {
        const labels = normalizeLabels(input.labels ?? []);
        const agentId = normalizeActorId(String(input.agentId));
        const candidates: WorkItem[] = [];
        const items = await writer.listWorkItems();
        for (const item of items) {
          if (item.status !== "ready" || item.reservationId) {
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
        const evidence = recordEvidenceDomain({ ...input, actor, now: now() });
        await writer.putEvidence(evidence);
        if (input.subjectType === "work") {
          const work = await requireWork(writer, input.subjectId as WorkId);
          await writer.putWorkItem(attachEvidenceToWork(work, evidence.meta.id, now(), actor));
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
        const work = await requireWork(writer, input.workId);
        const availableEvidence = await writer.listEvidenceForSubject(input.workId);
        const verification = verifySubject({
          subjectId: input.workId,
          subjectType: "work",
          verdict: input.verdict,
          evidenceIds: input.evidenceIds,
          availableEvidence,
          notes: input.notes,
          policy,
          actor,
          now: now()
        });
        await writer.putVerification(verification);
        await writer.putWorkItem(attachVerificationToWork(work, verification, now(), actor));
        await appendEvent(writer, "work.verified", input.workId, "work", {
          verdict: verification.verdict,
          verificationId: verification.meta.id
        });
        return verification;
      });
    },

    async closeWork(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const work = await requireWork(writer, input.workId);
        const verifications = await writer.listVerificationsForSubject(input.workId);
        const closed = closeWorkDomain(work, verifications, policy, now(), actor, input.reason);
        await writer.putWorkItem(closed);
        await recomputeAllReadiness(writer);
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
        if (input.close) {
          const availableVerifications = [...(await writer.listVerificationsForSubject(input.workId)), verification];
          closedWork = closeWorkDomain(workWithVerification, availableVerifications, policy, current, actor, input.close.reason);
          finalWork = closedWork;
        }

        const releasedReservation = releaseReservation(reservation, current, actor);
        finalWork = await clearWorkReservation(writer, finalWork, current, actor);
        closedWork = closedWork ? finalWork : undefined;

        await writer.putEvidence(evidence);
        await writer.putVerification(verification);
        await writer.putReservation(releasedReservation);
        await writer.putWorkItem(finalWork);
        if (input.close) {
          await recomputeAllReadiness(writer);
        }
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
        const workItems = await writer.listWorkItems();
        const sources = await writer.listKnowledgeSources();
        const claims = await writer.listClaims();
        const decisions = await writer.listDecisions();
        const views: WorkItemView[] = [];

        for (const work of workItems) {
          const graphWork = await workWithGraphDependencies(writer, work);
          const evidence = await writer.listEvidenceForSubject(work.meta.id);
          const contextPack = buildContextPack({ work: graphWork, evidence, sources, claims, decisions, actor, now: now() });
          const projection = buildContextProjection({ work: graphWork, evidence, sources, claims, decisions, actor, now: now() });
          const writeContextPack = !options.skipContextPackIds?.has(contextPack.id);
          const writeProjection = !options.skipProjectionIds?.has(projection.meta.id);
          if (writeContextPack) {
            await writer.putContextPack(contextPack);
          }
          if (writeProjection) {
            await writer.putProjection(projection);
          }
          views.push(toWorkItemView({ work: graphWork, evidence, contextPack: writeContextPack ? contextPack : undefined }));
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

async function resolveWorkReference(reader: BorealReader, ref: string): Promise<WorkId> {
  const normalizedRef = normalizeSearchQuery(ref);
  const normalizedLower = normalizedRef.toLocaleLowerCase("en-US");
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
  const activeReservations = (await reader.listReservationsForWork(work.meta.id)).filter(
    (reservation) => reservation.status === "active"
  );
  const reservation = work.reservationId
    ? activeReservations.find((entry) => entry.meta.id === work.reservationId)
    : activeReservations[0];
  if (!reservation) {
    throw new BorealError("BOREAL_NOT_FOUND", "Work item does not have an active reservation", {
      workId: work.meta.id,
      reservationId: work.reservationId
    });
  }
  return reservation;
}

async function requireAgentWorkReservation(
  reader: BorealReader,
  work: WorkItem,
  agentId: AgentId | string,
  current: IsoTimestamp
): Promise<AgentReservation> {
  const normalizedAgentId = normalizeActorId(String(agentId));
  const reservation = await requireActiveWorkReservation(reader, work);
  if (String(reservation.agentId) !== normalizedAgentId) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Agent does not own the active reservation", {
      workId: work.meta.id,
      agentId: normalizedAgentId,
      reservationAgentId: reservation.agentId,
      reservationId: reservation.meta.id
    });
  }
  if (reservation.expiresAt && Date.parse(reservation.expiresAt) <= Date.parse(current)) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Agent reservation is expired; run `bwrk doctor --fix`", {
      workId: work.meta.id,
      agentId: normalizedAgentId,
      reservationId: reservation.meta.id,
      expiresAt: reservation.expiresAt
    });
  }
  return reservation;
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
  const evidence = await reader.listEvidenceForSubject(work.meta.id);
  const verifications = await reader.listVerificationsForSubject(work.meta.id);
  const packs = await reader.listContextPacks();
  const contextPack = packs.find((pack) => pack.subjectId === work.meta.id);
  return toWorkItemView({ work: await workWithGraphDependencies(reader, work), evidence, verifications, contextPack });
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
