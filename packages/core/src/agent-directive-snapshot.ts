import {
  AGENT_DIRECTIVE_SUBJECT_TYPES,
  agentDirectiveDataIssues,
  type AgentDirectiveId,
  type AgentDirectiveSubjectType
} from "./agent-directives.js";
import { BorealError } from "./errors.js";
import { hashContent } from "./hash.js";
import type {
  AgentId,
  AgentSummaryId,
  CloseoutGateId,
  ContentHash,
  EvidenceId,
  ReservationId,
  VerificationId,
  WorkId
} from "./ids.js";
import type {
  ActorRef,
  CloseoutGateForceReasonCode,
  CloseoutGateKind,
  CloseoutGateScope,
  CloseoutGateStatus,
  EvidenceKind,
  EvidenceOutcome,
  VerificationVerdict,
  WorkKind,
  WorkPriority,
  WorkStatus
} from "./records.js";
import { isIsoTimestamp, type IsoTimestamp } from "./time.js";

export const AGENT_DIRECTIVE_SNAPSHOT_SCHEMA_VERSION = "boreal.agent-directive-snapshot.v1";
export const AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS = [
  "work",
  "summary",
  "gate",
  "evidence",
  "git",
  "workflow",
  "doctor",
  "sync",
  "command",
  "actor"
] as const;

export type AgentDirectiveSnapshotContextKey = (typeof AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS)[number];
export type AgentDirectiveSnapshotDiagnosticSeverity = "ok" | "info" | "warning" | "error";

export interface AgentDirectiveCommandSnapshot {
  readonly path: string;
  readonly argv: readonly string[];
  readonly envelopeSchema?: string;
  readonly json: boolean;
  readonly mutatesState: boolean;
  readonly resultOk?: boolean;
  readonly resultPath?: string;
  readonly spooledResultPath?: string;
}

export interface AgentDirectiveActorSnapshot {
  readonly actor: ActorRef;
  readonly activeAgentId?: AgentId | string;
  readonly activeReservationIds: readonly ReservationId[];
  readonly purpose?: string;
  readonly reviewerId?: string;
}

export interface AgentDirectiveWorkSubjectSnapshot {
  readonly type: AgentDirectiveSubjectType;
  readonly id: string;
  readonly title: string;
  readonly kind?: WorkKind;
  readonly status?: WorkStatus;
  readonly priority?: WorkPriority;
  readonly parentId?: WorkId;
  readonly reservationId?: ReservationId;
  readonly closedReason?: string;
}

export interface AgentDirectiveWorkSnapshot {
  readonly subject?: AgentDirectiveWorkSubjectSnapshot;
  readonly labels: readonly string[];
  readonly dependencyIds: readonly WorkId[];
  readonly activeBlockerIds: readonly WorkId[];
  readonly blockedByIds: readonly WorkId[];
  readonly childWorkIds: readonly WorkId[];
  readonly descendantWorkIds: readonly WorkId[];
  readonly openDescendantIds: readonly WorkId[];
}

export interface AgentDirectiveSummarySnapshot {
  readonly summaryIds: readonly AgentSummaryId[];
  readonly finalSummaryIds: readonly AgentSummaryId[];
  readonly childSummaryIds: readonly AgentSummaryId[];
  readonly artifactUris: readonly string[];
  readonly commitShas: readonly string[];
  readonly dirtyPathNotes: readonly string[];
  readonly latestSummaryId?: AgentSummaryId;
  readonly latestSummaryUri?: string;
}

export interface AgentDirectiveGateStateSnapshot {
  readonly id: CloseoutGateId;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly kind: CloseoutGateKind;
  readonly scope: CloseoutGateScope;
  readonly status: CloseoutGateStatus;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly minEvidenceCount: number;
  readonly evidenceIds: readonly EvidenceId[];
  readonly verificationIds: readonly VerificationId[];
  readonly agentSummaryIds: readonly AgentSummaryId[];
  readonly commitShas: readonly string[];
  readonly dirtyPathNotes: readonly string[];
  readonly directiveIds: readonly AgentDirectiveId[];
  readonly acknowledgementIds: readonly string[];
  readonly declaredCommand?: string;
  readonly expectedObservable?: string;
  readonly forceReasonCode?: CloseoutGateForceReasonCode;
}

