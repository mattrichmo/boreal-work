import type { Brand, ContentHash } from "./ids.js";
import { BorealError } from "./errors.js";
import { detectSuspiciousUnicode } from "./string-safety.js";
import type { IsoTimestamp } from "./time.js";

export const AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION = "boreal.agent-directives.v1";
export const AGENT_DIRECTIVE_TRUSTED_REGISTRY_PATH_PREFIXES = ["packages/core/src/agent-directive"] as const;

export const AGENT_DIRECTIVE_FAMILIES = [
  "closeout",
  "git",
  "sprint",
  "phase",
  "container",
  "handoff",
  "doctor",
  "blocked",
  "workflow_next",
  "verification",
  "review",
  "audit",
  "memory"
] as const;

export const AGENT_DIRECTIVE_SEVERITIES = ["info", "action", "required", "blocking"] as const;
export const AGENT_DIRECTIVE_AUDIENCES = ["agent", "operator", "reviewer"] as const;
export const AGENT_DIRECTIVE_KINDS = [
  "obligation",
  "next_step",
  "warning",
  "recovery",
  "summary",
  "acknowledgement"
] as const;
export const AGENT_DIRECTIVE_LIFECYCLES = [
  "proposed",
  "active",
  "satisfied",
  "acknowledged",
  "superseded",
  "blocked"
] as const;
export const AGENT_DIRECTIVE_SUBJECT_TYPES = [
  "work",
  "sprint",
  "phase",
  "milestone",
  "project",
  "session",
  "workspace",
  "command"
] as const;
export const AGENT_DIRECTIVE_CONFLICT_RESOLUTIONS = [
  "highest_severity_wins",
  "blocking_wins",
  "registry_order",
  "manual_review"
] as const;

export type AgentDirectiveId = Brand<string, "AgentDirectiveId">;
export type AgentDirectiveBundleId = Brand<string, "AgentDirectiveBundleId">;
export type AgentDirectiveTemplateId = Brand<string, "AgentDirectiveTemplateId">;
export type AgentDirectiveVersion = Brand<string, "AgentDirectiveVersion">;
export type AgentDirectiveRegistryVersion = Brand<string, "AgentDirectiveRegistryVersion">;

export type AgentDirectiveFamily = (typeof AGENT_DIRECTIVE_FAMILIES)[number];
export type AgentDirectiveSeverity = (typeof AGENT_DIRECTIVE_SEVERITIES)[number];
export type AgentDirectiveAudience = (typeof AGENT_DIRECTIVE_AUDIENCES)[number];
export type AgentDirectiveKind = (typeof AGENT_DIRECTIVE_KINDS)[number];
export type AgentDirectiveLifecycle = (typeof AGENT_DIRECTIVE_LIFECYCLES)[number];
export type AgentDirectiveSubjectType = (typeof AGENT_DIRECTIVE_SUBJECT_TYPES)[number];

export type AgentDirectiveDataPrimitive = string | number | boolean | null;
export type AgentDirectiveDataValue =
  | AgentDirectiveDataPrimitive
  | readonly AgentDirectiveDataValue[]
  | { readonly [key: string]: AgentDirectiveDataValue };
export type AgentDirectiveData = { readonly [key: string]: AgentDirectiveDataValue };

export interface AgentDirectiveSource {
  readonly registryVersion: AgentDirectiveRegistryVersion;
  readonly registryPath: string;
  readonly selectedBy: readonly string[];
  readonly snapshotHash?: ContentHash;
}

export interface AgentDirectiveSubject {
  readonly type: AgentDirectiveSubjectType;
  readonly id?: string;
  readonly title?: string;
}

export interface AgentDirectiveAppliesTo {
  readonly commandPaths: readonly string[];
  readonly subjectTypes?: readonly AgentDirectiveSubjectType[];
  readonly workStatuses?: readonly string[];
  readonly labels?: readonly string[];
  readonly gates?: readonly string[];
}

export interface AgentDirectiveAcknowledgementRequirement {
  readonly requiredBefore: "close" | "release" | "force_gate" | "handoff" | "none";
  readonly evidenceKind?: "command" | "review" | "artifact" | "note";
  readonly message: string;
}

