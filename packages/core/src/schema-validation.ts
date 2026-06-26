import { BorealError } from "./errors.js";
import type { RuntimePolicy } from "./policies.js";

export interface SchemaValidationIssue {
  readonly schemaId: string;
  readonly path: string;
  readonly message: string;
}

export const RUNTIME_SCHEMA_IDS = {
  workItem: "https://boreal.work/schemas/records/work-item.schema.json",
  graphEdge: "https://boreal.work/schemas/records/graph-edge.schema.json",
  evidenceRecord: "https://boreal.work/schemas/records/evidence-record.schema.json",
  verificationRecord: "https://boreal.work/schemas/records/verification-record.schema.json",
  knowledgeSource: "https://boreal.work/schemas/records/knowledge-source.schema.json",
  claimRecord: "https://boreal.work/schemas/records/claim-record.schema.json",
  decisionRecord: "https://boreal.work/schemas/records/decision-record.schema.json",
  agentReservation: "https://boreal.work/schemas/records/agent-reservation.schema.json",
  runtimeEvent: "https://boreal.work/schemas/events/runtime-event.schema.json",
  runtimeOperation: "https://boreal.work/schemas/operations/runtime-operation.schema.json",
  projectionRecord: "https://boreal.work/schemas/projections/projection-record.schema.json",
  contextPack: "https://boreal.work/schemas/projections/context-pack.schema.json",
  runtimePolicy: "https://boreal.work/schemas/policies/runtime-policy.schema.json"
} as const;

export function runtimeSnapshotSchemaIssues(snapshot: {
  readonly workItems?: readonly unknown[];
  readonly evidence?: readonly unknown[];
  readonly verifications?: readonly unknown[];
  readonly knowledgeSources?: readonly unknown[];
  readonly claims?: readonly unknown[];
  readonly decisions?: readonly unknown[];
  readonly graphEdges?: readonly unknown[];
  readonly reservations?: readonly unknown[];
  readonly events?: readonly unknown[];
  readonly operations?: readonly unknown[];
  readonly projections?: readonly unknown[];
  readonly contextPacks?: readonly unknown[];
}): readonly SchemaValidationIssue[] {
  return [
    ...arrayItems(snapshot.workItems ?? [], RUNTIME_SCHEMA_IDS.workItem, "workItems", workItemSchemaIssues),
    ...arrayItems(snapshot.evidence ?? [], RUNTIME_SCHEMA_IDS.evidenceRecord, "evidence", evidenceRecordSchemaIssues),
    ...arrayItems(
      snapshot.verifications ?? [],
      RUNTIME_SCHEMA_IDS.verificationRecord,
      "verifications",
      verificationRecordSchemaIssues
    ),
    ...arrayItems(
      snapshot.knowledgeSources ?? [],
      RUNTIME_SCHEMA_IDS.knowledgeSource,
      "knowledgeSources",
      knowledgeSourceSchemaIssues
    ),
    ...arrayItems(snapshot.claims ?? [], RUNTIME_SCHEMA_IDS.claimRecord, "claims", claimRecordSchemaIssues),
    ...arrayItems(snapshot.decisions ?? [], RUNTIME_SCHEMA_IDS.decisionRecord, "decisions", decisionRecordSchemaIssues),
    ...arrayItems(snapshot.graphEdges ?? [], RUNTIME_SCHEMA_IDS.graphEdge, "graphEdges", graphEdgeSchemaIssues),
    ...arrayItems(
      snapshot.reservations ?? [],
      RUNTIME_SCHEMA_IDS.agentReservation,
      "reservations",
      agentReservationSchemaIssues
    ),
    ...arrayItems(snapshot.events ?? [], RUNTIME_SCHEMA_IDS.runtimeEvent, "events", runtimeEventSchemaIssues),
    ...arrayItems(
      snapshot.operations ?? [],
      RUNTIME_SCHEMA_IDS.runtimeOperation,
      "operations",
      runtimeOperationSchemaIssues
    ),
    ...arrayItems(
      snapshot.projections ?? [],
      RUNTIME_SCHEMA_IDS.projectionRecord,
      "projections",
      projectionRecordSchemaIssues
    ),
    ...arrayItems(snapshot.contextPacks ?? [], RUNTIME_SCHEMA_IDS.contextPack, "contextPacks", contextPackSchemaIssues),
    ...(snapshot.events ?? []).flatMap((event, index) => workspaceInitializedPolicyIssues(event, `events[${index}]`))
  ];
}