export interface AgentDirectiveGateSnapshot {
  readonly requiredGates: readonly AgentDirectiveGateStateSnapshot[];
  readonly openGateIds: readonly CloseoutGateId[];
  readonly satisfiedGateIds: readonly CloseoutGateId[];
  readonly forcedGateIds: readonly CloseoutGateId[];
}

export interface AgentDirectiveEvidenceEntrySnapshot {
  readonly id: EvidenceId;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly kind: EvidenceKind;
  readonly outcome: EvidenceOutcome;
  readonly summary: string;
  readonly command?: string;
  readonly uri?: string;
  readonly observedAt: IsoTimestamp;
}

export interface AgentDirectiveVerificationEntrySnapshot {
  readonly id: VerificationId;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly verdict: VerificationVerdict;
  readonly evidenceIds: readonly EvidenceId[];
  readonly verifiedAt: IsoTimestamp;
}

export interface AgentDirectiveEvidenceSnapshot {
  readonly evidenceIds: readonly EvidenceId[];
  readonly verificationIds: readonly VerificationId[];
  readonly evidence: readonly AgentDirectiveEvidenceEntrySnapshot[];
  readonly verifications: readonly AgentDirectiveVerificationEntrySnapshot[];
}

export interface AgentDirectiveGitPathSnapshot {
  readonly status: string;
  readonly path: string;
}

export interface AgentDirectiveGitRootSnapshot {
  readonly root: string;
  readonly branchName?: string;
  readonly detached: boolean;
  readonly protectedBranch: boolean;
  readonly clean: boolean;
  readonly scopedChangedPaths: readonly AgentDirectiveGitPathSnapshot[];
  readonly collaborationDirtyPaths: readonly AgentDirectiveGitPathSnapshot[];
  readonly blockingDirtyPaths: readonly AgentDirectiveGitPathSnapshot[];
  readonly untrackedPaths: readonly string[];
  readonly lastCommitSha?: string;
}

export interface AgentDirectiveGitSnapshot {
  readonly roots: readonly AgentDirectiveGitRootSnapshot[];
  readonly checkpointCommitShas: readonly string[];
  readonly dirtyPathNotes: readonly string[];
}

export interface AgentDirectiveWorkflowSnapshot {
  readonly workflowRefs: readonly string[];
  readonly skillRefs: readonly string[];
  readonly requiredInputNames: readonly AgentDirectiveSnapshotContextKey[];
  readonly nextWorkflowRef?: string;
  readonly recommendedCommandPath?: string;
  readonly assetManifestHash?: ContentHash;
}

export interface AgentDirectiveDiagnosticSnapshot {
  readonly code: string;
  readonly severity: AgentDirectiveSnapshotDiagnosticSeverity;
  readonly message: string;
  readonly blocking: boolean;
  readonly recommendedCommands: readonly string[];
}

export interface AgentDirectiveDoctorSnapshot {
  readonly ok: boolean;
  readonly strict: boolean;
  readonly diagnostics: readonly AgentDirectiveDiagnosticSnapshot[];
}

export interface AgentDirectiveSyncSnapshot {
  readonly ok: boolean;
  readonly refreshed: boolean;
  readonly ledgersFresh: boolean;
  readonly searchIndexFresh: boolean;
  readonly sqliteCacheFresh: boolean;
  readonly operationCount?: number;
  readonly warningThreshold?: number;
  readonly contentHash?: ContentHash;
  readonly searchIndexHash?: ContentHash;
}

export interface AgentDirectiveSnapshot {
  readonly schemaVersion: typeof AGENT_DIRECTIVE_SNAPSHOT_SCHEMA_VERSION;
  readonly capturedAt: IsoTimestamp;
  readonly work: AgentDirectiveWorkSnapshot;
  readonly summary: AgentDirectiveSummarySnapshot;
  readonly gate: AgentDirectiveGateSnapshot;
  readonly evidence: AgentDirectiveEvidenceSnapshot;
  readonly git: AgentDirectiveGitSnapshot;
  readonly workflow: AgentDirectiveWorkflowSnapshot;
  readonly doctor: AgentDirectiveDoctorSnapshot;
  readonly sync: AgentDirectiveSyncSnapshot;
  readonly command: AgentDirectiveCommandSnapshot;
  readonly actor: AgentDirectiveActorSnapshot;
}

