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
  OperationId,
  ProjectionId,
  ProjectionRecord,
  ReservationId,
  RuntimeEvent,
  RuntimeOperation,
  VerificationId,
  VerificationRecord,
  WorkId,
  WorkItem
} from "@boreal/core";

export interface WorkItemFilter {
  readonly status?: WorkItem["status"];
  readonly labels?: readonly string[];
}

export interface BorealReader {
  getWorkItem(id: WorkId): Promise<WorkItem | undefined>;
  listWorkItems(filter?: WorkItemFilter): Promise<readonly WorkItem[]>;
  getEvidence(id: EvidenceId): Promise<EvidenceRecord | undefined>;
  listEvidence(): Promise<readonly EvidenceRecord[]>;
  listEvidenceForSubject(subjectId: string): Promise<readonly EvidenceRecord[]>;
  getVerification(id: VerificationId): Promise<VerificationRecord | undefined>;
  listVerifications(): Promise<readonly VerificationRecord[]>;
  listVerificationsForSubject(subjectId: string): Promise<readonly VerificationRecord[]>;
  getKnowledgeSource(id: KnowledgeSourceId): Promise<KnowledgeSource | undefined>;
  listKnowledgeSources(): Promise<readonly KnowledgeSource[]>;
  getClaim(id: ClaimId): Promise<ClaimRecord | undefined>;
  getDecision(id: DecisionId): Promise<DecisionRecord | undefined>;
  listClaims(): Promise<readonly ClaimRecord[]>;
  listDecisions(): Promise<readonly DecisionRecord[]>;
  getGraphEdge(id: GraphEdgeId): Promise<GraphEdge | undefined>;
  listGraphEdges(): Promise<readonly GraphEdge[]>;
  listGraphEdgesForSubject(subjectId: string): Promise<readonly GraphEdge[]>;
  getReservation(id: ReservationId): Promise<AgentReservation | undefined>;
  listReservations(): Promise<readonly AgentReservation[]>;
  listReservationsForWork(workId: WorkId): Promise<readonly AgentReservation[]>;
  listActiveReservationsForAgent(agentId: string): Promise<readonly AgentReservation[]>;
  listEvents(): Promise<readonly RuntimeEvent[]>;
  getOperation(id: OperationId): Promise<RuntimeOperation | undefined>;
  listOperations(): Promise<readonly RuntimeOperation[]>;
  getProjection(id: ProjectionId): Promise<ProjectionRecord | undefined>;
  listProjections(): Promise<readonly ProjectionRecord[]>;
  listContextPacks(): Promise<readonly ContextPack[]>;
  getContextPackForSubject(subjectId: string): Promise<ContextPack | undefined>;
}

export interface BorealWriter extends BorealReader {
  putWorkItem(item: WorkItem): Promise<void>;
  deleteWorkItem(id: WorkId): Promise<boolean>;
  putEvidence(record: EvidenceRecord): Promise<void>;
  deleteEvidence(id: EvidenceId): Promise<boolean>;
  putVerification(record: VerificationRecord): Promise<void>;
  deleteVerification(id: VerificationId): Promise<boolean>;
  putKnowledgeSource(record: KnowledgeSource): Promise<void>;
  deleteKnowledgeSource(id: KnowledgeSourceId): Promise<boolean>;
  putClaim(record: ClaimRecord): Promise<void>;
  deleteClaim(id: ClaimId): Promise<boolean>;
  putDecision(record: DecisionRecord): Promise<void>;
  deleteDecision(id: DecisionId): Promise<boolean>;
  putGraphEdge(record: GraphEdge): Promise<void>;
  deleteGraphEdge(id: GraphEdgeId): Promise<boolean>;
  putReservation(record: AgentReservation): Promise<void>;
  deleteReservation(id: ReservationId): Promise<boolean>;
  putEvent(record: RuntimeEvent): Promise<void>;
  putOperation(record: RuntimeOperation): Promise<void>;
  deleteOperation(id: OperationId): Promise<boolean>;
  putProjection(record: ProjectionRecord): Promise<void>;
  deleteProjection(id: ProjectionId): Promise<boolean>;
  putContextPack(record: ContextPack): Promise<void>;
  deleteContextPack(id: ProjectionId): Promise<boolean>;
}

export interface BorealStore {
  read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T>;
  write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T>;
}
