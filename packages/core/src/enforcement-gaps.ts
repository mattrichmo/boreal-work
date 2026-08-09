import type { CloseoutGateId, WorkId } from "./ids.js";
import type { EvidenceKind, EvidenceTrustLevel } from "./records.js";

export const ENFORCEMENT_GAP_CODES = [
  "gate.verification.unsatisfied",
  "gate.checkpoint.unsatisfied",
  "gate.review.unsatisfied",
  "gate.audit.unsatisfied",
  "gate.force.invalid",
  "gate.declared-command.missing",
  "gate.declared-command.mismatch",
  "gate.expected-observable.missing",
  "gate.expected-observable.mismatch",
  "gate.evidence.trust-insufficient",
  "gate.evidence.revision-stale",
  "gate.evidence.git-stale",
  "gate.evidence.external-unverified",
  "gate.evidence.failed",
  "work.blocked.open-dependency",
  "work.container.open-descendant",
  "reservation.not-ready",
  "reservation.capacity-exceeded",
  "reservation.active-conflict",
  "close.no-passing-verification",
  "summary.missing",
  "summary.checkpoint-missing",
  "directive.acknowledgement-missing",
  "directive.workflow-next.available",
  "closeout.user-summary.required",
  "git.checkpoint.required",
  "git.branch-mismatch",
  "git.lane-worktree.required",
  "doctor.recovery.required",
  "memory.reconcile-source.required",
  "inbox.triage.aging",
  "handoff.session-summary.required",
  "container.descendant-closeout.required",
  "phase.close-rollup.required",
  "sprint.close-rollup.required",
  "sprint.launch-plan.required",
  "search.index-stale",
  "reconciliation.obligation.open"
] as const;

export type EnforcementGapCode = (typeof ENFORCEMENT_GAP_CODES)[number];

export type EnforcementGapSubjectType =
  | "work"
  | "sprint"
  | "phase"
  | "milestone"
  | "project"
  | "session"
  | "workspace"
  | "command";

export interface EnforcementGapData {
  readonly blockerIds?: readonly WorkId[];
  readonly externalBlockers?: readonly {
    readonly uri: string;
    readonly projectId: string;
    readonly workId: WorkId;
    readonly status?: string;
    readonly title?: string;
    readonly reason: "open" | "stale" | "unresolved";
    readonly message?: string;
  }[];
  readonly gateIds?: readonly CloseoutGateId[];
  readonly requiredEvidenceKinds?: readonly EvidenceKind[];
  readonly minEvidenceCount?: number;
  readonly declaredCommand?: string;
  readonly expectedObservable?: string;
  readonly requiredTrustLevels?: readonly EvidenceTrustLevel[];
  readonly requiredRevision?: string;
  readonly requiredGitHead?: string;
  readonly observed?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly reason?: string;
  readonly rawSourceIds?: readonly string[];
  readonly rawSourceCount?: number;
  readonly oldestRawSourceId?: string;
  readonly oldestAgeDays?: number;
  readonly thresholdDays?: number;
  readonly command?: string;
  readonly recommendedCommands?: readonly string[];
  readonly obligationIds?: readonly string[];
  readonly findingIds?: readonly string[];
  readonly revalidationCommands?: readonly string[];
}

export interface EnforcementGap {
  readonly code: EnforcementGapCode;
  readonly subjectType: EnforcementGapSubjectType;
  readonly subjectId: string;
  readonly targetId?: string;
  readonly data?: EnforcementGapData;
}

export function isEnforcementGapCode(value: unknown): value is EnforcementGapCode {
  return typeof value === "string" && (ENFORCEMENT_GAP_CODES as readonly string[]).includes(value);
}