export type AgentDirectiveSnapshotInput = Omit<AgentDirectiveSnapshot, "schemaVersion"> &
  Partial<Pick<AgentDirectiveSnapshot, "schemaVersion">>;

export interface AgentDirectiveSnapshotValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function createAgentDirectiveSnapshot(input: AgentDirectiveSnapshotInput): AgentDirectiveSnapshot {
  const snapshot = {
    ...input,
    schemaVersion: input.schemaVersion ?? AGENT_DIRECTIVE_SNAPSHOT_SCHEMA_VERSION
  } as AgentDirectiveSnapshot;
  assertAgentDirectiveSnapshot(snapshot);
  return snapshot;
}

export function agentDirectiveSnapshotHash(snapshot: AgentDirectiveSnapshot): ContentHash {
  assertAgentDirectiveSnapshot(snapshot);
  const { capturedAt: _capturedAt, ...stableSnapshot } = snapshot;
  return hashContent(stableSnapshot);
}

export function agentDirectiveSnapshotIssues(value: unknown): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("$", "must be an object")];
  }

  const issues: AgentDirectiveSnapshotValidationIssue[] = [
    ...agentDirectiveDataIssues(value, "$"),
    ...literalIssues(value.schemaVersion, "$.schemaVersion", AGENT_DIRECTIVE_SNAPSHOT_SCHEMA_VERSION),
    ...isoTimestampIssues(value.capturedAt, "$.capturedAt"),
    ...objectIssues(value.work, "$.work"),
    ...objectIssues(value.summary, "$.summary"),
    ...objectIssues(value.gate, "$.gate"),
    ...objectIssues(value.evidence, "$.evidence"),
    ...objectIssues(value.git, "$.git"),
    ...objectIssues(value.workflow, "$.workflow"),
    ...objectIssues(value.doctor, "$.doctor"),
    ...objectIssues(value.sync, "$.sync"),
    ...objectIssues(value.command, "$.command"),
    ...objectIssues(value.actor, "$.actor")
  ];

  if (isPlainRecord(value.work)) {
    issues.push(
      ...stringArrayIssues(value.work.labels, "$.work.labels"),
      ...stringArrayIssues(value.work.dependencyIds, "$.work.dependencyIds"),
      ...stringArrayIssues(value.work.activeBlockerIds, "$.work.activeBlockerIds"),
      ...stringArrayIssues(value.work.blockedByIds, "$.work.blockedByIds"),
      ...stringArrayIssues(value.work.childWorkIds, "$.work.childWorkIds"),
      ...stringArrayIssues(value.work.descendantWorkIds, "$.work.descendantWorkIds"),
      ...stringArrayIssues(value.work.openDescendantIds, "$.work.openDescendantIds")
    );
    if (value.work.subject !== undefined) {
      issues.push(...workSubjectIssues(value.work.subject, "$.work.subject"));
    }
  }

  if (isPlainRecord(value.summary)) {
    issues.push(
      ...stringArrayIssues(value.summary.summaryIds, "$.summary.summaryIds"),
      ...stringArrayIssues(value.summary.finalSummaryIds, "$.summary.finalSummaryIds"),
      ...stringArrayIssues(value.summary.childSummaryIds, "$.summary.childSummaryIds"),
      ...stringArrayIssues(value.summary.artifactUris, "$.summary.artifactUris"),
      ...stringArrayIssues(value.summary.commitShas, "$.summary.commitShas"),
      ...stringArrayIssues(value.summary.dirtyPathNotes, "$.summary.dirtyPathNotes")
    );
  }

  if (isPlainRecord(value.gate)) {
    issues.push(
      ...arrayIssues(value.gate.requiredGates, "$.gate.requiredGates"),
      ...stringArrayIssues(value.gate.openGateIds, "$.gate.openGateIds"),
      ...stringArrayIssues(value.gate.satisfiedGateIds, "$.gate.satisfiedGateIds"),
      ...stringArrayIssues(value.gate.forcedGateIds, "$.gate.forcedGateIds")
    );
    if (Array.isArray(value.gate.requiredGates)) {
      value.gate.requiredGates.forEach((gate, index) => {
        issues.push(...gateStateIssues(gate, `$.gate.requiredGates[${index}]`));
      });
    }
  }

  if (isPlainRecord(value.evidence)) {
    issues.push(
      ...stringArrayIssues(value.evidence.evidenceIds, "$.evidence.evidenceIds"),
      ...stringArrayIssues(value.evidence.verificationIds, "$.evidence.verificationIds"),
      ...arrayIssues(value.evidence.evidence, "$.evidence.evidence"),
      ...arrayIssues(value.evidence.verifications, "$.evidence.verifications")
    );
    if (Array.isArray(value.evidence.evidence)) {
      value.evidence.evidence.forEach((evidence, index) => {
        issues.push(...evidenceEntryIssues(evidence, `$.evidence.evidence[${index}]`));
      });
    }
    if (Array.isArray(value.evidence.verifications)) {
      value.evidence.verifications.forEach((verification, index) => {
        issues.push(...verificationEntryIssues(verification, `$.evidence.verifications[${index}]`));
      });
    }
  }

  if (isPlainRecord(value.git)) {
    issues.push(
      ...arrayIssues(value.git.roots, "$.git.roots"),
      ...stringArrayIssues(value.git.checkpointCommitShas, "$.git.checkpointCommitShas"),
      ...stringArrayIssues(value.git.dirtyPathNotes, "$.git.dirtyPathNotes")
    );
    if (Array.isArray(value.git.roots)) {
      value.git.roots.forEach((root, index) => {
        issues.push(...gitRootIssues(root, `$.git.roots[${index}]`));
      });
    }
  }

  if (isPlainRecord(value.workflow)) {
    issues.push(
      ...stringArrayIssues(value.workflow.workflowRefs, "$.workflow.workflowRefs"),
      ...stringArrayIssues(value.workflow.skillRefs, "$.workflow.skillRefs"),
      ...requiredInputNameIssues(value.workflow.requiredInputNames, "$.workflow.requiredInputNames")
    );
  }

  if (isPlainRecord(value.doctor)) {
    issues.push(
      ...booleanIssues(value.doctor.ok, "$.doctor.ok"),
      ...booleanIssues(value.doctor.strict, "$.doctor.strict"),
      ...arrayIssues(value.doctor.diagnostics, "$.doctor.diagnostics")
    );
    if (Array.isArray(value.doctor.diagnostics)) {
      value.doctor.diagnostics.forEach((diagnostic, index) => {
        issues.push(...diagnosticIssues(diagnostic, `$.doctor.diagnostics[${index}]`));
      });
    }
  }

  if (isPlainRecord(value.sync)) {
    issues.push(
      ...booleanIssues(value.sync.ok, "$.sync.ok"),
      ...booleanIssues(value.sync.refreshed, "$.sync.refreshed"),
      ...booleanIssues(value.sync.ledgersFresh, "$.sync.ledgersFresh"),
      ...booleanIssues(value.sync.searchIndexFresh, "$.sync.searchIndexFresh"),
      ...booleanIssues(value.sync.sqliteCacheFresh, "$.sync.sqliteCacheFresh"),
      ...optionalNumberIssues(value.sync.operationCount, "$.sync.operationCount"),
      ...optionalNumberIssues(value.sync.warningThreshold, "$.sync.warningThreshold")
    );
  }

  if (isPlainRecord(value.command)) {
    issues.push(
      ...nonEmptyStringIssues(value.command.path, "$.command.path"),
      ...stringArrayIssues(value.command.argv, "$.command.argv"),
      ...booleanIssues(value.command.json, "$.command.json"),
      ...booleanIssues(value.command.mutatesState, "$.command.mutatesState"),
      ...optionalBooleanIssues(value.command.resultOk, "$.command.resultOk"),
      ...optionalNonEmptyStringIssues(value.command.envelopeSchema, "$.command.envelopeSchema"),
      ...optionalNonEmptyStringIssues(value.command.resultPath, "$.command.resultPath"),
      ...optionalNonEmptyStringIssues(value.command.spooledResultPath, "$.command.spooledResultPath")
    );
  }

  if (isPlainRecord(value.actor)) {
    issues.push(...objectIssues(value.actor.actor, "$.actor.actor"));
    if (isPlainRecord(value.actor.actor)) {
      issues.push(
        ...nonEmptyStringIssues(value.actor.actor.id, "$.actor.actor.id"),
        ...enumIssues(value.actor.actor.kind, "$.actor.actor.kind", ["human", "agent", "system"] as const)
      );
    }
    issues.push(...stringArrayIssues(value.actor.activeReservationIds, "$.actor.activeReservationIds"));
  }

  return issues;
}

