import { reserveWork as reserveWorkDomain } from "@boreal/agent-runtime";
import {
  BorealError,
  DEFAULT_RUNTIME_POLICY,
  createRecordMeta,
  nowIso,
  randomId,
  type ActorRef,
  type AgentId,
  type ClaimId,
  type ClaimRecord,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type EventId,
  type EvidenceId,
  type EvidenceRecord,
  type KnowledgeSource,
  type KnowledgeSourceId,
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

export interface BorealRuntime {
  readonly policy: RuntimePolicy;
  initWorkspace(): Promise<RuntimeEvent>;
  ensureWorkspaceInitialized(): Promise<WorkspaceInitializationResult>;
  createWork(input: CreateWorkRuntimeInput): Promise<WorkItem>;
  addBlockingDependency(input: {
    readonly blockedWorkId: WorkId;
    readonly blockingWorkId: WorkId;
  }): Promise<WorkItem>;
  markReady(workId: WorkId): Promise<WorkItem>;
  listReadyWork(): Promise<readonly WorkItemView[]>;
  reserveWork(input: {
    readonly workId: WorkId;
    readonly agentId: AgentId | string;
    readonly purpose?: string;
    readonly force?: boolean;
    readonly forceReason?: string;
  }): Promise<WorkItem>;
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
  createKnowledgeSource(input: Omit<Parameters<typeof createKnowledgeSource>[0], "actor" | "now">): Promise<KnowledgeSource>;
  listKnowledgeSources(): Promise<readonly KnowledgeSource[]>;
  getKnowledgeSource(sourceId: KnowledgeSourceId): Promise<KnowledgeSource>;
  createClaim(input: Omit<Parameters<typeof createClaim>[0], "actor" | "now">): Promise<ClaimRecord>;
  listClaims(): Promise<readonly ClaimRecord[]>;
  getClaim(claimId: ClaimId): Promise<ClaimRecord>;
  createDecision(input: Omit<Parameters<typeof createDecision>[0], "actor" | "now">): Promise<DecisionRecord>;
  listDecisions(): Promise<readonly DecisionRecord[]>;
  getDecision(decisionId: DecisionId): Promise<DecisionRecord>;
  rebuildProjections(): Promise<readonly WorkItemView[]>;
  getContextPack(workId: WorkId): Promise<ContextPack>;
  recomputeReadiness(): Promise<{ readonly changed: number }>;
  getWorkView(workId: WorkId): Promise<WorkItemView>;
  listEvents(): Promise<readonly RuntimeEvent[]>;
}

export function createBorealRuntime(options: BorealRuntimeOptions = {}): BorealRuntime {
  const store = options.store ?? new InMemoryBorealStore();
  const policy: RuntimePolicy = { ...DEFAULT_RUNTIME_POLICY, ...options.policy };
  const actor = options.actor ?? systemActor();
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
        const blockedWork = await requireWork(writer, input.blockedWorkId);
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
        const work = await requireWork(writer, workId);
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
        const readyItems = items.filter((item) => item.status === "ready");
        return Promise.all(readyItems.map((item) => makeWorkView(reader, item)));
      });
    },

    async reserveWork(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const work = await requireWork(writer, input.workId);
        const reservationResult = reserveWorkDomain({
          work,
          agentId: input.agentId,
          existingReservationsForWork: await writer.listReservationsForWork(input.workId),
          activeReservationsForAgent: await writer.listActiveReservationsForAgent(input.agentId),
          policy,
          actor,
          now: now(),
          purpose: input.purpose,
          force: input.force,
          forceReason: input.forceReason
        });
        for (const released of reservationResult.releasedReservations) {
          await writer.putReservation(released);
        }
        await writer.putReservation(reservationResult.reservation);
        await writer.putWorkItem(reservationResult.work);
        await appendEvent(writer, "work.reserved", work.meta.id, "work", {
          agentId: input.agentId,
          reservationId: reservationResult.reservation.meta.id,
          forced: Boolean(input.force),
          forceReason: input.forceReason
        });
        return reservationResult.work;
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

    async rebuildProjections(): Promise<readonly WorkItemView[]> {
      return store.write(async (writer) => {
        const workItems = await writer.listWorkItems();
        const claims = await writer.listClaims();
        const decisions = await writer.listDecisions();
        const views: WorkItemView[] = [];

        for (const work of workItems) {
          const evidence = await writer.listEvidenceForSubject(work.meta.id);
          const contextPack = buildContextPack({ work, evidence, claims, decisions, actor, now: now() });
          await writer.putContextPack(contextPack);
          await writer.putProjection(buildContextProjection({ work, evidence, claims, decisions, actor, now: now() }));
          views.push(toWorkItemView({ work, evidence, contextPack }));
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
  return Promise.all(work.dependencyIds.map((dependencyId) => requireWork(reader, dependencyId)));
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
  return toWorkItemView({ work, evidence, verifications, contextPack });
}

function systemActor(): ActorRef {
  return {
    id: "boreal-system",
    kind: "system",
    displayName: "Boreal Runtime"
  };
}
