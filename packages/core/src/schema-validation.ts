import { dirname, isAbsolute, relative, resolve } from "node:path";

import { BorealError } from "./errors.js";
import type { RuntimePolicy } from "./policies.js";
import { PROJECT_REGISTRY_SCHEMA_ID, PROJECT_REGISTRY_SCHEMA_VERSION } from "./project-registry.js";

export interface SchemaValidationIssue {
  readonly schemaId: string;
  readonly path: string;
  readonly message: string;
}

export type SchemaIssueValidator = (value: unknown, path?: string) => readonly SchemaValidationIssue[];

export interface RuntimeSnapshotSchemaInput {
  readonly workItems?: readonly unknown[];
  readonly agentSummaries?: readonly unknown[];
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
}

export type RuntimeSnapshotSection = keyof RuntimeSnapshotSchemaInput;

export interface PublishedSchemaContract {
  readonly key: string;
  readonly schemaId: string;
  readonly schemaPath: string;
  readonly validator: SchemaIssueValidator;
  readonly runtimeSection?: RuntimeSnapshotSection;
}

export const RUNTIME_SCHEMA_IDS = {
  workItem: "https://boreal.work/schemas/records/work-item.schema.json",
  agentSummaryRecord: "https://boreal.work/schemas/records/agent-summary-record.schema.json",
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

export const RUNTIME_SCHEMA_CONTRACTS = [
  {
    key: "workItem",
    schemaId: RUNTIME_SCHEMA_IDS.workItem,
    schemaPath: "schemas/records/work-item.schema.json",
    runtimeSection: "workItems",
    validator: workItemSchemaIssues
  },
  {
    key: "agentSummaryRecord",
    schemaId: RUNTIME_SCHEMA_IDS.agentSummaryRecord,
    schemaPath: "schemas/records/agent-summary-record.schema.json",
    runtimeSection: "agentSummaries",
    validator: agentSummaryRecordSchemaIssues
  },
  {
    key: "evidenceRecord",
    schemaId: RUNTIME_SCHEMA_IDS.evidenceRecord,
    schemaPath: "schemas/records/evidence-record.schema.json",
    runtimeSection: "evidence",
    validator: evidenceRecordSchemaIssues
  },
  {
    key: "verificationRecord",
    schemaId: RUNTIME_SCHEMA_IDS.verificationRecord,
    schemaPath: "schemas/records/verification-record.schema.json",
    runtimeSection: "verifications",
    validator: verificationRecordSchemaIssues
  },
  {
    key: "knowledgeSource",
    schemaId: RUNTIME_SCHEMA_IDS.knowledgeSource,
    schemaPath: "schemas/records/knowledge-source.schema.json",
    runtimeSection: "knowledgeSources",
    validator: knowledgeSourceSchemaIssues
  },
  {
    key: "claimRecord",
    schemaId: RUNTIME_SCHEMA_IDS.claimRecord,
    schemaPath: "schemas/records/claim-record.schema.json",
    runtimeSection: "claims",
    validator: claimRecordSchemaIssues
  },
  {
    key: "decisionRecord",
    schemaId: RUNTIME_SCHEMA_IDS.decisionRecord,
    schemaPath: "schemas/records/decision-record.schema.json",
    runtimeSection: "decisions",
    validator: decisionRecordSchemaIssues
  },
  {
    key: "graphEdge",
    schemaId: RUNTIME_SCHEMA_IDS.graphEdge,
    schemaPath: "schemas/records/graph-edge.schema.json",
    runtimeSection: "graphEdges",
    validator: graphEdgeSchemaIssues
  },
  {
    key: "agentReservation",
    schemaId: RUNTIME_SCHEMA_IDS.agentReservation,
    schemaPath: "schemas/records/agent-reservation.schema.json",
    runtimeSection: "reservations",
    validator: agentReservationSchemaIssues
  },
  {
    key: "runtimeEvent",
    schemaId: RUNTIME_SCHEMA_IDS.runtimeEvent,
    schemaPath: "schemas/events/runtime-event.schema.json",
    runtimeSection: "events",
    validator: runtimeEventSchemaIssues
  },
  {
    key: "runtimeOperation",
    schemaId: RUNTIME_SCHEMA_IDS.runtimeOperation,
    schemaPath: "schemas/operations/runtime-operation.schema.json",
    runtimeSection: "operations",
    validator: runtimeOperationSchemaIssues
  },
  {
    key: "projectionRecord",
    schemaId: RUNTIME_SCHEMA_IDS.projectionRecord,
    schemaPath: "schemas/projections/projection-record.schema.json",
    runtimeSection: "projections",
    validator: projectionRecordSchemaIssues
  },
  {
    key: "contextPack",
    schemaId: RUNTIME_SCHEMA_IDS.contextPack,
    schemaPath: "schemas/projections/context-pack.schema.json",
    runtimeSection: "contextPacks",
    validator: contextPackSchemaIssues
  },
  {
    key: "runtimePolicy",
    schemaId: RUNTIME_SCHEMA_IDS.runtimePolicy,
    schemaPath: "schemas/policies/runtime-policy.schema.json",
    runtimeSection: undefined,
    validator: runtimePolicySchemaIssues
  }
] as const satisfies readonly PublishedSchemaContract[];

export const PROJECT_SCHEMA_CONTRACTS = [
  {
    key: "projectRegistry",
    schemaId: PROJECT_REGISTRY_SCHEMA_ID,
    schemaPath: "schemas/projects/project-registry.schema.json",
    runtimeSection: undefined,
    validator: projectRegistryDocumentSchemaIssues
  }
] as const satisfies readonly PublishedSchemaContract[];

export const PUBLISHED_SCHEMA_CONTRACTS = [
  ...RUNTIME_SCHEMA_CONTRACTS,
  ...PROJECT_SCHEMA_CONTRACTS
] as const satisfies readonly PublishedSchemaContract[];

export function runtimeSnapshotSchemaIssues(snapshot: RuntimeSnapshotSchemaInput): readonly SchemaValidationIssue[] {
  return [
    ...RUNTIME_SCHEMA_CONTRACTS.flatMap((contract) =>
      contract.runtimeSection === undefined
        ? []
        : arrayItems(
            snapshot[contract.runtimeSection] ?? [],
            contract.schemaId,
            contract.runtimeSection,
            contract.validator
          )
    ),
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
    ...uniqueStringArrayIssue(value.verificationIds, `${path}.verificationIds`, schemaId),
    ...optionalRequiredCloseoutGateArrayIssues(value.requiredCloseoutGates, `${path}.requiredCloseoutGates`, schemaId)
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

export function agentSummaryRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.agentSummaryRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_summary_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...enumIssue(value.subjectType, `${path}.subjectType`, schemaId, ["work", "sprint", "milestone", "phase", "project", "session"]),
    ...enumIssue(value.summaryKind, `${path}.summaryKind`, schemaId, [
      "task",
      "sprint",
      "milestone",
      "phase",
      "project",
      "session",
      "legacy_backfill"
    ]),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["draft", "final", "forced"]),
    ...enumIssue(value.outcome, `${path}.outcome`, schemaId, [
      "completed",
      "partial",
      "deferred",
      "duplicate",
      "cancelled",
      "blocked",
      "no_change"
    ]),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...nonEmptyStringIssue(value.body, `${path}.body`, schemaId),
    ...agentSummaryCompletedWorkArrayIssues(value.completedWork, `${path}.completedWork`, schemaId),
    ...uniqueStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId),
    ...uniqueStringArrayIssue(value.verificationIds, `${path}.verificationIds`, schemaId),
    ...uniquePatternStringArrayIssue(value.commitShas, `${path}.commitShas`, schemaId, /^[a-f0-9]{7,64}$/),
    ...stringArrayIssue(value.dirtyPathNotes, `${path}.dirtyPathNotes`, schemaId),
    ...uniquePatternStringArrayIssue(value.childSummaryIds, `${path}.childSummaryIds`, schemaId, /^bw_summary_[a-f0-9]{12,64}$/),
    ...stringIssue(value.generatedAt, `${path}.generatedAt`, schemaId)
  ];

  if (value.parentSummaryId !== undefined) {
    issues.push(...patternStringIssue(value.parentSummaryId, `${path}.parentSummaryId`, schemaId, /^bw_summary_[a-f0-9]{12,64}$/));
  }
  if (value.artifactUri !== undefined) {
    issues.push(...stringIssue(value.artifactUri, `${path}.artifactUri`, schemaId));
  }
  if (value.duplicateOf !== undefined) {
    issues.push(...stringIssue(value.duplicateOf, `${path}.duplicateOf`, schemaId));
  }
  if (value.forceReasonCode !== undefined) {
    issues.push(
      ...enumIssue(value.forceReasonCode, `${path}.forceReasonCode`, schemaId, [
        "duplicate",
        "cancelled_no_work",
        "external_close",
        "legacy_backfill",
        "summary_unavailable",
        "operator_override"
      ])
    );
  }
  if (value.forceComment !== undefined) {
    issues.push(...stringIssue(value.forceComment, `${path}.forceComment`, schemaId));
  }

  if (value.status === "forced") {
    if (value.forceReasonCode === undefined) {
      issues.push(issue(schemaId, `${path}.forceReasonCode`, "is required when status is forced"));
    }
    if (typeof value.forceComment !== "string" || value.forceComment.trim().length === 0) {
      issues.push(issue(schemaId, `${path}.forceComment`, "must be a non-empty string when status is forced"));
    }
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
    ...uniqueStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId),
    ...(value.wikiPageIds === undefined ? [] : uniqueStringArrayIssue(value.wikiPageIds, `${path}.wikiPageIds`, schemaId))
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
    ...uniqueStringArrayIssue(value.sourceIds, `${path}.sourceIds`, schemaId),
    ...(value.wikiPageIds === undefined ? [] : uniqueStringArrayIssue(value.wikiPageIds, `${path}.wikiPageIds`, schemaId))
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
    ...(value.requireAgentSummaryForClose === undefined
      ? []
      : booleanIssue(value.requireAgentSummaryForClose, `${path}.requireAgentSummaryForClose`, schemaId)),
    ...booleanIssue(value.preventDependencyCycles, `${path}.preventDependencyCycles`, schemaId),
    ...booleanIssue(value.allowReservationStealing, `${path}.allowReservationStealing`, schemaId),
    ...integerAtLeastIssue(value.maxActiveReservationsPerAgent, `${path}.maxActiveReservationsPerAgent`, schemaId, 1)
  ];
}

