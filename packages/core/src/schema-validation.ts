import { dirname, isAbsolute, relative, resolve } from "node:path";

import { agentDirectiveBundleIssues } from "./agent-directives.js";
import { ENFORCEMENT_GAP_CODES } from "./enforcement-gaps.js";
import { BorealError } from "./errors.js";
import type { RuntimePolicy } from "./policies.js";
import {
  PROJECT_ROLLUP_SCHEMA_ID,
  PROJECT_ROLLUP_SCHEMA_VERSION,
  WORK_KINDS,
  WORK_STATUSES
} from "./project-rollup.js";
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
  readonly directiveAcknowledgements?: readonly unknown[];
  readonly knowledgeSources?: readonly unknown[];
  readonly claims?: readonly unknown[];
  readonly decisions?: readonly unknown[];
  readonly graphEdges?: readonly unknown[];
  readonly reservations?: readonly unknown[];
  readonly reviewerHeartbeats?: readonly unknown[];
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
  directiveAcknowledgementRecord: "https://boreal.work/schemas/records/directive-acknowledgement-record.schema.json",
  knowledgeSource: "https://boreal.work/schemas/records/knowledge-source.schema.json",
  claimRecord: "https://boreal.work/schemas/records/claim-record.schema.json",
  decisionRecord: "https://boreal.work/schemas/records/decision-record.schema.json",
  agentReservation: "https://boreal.work/schemas/records/agent-reservation.schema.json",
  reviewerHeartbeat: "https://boreal.work/schemas/records/reviewer-heartbeat.schema.json",
  runtimeEvent: "https://boreal.work/schemas/events/runtime-event.schema.json",
  runtimeOperation: "https://boreal.work/schemas/operations/runtime-operation.schema.json",
  projectionRecord: "https://boreal.work/schemas/projections/projection-record.schema.json",
  contextPack: "https://boreal.work/schemas/projections/context-pack.schema.json",
  projectRollup: PROJECT_ROLLUP_SCHEMA_ID,
  enforcementGap: "https://boreal.work/schemas/enforcement/enforcement-gap.schema.json",
  runtimePolicy: "https://boreal.work/schemas/policies/runtime-policy.schema.json"
} as const;

const AGENT_DIRECTIVE_LINK_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

export const AGENT_DIRECTIVE_SCHEMA_IDS = {
  agentDirectiveBundle: "https://boreal.work/schemas/directives/agent-directive-bundle.schema.json"
} as const;

export const TEMPLATE_SCHEMA_IDS = {
  workStructureTemplate: "https://boreal.work/schemas/work-structure-template.schema.json"
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
    key: "directiveAcknowledgementRecord",
    schemaId: RUNTIME_SCHEMA_IDS.directiveAcknowledgementRecord,
    schemaPath: "schemas/records/directive-acknowledgement-record.schema.json",
    runtimeSection: "directiveAcknowledgements",
    validator: directiveAcknowledgementRecordSchemaIssues
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
    key: "reviewerHeartbeat",
    schemaId: RUNTIME_SCHEMA_IDS.reviewerHeartbeat,
    schemaPath: "schemas/records/reviewer-heartbeat.schema.json",
    runtimeSection: "reviewerHeartbeats",
    validator: reviewerHeartbeatSchemaIssues
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
    key: "projectRollup",
    schemaId: RUNTIME_SCHEMA_IDS.projectRollup,
    schemaPath: "schemas/projections/project-rollup.schema.json",
    runtimeSection: undefined,
    validator: projectRollupSchemaIssues
  },
  {
    key: "enforcementGap",
    schemaId: RUNTIME_SCHEMA_IDS.enforcementGap,
    schemaPath: "schemas/enforcement/enforcement-gap.schema.json",
    runtimeSection: undefined,
    validator: enforcementGapSchemaIssues
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

export const AGENT_DIRECTIVE_SCHEMA_CONTRACTS = [
  {
    key: "agentDirectiveBundle",
    schemaId: AGENT_DIRECTIVE_SCHEMA_IDS.agentDirectiveBundle,
    schemaPath: "schemas/directives/agent-directive-bundle.schema.json",
    runtimeSection: undefined,
    validator: agentDirectiveBundleSchemaIssues
  }
] as const satisfies readonly PublishedSchemaContract[];

export const TEMPLATE_SCHEMA_CONTRACTS = [
  {
    key: "workStructureTemplate",
    schemaId: TEMPLATE_SCHEMA_IDS.workStructureTemplate,
    schemaPath: "schemas/work-structure-template.schema.json",
    runtimeSection: undefined,
    validator: workStructureTemplateSchemaIssues
  }
] as const satisfies readonly PublishedSchemaContract[];

export const PUBLISHED_SCHEMA_CONTRACTS = [
  ...RUNTIME_SCHEMA_CONTRACTS,
  ...AGENT_DIRECTIVE_SCHEMA_CONTRACTS,
  ...PROJECT_SCHEMA_CONTRACTS,
  ...TEMPLATE_SCHEMA_CONTRACTS
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
  if (value.binding !== undefined) {
    issues.push(...workBindingIssues(value.binding, `${path}.binding`, schemaId));
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
  if (value.git !== undefined) {
    if (!isRecord(value.git)) {
      issues.push(issue(schemaId, `${path}.git`, "must be an object"));
    } else {
      issues.push(
        ...nonEmptyStringIssue(value.git.branch, `${path}.git.branch`, schemaId),
        ...patternStringIssue(value.git.headSha, `${path}.git.headSha`, schemaId, /^[a-f0-9]{40,64}$/)
      );
    }
  }

  return issues;
}

function workBindingIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [];
  const fields = ["workflowRef", "outputContract", "command", "templateNodeKey", "templateId", "templateVersion", "templateRunId"] as const;
  for (const field of fields) {
    if (value[field] !== undefined) {
      issues.push(...nonEmptyStringIssue(value[field], `${path}.${field}`, schemaId));
    }
  }
  return issues;
}

export function workStructureTemplateSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = TEMPLATE_SCHEMA_IDS.workStructureTemplate;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...literalIssue(value.schemaVersion, `${path}.schemaVersion`, schemaId, "boreal.work-template.v1"),
    ...nonEmptyStringIssue(value.id, `${path}.id`, schemaId),
    ...(typeof value.version === "string" || typeof value.version === "number"
      ? []
      : [issue(schemaId, `${path}.version`, "must be a string or number")]),
    ...templateVariableArrayIssues(value.variables, `${path}.variables`, schemaId),
    ...templateNodeArrayIssues(value.nodes, `${path}.nodes`, schemaId)
  ];
  if (value.edges !== undefined) {
    issues.push(...templateEdgeArrayIssues(value.edges, `${path}.edges`, schemaId));
  }
  if (value.title !== undefined) {
    issues.push(...stringIssue(value.title, `${path}.title`, schemaId));
  }
  if (value.description !== undefined) {
    issues.push(...stringIssue(value.description, `${path}.description`, schemaId));
  }
  return issues;
}

function templateVariableArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      return [issue(schemaId, entryPath, "must be an object")];
    }
    const issues: SchemaValidationIssue[] = [
      ...patternStringIssue(entry.name, `${entryPath}.name`, schemaId, /^[A-Za-z][A-Za-z0-9_]*$/u)
    ];
    if (entry.description !== undefined) {
      issues.push(...stringIssue(entry.description, `${entryPath}.description`, schemaId));
    }
    if (entry.default !== undefined && !["string", "number", "boolean"].includes(typeof entry.default)) {
      issues.push(issue(schemaId, `${entryPath}.default`, "must be a string, number, or boolean"));
    }
    if (entry.required !== undefined) {
      issues.push(...booleanIssue(entry.required, `${entryPath}.required`, schemaId));
    }
    return issues;
  });
}

function templateNodeArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  if (value.length === 0) {
    return [issue(schemaId, path, "must contain at least one node")];
  }
  return value.flatMap((entry, index) => templateNodeIssues(entry, `${path}[${index}]`, schemaId));
}

function templateNodeIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...nonEmptyStringIssue(value.key, `${path}.key`, schemaId),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, ["issue", "task", "sprint", "milestone"]),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId)
  ];
  if (value.description !== undefined) {
    issues.push(...stringIssue(value.description, `${path}.description`, schemaId));
  }
  if (value.priority !== undefined) {
    issues.push(...enumIssue(value.priority, `${path}.priority`, schemaId, ["low", "normal", "high", "critical"]));
  }
  if (value.labels !== undefined) {
    issues.push(...stringArrayIssue(value.labels, `${path}.labels`, schemaId));
  }
  if (value.acceptance !== undefined) {
    issues.push(...stringArrayIssue(value.acceptance, `${path}.acceptance`, schemaId));
  }
  if (value.gates !== undefined) {
    issues.push(...templateGateArrayIssues(value.gates, `${path}.gates`, schemaId));
  }
  if (value.binding !== undefined) {
    issues.push(...templateBindingIssues(value.binding, `${path}.binding`, schemaId));
  }
  if (value.children !== undefined) {
    issues.push(...templateNodeArrayIssues(value.children, `${path}.children`, schemaId));
  }
  return issues;
}

function templateGateArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      return [issue(schemaId, entryPath, "must be an object")];
    }
    const issues: SchemaValidationIssue[] = [
      ...enumIssue(entry.kind, `${entryPath}.kind`, schemaId, ["verification", "checkpoint", "review", "audit"])
    ];
    if (entry.scope !== undefined) {
      issues.push(...enumIssue(entry.scope, `${entryPath}.scope`, schemaId, ["self", "direct_children", "descendants"]));
    }
    if (entry.requiredEvidenceKinds !== undefined) {
      issues.push(...enumArrayIssue(entry.requiredEvidenceKinds, `${entryPath}.requiredEvidenceKinds`, schemaId, ["command", "test", "diff", "review", "artifact", "note"]));
    }
    if (entry.minEvidenceCount !== undefined) {
      issues.push(...integerAtLeastIssue(entry.minEvidenceCount, `${entryPath}.minEvidenceCount`, schemaId, 0));
    }
    if (entry.declaredCommand !== undefined) {
      issues.push(...nonEmptyStringIssue(entry.declaredCommand, `${entryPath}.declaredCommand`, schemaId));
    }
    if (entry.expectedObservable !== undefined) {
      issues.push(...nonEmptyStringIssue(entry.expectedObservable, `${entryPath}.expectedObservable`, schemaId));
    }
    return issues;
  });
}

function templateBindingIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const keys = ["workflow", "workflowRef", "contract", "outputContract", "command"] as const;
  const present = keys.filter((key) => value[key] !== undefined);
  const issues: SchemaValidationIssue[] = present.length === 1 ? [] : [issue(schemaId, path, "must set exactly one binding target")];
  for (const key of present) {
    issues.push(...nonEmptyStringIssue(value[key], `${path}.${key}`, schemaId));
  }
  return issues;
}

function templateEdgeArrayIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      return [issue(schemaId, entryPath, "must be an object")];
    }
    return [
      ...nonEmptyStringIssue(entry.dependent, `${entryPath}.dependent`, schemaId),
      ...nonEmptyStringIssue(entry.dependency, `${entryPath}.dependency`, schemaId)
    ];
  });
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

export function reviewerHeartbeatSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.reviewerHeartbeat;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_heartbeat_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.name, `${path}.name`, schemaId),
    ...nonEmptyStringIssue(value.reviewerId, `${path}.reviewerId`, schemaId),
    ...stringIssue(value.advancedAt, `${path}.advancedAt`, schemaId)
  ];
  if (value.containerId !== undefined) {
    issues.push(...patternStringIssue(value.containerId, `${path}.containerId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/));
  }
  if (value.lastClosedAt !== undefined) {
    issues.push(...stringIssue(value.lastClosedAt, `${path}.lastClosedAt`, schemaId));
  }
  if (value.lastEventId !== undefined) {
    issues.push(...patternStringIssue(value.lastEventId, `${path}.lastEventId`, schemaId, /^bw_event_[a-f0-9]{12,64}$/));
  }
  if (value.lastWorkId !== undefined) {
    issues.push(...patternStringIssue(value.lastWorkId, `${path}.lastWorkId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/));
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
  if (value.attestation !== undefined) {
    issues.push(...evidenceAttestationIssues(value.attestation, `${path}.attestation`, schemaId));
  }

  return issues;
}

function evidenceAttestationIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) return [issue(schemaId, path, "must be an object")];
  const issues: SchemaValidationIssue[] = [
    ...literalIssue(value.schemaVersion, `${path}.schemaVersion`, schemaId, "boreal.evidence-attestation.v1"),
    ...enumIssue(value.trustLevel, `${path}.trustLevel`, schemaId, [
      "legacy_unattested",
      "self_reported",
      "boreal_witnessed",
      "external_attested"
    ]),
    ...actorRefIssues(value.producer, `${path}.producer`, schemaId),
    ...stringIssue(value.recordedAt, `${path}.recordedAt`, schemaId)
  ];
  if (isRecord(value.producer)) {
    if (value.producer.system !== undefined) issues.push(...stringIssue(value.producer.system, `${path}.producer.system`, schemaId));
    if (value.producer.version !== undefined) issues.push(...stringIssue(value.producer.version, `${path}.producer.version`, schemaId));
  }
  if (value.witness !== undefined) {
    if (!isRecord(value.witness)) {
      issues.push(issue(schemaId, `${path}.witness`, "must be an object"));
    } else {
      issues.push(
        ...enumIssue(value.witness.kind, `${path}.witness.kind`, schemaId, ["boreal", "external_ci", "human"]),
        ...nonEmptyStringIssue(value.witness.id, `${path}.witness.id`, schemaId)
      );
      if (value.witness.issuer !== undefined) issues.push(...stringIssue(value.witness.issuer, `${path}.witness.issuer`, schemaId));
    }
  }
  if (value.witnessedAt !== undefined) issues.push(...stringIssue(value.witnessedAt, `${path}.witnessedAt`, schemaId));
  if (value.subjectRevision !== undefined) {
    if (!isRecord(value.subjectRevision)) {
      issues.push(issue(schemaId, `${path}.subjectRevision`, "must be an object"));
    } else {
      issues.push(...patternStringIssue(value.subjectRevision.contentHash, `${path}.subjectRevision.contentHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
      if (value.subjectRevision.updatedAt !== undefined) issues.push(...stringIssue(value.subjectRevision.updatedAt, `${path}.subjectRevision.updatedAt`, schemaId));
    }
  }
  if (value.environment !== undefined) {
    if (!isRecord(value.environment)) {
      issues.push(issue(schemaId, `${path}.environment`, "must be an object"));
    } else {
      issues.push(
        ...nonEmptyStringIssue(value.environment.platform, `${path}.environment.platform`, schemaId),
        ...nonEmptyStringIssue(value.environment.arch, `${path}.environment.arch`, schemaId)
      );
      if (value.environment.nodeVersion !== undefined) issues.push(...stringIssue(value.environment.nodeVersion, `${path}.environment.nodeVersion`, schemaId));
      if (value.environment.cwdHash !== undefined) issues.push(...patternStringIssue(value.environment.cwdHash, `${path}.environment.cwdHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
    }
  }
  if (value.command !== undefined) {
    if (!isRecord(value.command)) {
      issues.push(issue(schemaId, `${path}.command`, "must be an object"));
    } else {
      issues.push(...patternStringIssue(value.command.commandHash, `${path}.command.commandHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
      if (value.command.startedAt !== undefined) issues.push(...stringIssue(value.command.startedAt, `${path}.command.startedAt`, schemaId));
      if (value.command.completedAt !== undefined) issues.push(...stringIssue(value.command.completedAt, `${path}.command.completedAt`, schemaId));
      if (value.command.durationMs !== undefined) issues.push(...integerAtLeastIssue(value.command.durationMs, `${path}.command.durationMs`, schemaId, 0));
      if (value.command.exitCode !== undefined) issues.push(...integerAtLeastIssue(value.command.exitCode, `${path}.command.exitCode`, schemaId, 0));
      if (value.command.signal !== undefined) issues.push(...stringIssue(value.command.signal, `${path}.command.signal`, schemaId));
      if (value.command.timedOut !== undefined) issues.push(...booleanIssue(value.command.timedOut, `${path}.command.timedOut`, schemaId));
      if (value.command.cancelled !== undefined) issues.push(...booleanIssue(value.command.cancelled, `${path}.command.cancelled`, schemaId));
      if (value.command.expectedObservableMatched !== undefined) issues.push(...booleanIssue(value.command.expectedObservableMatched, `${path}.command.expectedObservableMatched`, schemaId));
    }
  }
  if (value.output !== undefined) {
    if (!isRecord(value.output)) {
      issues.push(issue(schemaId, `${path}.output`, "must be an object"));
    } else {
      issues.push(
        ...integerAtLeastIssue(value.output.stdoutBytes, `${path}.output.stdoutBytes`, schemaId, 0),
        ...integerAtLeastIssue(value.output.stderrBytes, `${path}.output.stderrBytes`, schemaId, 0)
      );
      if (value.output.stdoutHash !== undefined) issues.push(...patternStringIssue(value.output.stdoutHash, `${path}.output.stdoutHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
      if (value.output.stderrHash !== undefined) issues.push(...patternStringIssue(value.output.stderrHash, `${path}.output.stderrHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
      if (value.output.truncated !== undefined) issues.push(...booleanIssue(value.output.truncated, `${path}.output.truncated`, schemaId));
      if (value.output.stdoutExcerpt !== undefined) issues.push(...stringIssue(value.output.stdoutExcerpt, `${path}.output.stdoutExcerpt`, schemaId));
      if (value.output.stderrExcerpt !== undefined) issues.push(...stringIssue(value.output.stderrExcerpt, `${path}.output.stderrExcerpt`, schemaId));
    }
  }
  if (value.git !== undefined) {
    if (!isRecord(value.git)) {
      issues.push(issue(schemaId, `${path}.git`, "must be an object"));
    } else {
      issues.push(
        ...stringIssue(value.git.branch, `${path}.git.branch`, schemaId),
        ...patternStringIssue(value.git.headSha, `${path}.git.headSha`, schemaId, /^[a-f0-9]{40,64}$/),
        ...booleanIssue(value.git.dirty, `${path}.git.dirty`, schemaId),
        ...patternStringIssue(value.git.dirtyFingerprint, `${path}.git.dirtyFingerprint`, schemaId, /^sha256:[a-f0-9]{64}$/),
        ...integerAtLeastIssue(value.git.dirtyFileCount, `${path}.git.dirtyFileCount`, schemaId, 0)
      );
    }
  }
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) {
      issues.push(issue(schemaId, `${path}.tools`, "must be an array"));
    } else {
      value.tools.forEach((tool, index) => {
        if (!isRecord(tool)) {
          issues.push(issue(schemaId, `${path}.tools[${index}]`, "must be an object"));
        } else {
          issues.push(
            ...nonEmptyStringIssue(tool.name, `${path}.tools[${index}].name`, schemaId),
            ...nonEmptyStringIssue(tool.version, `${path}.tools[${index}].version`, schemaId)
          );
        }
      });
    }
  }
  if (value.artifacts !== undefined) {
    if (!Array.isArray(value.artifacts)) {
      issues.push(issue(schemaId, `${path}.artifacts`, "must be an array"));
    } else {
      value.artifacts.forEach((artifact, index) => {
        if (!isRecord(artifact)) {
          issues.push(issue(schemaId, `${path}.artifacts[${index}]`, "must be an object"));
        } else {
          issues.push(
            ...nonEmptyStringIssue(artifact.path, `${path}.artifacts[${index}].path`, schemaId),
            ...patternStringIssue(artifact.contentHash, `${path}.artifacts[${index}].contentHash`, schemaId, /^sha256:[a-f0-9]{64}$/),
            ...integerAtLeastIssue(artifact.bytes, `${path}.artifacts[${index}].bytes`, schemaId, 0)
          );
        }
      });
    }
  }
  if (value.external !== undefined) {
    if (!isRecord(value.external)) {
      issues.push(issue(schemaId, `${path}.external`, "must be an object"));
    } else {
      issues.push(
        ...nonEmptyStringIssue(value.external.issuer, `${path}.external.issuer`, schemaId),
        ...nonEmptyStringIssue(value.external.resultUri, `${path}.external.resultUri`, schemaId),
        ...enumIssue(value.external.verificationStatus, `${path}.external.verificationStatus`, schemaId, ["unverified", "verified", "rejected"])
      );
      if (value.external.attestationId !== undefined) issues.push(...stringIssue(value.external.attestationId, `${path}.external.attestationId`, schemaId));
    }
  }
  if (value.trustLevel === "boreal_witnessed" && (!isRecord(value.witness) || value.witness.kind !== "boreal")) {
    issues.push(issue(schemaId, `${path}.witness`, "boreal_witnessed evidence requires a Boreal witness"));
  }
  if (value.trustLevel === "external_attested" && (!isRecord(value.external) || !isRecord(value.witness))) {
    issues.push(issue(schemaId, path, "external_attested evidence requires witness and external identity"));
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

export function directiveAcknowledgementRecordSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.directiveAcknowledgementRecord;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  const issues: SchemaValidationIssue[] = [
    ...recordMetaIssues(value.meta, `${path}.meta`, schemaId, /^bw_acknowledgement_[a-f0-9]{12,64}$/),
    ...patternStringIssue(value.directiveId, `${path}.directiveId`, schemaId, AGENT_DIRECTIVE_LINK_ID_PATTERN),
    ...nonEmptyStringIssue(value.directiveVersion, `${path}.directiveVersion`, schemaId),
    ...directiveAcknowledgementBundleSourceIssues(value.bundleSource, `${path}.bundleSource`, schemaId),
    ...actorRefIssues(value.actor, `${path}.actor`, schemaId),
    ...enumIssue(value.subjectType, `${path}.subjectType`, schemaId, [
      "work",
      "sprint",
      "phase",
      "milestone",
      "project",
      "session",
      "workspace",
      "command"
    ]),
    ...nonEmptyStringIssue(value.commandPath, `${path}.commandPath`, schemaId),
    ...enumIssue(value.outcome, `${path}.outcome`, schemaId, [
      "satisfied",
      "deferred",
      "noncompliant",
      "not_applicable"
    ]),
    ...uniquePatternStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId, /^bw_evidence_[a-f0-9]{12,64}$/),
    ...uniquePatternStringArrayIssue(value.agentSummaryIds, `${path}.agentSummaryIds`, schemaId, /^bw_summary_[a-f0-9]{12,64}$/),
    ...(value.verificationIds === undefined
      ? []
      : uniquePatternStringArrayIssue(value.verificationIds, `${path}.verificationIds`, schemaId, /^bw_verification_[a-f0-9]{12,64}$/)),
    ...(value.artifactUris === undefined ? [] : uniqueStringArrayIssue(value.artifactUris, `${path}.artifactUris`, schemaId)),
    ...uniqueStringArrayIssue(value.handoffIds, `${path}.handoffIds`, schemaId),
    ...stringIssue(value.acknowledgedAt, `${path}.acknowledgedAt`, schemaId)
  ];

  if (value.directiveRegistryId !== undefined) {
    issues.push(...patternStringIssue(value.directiveRegistryId, `${path}.directiveRegistryId`, schemaId, AGENT_DIRECTIVE_LINK_ID_PATTERN));
  }
  if (value.subjectId !== undefined) {
    issues.push(...stringIssue(value.subjectId, `${path}.subjectId`, schemaId));
  }
  if (value.subjectTitle !== undefined) {
    issues.push(...stringIssue(value.subjectTitle, `${path}.subjectTitle`, schemaId));
  }
  if (value.reasonCode !== undefined) {
    issues.push(...patternStringIssue(value.reasonCode, `${path}.reasonCode`, schemaId, AGENT_DIRECTIVE_LINK_ID_PATTERN));
  }
  if (value.reason !== undefined) {
    issues.push(...stringIssue(value.reason, `${path}.reason`, schemaId));
  }
  if (
    (value.outcome === "deferred" || value.outcome === "noncompliant") &&
    value.reasonCode === undefined &&
    (typeof value.reason !== "string" || value.reason.trim().length === 0)
  ) {
    issues.push(issue(schemaId, `${path}.reason`, "is required when outcome is deferred or noncompliant unless reasonCode is present"));
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
    ...(value.fromProjectId === undefined ? [] : nonEmptyStringIssue(value.fromProjectId, `${path}.fromProjectId`, schemaId)),
    ...nonEmptyStringIssue(value.fromId, `${path}.fromId`, schemaId),
    ...nonEmptyStringIssue(value.fromType, `${path}.fromType`, schemaId),
    ...(value.toProjectId === undefined ? [] : nonEmptyStringIssue(value.toProjectId, `${path}.toProjectId`, schemaId)),
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
  if (value.git !== undefined) {
    if (!isRecord(value.git)) {
      issues.push(issue(schemaId, `${path}.git`, "must be an object"));
    } else {
      issues.push(
        ...nonEmptyStringIssue(value.git.branch, `${path}.git.branch`, schemaId),
        ...patternStringIssue(value.git.baseSha, `${path}.git.baseSha`, schemaId, /^[a-f0-9]{40,64}$/)
      );
      if (value.git.worktreePath !== undefined) {
        issues.push(...nonEmptyStringIssue(value.git.worktreePath, `${path}.git.worktreePath`, schemaId));
      }
    }
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

export function projectRollupSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.projectRollup;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }

  return [
    ...literalIssue(value.schemaVersion, `${path}.schemaVersion`, schemaId, PROJECT_ROLLUP_SCHEMA_VERSION),
    ...nonEmptyStringIssue(value.projectId, `${path}.projectId`, schemaId),
    ...absolutePathIssue(value.workspaceRoot, `${path}.workspaceRoot`, schemaId),
    ...stringIssue(value.generatedAt, `${path}.generatedAt`, schemaId),
    ...patternStringIssue(value.stateContentHash, `${path}.stateContentHash`, schemaId, /^sha256:[a-f0-9]{64}$/),
    ...projectRollupCountsIssues(value.counts, `${path}.counts`, schemaId),
    ...projectRollupLimboIssues(value.limbo, `${path}.limbo`, schemaId),
    ...projectRollupReservationDetailIssues(value.reservations, `${path}.reservations`, schemaId),
    ...projectRollupEnforcementIssues(value.enforcement, `${path}.enforcement`, schemaId),
    ...projectRollupHealthIssues(value.health, `${path}.health`, schemaId),
    ...projectRollupLastEventIssues(value.lastEvent, `${path}.lastEvent`, schemaId),
    ...projectRollupLastOperationIssues(value.lastOperation, `${path}.lastOperation`, schemaId),
    ...projectRollupNextIssues(value.next, `${path}.next`, schemaId),
    ...(value.workIndex === undefined ? [] : projectRollupWorkIndexIssues(value.workIndex, `${path}.workIndex`, schemaId)),
    ...projectRollupAgingIssues(value.aging, `${path}.aging`, schemaId)
  ];
}

function projectRollupCountsIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...projectRollupWorkCountsIssues(value.work, `${path}.work`, schemaId),
    ...projectRollupReservationCountsIssues(value.reservations, `${path}.reservations`, schemaId)
  ];
}

function projectRollupWorkCountsIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...integerAtLeastIssue(value.total, `${path}.total`, schemaId, 0),
    ...countObjectIssues(value.byStatus, `${path}.byStatus`, schemaId, WORK_STATUSES),
    ...countObjectIssues(value.byKind, `${path}.byKind`, schemaId, WORK_KINDS)
  ];
}

function projectRollupReservationCountsIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...integerAtLeastIssue(value.total, `${path}.total`, schemaId, 0),
    ...integerAtLeastIssue(value.active, `${path}.active`, schemaId, 0),
    ...integerAtLeastIssue(value.expired, `${path}.expired`, schemaId, 0),
    ...integerAtLeastIssue(value.released, `${path}.released`, schemaId, 0)
  ];
}

function projectRollupLimboIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...projectRollupLimboArrayIssues(value.needsVerification, `${path}.needsVerification`, schemaId, "needs_verification"),
    ...projectRollupLimboArrayIssues(value.verified, `${path}.verified`, schemaId, "verified")
  ];
}

function projectRollupLimboArrayIssues(
  value: unknown,
  path: string,
  schemaId: string,
  status: "needs_verification" | "verified"
): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => projectRollupLimboEntryIssues(entry, `${path}[${index}]`, schemaId, status));
}

function projectRollupLimboEntryIssues(
  value: unknown,
  path: string,
  schemaId: string,
  status: "needs_verification" | "verified"
): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...patternStringIssue(value.workId, `${path}.workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...literalIssue(value.status, `${path}.status`, schemaId, status),
    ...stringIssue(value.updatedAt, `${path}.updatedAt`, schemaId),
    ...integerAtLeastIssue(value.ageMs, `${path}.ageMs`, schemaId, 0),
    ...integerAtLeastIssue(value.ageDays, `${path}.ageDays`, schemaId, 0)
  ];
}

function projectRollupReservationDetailIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...uniquePatternStringArrayIssue(value.activeIds, `${path}.activeIds`, schemaId, /^bw_reservation_[a-f0-9]{12,64}$/),
    ...uniquePatternStringArrayIssue(value.expiredIds, `${path}.expiredIds`, schemaId, /^bw_reservation_[a-f0-9]{12,64}$/)
  ];
}

function projectRollupEnforcementIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  if (!isRecord(value.blockingGaps)) {
    return [issue(schemaId, `${path}.blockingGaps`, "must be an object")];
  }
  const blockingGaps = value.blockingGaps;
  return [
    ...integerAtLeastIssue(blockingGaps.openCount, `${path}.blockingGaps.openCount`, schemaId, 0),
    ...integerAtLeastIssue(blockingGaps.blockedWorkCount, `${path}.blockingGaps.blockedWorkCount`, schemaId, 0),
    ...projectRollupBlockingGapSamplesIssues(blockingGaps.samples, `${path}.blockingGaps.samples`, schemaId)
  ];
}

function projectRollupBlockingGapSamplesIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(schemaId, path, "must be an array")];
  }
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [issue(schemaId, `${path}[${index}]`, "must be an object")];
    }
    return [
      ...patternStringIssue(entry.workId, `${path}[${index}].workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
      ...nonEmptyStringIssue(entry.title, `${path}[${index}].title`, schemaId),
      ...uniquePatternStringArrayIssue(entry.blockerIds, `${path}[${index}].blockerIds`, schemaId, /^bw_work_[a-f0-9]{12,64}$/)
    ];
  });
}

function projectRollupHealthIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...nullableBooleanIssue(value.doctorOk, `${path}.doctorOk`, schemaId),
    ...nullableBooleanIssue(value.syncOk, `${path}.syncOk`, schemaId)
  ];
}

function projectRollupLastEventIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (value === null) {
    return [];
  }
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object or null")];
  }
  return [
    ...patternStringIssue(value.id, `${path}.id`, schemaId, /^bw_event_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.type, `${path}.type`, schemaId),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId),
    ...stringIssue(value.at, `${path}.at`, schemaId)
  ];
}

function projectRollupLastOperationIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (value === null) {
    return [];
  }
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object or null")];
  }
  return [
    ...patternStringIssue(value.id, `${path}.id`, schemaId, /^bw_operation_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.commandPath, `${path}.commandPath`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["succeeded", "failed"]),
    ...stringIssue(value.finishedAt, `${path}.finishedAt`, schemaId)
  ];
}

function projectRollupNextIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  if (!Array.isArray(value.work)) {
    return [issue(schemaId, `${path}.work`, "must be an array")];
  }
  return [
    ...integerAtLeastIssue(value.limit, `${path}.limit`, schemaId, 1),
    ...value.work.flatMap((entry, index) => projectRollupNextWorkIssues(entry, `${path}.work[${index}]`, schemaId))
  ];
}

function projectRollupNextWorkIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...patternStringIssue(value.workId, `${path}.workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...enumIssue(value.kind, `${path}.kind`, schemaId, WORK_KINDS),
    ...enumIssue(value.priority, `${path}.priority`, schemaId, ["low", "normal", "high", "critical"]),
    ...enumIssue(value.status, `${path}.status`, schemaId, WORK_STATUSES),
    ...stringIssue(value.updatedAt, `${path}.updatedAt`, schemaId)
  ];
}

function projectRollupWorkIndexIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  if (!Array.isArray(value.work)) {
    return [issue(schemaId, `${path}.work`, "must be an array")];
  }
  return [
    ...integerAtLeastIssue(value.limit, `${path}.limit`, schemaId, 1),
    ...integerAtLeastIssue(value.total, `${path}.total`, schemaId, 0),
    ...booleanIssue(value.truncated, `${path}.truncated`, schemaId),
    ...value.work.flatMap((entry, index) => projectRollupNextWorkIssues(entry, `${path}.work[${index}]`, schemaId))
  ];
}

function projectRollupAgingIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...projectRollupAgingWorkBucketIssues(value.ready, `${path}.ready`, schemaId, ["ready"]),
    ...projectRollupAgingWorkBucketIssues(value.limbo, `${path}.limbo`, schemaId, ["needs_verification", "verified"]),
    ...projectRollupAgingReservationBucketIssues(value.expiredReservations, `${path}.expiredReservations`, schemaId),
    ...projectRollupAgingMaximaIssues(value.maxima, `${path}.maxima`, schemaId),
    ...projectRollupAgingApproximationIssues(value.approximation, `${path}.approximation`, schemaId)
  ];
}

function projectRollupAgingWorkBucketIssues(
  value: unknown,
  path: string,
  schemaId: string,
  statuses: readonly string[]
): readonly SchemaValidationIssue[] {
  const bucketIssues = projectRollupAgingBucketIssues(value, path, schemaId);
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return bucketIssues;
  }
  return [
    ...bucketIssues,
    ...value.items.flatMap((entry, index) =>
      projectRollupAgingWorkEntryIssues(entry, `${path}.items[${index}]`, schemaId, statuses)
    )
  ];
}