export interface AgentDirective {
  readonly id: AgentDirectiveId;
  readonly registryId: AgentDirectiveTemplateId;
  readonly version: AgentDirectiveVersion;
  readonly family: AgentDirectiveFamily;
  readonly severity: AgentDirectiveSeverity;
  readonly audience: AgentDirectiveAudience;
  readonly kind: AgentDirectiveKind;
  readonly lifecycle: AgentDirectiveLifecycle;
  readonly title: string;
  readonly instruction: string;
  readonly data: AgentDirectiveData;
  readonly source: AgentDirectiveSource;
  readonly subject?: AgentDirectiveSubject;
  readonly appliesTo: AgentDirectiveAppliesTo;
  readonly supersedes?: readonly AgentDirectiveId[];
  readonly blocksCloseout?: boolean;
  readonly acknowledgement?: AgentDirectiveAcknowledgementRequirement;
}

export type AgentDirectiveConflictResolution = (typeof AGENT_DIRECTIVE_CONFLICT_RESOLUTIONS)[number];

export interface AgentDirectiveConflict {
  readonly directiveIds: readonly AgentDirectiveId[];
  readonly reason: string;
  readonly resolution: AgentDirectiveConflictResolution;
  readonly resolvedDirectiveId?: AgentDirectiveId;
  readonly severity: AgentDirectiveSeverity;
}

export interface AgentDirectiveDeprecation {
  readonly directiveId: AgentDirectiveId;
  readonly deprecatedBy?: AgentDirectiveId;
  readonly reason: string;
}

export interface AgentDirectiveMissingRequiredEntry {
  readonly registryId?: AgentDirectiveTemplateId;
  readonly family: AgentDirectiveFamily;
  readonly subject?: AgentDirectiveSubject;
  readonly requirement: string;
  readonly message: string;
}

export interface AgentDirectiveTemplate {
  readonly id: AgentDirectiveTemplateId;
  readonly version: AgentDirectiveVersion;
  readonly family: AgentDirectiveFamily;
  readonly severity: AgentDirectiveSeverity;
  readonly audience: AgentDirectiveAudience;
  readonly kind: AgentDirectiveKind;
  readonly title: string;
  readonly instruction: string;
  readonly defaultLifecycle: AgentDirectiveLifecycle;
  readonly appliesTo: AgentDirectiveAppliesTo;
  readonly blocksCloseout?: boolean;
  readonly acknowledgement?: AgentDirectiveAcknowledgementRequirement;
}

export interface AgentDirectiveBundleMetadata {
  readonly id?: AgentDirectiveBundleId;
  readonly schemaVersion: typeof AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION;
  readonly registryVersion: AgentDirectiveRegistryVersion;
  readonly generatedAt: IsoTimestamp;
  readonly commandPath: string;
  readonly envelopeSchema?: string;
  readonly sourceSnapshotHash?: ContentHash;
}

export interface AgentDirectiveBundle {
  readonly meta: AgentDirectiveBundleMetadata;
  readonly directives: readonly AgentDirective[];
  readonly conflicts: readonly AgentDirectiveConflict[];
  readonly deprecations: readonly AgentDirectiveDeprecation[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
}

export interface AgentDirectiveBundleCarrier {
  readonly agentDirectives?: readonly AgentDirectiveBundle[];
}

export interface AgentDirectiveBundleValidationOptions {
  readonly knownRegistryIds?: readonly AgentDirectiveTemplateId[];
  readonly trustedRegistryPathPrefixes?: readonly string[];
  readonly maxDataDepth?: number;
}

export interface AgentDirectiveBundleValidationIssue {
  readonly path: string;
  readonly message: string;
}

const STABLE_MACHINE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const DATA_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export function agentDirectiveBundleIssues(
  value: unknown,
  options: AgentDirectiveBundleValidationOptions = {}
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue("$", "must be an object")];
  }

  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...bundleMetaIssues(value.meta, "$.meta"),
    ...directiveArrayIssues(value.directives, "$.directives", options),
    ...conflictArrayIssues(value.conflicts, "$.conflicts"),
    ...deprecationArrayIssues(value.deprecations, "$.deprecations"),
    ...missingRequiredArrayIssues(value.missingRequired, "$.missingRequired")
  ];

  const directiveIds = Array.isArray(value.directives)
    ? value.directives.flatMap((directive) => (isRecord(directive) && typeof directive.id === "string" ? [directive.id] : []))
    : [];
  const directiveIdSet = new Set(directiveIds);
  if (directiveIds.length !== directiveIdSet.size) {
    issues.push(issue("$.directives", "directive ids must be unique"));
  }

  const knownRegistryIdSet =
    options.knownRegistryIds === undefined ? undefined : new Set<string>(options.knownRegistryIds);
  if (knownRegistryIdSet && Array.isArray(value.directives)) {
    value.directives.forEach((directive, index) => {
      if (isRecord(directive) && typeof directive.registryId === "string" && !knownRegistryIdSet.has(directive.registryId)) {
        issues.push(issue(`$.directives[${index}].registryId`, "must reference a known registry id"));
      }
    });
  }

  issues.push(...directiveReferenceIssues(value.directives, "$.directives", directiveIdSet));
  issues.push(...conflictReferenceIssues(value.conflicts, "$.conflicts", directiveIdSet));
  issues.push(...deprecationReferenceIssues(value.deprecations, "$.deprecations", directiveIdSet));

  return issues;
}

