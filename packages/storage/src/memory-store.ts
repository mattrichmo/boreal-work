import { deepClone, deepFreeze } from "@boreal/core";
import type {
  AgentReservation,
  AgentSummaryId,
  AgentSummaryRecord,
  ClaimId,
  ClaimRecord,
  ContextPack,
  DecisionId,
  DecisionRecord,
  DirectiveAcknowledgementId,
  DirectiveAcknowledgementRecord,
  EventCursorId,
  EventCursorRecord,
  EvidenceId,
  EvidenceRecord,
  GraphEdge,
  GraphEdgeId,
  KnowledgeSource,
  KnowledgeSourceId,
  OperationId,
  ProjectionId,
  ProjectionRecord,
  ReservationId,
  ReviewerHeartbeatId,
  ReviewerHeartbeatRecord,
  RunCheckpoint,
  RunCheckpointId,
  RunId,
  ExecutionRun,
  RuntimeEvent,
  RuntimeOperation,
  VerificationId,
  VerificationRecord,
  WorkId,
  WorkItem
} from "@boreal/core";

import type { BorealReader, BorealStore, BorealWriter, WorkItemFilter } from "./ports.js";

interface StoreState {
  readonly workItems: Map<WorkId, WorkItem>;
  readonly agentSummaries: Map<AgentSummaryId, AgentSummaryRecord>;
  readonly evidence: Map<EvidenceId, EvidenceRecord>;
  readonly verifications: Map<VerificationId, VerificationRecord>;
  readonly directiveAcknowledgements: Map<DirectiveAcknowledgementId, DirectiveAcknowledgementRecord>;
  readonly knowledgeSources: Map<KnowledgeSourceId, KnowledgeSource>;
  readonly claims: Map<ClaimId, ClaimRecord>;
  readonly decisions: Map<DecisionId, DecisionRecord>;
  readonly graphEdges: Map<GraphEdgeId, GraphEdge>;
  readonly reservations: Map<ReservationId, AgentReservation>;
  readonly reviewerHeartbeats: Map<ReviewerHeartbeatId, ReviewerHeartbeatRecord>;
  readonly runs: Map<RunId, ExecutionRun>;
  readonly checkpoints: Map<RunCheckpointId, RunCheckpoint>;
  readonly eventCursors: Map<EventCursorId, EventCursorRecord>;
  readonly events: Map<string, RuntimeEvent>;
  readonly operations: Map<OperationId, RuntimeOperation>;
  readonly projections: Map<ProjectionId, ProjectionRecord>;
  readonly contextPacks: Map<ProjectionId, ContextPack>;
}

interface StoreOverlay {
  readonly workItems: SectionOverlay<WorkId, WorkItem>;
  readonly agentSummaries: SectionOverlay<AgentSummaryId, AgentSummaryRecord>;
  readonly evidence: SectionOverlay<EvidenceId, EvidenceRecord>;
  readonly verifications: SectionOverlay<VerificationId, VerificationRecord>;
  readonly directiveAcknowledgements: SectionOverlay<DirectiveAcknowledgementId, DirectiveAcknowledgementRecord>;
  readonly knowledgeSources: SectionOverlay<KnowledgeSourceId, KnowledgeSource>;
  readonly claims: SectionOverlay<ClaimId, ClaimRecord>;
  readonly decisions: SectionOverlay<DecisionId, DecisionRecord>;
  readonly graphEdges: SectionOverlay<GraphEdgeId, GraphEdge>;
  readonly reservations: SectionOverlay<ReservationId, AgentReservation>;
  readonly reviewerHeartbeats: SectionOverlay<ReviewerHeartbeatId, ReviewerHeartbeatRecord>;
  readonly runs: SectionOverlay<RunId, ExecutionRun>;
  readonly checkpoints: SectionOverlay<RunCheckpointId, RunCheckpoint>;
  readonly eventCursors: SectionOverlay<EventCursorId, EventCursorRecord>;
  readonly events: SectionOverlay<string, RuntimeEvent>;
  readonly operations: SectionOverlay<OperationId, RuntimeOperation>;
  readonly projections: SectionOverlay<ProjectionId, ProjectionRecord>;
  readonly contextPacks: SectionOverlay<ProjectionId, ContextPack>;
}

interface SectionOverlay<K, V> {
  readonly base: ReadonlyMap<K, V>;
  readonly pending: Map<K, V>;
  readonly deleted: Set<K>;
}

export class InMemoryBorealStore implements BorealStore {
  #state: StoreState;

