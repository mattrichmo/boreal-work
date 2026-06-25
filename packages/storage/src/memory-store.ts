import { deepClone } from "@boreal/core";
import type {
  AgentReservation,
  ClaimId,
  ClaimRecord,
  ContextPack,
  DecisionId,
  DecisionRecord,
  EvidenceId,
  EvidenceRecord,
  GraphEdge,
  GraphEdgeId,
  KnowledgeSource,
  KnowledgeSourceId,
  ProjectionId,
  ProjectionRecord,
  ReservationId,
  RuntimeEvent,
  VerificationId,
  VerificationRecord,
  WorkId,
  WorkItem
} from "@boreal/core";

import type { BorealReader, BorealStore, BorealWriter, WorkItemFilter } from "./ports.js";

interface StoreState {
  readonly workItems: Map<WorkId, WorkItem>;
  readonly evidence: Map<EvidenceId, EvidenceRecord>;
  readonly verifications: Map<VerificationId, VerificationRecord>;
  readonly knowledgeSources: Map<KnowledgeSourceId, KnowledgeSource>;
  readonly claims: Map<ClaimId, ClaimRecord>;
  readonly decisions: Map<DecisionId, DecisionRecord>;
  readonly graphEdges: Map<GraphEdgeId, GraphEdge>;
  readonly reservations: Map<ReservationId, AgentReservation>;
  readonly events: Map<string, RuntimeEvent>;
  readonly projections: Map<ProjectionId, ProjectionRecord>;
  readonly contextPacks: Map<ProjectionId, ContextPack>;
}

export class InMemoryBorealStore implements BorealStore {
  #state: StoreState;

