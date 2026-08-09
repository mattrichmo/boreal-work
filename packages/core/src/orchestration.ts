import type {
  AgentId,
  EvidenceId,
  OrchestrationId,
  OrchestrationNudgeId,
  ReservationId,
  WorkId
} from "./ids.js";
import type { IsoTimestamp } from "./time.js";
import type { RecordMeta } from "./records.js";

export const ORCHESTRATION_SCHEMA_VERSION = "boreal.orchestration.v1";

export type OrchestrationStatus =
  | "active"
  | "paused"
  | "needs_attention"
  | "succeeded"
  | "failed"
  | "cancelled";

export type OrchestrationAssignmentState =
  | "assigned"
  | "working"
  | "waiting"
  | "blocked"
  | "drifting"
  | "stale"
  | "completed"
  | "released";

export type OrchestrationProgressState = "working" | "waiting" | "blocked" | "completed";

export type OrchestrationNudgeKind = "heartbeat" | "checkpoint" | "scope" | "blocked" | "replan";
export type OrchestrationNudgeSeverity = "info" | "warning" | "blocking";

export interface OrchestrationPolicy {
  readonly maxConcurrent: number;
  readonly nudgeAfterMs: number;
  readonly staleAfterMs: number;
  readonly maxNudgesPerWork: number;
}

export interface OrchestrationProgress {
  readonly state: OrchestrationProgressState;
  readonly phase?: string;
  readonly nextCheckpoint?: string;
  readonly blockerCode?: string;
  readonly note?: string;
  readonly evidenceIds?: readonly EvidenceId[];
  readonly artifactUris?: readonly string[];
  readonly touchedPaths?: readonly string[];
  readonly observedAt: IsoTimestamp;
}

export interface OrchestrationAssignment {
  readonly workId: WorkId;
  readonly agentId: AgentId | string;
  readonly reservationId?: ReservationId;
  readonly wave: number;
  readonly state: OrchestrationAssignmentState;
  readonly assignedAt: IsoTimestamp;
  readonly lastProgressAt?: IsoTimestamp;
  readonly lastProgress?: OrchestrationProgress;
  readonly nudgeCount: number;
  readonly lastNudgeAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
}

export interface OrchestrationNudge {
  readonly meta: RecordMeta<OrchestrationNudgeId>;
  readonly orchestrationId: OrchestrationId;
  readonly workId: WorkId;
  readonly agentId: AgentId | string;
  readonly kind: OrchestrationNudgeKind;
  readonly severity: OrchestrationNudgeSeverity;
  readonly reasonCode: string;
  readonly instruction: string;
  readonly commandPath: string;
  readonly issuedAt: IsoTimestamp;
  readonly acknowledgedAt?: IsoTimestamp;
}

export interface OrchestrationRun {
  readonly meta: RecordMeta<OrchestrationId>;
  readonly rootWorkId: WorkId;
  readonly status: OrchestrationStatus;
  readonly purpose?: string;
  readonly policy: OrchestrationPolicy;
  readonly agentPool: readonly (AgentId | string)[];
  readonly contextLedgerSeq?: number;
  readonly wave: number;
  readonly assignments: readonly OrchestrationAssignment[];
  readonly nudges: readonly OrchestrationNudge[];
  readonly lastTickAt?: IsoTimestamp;
}
