import {
  BorealError,
  EVIDENCE_ATTESTATION_SCHEMA_VERSION,
  createRecordMeta,
  deterministicId,
  normalizeMachineString,
  type ActorRef,
  type CloseoutGateId,
  type ContentHash,
  type EvidenceId,
  type EvidenceAttestation,
  type EvidenceKind,
  type EvidenceOutcome,
  type EvidenceRecord,
  type EvidenceTrustLevel,
  type EnforcementGap,
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
  readonly attestation?: EvidenceAttestation;
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
  readonly trustRequirements?: readonly EvidenceTrustRequirement[];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface EvidenceTrustRequirement {
  readonly gateId?: CloseoutGateId;
  readonly requiredTrustLevels?: readonly EvidenceTrustLevel[];
  readonly currentRevision?: ContentHash;
  readonly currentGitHead?: string;
  readonly rerunCommand?: string;
}

export function recordEvidence(input: RecordEvidenceInput): EvidenceRecord {
  const summary = normalizeMachineString(input.summary, "summary");
  const observedAt = input.observedAt ?? input.now;
  const command = redactSensitiveCommand(input.command);
  const uri = input.uri === undefined ? undefined : normalizeMachineString(input.uri, "uri");
  const attestation = input.attestation ?? {
    schemaVersion: EVIDENCE_ATTESTATION_SCHEMA_VERSION,
    trustLevel: "self_reported",
    producer: input.actor,
    recordedAt: input.now
  };
  const id = deterministicId<EvidenceId>("evidence", {
    subjectId: input.subjectId,
    kind: input.kind,
    summary,
    command: command ?? null,
    uri: uri ?? null,
    observedAt,
    attestation
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
    observedAt,
    attestation
  });
}

export function evidenceTrustLevel(record: EvidenceRecord): EvidenceTrustLevel {
  return record.attestation?.trustLevel ?? "legacy_unattested";
}

export function verifySubject(input: VerifySubjectInput): VerificationRecord {
  const evidenceIds = unique([...input.evidenceIds].sort());
  const notes = input.notes === undefined ? undefined : normalizeMachineString(input.notes, "verification notes");
  if (input.policy.requireEvidenceForVerification && evidenceIds.length === 0) {
    const gaps = [verificationGap(input.subjectId, input.subjectType, "verification has no evidence ids")];
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Verification requires evidence", { gaps }, gaps);
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
    const gaps = [
      verificationGap(input.subjectId, input.subjectType, "verification evidence belongs to a different subject", {
        evidenceIds: mismatchedEvidence.map((record) => record.evidenceId),
        observed: mismatchedEvidence.map((record) => `${record.subjectType}:${record.subjectId}`)
      })
    ];
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Verification evidence belongs to a different subject",
      {
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        mismatchedEvidence,
        gaps
      },
      gaps
    );
  }
  if (input.verdict === "passed" && !selectedEvidence.some((record) => record.outcome === "passed")) {
    const gaps = [
      verificationGap(input.subjectId, input.subjectType, "passed verification has no passed evidence", {
        evidenceIds,
        observed: selectedEvidence.map((record) => record.outcome)
      })
    ];
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Passed verification requires at least one passed evidence",
      {
        evidenceIds,
        gaps
      },
      gaps
    );
  }
  if (input.verdict === "passed") {
    const trustGaps = (input.trustRequirements ?? []).flatMap((requirement) => {
      const candidates = selectedEvidence.filter((record) => record.outcome === "passed");
      return candidates.some((record) => evidenceSatisfiesTrustRequirement(record, requirement))
        ? []
        : [evidenceTrustGap(input.subjectId, input.subjectType, candidates, requirement)];
    });
    if (trustGaps.length > 0) {
      throw new BorealError(
        "BOREAL_POLICY_VIOLATION",
        "Passed verification does not satisfy evidence trust and freshness policy",
        { evidenceIds, gaps: trustGaps },
        trustGaps
      );
    }
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

export function evidenceSatisfiesTrustRequirement(
  record: EvidenceRecord,
  requirement: EvidenceTrustRequirement
): boolean {
  if (record.outcome !== "passed") return false;
  const attestation = record.attestation;
  if (attestation?.command) {
    if (
      attestation.command.exitCode !== undefined && attestation.command.exitCode !== 0 ||
      attestation.command.timedOut ||
      attestation.command.cancelled ||
      attestation.command.expectedObservableMatched === false
    ) return false;
  }
  if (attestation?.trustLevel === "external_attested" && attestation.external?.verificationStatus !== "verified") {
    return false;
  }
  if (requirement.requiredTrustLevels?.length && !requirement.requiredTrustLevels.includes(evidenceTrustLevel(record))) {
    return false;
  }
  if (requirement.currentRevision && attestation?.subjectRevision?.contentHash !== requirement.currentRevision) {
    return false;
  }
  if (requirement.currentGitHead && attestation?.git?.headSha !== requirement.currentGitHead) {
    return false;
  }
  return true;
}

export function evidenceTrustGap(
  subjectId: string,
  subjectType: string,
  candidates: readonly EvidenceRecord[],
  requirement: EvidenceTrustRequirement
): EnforcementGap {
  const base = {
    subjectType: enforcementSubjectType(subjectType),
    subjectId,
    data: {
      ...(requirement.gateId ? { gateIds: [requirement.gateId] } : {}),
      evidenceIds: candidates.map((record) => record.meta.id),
      ...(requirement.requiredTrustLevels ? { requiredTrustLevels: requirement.requiredTrustLevels } : {}),
      ...(requirement.currentRevision ? { requiredRevision: requirement.currentRevision } : {}),
      ...(requirement.currentGitHead ? { requiredGitHead: requirement.currentGitHead } : {}),
      ...(requirement.rerunCommand ? { recommendedCommands: [requirement.rerunCommand], command: requirement.rerunCommand } : {})
    }
  } as const;
  const failed = candidates.filter((record) => {
    const command = record.attestation?.command;
    return record.outcome !== "passed" || command?.timedOut || command?.cancelled ||
      command?.expectedObservableMatched === false || (command?.exitCode !== undefined && command.exitCode !== 0);
  });
  if (failed.length > 0 || candidates.length === 0) {
    return { ...base, code: "gate.evidence.failed", data: { ...base.data, reason: candidates.length === 0 ? "no passed evidence selected" : "selected evidence records a failed or interrupted execution" } };
  }
  if (candidates.some((record) => record.attestation?.trustLevel === "external_attested" && record.attestation.external?.verificationStatus !== "verified")) {
    return { ...base, code: "gate.evidence.external-unverified", data: { ...base.data, reason: "external attestation is not verified" } };
  }
  if (requirement.requiredTrustLevels?.length && candidates.every((record) => !requirement.requiredTrustLevels?.includes(evidenceTrustLevel(record)))) {
    return { ...base, code: "gate.evidence.trust-insufficient", data: { ...base.data, observed: candidates.map(evidenceTrustLevel), reason: "evidence trust level is not accepted by the gate" } };
  }
  if (requirement.currentRevision && candidates.every((record) => record.attestation?.subjectRevision?.contentHash !== requirement.currentRevision)) {
    return { ...base, code: "gate.evidence.revision-stale", data: { ...base.data, observed: candidates.map((record) => record.attestation?.subjectRevision?.contentHash ?? "<missing>"), reason: "evidence was captured for a different work revision" } };
  }
  return { ...base, code: "gate.evidence.git-stale", data: { ...base.data, observed: candidates.map((record) => record.attestation?.git?.headSha ?? "<missing>"), reason: "evidence was captured for a different Git head" } };
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

function verificationGap(
  subjectId: string,
  subjectType: string,
  reason: string,
  data: Omit<NonNullable<EnforcementGap["data"]>, "reason"> = {}
): EnforcementGap {
  return {
    code: "gate.verification.unsatisfied",
    subjectType: enforcementSubjectType(subjectType),
    subjectId,
    data: {
      ...data,
      reason
    }
  };
}

function enforcementSubjectType(value: string): EnforcementGap["subjectType"] {
  switch (value) {
    case "work":
    case "sprint":
    case "phase":
    case "milestone":
    case "project":
    case "session":
    case "workspace":
    case "command":
      return value;
    default:
      return "command";
  }
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