  constructor(seed?: PartialStoreSeed) {
    this.#state = createState(seed);
  }

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    const snapshot = new MemoryTransaction(cloneState(this.#state));
    return deepClone(await operation(snapshot));
  }

  async write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    const working = cloneState(this.#state);
    const transaction = new MemoryTransaction(working);
    const result = await operation(transaction);
    this.#state = working;
    return deepClone(result);
  }

  async snapshot(): Promise<StoreSnapshot> {
    return stateToSnapshot(this.#state);
  }
}

export interface StoreSnapshot {
  readonly workItems?: readonly WorkItem[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly verifications?: readonly VerificationRecord[];
  readonly knowledgeSources?: readonly KnowledgeSource[];
  readonly claims?: readonly ClaimRecord[];
  readonly decisions?: readonly DecisionRecord[];
  readonly graphEdges?: readonly GraphEdge[];
  readonly reservations?: readonly AgentReservation[];
  readonly events?: readonly RuntimeEvent[];
  readonly projections?: readonly ProjectionRecord[];
  readonly contextPacks?: readonly ContextPack[];
}

export type PartialStoreSeed = StoreSnapshot;

class MemoryTransaction implements BorealWriter {
  constructor(private readonly state: StoreState) {}

  async getWorkItem(id: WorkId): Promise<WorkItem | undefined> {
    return cloneMaybe(this.state.workItems.get(id));
  }

  async listWorkItems(filter?: WorkItemFilter): Promise<readonly WorkItem[]> {
    const items = [...this.state.workItems.values()].filter((item) => matchesWorkFilter(item, filter));
    return deepClone(items);
  }

  async getEvidence(id: EvidenceId): Promise<EvidenceRecord | undefined> {
    return cloneMaybe(this.state.evidence.get(id));
  }

  async listEvidenceForSubject(subjectId: string): Promise<readonly EvidenceRecord[]> {
    return deepClone([...this.state.evidence.values()].filter((record) => record.subjectId === subjectId));
  }

  async getVerification(id: VerificationId): Promise<VerificationRecord | undefined> {
    return cloneMaybe(this.state.verifications.get(id));
  }

  async listVerificationsForSubject(subjectId: string): Promise<readonly VerificationRecord[]> {
    return deepClone([...this.state.verifications.values()].filter((record) => record.subjectId === subjectId));
  }

  async getKnowledgeSource(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined> {
    return cloneMaybe(this.state.knowledgeSources.get(id));
  }

  async listKnowledgeSources(): Promise<readonly KnowledgeSource[]> {
    return deepClone([...this.state.knowledgeSources.values()]);
  }

  async getClaim(id: ClaimId): Promise<ClaimRecord | undefined> {
    return cloneMaybe(this.state.claims.get(id));
  }

  async getDecision(id: DecisionId): Promise<DecisionRecord | undefined> {
    return cloneMaybe(this.state.decisions.get(id));
  }

  async listClaims(): Promise<readonly ClaimRecord[]> {
    return deepClone([...this.state.claims.values()]);
  }

  async listDecisions(): Promise<readonly DecisionRecord[]> {
    return deepClone([...this.state.decisions.values()]);
  }

  async getGraphEdge(id: GraphEdgeId): Promise<GraphEdge | undefined> {
    return cloneMaybe(this.state.graphEdges.get(id));
  }

  async listGraphEdges(): Promise<readonly GraphEdge[]> {
    return deepClone([...this.state.graphEdges.values()]);
  }

  async listGraphEdgesForSubject(subjectId: string): Promise<readonly GraphEdge[]> {
    return deepClone(
      [...this.state.graphEdges.values()].filter((edge) => edge.fromId === subjectId || edge.toId === subjectId)
    );
  }

  async getReservation(id: ReservationId): Promise<AgentReservation | undefined> {
    return cloneMaybe(this.state.reservations.get(id));
  }

  async listReservationsForWork(workId: WorkId): Promise<readonly AgentReservation[]> {
    return deepClone([...this.state.reservations.values()].filter((record) => record.workId === workId));
  }

  async listActiveReservationsForAgent(agentId: string): Promise<readonly AgentReservation[]> {
    return deepClone(
      [...this.state.reservations.values()].filter(
        (record) => record.agentId === agentId && record.status === "active"
      )
    );
  }

  async listEvents(): Promise<readonly RuntimeEvent[]> {
    return deepClone([...this.state.events.values()]);
  }

  async getProjection(id: ProjectionId): Promise<ProjectionRecord | undefined> {
    return cloneMaybe(this.state.projections.get(id));
  }

  async listContextPacks(): Promise<readonly ContextPack[]> {
    return deepClone([...this.state.contextPacks.values()]);
  }

  async getContextPackForSubject(subjectId: string): Promise<ContextPack | undefined> {
    return cloneMaybe([...this.state.contextPacks.values()].find((record) => record.subjectId === subjectId));
  }

  async putWorkItem(item: WorkItem): Promise<void> {
    this.state.workItems.set(item.meta.id, deepClone(item));
  }

  async putEvidence(record: EvidenceRecord): Promise<void> {
    this.state.evidence.set(record.meta.id, deepClone(record));
  }

  async putVerification(record: VerificationRecord): Promise<void> {
    this.state.verifications.set(record.meta.id, deepClone(record));
  }

  async putKnowledgeSource(record: KnowledgeSource): Promise<void> {
    this.state.knowledgeSources.set(record.meta.id, deepClone(record));
  }

  async putClaim(record: ClaimRecord): Promise<void> {
    this.state.claims.set(record.meta.id, deepClone(record));
  }

  async putDecision(record: DecisionRecord): Promise<void> {
    this.state.decisions.set(record.meta.id, deepClone(record));
  }

  async putGraphEdge(record: GraphEdge): Promise<void> {
    this.state.graphEdges.set(record.meta.id, deepClone(record));
  }

  async putReservation(record: AgentReservation): Promise<void> {
    this.state.reservations.set(record.meta.id, deepClone(record));
  }

  async putEvent(record: RuntimeEvent): Promise<void> {
    this.state.events.set(record.meta.id, deepClone(record));
  }

  async putProjection(record: ProjectionRecord): Promise<void> {
    this.state.projections.set(record.meta.id, deepClone(record));
  }

  async putContextPack(record: ContextPack): Promise<void> {
    this.state.contextPacks.set(record.id, deepClone(record));
  }
}

function createState(seed?: PartialStoreSeed): StoreState {
  return {
    workItems: new Map((seed?.workItems ?? []).map((item) => [item.meta.id, deepClone(item)])),
    evidence: new Map((seed?.evidence ?? []).map((record) => [record.meta.id, deepClone(record)])),
    verifications: new Map((seed?.verifications ?? []).map((record) => [record.meta.id, deepClone(record)])),
    knowledgeSources: new Map((seed?.knowledgeSources ?? []).map((record) => [record.meta.id, deepClone(record)])),
    claims: new Map((seed?.claims ?? []).map((record) => [record.meta.id, deepClone(record)])),
    decisions: new Map((seed?.decisions ?? []).map((record) => [record.meta.id, deepClone(record)])),
    graphEdges: new Map((seed?.graphEdges ?? []).map((record) => [record.meta.id, deepClone(record)])),
    reservations: new Map((seed?.reservations ?? []).map((record) => [record.meta.id, deepClone(record)])),
    events: new Map((seed?.events ?? []).map((record) => [record.meta.id, deepClone(record)])),
    projections: new Map((seed?.projections ?? []).map((record) => [record.meta.id, deepClone(record)])),
    contextPacks: new Map((seed?.contextPacks ?? []).map((record) => [record.id, deepClone(record)]))
  };
}

function cloneState(state: StoreState): StoreState {
  return createState(stateToSnapshot(state));
}

function stateToSnapshot(state: StoreState): StoreSnapshot {
  return {
    workItems: [...state.workItems.values()],
    evidence: [...state.evidence.values()],
    verifications: [...state.verifications.values()],
    knowledgeSources: [...state.knowledgeSources.values()],
    claims: [...state.claims.values()],
    decisions: [...state.decisions.values()],
    graphEdges: [...state.graphEdges.values()],
    reservations: [...state.reservations.values()],
    events: [...state.events.values()],
    projections: [...state.projections.values()],
    contextPacks: [...state.contextPacks.values()]
  };
}

function cloneMaybe<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : deepClone(value);
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
