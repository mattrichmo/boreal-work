import {
  AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
  agentDirectiveBundleIssues,
  agentDirectiveDataIssues,
  agentDirectiveRegistryIssues,
  type AgentDirective,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleId,
  type AgentDirectiveData,
  type AgentDirectiveDataRequirement,
  type AgentDirectiveDataValue,
  type AgentDirectiveId,
  type AgentDirectiveMissingRequiredEntry,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveSubject,
  type AgentDirectiveSubjectType,
  type AgentDirectiveTemplateId
} from "./agent-directives.js";
import { AGENT_DIRECTIVE_REGISTRY } from "./agent-directive-registry.js";
import {
  agentDirectiveSnapshotHash,
  agentDirectiveSnapshotIssues,
  type AgentDirectiveSnapshot
} from "./agent-directive-snapshot.js";
import type { ContentHash } from "./ids.js";
import { isIsoTimestamp, type IsoTimestamp } from "./time.js";

export type AgentDirectiveAssemblyIssuePhase =
  | "snapshot"
  | "registry"
  | "selection"
  | "data"
  | "bundle_validation";

export interface AgentDirectiveBundleAssemblyIssue {
  readonly phase: AgentDirectiveAssemblyIssuePhase;
  readonly path: string;
  readonly message: string;
  readonly registryId?: AgentDirectiveTemplateId;
}

export type AgentDirectiveAssemblyDataByRegistryId = Readonly<Record<string, AgentDirectiveData | undefined>>;

export interface AgentDirectiveBundleAssemblyInput {
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
}

export interface AgentDirectiveRegistrySelection {
  readonly registryEntry: AgentDirectiveRegistryEntry;
  readonly selectedBy: readonly string[];
}

