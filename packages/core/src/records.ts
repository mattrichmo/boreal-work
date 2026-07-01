import type {
  AgentId,
  AgentSummaryId,
  ClaimId,
  CloseoutGateId,
  ContentHash,
  DecisionId,
  EventId,
  EvidenceId,
  GraphEdgeId,
  KnowledgeSourceId,
  OperationId,
  ProjectionId,
  ReservationId,
  ReviewerHeartbeatId,
  VerificationId,
  WorkId
} from "./ids.js";
import type { IsoTimestamp } from "./time.js";

export const BOREAL_SCHEMA_VERSION = "boreal.runtime.v1";

export type ActorKind = "human" | "agent" | "system";

export interface ActorRef {
  readonly id: AgentId | string;
  readonly kind: ActorKind;
  readonly displayName?: string;
}

export interface SourceRef {
  readonly uri: string;
  readonly label?: string;
  readonly contentHash?: ContentHash;
}

export interface RecordMeta<TId extends string> {
  readonly id: TId;
  readonly schemaVersion: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly createdBy: ActorRef;
  readonly updatedBy: ActorRef;
  readonly contentHash?: ContentHash;
  readonly sourceRefs: readonly SourceRef[];
  readonly tags: readonly string[];
}

export type WorkKind = "issue" | "task" | "sprint" | "milestone";
export type WorkPriority = "low" | "normal" | "high" | "critical";
export type WorkStatus =
  | "draft"
  | "ready"
  | "reserved"
  | "in_progress"
  | "blocked"
  | "needs_verification"
  | "verified"
  | "closed"
  | "cancelled";

export type CloseoutGateKind = "verification" | "checkpoint" | "review" | "audit";
export type CloseoutGateScope = "self" | "direct_children" | "descendants";
export type CloseoutGateStatus = "open" | "satisfied" | "forced";
export type CloseoutGateSubjectType = "work" | "sprint" | "phase" | "milestone" | "project";
export type CloseoutGateForceReasonCode =
  | "review_unavailable"
  | "audit_unavailable"
  | "external_review_record"
  | "legacy_backfill"
  | "user_accepted_risk"
  | "emergency_closeout";

export interface RequiredCloseoutGateSatisfaction {
  readonly evidenceIds?: readonly EvidenceId[];
  readonly verificationIds?: readonly VerificationId[];
  readonly agentSummaryIds?: readonly AgentSummaryId[];
  readonly commitShas?: readonly string[];
  readonly dirtyPathNotes?: readonly string[];
}

export interface RequiredCloseoutGateForce {
  readonly reason: CloseoutGateForceReasonCode;
  readonly comment: string;
  readonly actor: ActorRef;
  readonly evidenceIds?: readonly EvidenceId[];
  readonly forcedAt: IsoTimestamp;
}

export interface RequiredCloseoutGate {
  readonly id: CloseoutGateId;
  readonly subjectType: CloseoutGateSubjectType;
  readonly subjectId: string;
  readonly kind: CloseoutGateKind;
  readonly scope: CloseoutGateScope;
  readonly status: CloseoutGateStatus;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly requiredOutcome: "passed";
  readonly minEvidenceCount: number;
  readonly createdAt: IsoTimestamp;
  readonly createdBy: ActorRef;
  readonly satisfiedBy?: RequiredCloseoutGateSatisfaction;
  readonly force?: RequiredCloseoutGateForce;
}

export interface WorkItem {
  readonly meta: RecordMeta<WorkId>;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description: string;
  readonly status: WorkStatus;
  readonly priority: WorkPriority;
  readonly acceptanceCriteria: readonly string[];
  readonly labels: readonly string[];
  readonly parentId?: WorkId;
  readonly dependencyIds: readonly WorkId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly verificationIds: readonly VerificationId[];
  readonly requiredCloseoutGates?: readonly RequiredCloseoutGate[];
  readonly reservationId?: ReservationId;
  readonly closedAt?: IsoTimestamp;
  readonly closedReason?: string;
}

export interface ReviewerHeartbeatRecord {
  readonly meta: RecordMeta<ReviewerHeartbeatId>;
  readonly name: string;
  readonly reviewerId: string;
  readonly containerId?: WorkId;
  readonly lastClosedAt?: IsoTimestamp;
  readonly lastEventId?: EventId;
  readonly lastWorkId?: WorkId;
  readonly advancedAt: IsoTimestamp;
}

export type AgentSummarySubjectType = "work" | "sprint" | "milestone" | "phase" | "project" | "session";
export type AgentSummaryKind = "task" | "sprint" | "milestone" | "phase" | "project" | "session" | "legacy_backfill";
export type AgentSummaryStatus = "draft" | "final" | "forced";
export type AgentSummaryOutcome = "completed" | "partial" | "deferred" | "duplicate" | "cancelled" | "blocked" | "no_change";
export type AgentSummaryForceReasonCode =
  | "duplicate"
  | "cancelled_no_work"
  | "external_close"
  | "legacy_backfill"
  | "summary_unavailable"
  | "operator_override";

