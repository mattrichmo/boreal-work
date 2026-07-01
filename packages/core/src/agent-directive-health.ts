import { AGENT_DIRECTIVE_REGISTRY } from "./agent-directive-registry.js";
import {
  agentDirectiveBundleIssues,
  agentDirectiveDataIssues,
  agentDirectiveRegistryIssues,
  type AgentDirective,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleValidationIssue,
  type AgentDirectiveDataRequirement,
  type AgentDirectiveDataValue,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveRegistryVersion
} from "./agent-directives.js";
import { isIsoTimestamp } from "./time.js";

export const AGENT_DIRECTIVE_HEALTH_ISSUE_KINDS = [
  "registry_invalid",
  "bundle_invalid",
  "unknown_id",
  "deprecated_emission",
  "duplicate_id",
  "invalid_data",
  "unsafe_dynamic_instruction",
  "stale_registry_version",
  "missing_required_directive",
  "conflict"
] as const;

export type AgentDirectiveHealthIssueKind = (typeof AGENT_DIRECTIVE_HEALTH_ISSUE_KINDS)[number];
export type AgentDirectiveHealthIssueSeverity = "error" | "warning";
export type AgentDirectiveHealthIssueSource = "registry" | "bundle";

export interface AgentDirectiveHealthIssue {
  readonly kind: AgentDirectiveHealthIssueKind;
  readonly severity: AgentDirectiveHealthIssueSeverity;
  readonly source: AgentDirectiveHealthIssueSource;
  readonly path: string;
  readonly message: string;
  readonly bundleId?: string;
  readonly registryId?: string;
  readonly directiveId?: string;
}

export interface AgentDirectiveHealthReport {
  readonly ok: boolean;
  readonly registryVersion: AgentDirectiveRegistryVersion;
  readonly checkedBundles: number;
  readonly issueCounts: Readonly<Record<AgentDirectiveHealthIssueKind, number>>;
  readonly issues: readonly AgentDirectiveHealthIssue[];
}

export interface AgentDirectiveHealthReportInput {
  readonly registry?: AgentDirectiveRegistry;
  readonly bundles?: readonly AgentDirectiveBundle[];
  readonly currentRegistryVersion?: AgentDirectiveRegistryVersion;
}