export function assertAgentDirectiveBundle(
  value: unknown,
  options: AgentDirectiveBundleValidationOptions = {}
): asserts value is AgentDirectiveBundle {
  const issues = agentDirectiveBundleIssues(value, options);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Invalid agent directive bundle", { issues });
  }
}

export function agentDirectiveDataIssues(
  value: unknown,
  path = "$",
  options: Pick<AgentDirectiveBundleValidationOptions, "maxDataDepth"> = {}
): readonly AgentDirectiveBundleValidationIssue[] {
  return dataValueIssues(value, path, options.maxDataDepth ?? 24, 0, new WeakSet<object>(), true);
}

export function assertAgentDirectiveData(
  value: unknown,
  options: Pick<AgentDirectiveBundleValidationOptions, "maxDataDepth"> = {}
): asserts value is AgentDirectiveData {
  const issues = agentDirectiveDataIssues(value, "$", options);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Invalid agent directive data", { issues });
  }
}

export function isAgentDirectiveData(value: unknown): value is AgentDirectiveData {
  return agentDirectiveDataIssues(value).length === 0;
}

export function isAgentDirectiveDataValue(value: unknown): value is AgentDirectiveDataValue {
  return dataValueIssues(value, "$", 24, 0, new WeakSet<object>(), false).length === 0;
}

function bundleMetaIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...optionalStableMachineIdIssues(value.id, `${path}.id`),
    ...literalIssues(value.schemaVersion, `${path}.schemaVersion`, AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION),
    ...stableMachineIdIssues(value.registryVersion, `${path}.registryVersion`),
    ...nonEmptySafeStringIssues(value.generatedAt, `${path}.generatedAt`),
    ...nonEmptySafeStringIssues(value.commandPath, `${path}.commandPath`),
    ...optionalNonEmptySafeStringIssues(value.envelopeSchema, `${path}.envelopeSchema`),
    ...optionalContentHashIssues(value.sourceSnapshotHash, `${path}.sourceSnapshotHash`)
  ];
  return issues;
}

function directiveArrayIssues(
  value: unknown,
  path: string,
  options: AgentDirectiveBundleValidationOptions
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  return value.flatMap((directive, index) => directiveIssues(directive, `${path}[${index}]`, options));
}

