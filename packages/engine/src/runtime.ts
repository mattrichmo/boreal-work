import { reserveWork as reserveWorkDomain } from "@boreal/agent-runtime";
import {
  BorealError,
  DEFAULT_RUNTIME_POLICY,
  createRecordMeta,
  deterministicId,
  nowIso,
  type ActorRef,
  type AgentId,
  type ClaimRecord,
  type DecisionRecord,
  type EventId,
  type EvidenceId,
  type EvidenceRecord,
  type KnowledgeSource,
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

export interface BorealRuntime {
  readonly policy: RuntimePolicy;
  initWorkspace(): Promise<RuntimeEvent>;
  createWork(input: Omit<Parameters<typeof createWorkItem>[0], "actor" | "now">): Promise<WorkItem>;
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
  createClaim(input: Omit<Parameters<typeof createClaim>[0], "actor" | "now">): Promise<ClaimRecord>;
  createDecision(input: Omit<Parameters<typeof createDecision>[0], "actor" | "now">): Promise<DecisionRecord>;
  rebuildProjections(): Promise<readonly WorkItemView[]>;
  getWorkView(workId: WorkId): Promise<WorkItemView>;
  listEvents(): Promise<readonly RuntimeEvent[]>;
}

export function createBorealRuntime(options: BorealRuntimeOptions = {}): BorealRuntime {
  const store = options.store ?? new InMemoryBorealStore();
  const policy: RuntimePolicy = { ...DEFAULT_RUNTIME_POLICY, ...options.policy };
  const actor = options.actor ?? systemActor();
  const clock = options.clock ?? (() => new Date());
  let eventSequence = 0;

  const now = () => nowIso(clock());

  async function appendEvent(
    writer: BorealWriter,
    type: string,
    subjectId: string,
    subjectType: string,
    payload: Record<string, unknown>
  ): Promise<RuntimeEvent> {
    eventSequence += 1;
    const eventNow = now();
    const event = withContentHash({
      meta: createRecordMeta({
        id: deterministicId<EventId>("event", {
          type,
          subjectId,
          eventSequence,
          eventNow,
          payload
        }),
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

  return {
    policy,

    async initWorkspace(): Promise<RuntimeEvent> {
      return store.write((writer) =>
        appendEvent(writer, "workspace.initialized", "workspace", "workspace", {
          runtime: "boreal",
          policy
        })
      );
    },

    async createWork(input): Promise<WorkItem> {
      return store.write(async (writer) => {
        const work = createWorkItem({ ...input, actor, now: now() });
        if (await writer.getWorkItem(work.meta.id)) {
          throw new BorealError("BOREAL_CONFLICT", "Work item already exists", { workId: work.meta.id });
        }
        await writer.putWorkItem(work);
        await appendEvent(writer, "work.created", work.meta.id, "work", { title: work.title, kind: work.kind });
        return work;
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
          purpose: input.purpose
        });
        for (const released of reservationResult.releasedReservations) {
          await writer.putReservation(released);
        }
        await writer.putReservation(reservationResult.reservation);
        await writer.putWorkItem(reservationResult.work);
        await appendEvent(writer, "work.reserved", work.meta.id, "work", {
          agentId: input.agentId,
          reservationId: reservationResult.reservation.meta.id
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
        await refreshDependents(writer, closed.meta.id);
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

    async createClaim(input): Promise<ClaimRecord> {
      return store.write(async (writer) => {
        const claim = createClaim({ ...input, actor, now: now() });
        await writer.putClaim(claim);
        await appendEvent(writer, "knowledge.claim_created", claim.meta.id, "claim", { status: claim.status });
        return claim;
      });
    },

    async createDecision(input): Promise<DecisionRecord> {
      return store.write(async (writer) => {
        const decision = createDecision({ ...input, actor, now: now() });
        await writer.putDecision(decision);
        await appendEvent(writer, "knowledge.decision_created", decision.meta.id, "decision", {
          status: decision.status
        });
        return decision;
      });
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

    async getWorkView(workId): Promise<WorkItemView> {
      return store.read(async (reader) => makeWorkView(reader, await requireWork(reader, workId)));
    },

    async listEvents(): Promise<readonly RuntimeEvent[]> {
      return store.read((reader) => reader.listEvents());
    }
  };
}

async function requireWork(reader: BorealReader, workId: WorkId): Promise<WorkItem> {
  const work = await reader.getWorkItem(workId);
  if (!work) {
    throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId });
  }
  return work;
}

async function loadDependencies(reader: BorealReader, work: WorkItem): Promise<readonly WorkItem[]> {
  return Promise.all(work.dependencyIds.map((dependencyId) => requireWork(reader, dependencyId)));
}

async function refreshDependents(writer: BorealWriter, changedWorkId: WorkId): Promise<void> {
  const items = await writer.listWorkItems();
  for (const item of items) {
    if (!item.dependencyIds.includes(changedWorkId)) {
      continue;
    }
    const dependencies = await loadDependencies(writer, item);
    const status = deriveReadinessStatus(item, dependencies);
    if (status !== item.status) {
      await writer.putWorkItem({ ...item, status });
    }
  }
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