function projectRollupAgingReservationBucketIssues(
  value: unknown,
  path: string,
  schemaId: string
): readonly SchemaValidationIssue[] {
  const bucketIssues = projectRollupAgingBucketIssues(value, path, schemaId);
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return bucketIssues;
  }
  return [
    ...bucketIssues,
    ...value.items.flatMap((entry, index) =>
      projectRollupAgingReservationEntryIssues(entry, `${path}.items[${index}]`, schemaId)
    )
  ];
}

function projectRollupAgingBucketIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...integerAtLeastIssue(value.count, `${path}.count`, schemaId, 0),
    ...integerAtLeastIssue(value.oldestAgeMs, `${path}.oldestAgeMs`, schemaId, 0),
    ...integerAtLeastIssue(value.oldestAgeDays, `${path}.oldestAgeDays`, schemaId, 0),
    ...(Array.isArray(value.items) ? [] : [issue(schemaId, `${path}.items`, "must be an array")])
  ];
}

function projectRollupAgingWorkEntryIssues(
  value: unknown,
  path: string,
  schemaId: string,
  statuses: readonly string[]
): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...patternStringIssue(value.workId, `${path}.workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.title, `${path}.title`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, statuses),
    ...stringIssue(value.since, `${path}.since`, schemaId),
    ...integerAtLeastIssue(value.ageMs, `${path}.ageMs`, schemaId, 0),
    ...integerAtLeastIssue(value.ageDays, `${path}.ageDays`, schemaId, 0)
  ];
}

function projectRollupAgingReservationEntryIssues(
  value: unknown,
  path: string,
  schemaId: string
): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...patternStringIssue(value.reservationId, `${path}.reservationId`, schemaId, /^bw_reservation_[a-f0-9]{12,64}$/),
    ...patternStringIssue(value.workId, `${path}.workId`, schemaId, /^bw_work_[a-f0-9]{12,64}$/),
    ...nonEmptyStringIssue(value.agentId, `${path}.agentId`, schemaId),
    ...enumIssue(value.status, `${path}.status`, schemaId, ["active", "expired"]),
    ...stringIssue(value.reservedAt, `${path}.reservedAt`, schemaId),
    ...stringIssue(value.since, `${path}.since`, schemaId),
    ...integerAtLeastIssue(value.ageMs, `${path}.ageMs`, schemaId, 0),
    ...integerAtLeastIssue(value.ageDays, `${path}.ageDays`, schemaId, 0)
  ];
  if (value.expiresAt !== undefined) {
    issues.push(...stringIssue(value.expiresAt, `${path}.expiresAt`, schemaId));
  }
  return issues;
}

function projectRollupAgingMaximaIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...integerAtLeastIssue(value.readyAgeMs, `${path}.readyAgeMs`, schemaId, 0),
    ...integerAtLeastIssue(value.limboAgeMs, `${path}.limboAgeMs`, schemaId, 0),
    ...integerAtLeastIssue(value.expiredReservationAgeMs, `${path}.expiredReservationAgeMs`, schemaId, 0)
  ];
}

function projectRollupAgingApproximationIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...literalIssue(value.readySinceSource, `${path}.readySinceSource`, schemaId, "work.meta.updatedAt"),
    ...literalIssue(value.limboSinceSource, `${path}.limboSinceSource`, schemaId, "work.meta.updatedAt"),
    ...literalIssue(
      value.expiredReservationSinceSource,
      `${path}.expiredReservationSinceSource`,
      schemaId,
      "reservation.expiresAt_or_meta.updatedAt"
    ),
    ...(value.eventHistoryScanned === false ? [] : [issue(schemaId, `${path}.eventHistoryScanned`, "must be false")])
  ];
}

function countObjectIssues(
  value: unknown,
  path: string,
  schemaId: string,
  keys: readonly string[]
): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return keys.flatMap((key) => integerAtLeastIssue(value[key], `${path}.${key}`, schemaId, 0));
}

export function enforcementGapSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  const schemaId = RUNTIME_SCHEMA_IDS.enforcementGap;
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...enumIssue(value.code, `${path}.code`, schemaId, ENFORCEMENT_GAP_CODES),
    ...enumIssue(value.subjectType, `${path}.subjectType`, schemaId, [
      "work",
      "sprint",
      "phase",
      "milestone",
      "project",
      "session",
      "workspace",
      "command"
    ]),
    ...nonEmptyStringIssue(value.subjectId, `${path}.subjectId`, schemaId)
  ];
  if (value.targetId !== undefined) {
    issues.push(...nonEmptyStringIssue(value.targetId, `${path}.targetId`, schemaId));
  }
  if (value.data !== undefined) {
    issues.push(...enforcementGapDataIssues(value.data, `${path}.data`, schemaId));
  }
  return issues;
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

export function agentDirectiveBundleSchemaIssues(value: unknown, path = "$"): readonly SchemaValidationIssue[] {
  return agentDirectiveBundleIssues(value).map((directiveIssue) =>
    issue(AGENT_DIRECTIVE_SCHEMA_IDS.agentDirectiveBundle, schemaPath(path, directiveIssue.path), directiveIssue.message)
  );
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
    ...projectRegistryIdentityIssues(value.identity, `${path}.identity`, schemaId),
    ...enumIssue(value.lifecycle, `${path}.lifecycle`, schemaId, ["linked", "paused", "archived", "missing"]),
    ...projectRegistryDisplayIssues(value.display, `${path}.display`, schemaId),
    ...absolutePathIssue(value.projectRoot, `${path}.projectRoot`, schemaId),
    ...absolutePathIssue(value.borealDir, `${path}.borealDir`, schemaId),
    ...absolutePathIssue(value.runtimeDir, `${path}.runtimeDir`, schemaId),
    ...absolutePathIssue(value.runtimeStateFile, `${path}.runtimeStateFile`, schemaId),
    ...absolutePathIssue(value.projectConfigPath, `${path}.projectConfigPath`, schemaId),
    ...absolutePathIssue(value.memoryRoot, `${path}.memoryRoot`, schemaId),
    ...absolutePathIssue(value.memoryBorealDir, `${path}.memoryBorealDir`, schemaId),
    ...absolutePathIssue(value.installRoot, `${path}.installRoot`, schemaId),
    ...(value.bwrkPin === undefined ? [] : projectRegistryBwrkPinIssues(value.bwrkPin, `${path}.bwrkPin`, schemaId)),
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
    ...(value.bwrkPin === undefined ? [] : projectRegistryBwrkPinBoundaryIssues(value, path, schemaId)),
    ...memoryLayoutBoundaryIssues(value, path, schemaId),
    ...installRootBoundaryIssues(value, path, schemaId),
    ...(value.skillInstallRoots === undefined ? [] : skillInstallRootBoundaryIssues(value, path, schemaId))
  ];
}

function projectRegistryIdentityIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...enumIssue(value.strategy, `${path}.strategy`, schemaId, ["project-config", "git-remote", "path"]),
    ...nonEmptyStringIssue(value.fingerprint, `${path}.fingerprint`, schemaId)
  ];
}

function projectRegistryBwrkPinIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  return [
    ...enumIssue(value.source, `${path}.source`, schemaId, ["node_modules", "project-config"]),
    ...absolutePathIssue(value.binPath, `${path}.binPath`, schemaId),
    ...nonEmptyStringIssue(value.relativeBinPath, `${path}.relativeBinPath`, schemaId),
    ...(value.packageName === undefined ? [] : nonEmptyStringIssue(value.packageName, `${path}.packageName`, schemaId))
  ];
}

function projectRegistryBwrkPinBoundaryIssues(value: Record<string, unknown>, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value.bwrkPin) || typeof value.projectRoot !== "string") {
    return [];
  }
  return pathInsideIssue(value.projectRoot, value.bwrkPin.binPath, `${path}.bwrkPin.binPath`, schemaId, "must be inside projectRoot");
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

function directiveAcknowledgementBundleSourceIssues(
  value: unknown,
  path: string,
  schemaId: string
): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [
    ...nonEmptyStringIssue(value.registryVersion, `${path}.registryVersion`, schemaId),
    ...nonEmptyStringIssue(value.commandPath, `${path}.commandPath`, schemaId),
    ...stringIssue(value.generatedAt, `${path}.generatedAt`, schemaId)
  ];
  if (value.bundleId !== undefined) {
    issues.push(...nonEmptyStringIssue(value.bundleId, `${path}.bundleId`, schemaId));
  }
  if (value.envelopeSchema !== undefined) {
    issues.push(...stringIssue(value.envelopeSchema, `${path}.envelopeSchema`, schemaId));
  }
  if (value.sourceSnapshotHash !== undefined) {
    issues.push(...patternStringIssue(value.sourceSnapshotHash, `${path}.sourceSnapshotHash`, schemaId, /^sha256:[a-f0-9]{64}$/));
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
  if (value.declaredCommand !== undefined) {
    issues.push(...nonEmptyStringIssue(value.declaredCommand, `${path}.declaredCommand`, schemaId));
  }
  if (value.expectedObservable !== undefined) {
    issues.push(...nonEmptyStringIssue(value.expectedObservable, `${path}.expectedObservable`, schemaId));
  }
  if (value.requiredTrustLevels !== undefined) {
    issues.push(...enumArrayIssue(value.requiredTrustLevels, `${path}.requiredTrustLevels`, schemaId, [
      "legacy_unattested",
      "self_reported",
      "boreal_witnessed",
      "external_attested"
    ]));
    if (Array.isArray(value.requiredTrustLevels) && value.requiredTrustLevels.length === 0) {
      issues.push(issue(schemaId, `${path}.requiredTrustLevels`, "must contain at least one trust level"));
    }
  }
  if (value.requireCurrentRevision !== undefined) {
    issues.push(...booleanIssue(value.requireCurrentRevision, `${path}.requireCurrentRevision`, schemaId));
  }
  if (value.requireCurrentGitHead !== undefined) {
    issues.push(...booleanIssue(value.requireCurrentGitHead, `${path}.requireCurrentGitHead`, schemaId));
  }
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

function enforcementGapDataIssues(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(schemaId, path, "must be an object")];
  }
  const issues: SchemaValidationIssue[] = [];
  if (value.blockerIds !== undefined) {
    issues.push(...uniquePatternStringArrayIssue(value.blockerIds, `${path}.blockerIds`, schemaId, /^bw_work_[a-f0-9]{12,64}$/));
  }
  if (value.gateIds !== undefined) {
    issues.push(...uniquePatternStringArrayIssue(value.gateIds, `${path}.gateIds`, schemaId, /^bw_gate_[a-f0-9]{12,64}$/));
  }
  if (value.requiredEvidenceKinds !== undefined) {
    issues.push(...enumArrayIssue(value.requiredEvidenceKinds, `${path}.requiredEvidenceKinds`, schemaId, [
      "command",
      "test",
      "diff",
      "review",
      "artifact",
      "note"
    ]));
  }
  if (value.minEvidenceCount !== undefined) {
    issues.push(...integerAtLeastIssue(value.minEvidenceCount, `${path}.minEvidenceCount`, schemaId, 0));
  }
  if (value.declaredCommand !== undefined) {
    issues.push(...nonEmptyStringIssue(value.declaredCommand, `${path}.declaredCommand`, schemaId));
  }
  if (value.expectedObservable !== undefined) {
    issues.push(...nonEmptyStringIssue(value.expectedObservable, `${path}.expectedObservable`, schemaId));
  }
  if (value.requiredTrustLevels !== undefined) {
    issues.push(...enumArrayIssue(value.requiredTrustLevels, `${path}.requiredTrustLevels`, schemaId, [
      "legacy_unattested",
      "self_reported",
      "boreal_witnessed",
      "external_attested"
    ]));
  }
  if (value.requiredRevision !== undefined) {
    issues.push(...patternStringIssue(value.requiredRevision, `${path}.requiredRevision`, schemaId, /^sha256:[a-f0-9]{64}$/));
  }
  if (value.requiredGitHead !== undefined) {
    issues.push(...patternStringIssue(value.requiredGitHead, `${path}.requiredGitHead`, schemaId, /^[a-f0-9]{40,64}$/));
  }
  if (value.observed !== undefined) {
    issues.push(...stringArrayIssue(value.observed, `${path}.observed`, schemaId));
  }
  if (value.evidenceIds !== undefined) {
    issues.push(...uniquePatternStringArrayIssue(value.evidenceIds, `${path}.evidenceIds`, schemaId, /^bw_evidence_[a-f0-9]{12,64}$/));
  }
  if (value.reason !== undefined) {
    issues.push(...nonEmptyStringIssue(value.reason, `${path}.reason`, schemaId));
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
  for (const field of ["directiveIds", "acknowledgementIds"] as const) {
    if (value[field] !== undefined) {
      issues.push(...uniquePatternStringArrayIssue(value[field], `${path}.${field}`, schemaId, AGENT_DIRECTIVE_LINK_ID_PATTERN));
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
  for (const field of ["directiveIds", "acknowledgementIds"] as const) {
    if (value[field] !== undefined) {
      issues.push(...uniquePatternStringArrayIssue(value[field], `${path}.${field}`, schemaId, AGENT_DIRECTIVE_LINK_ID_PATTERN));
    }
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

function nullableBooleanIssue(value: unknown, path: string, schemaId: string): readonly SchemaValidationIssue[] {
  return typeof value === "boolean" || value === null ? [] : [issue(schemaId, path, "must be a boolean or null")];
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

function schemaPath(basePath: string, relativePath: string): string {
  if (relativePath === "$") {
    return basePath;
  }
  if (basePath === "$") {
    return relativePath;
  }
  return `${basePath}${relativePath.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