export interface AgentDirectiveBundleAssemblyResult {
  readonly ok: boolean;
  readonly selectedRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly issues: readonly AgentDirectiveBundleAssemblyIssue[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
  readonly bundle?: AgentDirectiveBundle;
}

export function selectAgentDirectiveRegistryEntries(
  snapshot: AgentDirectiveSnapshot,
  registry: AgentDirectiveRegistry = AGENT_DIRECTIVE_REGISTRY
): readonly AgentDirectiveRegistrySelection[] {
  const snapshotIssues = agentDirectiveSnapshotIssues(snapshot);
  if (snapshotIssues.length > 0) {
    return [];
  }
  const registryIssues = agentDirectiveRegistryIssues(registry);
  if (registryIssues.length > 0) {
    return [];
  }
  return registry.entries.flatMap((registryEntry) => {
    const selectedBy = registryEntrySelectedBy(registryEntry, snapshot);
    return selectedBy.length > 0 ? [{ registryEntry, selectedBy }] : [];
  });
}

export function assembleAgentDirectiveBundle(
  input: AgentDirectiveBundleAssemblyInput
): AgentDirectiveBundleAssemblyResult {
  const registry = input.registry ?? AGENT_DIRECTIVE_REGISTRY;
  const snapshotIssues = agentDirectiveSnapshotIssues(input.snapshot).map((snapshotIssue) =>
    assemblyIssue("snapshot", snapshotIssue.path, snapshotIssue.message)
  );
  const registryIssues = agentDirectiveRegistryIssues(registry).map((registryIssue) =>
    assemblyIssue("registry", registryIssue.path, registryIssue.message)
  );
  if (snapshotIssues.length > 0 || registryIssues.length > 0) {
    return {
      ok: false,
      selectedRegistryIds: [],
      issues: [...snapshotIssues, ...registryIssues],
      missingRequired: []
    };
  }

  const selections = selectAgentDirectiveRegistryEntries(input.snapshot, registry);
  const snapshotHash = agentDirectiveSnapshotHash(input.snapshot);
  const dataIssues: AgentDirectiveBundleAssemblyIssue[] = [];
  const missingRequired: AgentDirectiveMissingRequiredEntry[] = [];
  const directives: AgentDirective[] = [];

  for (const selection of selections) {
    const { registryEntry, selectedBy } = selection;
    const data = input.dataByRegistryId[registryEntry.id] ?? {};
    const registryDataPath = `$.dataByRegistryId.${registryEntry.id}`;
    const currentDataIssues = directiveDataIssues(registryEntry, data, registryDataPath);

    if (currentDataIssues.length > 0) {
      dataIssues.push(...currentDataIssues);
      missingRequired.push(...missingRequiredEntries(registryEntry, data, input.snapshot));
      continue;
    }

    directives.push(directiveFromRegistryEntry(registryEntry, registry, input.snapshot, data, selectedBy, snapshotHash));
  }

  const selectedRegistryIds = selections.map((selection) => selection.registryEntry.id);
  if (dataIssues.length > 0) {
    return {
      ok: false,
      selectedRegistryIds,
      issues: dataIssues,
      missingRequired
    };
  }

  const bundle: AgentDirectiveBundle = {
    meta: {
      id: input.bundleId ?? bundleIdForSnapshot(input.snapshot, snapshotHash),
      schemaVersion: AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
      registryVersion: registry.version,
      generatedAt: input.generatedAt ?? input.snapshot.capturedAt,
      commandPath: input.snapshot.command.path,
      envelopeSchema: input.snapshot.command.envelopeSchema,
      sourceSnapshotHash: snapshotHash
    },
    directives,
    conflicts: [],
    deprecations: [],
    missingRequired: []
  };
  const bundleValidationIssues = agentDirectiveBundleIssues(bundle, {
    knownRegistryEntries: registry.entries
  }).map((bundleIssue) => assemblyIssue("bundle_validation", bundleIssue.path, bundleIssue.message));

  return bundleValidationIssues.length > 0
    ? {
        ok: false,
        selectedRegistryIds,
        issues: bundleValidationIssues,
        missingRequired: []
      }
    : {
        ok: true,
        selectedRegistryIds,
        issues: [],
        missingRequired: [],
        bundle
      };
}

function registryEntrySelectedBy(
  registryEntry: AgentDirectiveRegistryEntry,
  snapshot: AgentDirectiveSnapshot
): readonly string[] {
  if (registryEntry.lifecycle !== "active") {
    return [];
  }
  if (!registryEntry.appliesTo.commandPaths.includes(snapshot.command.path)) {
    return [];
  }

  const selectedBy = ["applies.command_path"];
  const snapshotSubjectTypes = subjectTypesForSnapshot(snapshot);
  if (
    registryEntry.appliesTo.subjectTypes !== undefined &&
    !registryEntry.appliesTo.subjectTypes.some((subjectType) => snapshotSubjectTypes.includes(subjectType))
  ) {
    return [];
  }
  if (registryEntry.appliesTo.subjectTypes !== undefined) {
    selectedBy.push("applies.subject_type");
  }

  const workStatus = snapshot.work.subject?.status;
  if (
    registryEntry.appliesTo.workStatuses !== undefined &&
    (workStatus === undefined || !registryEntry.appliesTo.workStatuses.includes(workStatus))
  ) {
    return [];
  }
  if (registryEntry.appliesTo.workStatuses !== undefined) {
    selectedBy.push("applies.work_status");
  }

  if (
    registryEntry.appliesTo.labels !== undefined &&
    !registryEntry.appliesTo.labels.some((label) => snapshot.work.labels.includes(label))
  ) {
    return [];
  }
  if (registryEntry.appliesTo.labels !== undefined) {
    selectedBy.push("applies.label");
  }

  if (
    registryEntry.appliesTo.gates !== undefined &&
    !registryEntry.appliesTo.gates.some((gateKind) =>
      snapshot.gate.requiredGates.some((gate) => gate.kind === gateKind)
    )
  ) {
    return [];
  }
  if (registryEntry.appliesTo.gates !== undefined) {
    selectedBy.push("applies.gate");
  }

  return selectedBy;
}

function directiveDataIssues(
  registryEntry: AgentDirectiveRegistryEntry,
  data: AgentDirectiveData,
  path: string
): readonly AgentDirectiveBundleAssemblyIssue[] {
  const issues = agentDirectiveDataIssues(data, path).map((dataIssue) =>
    assemblyIssue("data", dataIssue.path, dataIssue.message, registryEntry.id)
  );
  return [
    ...issues,
    ...registryEntry.dataRequirements.flatMap((requirement) =>
      dataRequirementIssues(registryEntry, data, requirement, `${path}.${requirement.key}`)
    )
  ];
}

function dataRequirementIssues(
  registryEntry: AgentDirectiveRegistryEntry,
  data: AgentDirectiveData,
  requirement: AgentDirectiveDataRequirement,
  path: string
): readonly AgentDirectiveBundleAssemblyIssue[] {
  const hasValue = Object.prototype.hasOwnProperty.call(data, requirement.key);
  if (!hasValue) {
    return requirement.required
      ? [assemblyIssue("data", path, "missing required directive data", registryEntry.id)]
      : [];
  }
  const value = data[requirement.key];
  return dataValueMatchesRequirement(value, requirement.valueType)
    ? []
    : [assemblyIssue("data", path, `must be ${requirement.valueType} directive data`, registryEntry.id)];
}

function missingRequiredEntries(
  registryEntry: AgentDirectiveRegistryEntry,
  data: AgentDirectiveData,
  snapshot: AgentDirectiveSnapshot
): readonly AgentDirectiveMissingRequiredEntry[] {
  return registryEntry.dataRequirements.flatMap((requirement) =>
    requirement.required && !Object.prototype.hasOwnProperty.call(data, requirement.key)
      ? [
          {
            registryId: registryEntry.id,
            family: registryEntry.family,
            subject: subjectForSnapshot(snapshot),
            requirement: requirement.key,
            message: `Missing required directive data: ${requirement.key}`
          }
        ]
      : []
  );
}

function directiveFromRegistryEntry(
  registryEntry: AgentDirectiveRegistryEntry,
  registry: AgentDirectiveRegistry,
  snapshot: AgentDirectiveSnapshot,
  data: AgentDirectiveData,
  selectedBy: readonly string[],
  snapshotHash: ContentHash
): AgentDirective {
  return {
    id: directiveIdForRegistryEntry(registryEntry, snapshotHash),
    registryId: registryEntry.id,
    version: registryEntry.version,
    family: registryEntry.family,
    severity: registryEntry.severity,
    audience: registryEntry.audience,
    kind: registryEntry.kind,
    lifecycle: registryEntry.defaultLifecycle,
    title: registryEntry.title,
    instruction: registryEntry.instruction,
    data,
    source: {
      registryVersion: registry.version,
      registryPath: registryEntry.sourcePath,
      selectedBy,
      snapshotHash
    },
    subject: subjectForSnapshot(snapshot),
    appliesTo: registryEntry.appliesTo,
    supersedes: [],
    blocksCloseout: registryEntry.blocksCloseout,
    acknowledgement: registryEntry.acknowledgement
  };
}

function subjectForSnapshot(snapshot: AgentDirectiveSnapshot): AgentDirectiveSubject {
  if (snapshot.work.subject !== undefined) {
    return {
      type: snapshot.work.subject.type,
      id: snapshot.work.subject.id,
      title: snapshot.work.subject.title
    };
  }
  return {
    type: "command",
    id: normalizeMachineFragment(snapshot.command.path),
    title: snapshot.command.path
  };
}

function subjectTypesForSnapshot(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveSubjectType[] {
  const subjectTypes = new Set<AgentDirectiveSubjectType>(["command"]);
  if (snapshot.work.subject !== undefined) {
    subjectTypes.add(snapshot.work.subject.type);
  }
  if (snapshot.work.subject === undefined) {
    subjectTypes.add("workspace");
  }
  return [...subjectTypes];
}

function bundleIdForSnapshot(snapshot: AgentDirectiveSnapshot, snapshotHash: ContentHash): AgentDirectiveBundleId {
  return `bundle.${normalizeMachineFragment(snapshot.command.path)}.${hashSuffix(snapshotHash)}` as AgentDirectiveBundleId;
}

function directiveIdForRegistryEntry(
  registryEntry: AgentDirectiveRegistryEntry,
  snapshotHash: ContentHash
): AgentDirectiveId {
  return `directive.${registryEntry.id}.${hashSuffix(snapshotHash)}` as AgentDirectiveId;
}

function dataValueMatchesRequirement(value: AgentDirectiveDataValue | undefined, valueType: string): boolean {
  if (value === undefined) {
    return false;
  }
  switch (valueType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainRecord(value);
    case "id":
    case "uri":
      return typeof value === "string" && value.trim().length > 0;
    case "timestamp":
      return isIsoTimestamp(value);
    case "content_hash":
      return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
    default:
      return false;
  }
}

function normalizeMachineFragment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._:]+/gu, ".")
    .replace(/[.]{2,}/gu, ".")
    .replace(/^[._:]+|[._:]+$/gu, "");
  return normalized.length > 0 && /^[a-z0-9]/u.test(normalized) ? normalized : "command";
}

function hashSuffix(hash: ContentHash): string {
  return hash.replace("sha256:", "").slice(0, 12);
}

function isPlainRecord(value: unknown): value is { readonly [key: string]: AgentDirectiveDataValue } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assemblyIssue(
  phase: AgentDirectiveAssemblyIssuePhase,
  path: string,
  message: string,
  registryId?: AgentDirectiveTemplateId
): AgentDirectiveBundleAssemblyIssue {
  return { phase, path, message, registryId };
}