export function workItemSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.workItem;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, ["issue", "task", "sprint", "milestone"]),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...stringIssue(value.description, `${path}.description`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, [
      "draft",
      "ready",
      "reserved",
      "in_progress",
      "blocked",
      "needs_verification",
      "verified",
      "closed",
      "cancelled"
    ]),
    ...enumIssue(value.priority, `${path}.priority`, schemaId, ["low", "normal", "high", "critical"]),
    ...stringArrayIssue(value.acceptanceCriteria, `${path}.acceptanceCriteria`, schemaId),
    ...uniqueStringArrayIssue(value.labels, `${path}.labels`, schemaId),
    ...uniqueStringArrayIssue(value.dependencyIds, `${path}.dependencyIds`, schemaId),
    ...uniqueStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId),
    ...uniqueStringArrayIssue(value.verificationIds, `${path}.verificationIds`, schemaId)
  ];

  if (value.parentId !== undefined) {
    issues.push(...stringIssue(value.parentId, `${path}.parentId`, schemaId));
  }
  if (value.reservationId !== undefined) {
    issues.push(...stringIssue(value.reservationId, `${path}.reservationId`, schemaId));
  }
  if (value.closedAt !== undefined) {
    issues.push(...stringIssue(value.closedAt, `${path}.closedAt`, schemaId));
  }
  if (value.closedReason !== undefined) {
    issues.push(...stringIssue(value.closedReason, `${path}.closedReason`, schemaId));
  }

  return issues;
}

export function evidenceRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.evidenceRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_evidence_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...nonEmptyStringIssue(value.subjectType, `${path}.subjectType`, schemaId),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, ["command", "test", "diff", "review", "artifact", "note"]),
    ...nonEmptyStringIssue(value.summary, `${path}.summary`, schemaId),
    ...enumIssue(value.outcome, `${path}.outcome`, schemaId, ["passed", "failed", "observed", "unknown"]),
    ...stringIssue(value.observedAt, `${path}.observedAt`, schemaId)
  ];

  if (value.command !== undefined) {
    issues.push(...stringIssue(value.command, `${path}.command`, schemaId));
  }
  if (value.uri !== undefined) {
    issues.push(...stringIssue(value.uri, `${path}.uri`, schemaId));
  }

  return issues;
}

export function verificationRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.verificationRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_verification_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...nonEmptyStringIssue(value.subjectType, `${path}.subjectType`, schemaId),
    ...enumIssue(value.verdict, `${path}.verdict`, schemaId, ["passed", "failed"]),
    ...uniqueStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId),
    ...stringIssue(value.verifiedAt, `${path}.verifiedAt`, schemaId)
  ];

  if (value.notes !== undefined) {
    issues.push(...stringIssue(value.notes, `${path}.notes`, schemaId));
  }

  return issues;
}

export function knowledgeSourceSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.knowledgeSource;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_source_[a-f0-9]{12,64}$/),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, ["raw", "document", "chat", "code", "artifact"]),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...nonEmptyStringIssue(value.uri, `${path}.uri`, schemaId),
    ...stringIssue(value.summary, `${path}.summary`, schemaId)
  ];
}

export function claimRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.claimRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_claim_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.statement, `${path}.statement`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["proposed", "accepted", "rejected", "stale"]),
    ...uniqueStringArrayIssue(value.sourceIds, `${path}.sourceIds`, schemaId),
    ...uniqueStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId)
  ];
}

export function decisionRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.decisionRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_decision_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["proposed", "accepted", "superseded", "rejected"]),
    ...stringIssue(value.context, `${path}.context`, schemaId),
    ...nonEmptyStringIssue(value.decision, `${path}.decision`, schemaId),
    ...stringArrayIssue(value.consequences, `${path}.consequences`, schemaId),
    ...uniqueStringArrayIssue(value.sourceIds, `${path}.sourceIds`, schemaId)
  ];
}

export function graphEdgeSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.graphEdge;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_edge_[a-f0-9]{12,64}$/),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, [
      "blocks",
      "depends_on",
      "relates_to",
      "supports",
      "contradicts",
      "verifies",
      "references"
    ]),
    ...nonEmptyStringIssue(value.fromId, `${path}.fromId`, schemaId),
    ...nonEmptyStringIssue(value.fromType, `${path}.fromType`, schemaId),
    ...nonEmptyStringIssue(value.toId, `${path}.toId`, schemaId),
    ...nonEmptyStringIssue(value.toType, `${path}.toType`, schemaId),
    ...booleanIssue(value.directed, `${path}.directed`, schemaId)
  ];
}