const DYNAMIC_INSTRUCTION_PATTERN = /\$\{|\{\{|\$[A-Za-z_]/u;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export function agentDirectiveHealthReport(input: AgentDirectiveHealthReportInput = {}): AgentDirectiveHealthReport {
  const registry = input.registry ?? AGENT_DIRECTIVE_REGISTRY;
  const currentRegistryVersion = input.currentRegistryVersion ?? registry.version;
  const registryEntriesById = new Map<string, AgentDirectiveRegistryEntry>(
    registry.entries.map((entry) => [entry.id, entry])
  );
  const rawIssues: AgentDirectiveHealthIssue[] = [
    ...agentDirectiveRegistryIssues(registry).map((issue) => healthIssueFromRegistryIssue(issue))
  ];

  for (const [bundleIndex, bundle] of (input.bundles ?? []).entries()) {
    const bundleId = bundle.meta.id ?? `bundle[${bundleIndex}]`;
    rawIssues.push(
      ...agentDirectiveBundleIssues(bundle, { knownRegistryEntries: registry.entries }).map((issue) =>
        healthIssueFromBundleIssue(issue, bundleId)
      )
    );
    rawIssues.push(...bundleRegistryVersionIssues(bundle, bundleId, currentRegistryVersion));
    rawIssues.push(...bundleDirectiveHealthIssues(bundle, bundleId, registryEntriesById, currentRegistryVersion));
    rawIssues.push(...bundleMissingRequiredIssues(bundle, bundleId));
    rawIssues.push(...bundleConflictIssues(bundle, bundleId));
  }

  const issues = uniqueHealthIssues(rawIssues);
  return {
    ok: issues.length === 0,
    registryVersion: registry.version,
    checkedBundles: input.bundles?.length ?? 0,
    issueCounts: healthIssueCounts(issues),
    issues
  };
}

function healthIssueFromRegistryIssue(issue: AgentDirectiveBundleValidationIssue): AgentDirectiveHealthIssue {
  return {
    kind: classifyValidationIssue(issue, "registry"),
    severity: "error",
    source: "registry",
    path: issue.path,
    message: issue.message,
    registryId: registryIdFromPath(issue.path)
  };
}

function healthIssueFromBundleIssue(issue: AgentDirectiveBundleValidationIssue, bundleId: string): AgentDirectiveHealthIssue {
  return {
    kind: classifyValidationIssue(issue, "bundle"),
    severity: "error",
    source: "bundle",
    path: issue.path,
    message: issue.message,
    bundleId,
    registryId: registryIdFromPath(issue.path),
    directiveId: directiveIdFromPath(issue.path)
  };
}

function classifyValidationIssue(
  issue: AgentDirectiveBundleValidationIssue,
  source: AgentDirectiveHealthIssueSource
): AgentDirectiveHealthIssueKind {
  const message = issue.message.toLowerCase();
  if (message.includes("known registry") || message.includes("known registry entry")) {
    return "unknown_id";
  }
  if (message.includes("unique")) {
    return "duplicate_id";
  }
  if (message.includes("interpolation markers")) {
    return "unsafe_dynamic_instruction";
  }
  if (message.includes("superseded") || message.includes("deprecation metadata") || message.includes("active registry")) {
    return "deprecated_emission";
  }
  if (issue.path.includes(".data") || issue.path.includes(".dataRequirements") || message.includes("json-compatible")) {
    return "invalid_data";
  }
  return source === "registry" ? "registry_invalid" : "bundle_invalid";
}

function bundleRegistryVersionIssues(
  bundle: AgentDirectiveBundle,
  bundleId: string,
  currentRegistryVersion: AgentDirectiveRegistryVersion
): readonly AgentDirectiveHealthIssue[] {
  const issues: AgentDirectiveHealthIssue[] = [];
  if (bundle.meta.registryVersion !== currentRegistryVersion) {
    issues.push({
      kind: "stale_registry_version",
      severity: "error",
      source: "bundle",
      path: "$.meta.registryVersion",
      message: `must be current registry version ${currentRegistryVersion}`,
      bundleId
    });
  }
  return issues;
}

function bundleDirectiveHealthIssues(
  bundle: AgentDirectiveBundle,
  bundleId: string,
  registryEntriesById: ReadonlyMap<string, AgentDirectiveRegistryEntry>,
  currentRegistryVersion: AgentDirectiveRegistryVersion
): readonly AgentDirectiveHealthIssue[] {
  return bundle.directives.flatMap((directive, index) =>
    directiveHealthIssues(directive, `$.directives[${index}]`, bundleId, registryEntriesById, currentRegistryVersion)
  );
}

function directiveHealthIssues(
  directive: AgentDirective,
  path: string,
  bundleId: string,
  registryEntriesById: ReadonlyMap<string, AgentDirectiveRegistryEntry>,
  currentRegistryVersion: AgentDirectiveRegistryVersion
): readonly AgentDirectiveHealthIssue[] {
  const issues: AgentDirectiveHealthIssue[] = [];
  const registryEntry = registryEntriesById.get(directive.registryId);
  if (registryEntry === undefined) {
    issues.push({
      kind: "unknown_id",
      severity: "error",
      source: "bundle",
      path: `${path}.registryId`,
      message: "must reference a known registry id",
      bundleId,
      registryId: directive.registryId,
      directiveId: directive.id
    });
    return issues;
  }

  if (registryEntry.lifecycle !== "active") {
    issues.push({
      kind: "deprecated_emission",
      severity: "error",
      source: "bundle",
      path: `${path}.registryId`,
      message: "must not emit a non-active registry entry as an active directive",
      bundleId,
      registryId: directive.registryId,
      directiveId: directive.id
    });
  }
  if (directive.instruction !== registryEntry.instruction || DYNAMIC_INSTRUCTION_PATTERN.test(directive.instruction)) {
    issues.push({
      kind: "unsafe_dynamic_instruction",
      severity: "error",
      source: "bundle",
      path: `${path}.instruction`,
      message: "must match static registry instruction text and contain no interpolation markers",
      bundleId,
      registryId: directive.registryId,
      directiveId: directive.id
    });
  }
  if (directive.source.registryVersion !== currentRegistryVersion) {
    issues.push({
      kind: "stale_registry_version",
      severity: "error",
      source: "bundle",
      path: `${path}.source.registryVersion`,
      message: `must be current registry version ${currentRegistryVersion}`,
      bundleId,
      registryId: directive.registryId,
      directiveId: directive.id
    });
  }
  issues.push(...directiveDataHealthIssues(directive, path, bundleId, registryEntry));
  return issues;
}

function directiveDataHealthIssues(
  directive: AgentDirective,
  path: string,
  bundleId: string,
  registryEntry: AgentDirectiveRegistryEntry
): readonly AgentDirectiveHealthIssue[] {
  const dataPath = `${path}.data`;
  const issues: AgentDirectiveHealthIssue[] = agentDirectiveDataIssues(directive.data, dataPath).map((dataIssue) => ({
    kind: "invalid_data",
    severity: "error",
    source: "bundle",
    path: dataIssue.path,
    message: dataIssue.message,
    bundleId,
    registryId: directive.registryId,
    directiveId: directive.id
  }));

  for (const requirement of registryEntry.dataRequirements) {
    const requirementPath = `${dataPath}.${requirement.key}`;
    if (!Object.prototype.hasOwnProperty.call(directive.data, requirement.key)) {
      if (requirement.required) {
        issues.push({
          kind: "missing_required_directive",
          severity: "error",
          source: "bundle",
          path: requirementPath,
          message: "missing required directive data",
          bundleId,
          registryId: directive.registryId,
          directiveId: directive.id
        });
      }
      continue;
    }

    const value = directive.data[requirement.key];
    if (!dataValueMatchesRequirement(value, requirement)) {
      issues.push({
        kind: "invalid_data",
        severity: "error",
        source: "bundle",
        path: requirementPath,
        message: `must be ${requirement.valueType} directive data`,
        bundleId,
        registryId: directive.registryId,
        directiveId: directive.id
      });
    }
  }

  return issues;
}

function bundleMissingRequiredIssues(bundle: AgentDirectiveBundle, bundleId: string): readonly AgentDirectiveHealthIssue[] {
  return bundle.missingRequired.map((entry, index) => ({
    kind: "missing_required_directive",
    severity: "error",
    source: "bundle",
    path: `$.missingRequired[${index}]`,
    message: entry.message,
    bundleId,
    registryId: entry.registryId,
    directiveId: undefined
  }));
}

function bundleConflictIssues(bundle: AgentDirectiveBundle, bundleId: string): readonly AgentDirectiveHealthIssue[] {
  return bundle.conflicts.map((conflict, index) => ({
    kind: "conflict",
    severity: "warning",
    source: "bundle",
    path: `$.conflicts[${index}]`,
    message: conflict.reason,
    bundleId,
    directiveId: conflict.resolvedDirectiveId
  }));
}

function dataValueMatchesRequirement(
  value: AgentDirectiveDataValue | undefined,
  requirement: AgentDirectiveDataRequirement
): boolean {
  switch (requirement.valueType) {
    case "string":
      return typeof value === "string" && value.length > 0;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainRecord(value);
    case "id":
      return typeof value === "string" && value.trim().length > 0;
    case "timestamp":
      return typeof value === "string" && isIsoTimestamp(value);
    case "content_hash":
      return typeof value === "string" && CONTENT_HASH_PATTERN.test(value);
    case "uri":
      return typeof value === "string" && value.trim().length > 0;
  }
}

function healthIssueCounts(
  issues: readonly AgentDirectiveHealthIssue[]
): Readonly<Record<AgentDirectiveHealthIssueKind, number>> {
  const counts = Object.fromEntries(AGENT_DIRECTIVE_HEALTH_ISSUE_KINDS.map((kind) => [kind, 0])) as Record<
    AgentDirectiveHealthIssueKind,
    number
  >;
  for (const issue of issues) {
    counts[issue.kind] += 1;
  }
  return counts;
}

function uniqueHealthIssues(issues: readonly AgentDirectiveHealthIssue[]): readonly AgentDirectiveHealthIssue[] {
  const seen = new Set<string>();
  const output: AgentDirectiveHealthIssue[] = [];
  for (const issue of issues) {
    const key = [issue.kind, issue.source, issue.path, issue.bundleId ?? "", issue.registryId ?? "", issue.directiveId ?? ""].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(issue);
  }
  return output;
}

function registryIdFromPath(path: string): string | undefined {
  const match = /\.registryId$/u.test(path) ? undefined : path.match(/\$\.dataByRegistryId\.([A-Za-z0-9._:-]+)/u);
  return match?.[1];
}

function directiveIdFromPath(path: string): string | undefined {
  return path.match(/\$\.directives\[(\d+)\]\.id/u)?.[1];
}

function isPlainRecord(value: unknown): value is Record<string, AgentDirectiveDataValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