export function projectRegistryDocumentSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = PROJECT_REGISTRY_SCHEMA_ID;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...literalIssue(value.schemaVersion, `${path}.schemaVersion`, schemaId, PROJECT_REGISTRY_SCHEMA_VERSION),
    ...projectRegistryStorageIssues(value.storage, `${path}.storage`, schemaId),
    ...projectRegistryEntryArrayIssues(value.entries, `${path}.entries`, schemaId),
    ...(value.updatedAt === undefined ? [] : stringIssue(value.updatedAt, `${path}.updatedAt`, schemaId))
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

function projectRegistryStorageIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...literalIssue(value.scope, `${path}.scope`, schemaId, "machine-local"),
    ...absolutePathIssue(value.rootDir, `${path}.rootDir`, schemaId),
    ...absolutePathIssue(value.registryDir, `${path}.registryDir`, schemaId),
    ...absolutePathIssue(value.registryFile, `${path}.registryFile`, schemaId),
    ...absolutePathIssue(value.lockDir, `${path}.lockDir`, schemaId),
    ...pathInsideIssue(value.rootDir, value.registryDir, `${path}.registryDir`, schemaId, "must be inside storage rootDir"),
    ...pathInsideIssue(value.registryDir, value.registryFile, `${path}.registryFile`, schemaId, "must be inside registryDir"),
    ...pathInsideIssue(value.registryDir, value.lockDir, `${path}.lockDir`, schemaId, "must be inside registryDir")
  ];
}

function projectRegistryEntryArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  const seen = new Set<string>();
  return value.flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const entryIssues = projectRegistryEntryIssues(entry, entryPath, schemaId);
    if (isRecord(entry) && typeof entry.id === "string") {
      if (seen.has(entry.id)) {
        return [...entryIssues, issue(schemaId, `${entryPath}.id`, "must be unique")];
      }
      seen.add(entry.id);
    }
    return entryIssues;
  });
}

function projectRegistryEntryIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...nonEmptyStringIssue(value.id, `${path}.id`, schemaId),
    ...projectRegistryDisplayIssues(value.display, `${path}.display`, schemaId),
    ...absolutePathIssue(value.projectRoot, `${path}.projectRoot`, schemaId),
    ...absolutePathIssue(value.borealDir, `${path}.borealDir`, schemaId),
    ...absolutePathIssue(value.runtimeDir, `${path}.runtimeDir`, schemaId),
    ...absolutePathIssue(value.runtimeStateFile, `${path}.runtimeStateFile`, schemaId),
    ...absolutePathIssue(value.projectConfigPath, `${path}.projectConfigPath`, schemaId),
    ...absolutePathIssue(value.memoryRoot, `${path}.memoryRoot`, schemaId),
    ...absolutePathIssue(value.memoryBorealDir, `${path}.memoryBorealDir`, schemaId),
    ...absolutePathIssue(value.installRoot, `${path}.installRoot`, schemaId),
    ...(value.skillInstallRoots === undefined
      ? []
      : projectRegistrySkillInstallRootsIssues(value.skillInstallRoots, `${path}.skillInstallRoots`, schemaId)),
    ...enumIssue(value.memoryLayout, `${path}.memoryLayout`, schemaId, ["in-repo", "child", "sibling"]),
    ...enumIssue(value.memoryGitMode, `${path}.memoryGitMode`, schemaId, ["shared", "separate", "submodule"]),
    ...projectRegistrySkillTargetsIssues(value.skillTargets, `${path}.skillTargets`, schemaId),
    ...booleanIssue(value.folderScoped, `${path}.folderScoped`, schemaId),
    ...enumIssue(value.source, `${path}.source`, schemaId, ["explicit", "project-setup", "imported"]),
    ...stringIssue(value.addedAt, `${path}.addedAt`, schemaId),
    ...stringIssue(value.updatedAt, `${path}.updatedAt`, schemaId),
    ...(value.lastSeenAt === undefined ? [] : stringIssue(value.lastSeenAt, `${path}.lastSeenAt`, schemaId)),
    ...(value.memoryRemote === undefined ? [] : stringIssue(value.memoryRemote, `${path}.memoryRemote`, schemaId)),
    ...pathInsideIssue(value.projectRoot, value.borealDir, `${path}.borealDir`, schemaId, "must be inside projectRoot"),
    ...pathInsideIssue(value.borealDir, value.runtimeDir, `${path}.runtimeDir`, schemaId, "must be inside borealDir"),
    ...pathInsideIssue(value.runtimeDir, value.runtimeStateFile, `${path}.runtimeStateFile`, schemaId, "must be inside runtimeDir"),
    ...pathInsideIssue(value.borealDir, value.projectConfigPath, `${path}.projectConfigPath`, schemaId, "must be inside borealDir"),
    ...pathInsideIssue(value.memoryRoot, value.memoryBorealDir, `${path}.memoryBorealDir`, schemaId, "must be inside memoryRoot"),
    ...memoryLayoutBoundaryIssues(value, path, schemaId),
    ...installRootBoundaryIssues(value, path, schemaId),
    ...(value.skillInstallRoots === undefined ? [] : skillInstallRootBoundaryIssues(value, path, schemaId))
  ];
}

function projectRegistrySkillInstallRootsIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  const seen = new Set<string>();
  return value.flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      return [issue(schemaId, entryPath, "must be an object")];
    }
    const duplicateIssues =
      typeof entry.target === "string" && seen.has(entry.target)
        ? [issue(schemaId, `${entryPath}.target`, "must be unique")]
        : [];
    if (typeof entry.target === "string") {
      seen.add(entry.target);
    }
    return [
      ...enumIssue(entry.target, `${entryPath}.target`, schemaId, ["codex", "claude"]),
      ...duplicateIssues,
      ...absolutePathIssue(entry.installRoot, `${entryPath}.installRoot`, schemaId),
      ...absolutePathIssue(entry.skillRoot, `${entryPath}.skillRoot`, schemaId),
      ...pathInsideIssue(entry.installRoot, entry.skillRoot, `${entryPath}.skillRoot`, schemaId, "must be inside installRoot")
    ];
  });
}

function projectRegistryDisplayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues = [
    ...nonEmptyStringIssue(value.name, `${path}.name`, schemaId),
    ...uniqueStringArrayIssue(value.labels, `${path}.labels`, schemaId)
  ];
  if (value.description !== undefined) {
    return [...issues, ...stringIssue(value.description, `${path}.description`, schemaId)];
  }
  return issues;
}

function projectRegistrySkillTargetsIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  const issues = value.flatMap((entry, index) => enumIssue(entry, `${path}[${index}]`, schemaId, ["codex", "claude"]));
  const uniqueValues = new Set(value);
  return uniqueValues.size === value.length ? issues : [...issues, issue(schemaId, path, "must contain unique values")];
}

function memoryLayoutBoundaryIssues(value: Record<string, unknown>, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (typeof value.projectRoot !== "string" || typeof value.memoryRoot !== "string" || typeof value.memoryLayout !== "string") {
    return [];
  }
  if (value.memoryLayout === "sibling") {
    return dirname(resolve(value.memoryRoot)) === dirname(resolve(value.projectRoot))
      ? []
      : [issue(schemaId, `${path}.memoryRoot`, "sibling memoryRoot must share the projectRoot parent directory")];
  }
  return pathInsideIssue(value.projectRoot, value.memoryRoot, `${path}.memoryRoot`, schemaId, "must be inside projectRoot");
}

function installRootBoundaryIssues(value: Record<string, unknown>, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (typeof value.installRoot !== "string" || typeof value.memoryRoot !== "string") {
    return [];
  }
  const relation = relative(resolve(value.memoryRoot), resolve(value.installRoot));
  const insideMemory = relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
  return insideMemory
    ? [issue(schemaId, `${path}.installRoot`, "must not be inside memoryRoot")]
    : [];
}

function skillInstallRootBoundaryIssues(value: Record<string, unknown>, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (typeof value.memoryRoot !== "string" || !Array.isArray(value.skillInstallRoots)) {
    return [];
  }
  const memoryRoot = value.memoryRoot;
  return value.skillInstallRoots.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.installRoot !== "string" || typeof entry.skillRoot !== "string") {
      return [];
    }
    const installRelation = relative(resolve(memoryRoot), resolve(entry.installRoot));
    const skillRelation = relative(resolve(memoryRoot), resolve(entry.skillRoot));
    const installInsideMemory = installRelation === "" || (!installRelation.startsWith("..") && !isAbsolute(installRelation));
    const skillInsideMemory = skillRelation === "" || (!skillRelation.startsWith("..") && !isAbsolute(skillRelation));
    return [
      ...(installInsideMemory ? [issue(schemaId, `${path}.skillInstallRoots[${index}].installRoot`, "must not be inside memoryRoot")] : []),
      ...(skillInsideMemory ? [issue(schemaId, `${path}.skillInstallRoots[${index}].skillRoot`, "must not be inside memoryRoot")] : [])
    ];
  });
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

function agentSummaryCompletedWorkArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => agentSummaryCompletedWorkIssues(entry, `${path}[${index}]`, schemaId));
}

function agentSummaryCompletedWorkIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...enumIssue(value.outcome, `${path}.outcome`, schemaId, [
      "completed",
      "partial",
      "deferred",
      "duplicate",
      "cancelled",
      "blocked",
      "no_change"
    ]),
    ...stringIssue(value.notes, `${path}.notes`, schemaId)
  ];
  if (value.workId !== undefined) {
    issues.push(...patternStringIssue(value.workId, `${path}.workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/));
  }
  return issues;
}

function optionalRequiredCloseoutGateArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => requiredCloseoutGateIssues(entry, `${path}[${index}]`, schemaId));
}

function requiredCloseoutGateIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...patternStringIssue(value.id, `${path}.id`, schemaId, /^bw_gate_[a-f0-9]{12,64}$/),
    ...enumIssue(value.subjectType, `${path}.subjectType`, schemaId, ["work", "sprint", "phase", "milestone", "project"]),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, ["verification", "checkpoint", "review", "audit"]),
    ...enumIssue(value.scope, `${path}.scope`, schemaId, ["self", "direct_children", "descendants"]),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["open", "satisfied", "forced"]),
    ...enumArrayIssue(value.requiredEvidenceKinds, `${path}.requiredEvidenceKinds`, schemaId, [
      "command",
      "test",
      "diff",
      "review",
      "artifact",
      "note"
    ]),
    ...literalIssue(value.requiredOutcome, `${path}.requiredOutcome`, schemaId, "passed"),
    ...integerAtLeastIssue(value.minEvidenceCount, `${path}.minEvidenceCount`, schemaId, 0),
    ...stringIssue(value.createdAt, `${path}.createdAt`, schemaId),
    ...actorRefIssues(value.createdBy, `${path}.createdBy`, schemaId)
  ];
  if (value.satisfiedBy !== undefined) {
    issues.push(...requiredCloseoutGateSatisfactionIssues(value.satisfiedBy, `${path}.satisfiedBy`, schemaId));
  }
  if (value.force !== undefined) {
    issues.push(...requiredCloseoutGateForceIssues(value.force, `${path}.force`, schemaId));
  }
  if (value.status === "forced" && value.force === undefined) {
    issues.push(issue(schemaId, `${path}.force`, "is required when status is forced"));
  }
  return issues;
}

function requiredCloseoutGateSatisfactionIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [];
  for (const field of ["evidenceIds", "verificationIds", "agentSummaryIds", "commitShas", "dirtyPathNotes"] as const) {
    if (value[field] !== undefined) {
      issues.push(...uniqueStringArrayIssue(value[field], `${path}.${field}`, schemaId));
    }
  }
  return issues;
}

function requiredCloseoutGateForceIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...enumIssue(value.reason, `${path}.reason`, schemaId, [
      "review_unavailable",
      "audit_unavailable",
      "external_review_record",
      "legacy_backfill",
      "user_accepted_risk",
      "emergency_closeout"
    ]),
    ...nonEmptyStringIssue(value.comment, `${path}.comment`, schemaId),
    ...actorRefIssues(value.actor, `${path}.actor`, schemaId),
    ...stringIssue(value.forcedAt, `${path}.forcedAt`, schemaId)
  ];
  if (value.evidenceIds !== undefined) {
    issues.push(...uniqueStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId));
  }
  return issues;
}

function arrayItems(
  values: readonly unknown[],
  schemaId: string,
  section: string,
  validate: SchemaIssueValidator
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

function absolutePathIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  return typeof value === "string" && isAbsolute(value) ? [] : [issue(schemaId, path, "must be an absolute path")];
}

function pathInsideIssue(
  parent: unknown,
  child: unknown,
  path: string,
  schemaId: string,
  message: string
): readonly SchemaValidationIssue[] {
  if (typeof parent !== "string" || typeof child !== "string" || !isAbsolute(parent) || !isAbsolute(child)) {
    return [];
  }
  const relation = relative(resolve(parent), resolve(child));
  const inside = relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
  return inside ? [] : [issue(schemaId, path, message)];
}

function patternStringIssue(value: unknown, path: string, schemaId: string, pattern: RegExp): readonly SchemaValidationIssue[] {
  return typeof value === "string" && pattern.test(value) ? [] : [issue(schemaId, path, `must match ${pattern.source}`)];
}

function uniquePatternStringArrayIssue(value: unknown, path: string, schemaId: string, pattern: RegExp): readonly SchemaValidationIssue[] {
  const arrayIssues = uniqueStringArrayIssue(value, path, schemaId);
  if (!Array.isArray(value)) {
    return arrayIssues;
  }
  return [
    ...arrayIssues,
    ...value.flatMap((entry, index) => patternStringIssue(entry, `${path}[${index}]`, schemaId, pattern))
  ];
}

function enumArrayIssue(value: unknown, path: string, schemaId: string, allowed: readonly string[]): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => enumIssue(entry, `${path}[${index}]`, schemaId, allowed));
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