export function agentReservationSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.agentReservation;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_reservation_[a-f0-9]{12,64}$/),
    ...patternStringIssue(value.workId, `${path}.workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.agentId, `${path}.agentId`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["active", "released", "expired"]),
    ...stringIssue(value.reservedAt, `${path}.reservedAt`, schemaId)
  ];

  if (value.expiresAt !== undefined) {
    issues.push(...stringIssue(value.expiresAt, `${path}.expiresAt`, schemaId));
  }
  if (value.purpose !== undefined) {
    issues.push(...stringIssue(value.purpose, `${path}.purpose`, schemaId));
  }

  return issues;
}

export function runtimeEventSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.runtimeEvent;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_event_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.type, `${path}.type`, schemaId),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...nonEmptyStringIssue(value.subjectType, `${path}.subjectType`, schemaId),
    ...recordIssue(value.payload, `${path}.payload`, schemaId)
  ];
  if (value.operationId !== undefined) {
    issues.push(...patternStringIssue(value.operationId, `${path}.operationId`, schemaId, /^bw_operation_[a-f0-9]{12,64}$/));
  }
  if (value.operationLink !== undefined) {
    issues.push(...enumIssue(value.operationLink, `${path}.operationLink`, schemaId, ["legacy"]));
  }
  return issues;
}

export function runtimeOperationSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.runtimeOperation;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_operation_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.sessionId, `${path}.sessionId`, schemaId),
    ...nonEmptyStringIssue(value.commandPath, `${path}.commandPath`, schemaId),
    ...stringArrayIssue(value.argv, `${path}.argv`, schemaId),
    ...nonEmptyStringIssue(value.actorId, `${path}.actorId`, schemaId),
    ...stringIssue(value.startedAt, `${path}.startedAt`, schemaId),
    ...stringIssue(value.finishedAt, `${path}.finishedAt`, schemaId),
    ...integerAtLeastIssue(value.exitCode, `${path}.exitCode`, schemaId, 0),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["succeeded", "failed"]),
    ...booleanIssue(value.stateChanged, `${path}.stateChanged`, schemaId),
    ...booleanIssue(value.generatedArtifactsChanged, `${path}.generatedArtifactsChanged`, schemaId),
    ...uniqueStringArrayIssue(value.eventIds, `${path}.eventIds`, schemaId)
  ];

  if (value.errorCode !== undefined) {
    issues.push(...stringIssue(value.errorCode, `${path}.errorCode`, schemaId));
  }
  if (value.errorMessage !== undefined) {
    issues.push(...stringIssue(value.errorMessage, `${path}.errorMessage`, schemaId));
  }

  return issues;
}

export function projectionRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.projectionRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_projection_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.kind, `${path}.kind`, schemaId),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...recordIssue(value.value, `${path}.value`, schemaId)
  ];
}

export function contextPackSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.contextPack;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...patternStringIssue(value.id, `${path}.id`, schemaId, /^bw_projection_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...stringIssue(value.generatedAt, `${path}.generatedAt`, schemaId),
    ...stringIssue(value.title, `${path}.title`, schemaId),
    ...stringIssue(value.summary, `${path}.summary`, schemaId),
    ...stringArrayIssue(value.facts, `${path}.facts`, schemaId),
    ...stringArrayIssue(value.evidence, `${path}.evidence`, schemaId)
  ];
}

export function runtimePolicySchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.runtimePolicy;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...booleanIssue(value.requireEvidenceForVerification, `${path}.requireEvidenceForVerification`, schemaId),
    ...booleanIssue(value.requirePassingVerificationForClose, `${path}.requirePassingVerificationForClose`, schemaId),
    ...booleanIssue(value.preventDependencyCycles, `${path}.preventDependencyCycles`, schemaId),
    ...booleanIssue(value.allowReservationStealing, `${path}.allowReservationStealing`, schemaId),
    ...integerAtLeastIssue(value.maxActiveReservationsPerAgent, `${path}.maxActiveReservationsPerAgent`, schemaId, 1)
  ];
}

export function assertValidRuntimePolicy(policy: RuntimePolicy): void {
  const issues = runtimePolicySchemaIssues(policy);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Runtime policy failed schema validation", { issues });
  }
}

function workspaceInitializedPolicyIssues(value: unknown, path: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value) || value.type !== "workspace.initialized" || !isRecord(value.payload) || value.payload.policy === undefined) {
    return [];
  }
  return runtimePolicySchemaIssues(value.payload.policy, `${path}.payload.policy`);
}

function recordMetaIssues(
  value: unknown,
  path: string,
  schemaId: string,
  idPattern: RegExp
): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...patternStringIssue(value.id, `${path}.id`, schemaId, idPattern),
    ...literalIssue(value.schemaVersion, `${path}.schemaVersion`, schemaId, "boreal.runtime.v1"),
    ...stringIssue(value.createdAt, `${path}.createdAt`, schemaId),
    ...stringIssue(value.updatedAt, `${path}.updatedAt`, schemaId),
    ...actorRefIssues(value.createdBy, `${path}.createdBy`, schemaId),
    ...actorRefIssues(value.updatedBy, `${path}.updatedBy`, schemaId),
    ...sourceRefArrayIssues(value.sourceRefs, `${path}.sourceRefs`, schemaId),
    ...stringArrayIssue(value.tags, `${path}.tags`, schemaId),
    ...(value.contentHash === undefined
      ? []
      : patternStringIssue(value.contentHash, `${path}.contentHash`, schemaId, /^sha256:[a-f0-9]{64}$/))
  ];
}

function actorRefIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...nonEmptyStringIssue(value.id, `${path}.id`, schemaId),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, ["human", "agent", "system"])
  ];
  if (value.displayName !== undefined) {
    issues.push(...stringIssue(value.displayName, `${path}.displayName`, schemaId));
  }
  return issues;
}

function sourceRefArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => sourceRefIssues(entry, `${path}[${index}]`, schemaId));
}

function sourceRefIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [...nonEmptyStringIssue(value.uri, `${path}.uri`, schemaId)];
  if (value.label !== undefined) {
    issues.push(...stringIssue(value.label, `${path}.label`, schemaId));
  }
  if (value.contentHash !== undefined) {
    issues.push(...patternStringIssue(value.contentHash, `${path}.contentHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
  }
  return issues;
}

