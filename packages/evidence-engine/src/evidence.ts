import {
  BorealError,
  createRecordMeta,
  deterministicId,
  normalizeMachineString,
  type ActorRef,
  type EvidenceId,
  type EvidenceKind,
  type EvidenceOutcome,
  type EvidenceRecord,
  type IsoTimestamp,
  type RuntimePolicy,
  type VerificationRecord,
  type VerificationVerdict,
  type VerificationId,
  withContentHash
} from "@boreal/core";

export interface RecordEvidenceInput {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly kind: EvidenceKind;
  readonly summary: string;
  readonly outcome?: EvidenceOutcome;
  readonly command?: string;
  readonly uri?: string;
  readonly observedAt?: IsoTimestamp;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface VerifySubjectInput {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly verdict: VerificationVerdict;
  readonly evidenceIds: readonly EvidenceId[];
  readonly availableEvidence: readonly EvidenceRecord[];
  readonly notes?: string;
  readonly policy: Pick<RuntimePolicy, "requireEvidenceForVerification">;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function recordEvidence(input: RecordEvidenceInput): EvidenceRecord {
  const summary = normalizeMachineString(input.summary, "summary");
  const observedAt = input.observedAt ?? input.now;
  const command = redactSensitiveCommand(input.command);
  const uri = input.uri === undefined ? undefined : normalizeMachineString(input.uri, "uri");
  const id = deterministicId<EvidenceId>("evidence", {
    subjectId: input.subjectId,
    kind: input.kind,
    summary,
    command: command ?? null,
    uri: uri ?? null,
    observedAt
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    kind: input.kind,
    summary,
    outcome: input.outcome ?? "observed",
    command,
    uri,
    observedAt
  });
}

export function verifySubject(input: VerifySubjectInput): VerificationRecord {
  const evidenceIds = unique([...input.evidenceIds].sort());
  const notes = input.notes === undefined ? undefined : normalizeMachineString(input.notes, "verification notes");
  if (input.policy.requireEvidenceForVerification && evidenceIds.length === 0) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Verification requires evidence");
  }

  const availableById = new Map(input.availableEvidence.map((record) => [record.meta.id, record]));
  const missingEvidence = evidenceIds.filter((id) => !availableById.has(id));
  if (missingEvidence.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Verification references missing evidence", { missingEvidence });
  }

  const selectedEvidence = evidenceIds
    .map((id) => availableById.get(id))
    .filter((record): record is EvidenceRecord => record !== undefined);
  const mismatchedEvidence = selectedEvidence
    .filter((record) => record.subjectId !== input.subjectId || record.subjectType !== input.subjectType)
    .map((record) => ({
      evidenceId: record.meta.id,
      subjectId: record.subjectId,
      subjectType: record.subjectType
    }));
  if (mismatchedEvidence.length > 0) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Verification evidence belongs to a different subject", {
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      mismatchedEvidence
    });
  }
  if (input.verdict === "passed" && !selectedEvidence.some((record) => record.outcome === "passed")) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Passed verification requires at least one passed evidence", {
      evidenceIds
    });
  }

  const id = deterministicId<VerificationId>("verification", {
    subjectId: input.subjectId,
    verdict: input.verdict,
    evidenceIds,
    notes: notes ?? null
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    verdict: input.verdict,
    evidenceIds,
    verifiedAt: input.now,
    notes
  });
}

function redactSensitiveCommand(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  if (!trimmed) {
    return undefined;
  }
  const sensitiveName = String.raw`(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pwd|authorization|auth|cookie|client[-_]?secret|private[-_]?key|credential)`;
  return trimmed
    .replace(new RegExp(String.raw`(--${sensitiveName})(=)([^\s]+)`, "giu"), "$1$2<redacted>")
    .replace(new RegExp(String.raw`(--${sensitiveName}\s+)(?:"[^"]*"|'[^']*'|[^\s]+)`, "giu"), "$1<redacted>")
    .replace(new RegExp(String.raw`(^|\s)([A-Za-z_][A-Za-z0-9_]*(?:${sensitiveName})[A-Za-z0-9_]*=)([^\s]+)`, "giu"), "$1$2<redacted>")
    .replace(new RegExp(String.raw`([?&]${sensitiveName}=)([^\s&]+)`, "giu"), "$1<redacted>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, "$1<redacted>");
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
