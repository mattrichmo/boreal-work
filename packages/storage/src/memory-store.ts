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
  readonly events: Map<string, RuntimeEvent>;
  readonly operations: Map<OperationId, RuntimeOperation>;
  readonly projections: Map<ProjectionId, ProjectionRecord>;
  readonly contextPacks: Map<ProjectionId, ContextPack>;
}

export class InMemoryBorealStore implements BorealStore {
  #state: StoreState;

  constructor(seed?: PartialStoreSeed) {
    this.#state = createState(seed);
  }

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    const snapshot = new MemoryTransaction(this.#state);
    return operation(snapshot);
  }

  async write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    const working = cloneState(this.#state);
    const transaction = new MemoryTransaction(working);
    const result = await operation(transaction);
    this.#state = working;
    return result;
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
  readonly events?: readonly RuntimeEvent[];
  readonly operations?: readonly RuntimeOperation[];
  readonly projections?: readonly ProjectionRecord[];
  readonly contextPacks?: readonly ContextPack[];
}

export type PartialStoreSeed = StoreSnapshot;

class MemoryTransaction implements BorealWriter {
  constructor(private readonly state: StoreState) {}

  async getWorkItem(id: WorkId): Promise<WorkItem | undefined> {
    return this.state.workItems.get(id);
  }

  async listWorkItems(filter?: WorkItemFilter): Promise<readonly WorkItem[]> {
    return [...this.state.workItems.values()].filter((item) => matchesWorkFilter(item, filter));
  }

  async getAgentSummary(id: AgentSummaryId): Promise<AgentSummaryRecord | undefined> {
    return this.state.agentSummaries.get(id);
  }

  async listAgentSummaries(): Promise<readonly AgentSummaryRecord[]> {
    return [...this.state.agentSummaries.values()];
  }

  async listAgentSummariesForSubject(subjectId: string): Promise<readonly AgentSummaryRecord[]> {
    return [...this.state.agentSummaries.values()].filter((record) => record.subjectId === subjectId);
  }

  async getEvidence(id: EvidenceId): Promise<EvidenceRecord | undefined> {
    return this.state.evidence.get(id);
  }

  async listEvidence(): Promise<readonly EvidenceRecord[]> {
    return [...this.state.evidence.values()];
  }

  async listEvidenceForSubject(subjectId: string): Promise<readonly EvidenceRecord[]> {
    return [...this.state.evidence.values()].filter((record) => record.subjectId === subjectId);
  }

  async getVerification(id: VerificationId): Promise<VerificationRecord | undefined> {
    return this.state.verifications.get(id);
  }

  async listVerifications(): Promise<readonly VerificationRecord[]> {
    return [...this.state.verifications.values()];
  }

  async listVerificationsForSubject(subjectId: string): Promise<readonly VerificationRecord[]> {
    return [...this.state.verifications.values()].filter((record) => record.subjectId === subjectId);
  }

  async getDirectiveAcknowledgement(id: DirectiveAcknowledgementId): Promise<DirectiveAcknowledgementRecord | undefined> {
    return this.state.directiveAcknowledgements.get(id);
  }

  async listDirectiveAcknowledgements(): Promise<readonly DirectiveAcknowledgementRecord[]> {
    return [...this.state.directiveAcknowledgements.values()];
  }

  async listDirectiveAcknowledgementsForSubject(subjectId: string): Promise<readonly DirectiveAcknowledgementRecord[]> {
    return [...this.state.directiveAcknowledgements.values()].filter((record) => record.subjectId === subjectId);
  }