export interface AgentSummaryCompletedWork {
  readonly workId?: WorkId;
  readonly title: string;
  readonly outcome: AgentSummaryOutcome;
  readonly notes: string;
}

export interface AgentSummaryRecord {
  readonly meta: RecordMeta<AgentSummaryId>;
  readonly subjectId: string;
  readonly subjectType: AgentSummarySubjectType;
  readonly summaryKind: AgentSummaryKind;
  readonly status: AgentSummaryStatus;
  readonly outcome: AgentSummaryOutcome;
  readonly title: string;
  readonly body: string;
  readonly completedWork: readonly AgentSummaryCompletedWork[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly verificationIds: readonly VerificationId[];
  readonly commitShas: readonly string[];
  readonly dirtyPathNotes: readonly string[];
  readonly childSummaryIds: readonly AgentSummaryId[];
  readonly parentSummaryId?: AgentSummaryId;
  readonly artifactUri?: string;
  readonly duplicateOf?: string;
  readonly forceReasonCode?: AgentSummaryForceReasonCode;
  readonly forceComment?: string;
  readonly generatedAt: IsoTimestamp;
}

export type EdgeKind =
  | "blocks"
  | "depends_on"
  | "relates_to"
  | "supports"
  | "contradicts"
  | "verifies"
  | "references";

export interface GraphEdge {
  readonly meta: RecordMeta<GraphEdgeId>;
  readonly kind: EdgeKind;
  readonly fromId: string;
  readonly fromType: string;
  readonly toId: string;
  readonly toType: string;
  readonly directed: boolean;
}

export type EvidenceKind = "command" | "test" | "diff" | "review" | "artifact" | "note";
export type EvidenceOutcome = "passed" | "failed" | "observed" | "unknown";

export interface EvidenceRecord {
  readonly meta: RecordMeta<EvidenceId>;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly kind: EvidenceKind;
  readonly summary: string;
  readonly outcome: EvidenceOutcome;
  readonly command?: string;
  readonly uri?: string;
  readonly observedAt: IsoTimestamp;
}

export type VerificationVerdict = "passed" | "failed";

export interface VerificationRecord {
  readonly meta: RecordMeta<VerificationId>;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly verdict: VerificationVerdict;
  readonly evidenceIds: readonly EvidenceId[];
  readonly verifiedAt: IsoTimestamp;
  readonly notes?: string;
}

export type KnowledgeSourceKind = "raw" | "document" | "chat" | "code" | "artifact";

export interface KnowledgeSource {
  readonly meta: RecordMeta<KnowledgeSourceId>;
  readonly kind: KnowledgeSourceKind;
  readonly title: string;
  readonly uri: string;
  readonly summary: string;
}

export type ClaimStatus = "proposed" | "accepted" | "rejected" | "stale";

export interface ClaimRecord {
  readonly meta: RecordMeta<ClaimId>;
  readonly statement: string;
  readonly status: ClaimStatus;
  readonly sourceIds: readonly KnowledgeSourceId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly wikiPageIds?: readonly string[];
}

export type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";

export interface DecisionRecord {
  readonly meta: RecordMeta<DecisionId>;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly context: string;
  readonly decision: string;
  readonly consequences: readonly string[];
  readonly sourceIds: readonly KnowledgeSourceId[];
  readonly wikiPageIds?: readonly string[];
}

export type ReservationStatus = "active" | "released" | "expired";

export interface AgentReservation {
  readonly meta: RecordMeta<ReservationId>;
  readonly workId: WorkId;
  readonly agentId: AgentId | string;
  readonly status: ReservationStatus;
  readonly reservedAt: IsoTimestamp;
  readonly expiresAt?: IsoTimestamp;
  readonly purpose?: string;
}

export interface RuntimeEvent {
  readonly meta: RecordMeta<EventId>;
  readonly type: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly operationId?: OperationId;
  readonly operationLink?: "legacy";
  readonly payload: Record<string, unknown>;
}

export type RuntimeOperationStatus = "succeeded" | "failed";

export interface RuntimeOperation {
  readonly meta: RecordMeta<OperationId>;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly argv: readonly string[];
  readonly actorId: string;
  readonly startedAt: IsoTimestamp;
  readonly finishedAt: IsoTimestamp;
  readonly exitCode: number;
  readonly status: RuntimeOperationStatus;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly eventIds: readonly EventId[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface ProjectionRecord {
  readonly meta: RecordMeta<ProjectionId>;
  readonly kind: string;
  readonly subjectId: string;
  readonly value: Record<string, unknown>;
}

export interface ContextPack {
  readonly id: ProjectionId;
  readonly subjectId: string;
  readonly generatedAt: IsoTimestamp;
  readonly title: string;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly evidence: readonly string[];
}
