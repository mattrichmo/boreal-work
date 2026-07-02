import type { CloseoutGateId, WorkId } from "./ids.js";
import type { EvidenceKind } from "./records.js";

export const ENFORCEMENT_GAP_CODES = [
  "gate.verification.unsatisfied",
  "gate.checkpoint.unsatisfied",
  "gate.review.unsatisfied",
  "gate.audit.unsatisfied",
  "gate.force.invalid",
  "gate.declared-command.missing",
  "gate.expected-observable.missing",
  "work.blocked.open-dependency",
  "work.container.open-descendant",
  "reservation.not-ready",
  "reservation.capacity-exceeded",
  "reservation.active-conflict",
  "close.no-passing-verification",
  "summary.missing",
  "summary.checkpoint-missing",
  "directive.acknowledgement-missing",
  "search.index-stale"
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
  readonly gateIds?: readonly CloseoutGateId[];
  readonly requiredEvidenceKinds?: readonly EvidenceKind[];
  readonly minEvidenceCount?: number;
  readonly declaredCommand?: string;
  readonly expectedObservable?: string;
  readonly observed?: readonly string[];
  readonly reason?: string;
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