function directiveIssues(
  value: unknown,
  path: string,
  options: AgentDirectiveBundleValidationOptions
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...stableMachineIdIssues(value.id, `${path}.id`),
    ...stableMachineIdIssues(value.registryId, `${path}.registryId`),
    ...stableMachineIdIssues(value.version, `${path}.version`),
    ...enumIssues(value.family, `${path}.family`, AGENT_DIRECTIVE_FAMILIES),
    ...enumIssues(value.severity, `${path}.severity`, AGENT_DIRECTIVE_SEVERITIES),
    ...enumIssues(value.audience, `${path}.audience`, AGENT_DIRECTIVE_AUDIENCES),
    ...enumIssues(value.kind, `${path}.kind`, AGENT_DIRECTIVE_KINDS),
    ...enumIssues(value.lifecycle, `${path}.lifecycle`, AGENT_DIRECTIVE_LIFECYCLES),
    ...nonEmptySafeStringIssues(value.title, `${path}.title`),
    ...nonEmptySafeStringIssues(value.instruction, `${path}.instruction`),
    ...agentDirectiveDataIssues(value.data, `${path}.data`, options),
    ...sourceIssues(value.source, `${path}.source`, options),
    ...appliesToIssues(value.appliesTo, `${path}.appliesTo`)
  ];
  if (value.subject !== undefined) {
    issues.push(...subjectIssues(value.subject, `${path}.subject`));
  }
  if (value.supersedes !== undefined) {
    issues.push(...stableMachineIdArrayIssues(value.supersedes, `${path}.supersedes`));
  }
  if (value.blocksCloseout !== undefined && typeof value.blocksCloseout !== "boolean") {
    issues.push(issue(`${path}.blocksCloseout`, "must be a boolean"));
  }
  if (value.acknowledgement !== undefined) {
    issues.push(...acknowledgementIssues(value.acknowledgement, `${path}.acknowledgement`));
  }
  return issues;
}

function sourceIssues(
  value: unknown,
  path: string,
  options: AgentDirectiveBundleValidationOptions
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...stableMachineIdIssues(value.registryVersion, `${path}.registryVersion`),
    ...trustedRegistryPathIssues(value.registryPath, `${path}.registryPath`, options),
    ...stableMachineIdArrayIssues(value.selectedBy, `${path}.selectedBy`),
    ...optionalContentHashIssues(value.snapshotHash, `${path}.snapshotHash`)
  ];
}

function subjectIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  return [
    ...enumIssues(value.type, `${path}.type`, AGENT_DIRECTIVE_SUBJECT_TYPES),
    ...optionalNonEmptySafeStringIssues(value.id, `${path}.id`),
    ...optionalNonEmptySafeStringIssues(value.title, `${path}.title`)
  ];
}

function appliesToIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...nonEmptySafeStringArrayIssues(value.commandPaths, `${path}.commandPaths`)
  ];
  if (value.subjectTypes !== undefined) {
    issues.push(...enumArrayIssues(value.subjectTypes, `${path}.subjectTypes`, AGENT_DIRECTIVE_SUBJECT_TYPES));
  }
  if (value.workStatuses !== undefined) {
    issues.push(...nonEmptySafeStringArrayIssues(value.workStatuses, `${path}.workStatuses`));
  }
  if (value.labels !== undefined) {
    issues.push(...nonEmptySafeStringArrayIssues(value.labels, `${path}.labels`));
  }
  if (value.gates !== undefined) {
    issues.push(...nonEmptySafeStringArrayIssues(value.gates, `${path}.gates`));
  }
  return issues;
}

function acknowledgementIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...enumIssues(value.requiredBefore, `${path}.requiredBefore`, ["close", "release", "force_gate", "handoff", "none"] as const),
    ...nonEmptySafeStringIssues(value.message, `${path}.message`)
  ];
  if (value.evidenceKind !== undefined) {
    issues.push(...enumIssues(value.evidenceKind, `${path}.evidenceKind`, ["command", "review", "artifact", "note"] as const));
  }
  return issues;
}

function conflictArrayIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  return value.flatMap((conflict, index) => conflictIssues(conflict, `${path}[${index}]`));
}

function conflictIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...stableMachineIdArrayIssues(value.directiveIds, `${path}.directiveIds`),
    ...nonEmptySafeStringIssues(value.reason, `${path}.reason`),
    ...enumIssues(value.resolution, `${path}.resolution`, AGENT_DIRECTIVE_CONFLICT_RESOLUTIONS),
    ...enumIssues(value.severity, `${path}.severity`, AGENT_DIRECTIVE_SEVERITIES)
  ];
  if (value.resolvedDirectiveId !== undefined) {
    issues.push(...stableMachineIdIssues(value.resolvedDirectiveId, `${path}.resolvedDirectiveId`));
  }
  return issues;
}

function deprecationArrayIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  return value.flatMap((deprecation, index) => deprecationIssues(deprecation, `${path}[${index}]`));
}

function deprecationIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...stableMachineIdIssues(value.directiveId, `${path}.directiveId`),
    ...nonEmptySafeStringIssues(value.reason, `${path}.reason`)
  ];
  if (value.deprecatedBy !== undefined) {
    issues.push(...stableMachineIdIssues(value.deprecatedBy, `${path}.deprecatedBy`));
  }
  return issues;
}

function missingRequiredArrayIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  return value.flatMap((entry, index) => missingRequiredIssues(entry, `${path}[${index}]`));
}

function missingRequiredIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "must be an object")];
  }
  const issues: AgentDirectiveBundleValidationIssue[] = [
    ...enumIssues(value.family, `${path}.family`, AGENT_DIRECTIVE_FAMILIES),
    ...nonEmptySafeStringIssues(value.requirement, `${path}.requirement`),
    ...nonEmptySafeStringIssues(value.message, `${path}.message`)
  ];
  if (value.registryId !== undefined) {
    issues.push(...stableMachineIdIssues(value.registryId, `${path}.registryId`));
  }
  if (value.subject !== undefined) {
    issues.push(...subjectIssues(value.subject, `${path}.subject`));
  }
  return issues;
}

function directiveReferenceIssues(
  value: unknown,
  path: string,
  directiveIds: ReadonlySet<string>
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((directive, index) => {
    if (!isRecord(directive) || !Array.isArray(directive.supersedes)) {
      return [];
    }
    return directive.supersedes.flatMap((directiveId, supersedesIndex) =>
      typeof directiveId === "string" && !directiveIds.has(directiveId)
        ? [issue(`${path}[${index}].supersedes[${supersedesIndex}]`, "must reference a directive id from this bundle")]
        : []
    );
  });
}

function conflictReferenceIssues(
  value: unknown,
  path: string,
  directiveIds: ReadonlySet<string>
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((conflict, index) => {
    if (!isRecord(conflict)) {
      return [];
    }
    const issues: AgentDirectiveBundleValidationIssue[] = [];
    if (Array.isArray(conflict.directiveIds)) {
      conflict.directiveIds.forEach((directiveId, directiveIndex) => {
        if (typeof directiveId === "string" && !directiveIds.has(directiveId)) {
          issues.push(issue(`${path}[${index}].directiveIds[${directiveIndex}]`, "must reference a directive id from this bundle"));
        }
      });
    }
    if (typeof conflict.resolvedDirectiveId === "string" && !directiveIds.has(conflict.resolvedDirectiveId)) {
      issues.push(issue(`${path}[${index}].resolvedDirectiveId`, "must reference a directive id from this bundle"));
    }
    return issues;
  });
}

function deprecationReferenceIssues(
  value: unknown,
  path: string,
  directiveIds: ReadonlySet<string>
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((deprecation, index) => {
    if (!isRecord(deprecation)) {
      return [];
    }
    const issues: AgentDirectiveBundleValidationIssue[] = [];
    if (typeof deprecation.directiveId === "string" && !directiveIds.has(deprecation.directiveId)) {
      issues.push(issue(`${path}[${index}].directiveId`, "must reference a directive id from this bundle"));
    }
    if (typeof deprecation.deprecatedBy === "string" && !directiveIds.has(deprecation.deprecatedBy)) {
      issues.push(issue(`${path}[${index}].deprecatedBy`, "must reference a directive id from this bundle"));
    }
    return issues;
  });
}

function dataValueIssues(
  value: unknown,
  path: string,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>,
  requireObject: boolean
): readonly AgentDirectiveBundleValidationIssue[] {
  if (depth > maxDepth) {
    return [issue(path, `must not exceed ${maxDepth} nested levels`)];
  }
  if (requireObject && !isPlainRecord(value)) {
    return [issue(path, "must be an object")];
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" ? safeStringContentIssues(value, path) : [];
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [issue(path, "must be a finite number")];
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return [issue(path, "must be JSON-compatible data")];
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return [issue(path, "must not contain circular references")];
    }
    seen.add(value);
    const issues = value.flatMap((entry, index) =>
      dataValueIssues(entry, `${path}[${index}]`, maxDepth, depth + 1, seen, false)
    );
    seen.delete(value);
    return issues;
  }
  if (!isPlainRecord(value)) {
    return [issue(path, "must be a plain object, array, string, number, boolean, or null")];
  }
  if (seen.has(value)) {
    return [issue(path, "must not contain circular references")];
  }
  seen.add(value);
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  const issues: AgentDirectiveBundleValidationIssue[] = [];
  for (const [key, entry] of entries) {
    if (!DATA_KEY_PATTERN.test(key) || key === "__proto__" || key === "prototype" || key === "constructor") {
      issues.push(issue(`${path}.${key}`, "must use a safe data key"));
    }
    issues.push(...safeStringContentIssues(key, `${path}.${key}`));
    issues.push(...dataValueIssues(entry, `${path}.${key}`, maxDepth, depth + 1, seen, false));
  }
  seen.delete(value);
  return issues;
}