function arrayItems(
  values: readonly unknown[],
  schemaId: string,
  section: string,
  validate: (value: unknown, path: string) => readonly SchemaValidationIssue[]
): readonly SchemaValidationIssue[] {
  if (!Array.isArray(values)) {
    return [issue(schemaId, section, "must be an array")];
  }
  return values.flatMap((value, index) => validate(value, `${section}[${index}]`));
}

function enumIssue(value: unknown, path: string, schemaId: string, allowed: readonly string[]): readonly SchemaValidationIssue[] {
  return typeof value === "string" && allowed.includes(value)
    ? []
    : [issue(schemaId, path, `must be one of: ${allowed.join(", ")}`)];
}

function literalIssue(value: unknown, path: string, schemaId: string, expected: string): readonly SchemaValidationIssue[] {
  return value === expected ? [] : [issue(schemaId, path, `must be ${expected}`)];
}

function nonEmptyStringIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  return typeof value === "string" && value.length > 0 ? [] : [issue(schemaId, path, "must be a non-empty string")];
}

function stringIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  return typeof value === "string" ? [] : [issue(schemaId, path, "must be a string")];
}

function patternStringIssue(value: unknown, path: string, schemaId: string, pattern: RegExp): readonly SchemaValidationIssue[] {
  return typeof value === "string" && pattern.test(value) ? [] : [issue(schemaId, path, `must match ${pattern.source}`)];
}

function recordIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  return isRecord(value) ? [] : [issue(schemaId, path, "must be an object")];
}

function booleanIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  return typeof value === "boolean" ? [] : [issue(schemaId, path, "must be a boolean")];
}

function integerAtLeastIssue(value: unknown, path: string, schemaId: string, minimum: number): readonly SchemaValidationIssue[] {
  return Number.isInteger(value) && Number(value) >= minimum
    ? []
    : [issue(schemaId, path, `must be an integer >= ${minimum}`)];
}

function stringArrayIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => stringIssue(entry, `${path}[${index}]`, schemaId));
}

function uniqueStringArrayIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  const issues = stringArrayIssue(value, path, schemaId);
  if (!Array.isArray(value)) {
    return issues;
  }
  const uniqueValues = new Set(value);
  return uniqueValues.size === value.length ? issues : [...issues, issue(schemaId, path, "must contain unique values")];
}

function issue(schemaId: string, path: string, message: string): SchemaValidationIssue {
  return { schemaId, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