  async getKnowledgeSource(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined> {
    return this.state.knowledgeSources.get(id);
  }

  async listKnowledgeSources(): Promise<readonly KnowledgeSource[]> {
    return [...this.state.knowledgeSources.values()];
  }

  async getClaim(id: ClaimId): Promise<ClaimRecord | undefined> {
    return this.state.claims.get(id);
  }

  async getDecision(id: DecisionId): Promise<DecisionRecord | undefined> {
    return this.state.decisions.get(id);
  }

  async listClaims(): Promise<readonly ClaimRecord[]> {
    return [...this.state.claims.values()];
  }

  async listDecisions(): Promise<readonly DecisionRecord[]> {
    return [...this.state.decisions.values()];
  }

  async getGraphEdge(id: GraphEdgeId): Promise<GraphEdge | undefined> {
    return this.state.graphEdges.get(id);
  }

  async listGraphEdges(): Promise<readonly GraphEdge[]> {
    return [...this.state.graphEdges.values()];
  }

  async listGraphEdgesForSubject(subjectId: string): Promise<readonly GraphEdge[]> {
    return [...this.state.graphEdges.values()].filter((edge) => edge.fromId === subjectId || edge.toId === subjectId);
  }

  async getReservation(id: ReservationId): Promise<AgentReservation | undefined> {
    return this.state.reservations.get(id);
  }

  async listReservations(): Promise<readonly AgentReservation[]> {
    return [...this.state.reservations.values()];
  }

  async listReservationsForWork(workId: WorkId): Promise<readonly AgentReservation[]> {
    return [...this.state.reservations.values()].filter((record) => record.workId === workId);
  }

  async listActiveReservationsForAgent(agentId: string): Promise<readonly AgentReservation[]> {
    return [...this.state.reservations.values()].filter(
      (record) => record.agentId === agentId && record.status === "active"
    );
  }

  async getReviewerHeartbeat(id: ReviewerHeartbeatId): Promise<ReviewerHeartbeatRecord | undefined> {
    return this.state.reviewerHeartbeats.get(id);
  }

  async listReviewerHeartbeats(): Promise<readonly ReviewerHeartbeatRecord[]> {
    return [...this.state.reviewerHeartbeats.values()];
  }

  async listEvents(): Promise<readonly RuntimeEvent[]> {
    return [...this.state.events.values()];
  }

  async getOperation(id: OperationId): Promise<RuntimeOperation | undefined> {
    return this.state.operations.get(id);
  }

  async listOperations(): Promise<readonly RuntimeOperation[]> {
    return [...this.state.operations.values()];
  }

  async getProjection(id: ProjectionId): Promise<ProjectionRecord | undefined> {
    return this.state.projections.get(id);
  }

  async listProjections(): Promise<readonly ProjectionRecord[]> {
    return [...this.state.projections.values()];
  }

  async listContextPacks(): Promise<readonly ContextPack[]> {
    return [...this.state.contextPacks.values()];
  }

  async getContextPackForSubject(subjectId: string): Promise<ContextPack | undefined> {
    return [...this.state.contextPacks.values()].find((record) => record.subjectId === subjectId);
  }

  async putWorkItem(item: WorkItem): Promise<void> {
    this.state.workItems.set(item.meta.id, frozenClone(item));
  }

  async deleteWorkItem(id: WorkId): Promise<boolean> {
    return this.state.workItems.delete(id);
  }

  async putAgentSummary(record: AgentSummaryRecord): Promise<void> {
    this.state.agentSummaries.set(record.meta.id, frozenClone(record));
  }

  async deleteAgentSummary(id: AgentSummaryId): Promise<boolean> {
    return this.state.agentSummaries.delete(id);
  }

  async putEvidence(record: EvidenceRecord): Promise<void> {
    this.state.evidence.set(record.meta.id, frozenClone(record));
  }

  async deleteEvidence(id: EvidenceId): Promise<boolean> {
    return this.state.evidence.delete(id);
  }

  async putVerification(record: VerificationRecord): Promise<void> {
    this.state.verifications.set(record.meta.id, frozenClone(record));
  }

  async deleteVerification(id: VerificationId): Promise<boolean> {
    return this.state.verifications.delete(id);
  }

  async putDirectiveAcknowledgement(record: DirectiveAcknowledgementRecord): Promise<void> {
    this.state.directiveAcknowledgements.set(record.meta.id, frozenClone(record));
  }

  async deleteDirectiveAcknowledgement(id: DirectiveAcknowledgementId): Promise<boolean> {
    return this.state.directiveAcknowledgements.delete(id);
  }

  async putKnowledgeSource(record: KnowledgeSource): Promise<void> {
    this.state.knowledgeSources.set(record.meta.id, frozenClone(record));
  }

  async deleteKnowledgeSource(id: KnowledgeSourceId): Promise<boolean> {
    return this.state.knowledgeSources.delete(id);
  }

  async putClaim(record: ClaimRecord): Promise<void> {
    this.state.claims.set(record.meta.id, frozenClone(record));
  }

  async deleteClaim(id: ClaimId): Promise<boolean> {
    return this.state.claims.delete(id);
  }

  async putDecision(record: DecisionRecord): Promise<void> {
    this.state.decisions.set(record.meta.id, frozenClone(record));
  }

  async deleteDecision(id: DecisionId): Promise<boolean> {
    return this.state.decisions.delete(id);
  }

  async putGraphEdge(record: GraphEdge): Promise<void> {
    this.state.graphEdges.set(record.meta.id, frozenClone(record));
  }

  async deleteGraphEdge(id: GraphEdgeId): Promise<boolean> {
    return this.state.graphEdges.delete(id);
  }

  async putReservation(record: AgentReservation): Promise<void> {
    this.state.reservations.set(record.meta.id, frozenClone(record));
  }

  async deleteReservation(id: ReservationId): Promise<boolean> {
    return this.state.reservations.delete(id);
  }

  async putReviewerHeartbeat(record: ReviewerHeartbeatRecord): Promise<void> {
    this.state.reviewerHeartbeats.set(record.meta.id, frozenClone(record));
  }

  async deleteReviewerHeartbeat(id: ReviewerHeartbeatId): Promise<boolean> {
    return this.state.reviewerHeartbeats.delete(id);
  }

  async putEvent(record: RuntimeEvent): Promise<void> {
    this.state.events.set(record.meta.id, frozenClone(record));
  }

  async putOperation(record: RuntimeOperation): Promise<void> {
    this.state.operations.set(record.meta.id, frozenClone(record));
  }

  async deleteOperation(id: OperationId): Promise<boolean> {
    return this.state.operations.delete(id);
  }

  async putProjection(record: ProjectionRecord): Promise<void> {
    this.state.projections.set(record.meta.id, frozenClone(record));
  }

  async deleteProjection(id: ProjectionId): Promise<boolean> {
    return this.state.projections.delete(id);
  }

  async putContextPack(record: ContextPack): Promise<void> {
    this.state.contextPacks.set(record.id, frozenClone(record));
  }

  async deleteContextPack(id: ProjectionId): Promise<boolean> {
    return this.state.contextPacks.delete(id);
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
    events: new Map((seed?.events ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    operations: new Map((seed?.operations ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    projections: new Map((seed?.projections ?? []).map((record) => [record.meta.id, frozenClone(record)])),
    contextPacks: new Map((seed?.contextPacks ?? []).map((record) => [record.id, frozenClone(record)]))
  };
}

function cloneState(state: StoreState): StoreState {
  return createState(stateToSnapshot(state));
}

function frozenClone<T>(value: T): T {
  return deepFreeze(deepClone(value));
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