function trustedRegistryPathIssues(
  value: unknown,
  path: string,
  options: AgentDirectiveBundleValidationOptions
): readonly AgentDirectiveBundleValidationIssue[] {
  const issues = nonEmptySafeStringIssues(value, path);
  if (typeof value !== "string") {
    return issues;
  }
  const pathSegments = value.split("/");
  const trustedPrefixes = options.trustedRegistryPathPrefixes ?? AGENT_DIRECTIVE_TRUSTED_REGISTRY_PATH_PREFIXES;
  return [
    ...issues,
    ...(value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("://") ||
    pathSegments.includes("..") ||
    pathSegments.includes(".")
      ? [issue(path, "must be a relative checked-in registry path")]
      : []),
    ...(trustedPrefixes.some((prefix) => value.startsWith(prefix))
      ? []
      : [issue(path, `must start with a trusted registry path prefix: ${trustedPrefixes.join(", ")}`)])
  ];
}

function stableMachineIdArrayIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  const issues = value.flatMap((entry, index) => stableMachineIdIssues(entry, `${path}[${index}]`));
  return new Set(value).size === value.length ? issues : [...issues, issue(path, "must contain unique values")];
}

function nonEmptySafeStringArrayIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  const issues = value.flatMap((entry, index) => nonEmptySafeStringIssues(entry, `${path}[${index}]`));
  return new Set(value).size === value.length ? issues : [...issues, issue(path, "must contain unique values")];
}

function enumArrayIssues<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[]
): readonly AgentDirectiveBundleValidationIssue[] {
  if (!Array.isArray(value)) {
    return [issue(path, "must be an array")];
  }
  const issues = value.flatMap((entry, index) => enumIssues(entry, `${path}[${index}]`, allowed));
  return new Set(value).size === value.length ? issues : [...issues, issue(path, "must contain unique values")];
}

function stableMachineIdIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  const issues = nonEmptySafeStringIssues(value, path);
  if (typeof value !== "string") {
    return issues;
  }
  return STABLE_MACHINE_ID_PATTERN.test(value) ? issues : [...issues, issue(path, "must be a stable lowercase machine id")];
}

function optionalStableMachineIdIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  return value === undefined ? [] : stableMachineIdIssues(value, path);
}

function optionalNonEmptySafeStringIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  return value === undefined ? [] : nonEmptySafeStringIssues(value, path);
}

function optionalContentHashIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (value === undefined) {
    return [];
  }
  const issues = nonEmptySafeStringIssues(value, path);
  if (typeof value !== "string") {
    return issues;
  }
  return CONTENT_HASH_PATTERN.test(value) ? issues : [...issues, issue(path, `must match ${CONTENT_HASH_PATTERN.source}`)];
}

function literalIssues(
  value: unknown,
  path: string,
  expected: string
): readonly AgentDirectiveBundleValidationIssue[] {
  return value === expected ? [] : [issue(path, `must be ${expected}`)];
}

function enumIssues<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[]
): readonly AgentDirectiveBundleValidationIssue[] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? []
    : [issue(path, `must be one of: ${allowed.join(", ")}`)];
}

function nonEmptySafeStringIssues(value: unknown, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  if (typeof value !== "string" || value.length === 0) {
    return [issue(path, "must be a non-empty string")];
  }
  return safeStringContentIssues(value, path);
}

function safeStringContentIssues(value: string, path: string): readonly AgentDirectiveBundleValidationIssue[] {
  const findings = detectSuspiciousUnicode(value);
  return findings.length === 0
    ? []
    : [
        issue(
          path,
          `must not contain suspicious Unicode: ${findings.map((finding) => `${finding.codePoint} ${finding.kind}`).join(", ")}`
        )
      ];
}

function issue(path: string, message: string): AgentDirectiveBundleValidationIssue {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