export function assertAgentDirectiveSnapshot(value: unknown): asserts value is AgentDirectiveSnapshot {
  const issues = agentDirectiveSnapshotIssues(value);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Invalid agent directive snapshot", { issues });
  }
}

function workSubjectIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...enumIssues(value.type, `${path}.type`, AGENT_DIRECTIVE_SUBJECT_TYPES),
    ...nonEmptyStringIssues(value.id, `${path}.id`),
    ...nonEmptyStringIssues(value.title, `${path}.title`)
  ];
}

function gateStateIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...nonEmptyStringIssues(value.id, `${path}.id`),
    ...nonEmptyStringIssues(value.subjectType, `${path}.subjectType`),
    ...nonEmptyStringIssues(value.subjectId, `${path}.subjectId`),
    ...nonEmptyStringIssues(value.kind, `${path}.kind`),
    ...nonEmptyStringIssues(value.scope, `${path}.scope`),
    ...nonEmptyStringIssues(value.status, `${path}.status`),
    ...stringArrayIssues(value.requiredEvidenceKinds, `${path}.requiredEvidenceKinds`),
    ...numberIssues(value.minEvidenceCount, `${path}.minEvidenceCount`),
    ...stringArrayIssues(value.evidenceIds, `${path}.evidenceIds`),
    ...stringArrayIssues(value.verificationIds, `${path}.verificationIds`),
    ...stringArrayIssues(value.agentSummaryIds, `${path}.agentSummaryIds`),
    ...stringArrayIssues(value.commitShas, `${path}.commitShas`),
    ...stringArrayIssues(value.dirtyPathNotes, `${path}.dirtyPathNotes`),
    ...stringArrayIssues(value.directiveIds, `${path}.directiveIds`),
    ...stringArrayIssues(value.acknowledgementIds, `${path}.acknowledgementIds`),
    ...optionalNonEmptyStringIssues(value.declaredCommand, `${path}.declaredCommand`),
    ...optionalNonEmptyStringIssues(value.expectedObservable, `${path}.expectedObservable`),
    ...optionalNonEmptyStringIssues(value.forceReasonCode, `${path}.forceReasonCode`)
  ];
}

function evidenceEntryIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...nonEmptyStringIssues(value.id, `${path}.id`),
    ...nonEmptyStringIssues(value.subjectId, `${path}.subjectId`),
    ...nonEmptyStringIssues(value.subjectType, `${path}.subjectType`),
    ...nonEmptyStringIssues(value.kind, `${path}.kind`),
    ...nonEmptyStringIssues(value.outcome, `${path}.outcome`),
    ...nonEmptyStringIssues(value.summary, `${path}.summary`),
    ...optionalNonEmptyStringIssues(value.command, `${path}.command`),
    ...optionalNonEmptyStringIssues(value.uri, `${path}.uri`),
    ...isoTimestampIssues(value.observedAt, `${path}.observedAt`)
  ];
}

function verificationEntryIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...nonEmptyStringIssues(value.id, `${path}.id`),
    ...nonEmptyStringIssues(value.subjectId, `${path}.subjectId`),
    ...nonEmptyStringIssues(value.subjectType, `${path}.subjectType`),
    ...nonEmptyStringIssues(value.verdict, `${path}.verdict`),
    ...stringArrayIssues(value.evidenceIds, `${path}.evidenceIds`),
    ...isoTimestampIssues(value.verifiedAt, `${path}.verifiedAt`)
  ];
}

function gitRootIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...nonEmptyStringIssues(value.root, `${path}.root`),
    ...optionalNonEmptyStringIssues(value.branchName, `${path}.branchName`),
    ...booleanIssues(value.detached, `${path}.detached`),
    ...booleanIssues(value.protectedBranch, `${path}.protectedBranch`),
    ...booleanIssues(value.clean, `${path}.clean`),
    ...gitPathArrayIssues(value.scopedChangedPaths, `${path}.scopedChangedPaths`),
    ...gitPathArrayIssues(value.collaborationDirtyPaths, `${path}.collaborationDirtyPaths`),
    ...gitPathArrayIssues(value.blockingDirtyPaths, `${path}.blockingDirtyPaths`),
    ...stringArrayIssues(value.untrackedPaths, `${path}.untrackedPaths`),
    ...optionalNonEmptyStringIssues(value.lastCommitSha, `${path}.lastCommitSha`)
  ];
}

function diagnosticIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...nonEmptyStringIssues(value.code, `${path}.code`),
    ...enumIssues(value.severity, `${path}.severity`, ["ok", "info", "warning", "error"] as const),
    ...nonEmptyStringIssues(value.message, `${path}.message`),
    ...booleanIssues(value.blocking, `${path}.blocking`),
    ...stringArrayIssues(value.recommendedCommands, `${path}.recommendedCommands`)
  ];
}

function gitPathArrayIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  const issues = arrayIssues(value, path);
  if (!Array.isArray(value)) {
    return issues;
  }
  return [
    ...issues,
    ...value.flatMap((entry, index) => {
      const entryPath = `${path}[${index}]`;
      if (!isPlainRecord(entry)) {
        return [issue(entryPath, "must be an object")];
      }
      return [
        ...nonEmptyStringIssues(entry.status, `${entryPath}.status`),
        ...nonEmptyStringIssues(entry.path, `${entryPath}.path`)
      ];
    })
  ];
}

function requiredInputNameIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  const issues = stringArrayIssues(value, path);
  if (!Array.isArray(value)) {
    return issues;
  }
  const knownKeys = new Set<string>(AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS);
  return [
    ...issues,
    ...value.flatMap((entry, index) =>
      typeof entry === "string" && !knownKeys.has(entry)
        ? [issue(`${path}[${index}]`, "must name an explicit directive snapshot context")]
        : []
    )
  ];
}

function literalIssues(
  value: unknown,
  path: string,
  expected: string
): readonly AgentDirectiveSnapshotValidationIssue[] {
  return value === expected ? [] : [issue(path, `must be ${expected}`)];
}

function isoTimestampIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return isIsoTimestamp(value) ? [] : [issue(path, "must be an ISO timestamp")];
}

function objectIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return isPlainRecord(value) ? [] : [issue(path, "must be an object")];
}

function arrayIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return Array.isArray(value) ? [] : [issue(path, "must be an array")];
}

function stringArrayIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  return value.flatMap((entry, index) => nonEmptyStringIssues(entry, `${path}[${index}]`));
}

function nonEmptyStringIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return typeof value === "string" && value.trim().length > 0 ? [] : [issue(path, "must be a non-empty string")];
}

function optionalNonEmptyStringIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return value === undefined ? [] : nonEmptyStringIssues(value, path);
}

function numberIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return typeof value === "number" && Number.isFinite(value) ? [] : [issue(path, "must be a finite number")];
}

function optionalNumberIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return value === undefined ? [] : numberIssues(value, path);
}

function booleanIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return typeof value === "boolean" ? [] : [issue(path, "must be a boolean")];
}

function optionalBooleanIssues(value: unknown, path: string): readonly AgentDirectiveSnapshotValidationIssue[] {
  return value === undefined ? [] : booleanIssues(value, path);
}

function enumIssues<TValue extends string>(
  value: unknown,
  path: string,
  allowed: readonly TValue[]
): readonly AgentDirectiveSnapshotValidationIssue[] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? []
    : [issue(path, `must be one of: ${allowed.join(", ")}`)];
}

function isPlainRecord(value: unknown): value is { readonly [key: string]: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(path: string, message: string): AgentDirectiveSnapshotValidationIssue {
  return { path, message };
}