  constructor(seed?: PartialStoreSeed) {
    this.#state = createState(seed);
  }

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    const snapshot = new MemoryTransaction(createOverlayState(this.#state));
    return operation(snapshot);
  }

  async write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    const { result } = await this.writeWithChangeSet(operation);
    return result;
  }

  async writeWithChangeSet<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<StoreWriteResult<T>> {
    const working = createOverlayState(this.#state);
    const transaction = new MemoryTransaction(working);
    const result = await operation(transaction);
    const changes = overlayStateChanges(working);
    this.#state = commitOverlayState(working);
    return { result, changes };
  }

  async snapshot(): Promise<StoreSnapshot> {
    return stateToSnapshot(this.#state);
  }
}

export interface StoreSnapshot {
  readonly workItems?: readonly WorkItem[];
  readonly agentSummaries?: readonly AgentSummaryRecord[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly verifications?: readonly VerificationRecord[];
  readonly directiveAcknowledgements?: readonly DirectiveAcknowledgementRecord[];
  readonly knowledgeSources?: readonly KnowledgeSource[];
  readonly claims?: readonly ClaimRecord[];
  readonly decisions?: readonly DecisionRecord[];
  readonly graphEdges?: readonly GraphEdge[];
  readonly reservations?: readonly AgentReservation[];
  readonly reviewerHeartbeats?: readonly ReviewerHeartbeatRecord[];
  readonly runs?: readonly ExecutionRun[];
  readonly checkpoints?: readonly RunCheckpoint[];
  readonly eventCursors?: readonly EventCursorRecord[];
  readonly events?: readonly RuntimeEvent[];
  readonly operations?: readonly RuntimeOperation[];
  readonly projections?: readonly ProjectionRecord[];
  readonly contextPacks?: readonly ContextPack[];
}

export type PartialStoreSeed = StoreSnapshot;

export type StoreSectionName = keyof Required<StoreSnapshot>;

export interface StoreChange {
  readonly section: StoreSectionName;
  readonly id: string;
  readonly record: unknown | null;
}

export interface StoreWriteResult<T> {
  readonly result: T;
  readonly changes: readonly StoreChange[];
}

class MemoryTransaction implements BorealWriter {
  constructor(private readonly state: StoreOverlay) {}

  async getWorkItem(id: WorkId): Promise<WorkItem | undefined> {
    return overlayGet(this.state.workItems, id);
  }

  async listWorkItems(filter?: WorkItemFilter): Promise<readonly WorkItem[]> {
    return overlayValues(this.state.workItems).filter((item) => matchesWorkFilter(item, filter));
  }

  async getAgentSummary(id: AgentSummaryId): Promise<AgentSummaryRecord | undefined> {
    return overlayGet(this.state.agentSummaries, id);
  }

  async listAgentSummaries(): Promise<readonly AgentSummaryRecord[]> {
    return overlayValues(this.state.agentSummaries);
  }

  async listAgentSummariesForSubject(subjectId: string): Promise<readonly AgentSummaryRecord[]> {
    return overlayValues(this.state.agentSummaries).filter((record) => record.subjectId === subjectId);
  }

  async getEvidence(id: EvidenceId): Promise<EvidenceRecord | undefined> {
    return overlayGet(this.state.evidence, id);
  }

  async listEvidence(): Promise<readonly EvidenceRecord[]> {
    return overlayValues(this.state.evidence);
  }

  async listEvidenceForSubject(subjectId: string): Promise<readonly EvidenceRecord[]> {
    return overlayValues(this.state.evidence).filter((record) => record.subjectId === subjectId);
  }

  async getVerification(id: VerificationId): Promise<VerificationRecord | undefined> {
    return overlayGet(this.state.verifications, id);
  }

  async listVerifications(): Promise<readonly VerificationRecord[]> {
    return overlayValues(this.state.verifications);
  }

  async listVerificationsForSubject(subjectId: string): Promise<readonly VerificationRecord[]> {
    return overlayValues(this.state.verifications).filter((record) => record.subjectId === subjectId);
  }

  async getDirectiveAcknowledgement(id: DirectiveAcknowledgementId): Promise<DirectiveAcknowledgementRecord | undefined> {
    return overlayGet(this.state.directiveAcknowledgements, id);
  }

  async listDirectiveAcknowledgements(): Promise<readonly DirectiveAcknowledgementRecord[]> {
    return overlayValues(this.state.directiveAcknowledgements);
  }

  async listDirectiveAcknowledgementsForSubject(subjectId: string): Promise<readonly DirectiveAcknowledgementRecord[]> {
    return overlayValues(this.state.directiveAcknowledgements).filter((record) => record.subjectId === subjectId);
  }

  async getKnowledgeSource(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined> {
    return overlayGet(this.state.knowledgeSources, id);
  }

  async listKnowledgeSources(): Promise<readonly KnowledgeSource[]> {
    return overlayValues(this.state.knowledgeSources);
  }

  async getClaim(id: ClaimId): Promise<ClaimRecord | undefined> {
    return overlayGet(this.state.claims, id);
  }

  async getDecision(id: DecisionId): Promise<DecisionRecord | undefined> {
    return overlayGet(this.state.decisions, id);
  }

  async listClaims(): Promise<readonly ClaimRecord[]> {
    return overlayValues(this.state.claims);
  }

  async listDecisions(): Promise<readonly DecisionRecord[]> {
    return overlayValues(this.state.decisions);
  }

  async getGraphEdge(id: GraphEdgeId): Promise<GraphEdge | undefined> {
    return overlayGet(this.state.graphEdges, id);
  }

  async listGraphEdges(): Promise<readonly GraphEdge[]> {
    return overlayValues(this.state.graphEdges);
  }

  async listGraphEdgesForSubject(subjectId: string): Promise<readonly GraphEdge[]> {
    return overlayValues(this.state.graphEdges).filter((edge) => edge.fromId === subjectId || edge.toId === subjectId);
  }

  async getReservation(id: ReservationId): Promise<AgentReservation | undefined> {
    return overlayGet(this.state.reservations, id);
  }

  async listReservations(): Promise<readonly AgentReservation[]> {
    return overlayValues(this.state.reservations);
  }

  async listReservationsForWork(workId: WorkId): Promise<readonly AgentReservation[]> {
    return overlayValues(this.state.reservations).filter((record) => record.workId === workId);
  }

  async listActiveReservationsForAgent(agentId: string): Promise<readonly AgentReservation[]> {
    return overlayValues(this.state.reservations).filter((record) => record.agentId === agentId && record.status === "active");
  }

  async getReviewerHeartbeat(id: ReviewerHeartbeatId): Promise<ReviewerHeartbeatRecord | undefined> {
    return overlayGet(this.state.reviewerHeartbeats, id);
  }

  async listReviewerHeartbeats(): Promise<readonly ReviewerHeartbeatRecord[]> {
    return overlayValues(this.state.reviewerHeartbeats);
  }

  async getRun(id: RunId): Promise<ExecutionRun | undefined> {
    return overlayGet(this.state.runs, id);
  }

  async listRuns(): Promise<readonly ExecutionRun[]> {
    return overlayValues(this.state.runs);
  }

  async listRunsForWork(workId: WorkId): Promise<readonly ExecutionRun[]> {
    return overlayValues(this.state.runs).filter((record) => record.workId === workId);
  }

  async getCheckpoint(id: RunCheckpointId): Promise<RunCheckpoint | undefined> {
    return overlayGet(this.state.checkpoints, id);
  }

  async listCheckpoints(): Promise<readonly RunCheckpoint[]> {
    return overlayValues(this.state.checkpoints);
  }

  async listCheckpointsForRun(runId: RunId): Promise<readonly RunCheckpoint[]> {
    return overlayValues(this.state.checkpoints)
      .filter((record) => record.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async getEventCursor(id: EventCursorId): Promise<EventCursorRecord | undefined> {
    return overlayGet(this.state.eventCursors, id);
  }

  async listEventCursors(): Promise<readonly EventCursorRecord[]> {
    return overlayValues(this.state.eventCursors);
  }

  async headSeq(): Promise<number> {
    return overlayValues(this.state.events).length + overlayValues(this.state.operations).length;
  }

  async listEvents(): Promise<readonly RuntimeEvent[]> {
    return overlayValues(this.state.events);
  }

  async getOperation(id: OperationId): Promise<RuntimeOperation | undefined> {
    return overlayGet(this.state.operations, id);
  }

  async listOperations(): Promise<readonly RuntimeOperation[]> {
    return overlayValues(this.state.operations);
  }

  async getProjection(id: ProjectionId): Promise<ProjectionRecord | undefined> {
    return overlayGet(this.state.projections, id);
  }

  async listProjections(): Promise<readonly ProjectionRecord[]> {
    return overlayValues(this.state.projections);
  }

  async listContextPacks(): Promise<readonly ContextPack[]> {
    return overlayValues(this.state.contextPacks);
  }

  async getContextPackForSubject(subjectId: string): Promise<ContextPack | undefined> {
    return overlayValues(this.state.contextPacks).find((record) => record.subjectId === subjectId);
  }

  async putWorkItem(item: WorkItem): Promise<void> {
    overlayPut(this.state.workItems, item.meta.id, frozenClone(item));
  }

  async deleteWorkItem(id: WorkId): Promise<boolean> {
    return overlayDelete(this.state.workItems, id);
  }

  async putAgentSummary(record: AgentSummaryRecord): Promise<void> {
    overlayPut(this.state.agentSummaries, record.meta.id, frozenClone(record));
  }

  async deleteAgentSummary(id: AgentSummaryId): Promise<boolean> {
    return overlayDelete(this.state.agentSummaries, id);
  }

  async putEvidence(record: EvidenceRecord): Promise<void> {
    overlayPut(this.state.evidence, record.meta.id, frozenClone(record));
  }

  async deleteEvidence(id: EvidenceId): Promise<boolean> {
    return overlayDelete(this.state.evidence, id);
  }

  async putVerification(record: VerificationRecord): Promise<void> {
    overlayPut(this.state.verifications, record.meta.id, frozenClone(record));
  }

  async deleteVerification(id: VerificationId): Promise<boolean> {
    return overlayDelete(this.state.verifications, id);
  }

  async putDirectiveAcknowledgement(record: DirectiveAcknowledgementRecord): Promise<void> {
    overlayPut(this.state.directiveAcknowledgements, record.meta.id, frozenClone(record));
  }

  async deleteDirectiveAcknowledgement(id: DirectiveAcknowledgementId): Promise<boolean> {
    return overlayDelete(this.state.directiveAcknowledgements, id);
  }

  async putKnowledgeSource(record: KnowledgeSource): Promise<void> {
    overlayPut(this.state.knowledgeSources, record.meta.id, frozenClone(record));
  }

  async deleteKnowledgeSource(id: KnowledgeSourceId): Promise<boolean> {
    return overlayDelete(this.state.knowledgeSources, id);
  }

  async putClaim(record: ClaimRecord): Promise<void> {
    overlayPut(this.state.claims, record.meta.id, frozenClone(record));
  }

  async deleteClaim(id: ClaimId): Promise<boolean> {
    return overlayDelete(this.state.claims, id);
  }

  async putDecision(record: DecisionRecord): Promise<void> {
    overlayPut(this.state.decisions, record.meta.id, frozenClone(record));
  }

  async deleteDecision(id: DecisionId): Promise<boolean> {
    return overlayDelete(this.state.decisions, id);
  }

  async putGraphEdge(record: GraphEdge): Promise<void> {
    overlayPut(this.state.graphEdges, record.meta.id, frozenClone(record));
  }

  async deleteGraphEdge(id: GraphEdgeId): Promise<boolean> {
    return overlayDelete(this.state.graphEdges, id);
  }

  async putReservation(record: AgentReservation): Promise<void> {
    overlayPut(this.state.reservations, record.meta.id, frozenClone(record));
  }

  async deleteReservation(id: ReservationId): Promise<boolean> {
    return overlayDelete(this.state.reservations, id);
  }

  async putReviewerHeartbeat(record: ReviewerHeartbeatRecord): Promise<void> {
    overlayPut(this.state.reviewerHeartbeats, record.meta.id, frozenClone(record));
  }

  async deleteReviewerHeartbeat(id: ReviewerHeartbeatId): Promise<boolean> {
    return overlayDelete(this.state.reviewerHeartbeats, id);
  }

  async putRun(record: ExecutionRun): Promise<void> {
    overlayPut(this.state.runs, record.meta.id, frozenClone(record));
  }

  async deleteRun(id: RunId): Promise<boolean> {
    return overlayDelete(this.state.runs, id);
  }

  async putCheckpoint(record: RunCheckpoint): Promise<void> {
    overlayPut(this.state.checkpoints, record.meta.id, frozenClone(record));
  }

  async deleteCheckpoint(id: RunCheckpointId): Promise<boolean> {
    return overlayDelete(this.state.checkpoints, id);
  }

  async putEventCursor(record: EventCursorRecord): Promise<void> {
    overlayPut(this.state.eventCursors, record.meta.id, frozenClone(record));
  }

  async deleteEventCursor(id: EventCursorId): Promise<boolean> {
    return overlayDelete(this.state.eventCursors, id);
  }

  async putEvent(record: RuntimeEvent): Promise<void> {
    overlayPut(this.state.events, record.meta.id, frozenClone(record));
  }

  async putOperation(record: RuntimeOperation): Promise<void> {
    overlayPut(this.state.operations, record.meta.id, frozenClone(record));
  }

  async deleteOperation(id: OperationId): Promise<boolean> {
    return overlayDelete(this.state.operations, id);
  }

  async putProjection(record: ProjectionRecord): Promise<void> {
    overlayPut(this.state.projections, record.meta.id, frozenClone(record));
  }

  async deleteProjection(id: ProjectionId): Promise<boolean> {
    return overlayDelete(this.state.projections, id);
  }

  async putContextPack(record: ContextPack): Promise<void> {
    overlayPut(this.state.contextPacks, record.id, frozenClone(record));
  }

  async deleteContextPack(id: ProjectionId): Promise<boolean> {
    return overlayDelete(this.state.contextPacks, id);
  }
}

function createState(seed?: PartialStoreSeed): StoreState {
  return {
    workItems: new Map((seed?.workItems ?? []).map((item) => [item.meta.id, frozenClone(item)])),
    agentSummaries: new Map((seed?.agentSummaries ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    evidence: new Map((seed?.evidence ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    verifications: new Map((seed?.verifications ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    directiveAcknowledgements: new Map(
      (seed?.directiveAcknowledgements ?? []).map((record) => [record.meta.id, frozenClone(record)])
    ),
    knowledgeSources: new Map((seed?.knowledgeSources ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    claims: new Map((seed?.claims ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    decisions: new Map((seed?.decisions ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    graphEdges: new Map((seed?.graphEdges ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    reservations: new Map((seed?.reservations ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    reviewerHeartbeats: new Map((seed?.reviewerHeartbeats ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    runs: new Map((seed?.runs ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    checkpoints: new Map((seed?.checkpoints ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    eventCursors: new Map((seed?.eventCursors ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    events: new Map((seed?.events ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    operations: new Map((seed?.operations ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    projections: new Map((seed?.projections ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    contextPacks: new Map((seed?.contextPacks ?? []).map((record) => [record.id, frozenClone(record)]))
  };
}

function frozenClone<T>(value: T): T {
  return deepFreeze(deepClone(value));
}

function createOverlayState(state: StoreState): StoreOverlay {
  return {
    workItems: createOverlay(state.workItems),
    agentSummaries: createOverlay(state.agentSummaries),
    evidence: createOverlay(state.evidence),
    verifications: createOverlay(state.verifications),
    directiveAcknowledgements: createOverlay(state.directiveAcknowledgements),
    knowledgeSources: createOverlay(state.knowledgeSources),
    claims: createOverlay(state.claims),
    decisions: createOverlay(state.decisions),
    graphEdges: createOverlay(state.graphEdges),
    reservations: createOverlay(state.reservations),
    reviewerHeartbeats: createOverlay(state.reviewerHeartbeats),
    runs: createOverlay(state.runs),
    checkpoints: createOverlay(state.checkpoints),
    eventCursors: createOverlay(state.eventCursors),
    events: createOverlay(state.events),
    operations: createOverlay(state.operations),
    projections: createOverlay(state.projections),
    contextPacks: createOverlay(state.contextPacks)
  };
}

function commitOverlayState(state: StoreOverlay): StoreState {
  return {
    workItems: overlayCommit(state.workItems),
    agentSummaries: overlayCommit(state.agentSummaries),
    evidence: overlayCommit(state.evidence),
    verifications: overlayCommit(state.verifications),
    directiveAcknowledgements: overlayCommit(state.directiveAcknowledgements),
    knowledgeSources: overlayCommit(state.knowledgeSources),
    claims: overlayCommit(state.claims),
    decisions: overlayCommit(state.decisions),
    graphEdges: overlayCommit(state.graphEdges),
    reservations: overlayCommit(state.reservations),
    reviewerHeartbeats: overlayCommit(state.reviewerHeartbeats),
    runs: overlayCommit(state.runs),
    checkpoints: overlayCommit(state.checkpoints),
    eventCursors: overlayCommit(state.eventCursors),
    events: overlayCommit(state.events),
    operations: overlayCommit(state.operations),
    projections: overlayCommit(state.projections),
    contextPacks: overlayCommit(state.contextPacks)
  };
}

function overlayStateChanges(state: StoreOverlay): StoreChange[] {
  return [
    ...sectionChanges("workItems", state.workItems),
    ...sectionChanges("agentSummaries", state.agentSummaries),
    ...sectionChanges("evidence", state.evidence),
    ...sectionChanges("verifications", state.verifications),
    ...sectionChanges("directiveAcknowledgements", state.directiveAcknowledgements),
    ...sectionChanges("knowledgeSources", state.knowledgeSources),
    ...sectionChanges("claims", state.claims),
    ...sectionChanges("decisions", state.decisions),
    ...sectionChanges("graphEdges", state.graphEdges),
    ...sectionChanges("reservations", state.reservations),
    ...sectionChanges("reviewerHeartbeats", state.reviewerHeartbeats),
    ...sectionChanges("runs", state.runs),
    ...sectionChanges("checkpoints", state.checkpoints),
    ...sectionChanges("eventCursors", state.eventCursors),
    ...sectionChanges("events", state.events),
    ...sectionChanges("operations", state.operations),
    ...sectionChanges("projections", state.projections),
    ...sectionChanges("contextPacks", state.contextPacks)
  ];
}

function sectionChanges<K, V>(section: StoreSectionName, overlay: SectionOverlay<K, V>): StoreChange[] {
  return [
    ...[...overlay.pending].map(([id, record]) => ({
      section,
      id: String(id),
      record
    })),
    ...[...overlay.deleted].map((id) => ({
      section,
      id: String(id),
      record: null
    }))
  ];
}

function createOverlay<K, V>(base: ReadonlyMap<K, V>): SectionOverlay<K, V> {
  return {
    base,
    pending: new Map(),
    deleted: new Set()
  };
}

function overlayGet<K, V>(overlay: SectionOverlay<K, V>, id: K): V | undefined {
  if (overlay.deleted.has(id)) {
    return undefined;
  }
  return overlay.pending.get(id) ?? overlay.base.get(id);
}

function overlayValues<K, V>(overlay: SectionOverlay<K, V>): V[] {
  const out: V[] = [];
  for (const [id, value] of overlay.base) {
    if (!overlay.deleted.has(id) && !overlay.pending.has(id)) {
      out.push(value);
    }
  }
  out.push(...overlay.pending.values());
  return out;
}

function overlayPut<K, V>(overlay: SectionOverlay<K, V>, id: K, value: V): void {
  overlay.pending.set(id, value);
  overlay.deleted.delete(id);
}

function overlayDelete<K, V>(overlay: SectionOverlay<K, V>, id: K): boolean {
  const existed = overlayGet(overlay, id) !== undefined;
  overlay.pending.delete(id);
  overlay.deleted.add(id);
  return existed;
}

function overlayCommit<K, V>(overlay: SectionOverlay<K, V>): Map<K, V> {
  if (overlay.pending.size === 0 && overlay.deleted.size === 0 && overlay.base instanceof Map) {
    return overlay.base;
  }
  const merged = new Map(overlay.base);
  for (const id of overlay.deleted) {
    merged.delete(id);
  }
  for (const [id, value] of overlay.pending) {
    merged.set(id, value);
  }
  return merged;
}

function stateToSnapshot(state: StoreState): StoreSnapshot {
  return {
    workItems: [...state.workItems.values()],
    agentSummaries: [...state.agentSummaries.values()],
    evidence: [...state.evidence.values()],
    verifications: [...state.verifications.values()],
    directiveAcknowledgements: [...state.directiveAcknowledgements.values()],
    knowledgeSources: [...state.knowledgeSources.values()],
    claims: [...state.claims.values()],
    decisions: [...state.decisions.values()],
    graphEdges: [...state.graphEdges.values()],
    reservations: [...state.reservations.values()],
    reviewerHeartbeats: [...state.reviewerHeartbeats.values()],
    runs: [...state.runs.values()],
    checkpoints: [...state.checkpoints.values()],
    eventCursors: [...state.eventCursors.values()],
    events: [...state.events.values()],
    operations: [...state.operations.values()],
    projections: [...state.projections.values()],
    contextPacks: [...state.contextPacks.values()]
  };
}

function matchesWorkFilter(item: WorkItem, filter: WorkItemFilter | undefined): boolean {
  if (!filter) {
    return true;
  }

  if (filter.status && item.status !== filter.status) {
    return false;
  }

  if (filter.labels && !filter.labels.every((label) => item.labels.includes(label))) {
    return false;
  }

  return true;
}
