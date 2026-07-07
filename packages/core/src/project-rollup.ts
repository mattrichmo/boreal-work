import type {
  ContentHash,
  EventId,
  OperationId,
  ReservationId,
  WorkId
} from "./ids.js";
import type { IsoTimestamp } from "./time.js";
import type { WorkKind, WorkPriority, WorkStatus } from "./records.js";

export const PROJECT_ROLLUP_SCHEMA_VERSION = "boreal.project-rollup.v2";
export const PROJECT_ROLLUP_SCHEMA_ID = "https://boreal.work/schemas/projections/project-rollup.schema.json";

export const WORK_STATUSES = [
  "draft",
  "ready",
  "reserved",
  "in_progress",
  "blocked",
  "needs_verification",
  "verified",
  "closed",
  "cancelled"
] as const satisfies readonly WorkStatus[];

export const WORK_KINDS = ["issue", "task", "sprint", "milestone"] as const satisfies readonly WorkKind[];

export interface ProjectRollupCountSet {
  readonly draft: number;
  readonly ready: number;
  readonly reserved: number;
  readonly in_progress: number;
  readonly blocked: number;
  readonly needs_verification: number;
  readonly verified: number;
  readonly closed: number;
  readonly cancelled: number;
}

export interface ProjectRollupKindCounts {
  readonly issue: number;
  readonly task: number;
  readonly sprint: number;
  readonly milestone: number;
}

export interface ProjectRollupWorkCounts {
  readonly total: number;
  readonly byStatus: ProjectRollupCountSet;
  readonly byKind: ProjectRollupKindCounts;
}

export interface ProjectRollupLimboEntry {
  readonly workId: WorkId;
  readonly title: string;
  readonly status: Extract<WorkStatus, "needs_verification" | "verified">;
  readonly updatedAt: IsoTimestamp;
  readonly ageMs: number;
  readonly ageDays: number;
}

export interface ProjectRollupLimboLists {
  readonly needsVerification: readonly ProjectRollupLimboEntry[];
  readonly verified: readonly ProjectRollupLimboEntry[];
}

export interface ProjectRollupReservationCounts {
  readonly total: number;
  readonly active: number;
  readonly expired: number;
  readonly released: number;
}

export interface ProjectRollupBlockingGapSample {
  readonly workId: WorkId;
  readonly title: string;
  readonly blockerIds: readonly WorkId[];
}

export interface ProjectRollupBlockingGaps {
  readonly openCount: number;
  readonly blockedWorkCount: number;
  readonly samples: readonly ProjectRollupBlockingGapSample[];
}

export interface ProjectRollupHealthFlags {
  readonly doctorOk: boolean | null;
  readonly syncOk: boolean | null;
}

export interface ProjectRollupLastEvent {
  readonly id: EventId;
  readonly type: string;
  readonly subjectId: string;
  readonly at: IsoTimestamp;
}

export interface ProjectRollupLastOperation {
  readonly id: OperationId;
  readonly commandPath: string;
  readonly status: string;
  readonly finishedAt: IsoTimestamp;
}

export interface ProjectRollupNextWork {
  readonly workId: WorkId;
  readonly title: string;
  readonly kind: WorkKind;
  readonly priority: WorkPriority;
  readonly status: WorkStatus;
  readonly updatedAt: IsoTimestamp;
}

export interface ProjectRollupWorkIndexEntry {
  readonly workId: WorkId;
  readonly title: string;
  readonly kind: WorkKind;
  readonly priority: WorkPriority;
  readonly status: WorkStatus;
  readonly updatedAt: IsoTimestamp;
}

export interface ProjectRollupWorkIndex {
  readonly limit: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly work: readonly ProjectRollupWorkIndexEntry[];
}

export interface ProjectRollupNextDirectives {
  readonly limit: number;
  readonly work: readonly ProjectRollupNextWork[];
}

export interface ProjectRollupAgingWorkEntry {
  readonly workId: WorkId;
  readonly title: string;
  readonly status: Extract<WorkStatus, "ready" | "needs_verification" | "verified">;
  readonly since: IsoTimestamp;
  readonly ageMs: number;
  readonly ageDays: number;
}

export interface ProjectRollupAgingReservationEntry {
  readonly reservationId: ReservationId;
  readonly workId: WorkId;
  readonly agentId: string;
  readonly status: "active" | "expired";
  readonly reservedAt: IsoTimestamp;
  readonly expiresAt?: IsoTimestamp;
  readonly since: IsoTimestamp;
  readonly ageMs: number;
  readonly ageDays: number;
}

export interface ProjectRollupAgingBucket<TEntry> {
  readonly count: number;
  readonly oldestAgeMs: number;
  readonly oldestAgeDays: number;
  readonly items: readonly TEntry[];
}

export interface ProjectRollupAgingSummary {
  readonly ready: ProjectRollupAgingBucket<ProjectRollupAgingWorkEntry>;
  readonly limbo: ProjectRollupAgingBucket<ProjectRollupAgingWorkEntry>;
  readonly expiredReservations: ProjectRollupAgingBucket<ProjectRollupAgingReservationEntry>;
  readonly maxima: {
    readonly readyAgeMs: number;
    readonly limboAgeMs: number;
    readonly expiredReservationAgeMs: number;
  };
  readonly approximation: {
    readonly readySinceSource: "work.meta.updatedAt";
    readonly limboSinceSource: "work.meta.updatedAt";
    readonly expiredReservationSinceSource: "reservation.expiresAt_or_meta.updatedAt";
    readonly eventHistoryScanned: false;
  };
}

export interface ProjectRollupDocument {
  readonly schemaVersion: typeof PROJECT_ROLLUP_SCHEMA_VERSION;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly generatedAt: IsoTimestamp;
  readonly stateContentHash: ContentHash;
  readonly counts: {
    readonly work: ProjectRollupWorkCounts;
    readonly reservations: ProjectRollupReservationCounts;
  };
  readonly limbo: ProjectRollupLimboLists;
  readonly reservations: {
    readonly activeIds: readonly ReservationId[];
    readonly expiredIds: readonly ReservationId[];
  };
  readonly enforcement: {
    readonly blockingGaps: ProjectRollupBlockingGaps;
  };
  readonly health: ProjectRollupHealthFlags;
  readonly lastEvent: ProjectRollupLastEvent | null;
  readonly lastOperation: ProjectRollupLastOperation | null;
  readonly next: ProjectRollupNextDirectives;
  readonly workIndex?: ProjectRollupWorkIndex;
  readonly aging: ProjectRollupAgingSummary;
}
