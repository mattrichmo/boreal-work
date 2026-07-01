import {
  AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
  agentDirectiveBundleIssues,
  agentDirectiveDataIssues,
  agentDirectiveRegistryIssues,
  type AgentDirective,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleId,
  type AgentDirectiveConflict,
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
import type {
  AgentSummaryForceReasonCode,
  AgentSummaryOutcome,
  AgentSummaryStatus,
  VerificationVerdict
} from "./records.js";
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

export interface AgentDirectiveCloseoutDataOptions {
  readonly summaryStatus?: AgentSummaryStatus;
  readonly summaryOutcome?: AgentSummaryOutcome;
  readonly closeReason?: string;
  readonly duplicateOf?: string;
  readonly forceReasonCode?: AgentSummaryForceReasonCode;
  readonly forceComment?: string;
  readonly checkpointReasonCode?: string;
  readonly validationCommand?: string;
  readonly expectedVerificationVerdict?: VerificationVerdict;
  readonly nextWorkflowRef?: string;
  readonly nextCommandPath?: string;
  readonly nextRequiredInputs?: readonly string[];
}

export interface AgentDirectiveCloseoutCompilationInput extends AgentDirectiveCloseoutDataOptions {
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
}

export interface AgentDirectiveCloseoutCompilationResult extends AgentDirectiveBundleAssemblyResult {
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
}

export interface AgentDirectiveRollupChildStatus {
  readonly workId: string;
  readonly title?: string;
  readonly status: string;
  readonly summaryIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly verificationIds?: readonly string[];
  readonly commitShas?: readonly string[];
  readonly deferred?: boolean;
  readonly deferralReason?: string;
}

export interface AgentDirectiveSummaryDataOptions extends AgentDirectiveCloseoutDataOptions {
  readonly childWorkIds?: readonly string[];
  readonly childSummaryIds?: readonly string[];
  readonly childStatuses?: readonly AgentDirectiveRollupChildStatus[];
  readonly carryoverWorkIds?: readonly string[];
  readonly deferredWorkIds?: readonly string[];
  readonly findingsDisposition?: string;
}

export interface AgentDirectiveSummaryCompilationInput extends AgentDirectiveSummaryDataOptions {
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
}

export interface AgentDirectiveSummaryCompilationResult extends AgentDirectiveBundleAssemblyResult {
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
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
  const dataIssues: AgentDirectiveBundleAssemblyIssue[] = [...staleDataReferenceIssues(input.dataByRegistryId, registry)];
  const missingRequired: AgentDirectiveMissingRequiredEntry[] = [];
  const directives: AgentDirective[] = [];

  for (const selection of selections) {
    const { registryEntry, selectedBy } = selection;
    const data = input.dataByRegistryId[registryEntry.id] ?? {};
    const registryDataPath = `$.dataByRegistryId.${registryEntry.id}`;
    const currentDataIssues = directiveDataIssues(registryEntry, data, registryDataPath);

    if (currentDataIssues.length > 0) {
      dataIssues.push(...currentDataIssues);
      missingRequired.push(...missingRequiredEntries(registryEntry, currentDataIssues, input.snapshot));
      continue;
    }

    directives.push(directiveFromRegistryEntry(registryEntry, registry, input.snapshot, data, selectedBy, snapshotHash));
  }

  const selectedRegistryIds = selections.map((selection) => selection.registryEntry.id);
  const conflicts = resolveAgentDirectiveConflicts(directives, registry);
  const resolvedDirectives = applyConflictLifecycles(directives, conflicts);

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
    directives: resolvedDirectives,
    conflicts,
    deprecations: [],
    missingRequired
  };
  const bundleValidationIssues = agentDirectiveBundleIssues(bundle, {
    knownRegistryEntries: registry.entries
  }).map((bundleIssue) => assemblyIssue("bundle_validation", bundleIssue.path, bundleIssue.message));

  return bundleValidationIssues.length > 0
    ? {
        ok: false,
        selectedRegistryIds,
        issues: bundleValidationIssues,
        missingRequired
      }
    : {
        ok: dataIssues.length === 0,
        selectedRegistryIds,
        issues: dataIssues,
        missingRequired,
        bundle
      };
}

export function closeoutDirectiveDataByRegistryId(
  snapshot: AgentDirectiveSnapshot,
  options: AgentDirectiveCloseoutDataOptions = {}
): AgentDirectiveAssemblyDataByRegistryId {
  const subjectId = snapshot.work.subject?.id;
  const latestSummaryId =
    snapshot.summary.latestSummaryId ?? last(snapshot.summary.finalSummaryIds) ?? last(snapshot.summary.summaryIds);
  const latestSummaryUri = snapshot.summary.latestSummaryUri ?? last(snapshot.summary.artifactUris);
  const evidenceIds = snapshot.evidence.evidenceIds;
  const verificationIds = snapshot.evidence.verificationIds;
  const commitShas = uniqueStrings([...snapshot.git.checkpointCommitShas, ...snapshot.summary.commitShas]);
  const dirtyPathNotes = uniqueStrings([...snapshot.git.dirtyPathNotes, ...snapshot.summary.dirtyPathNotes]);
  const primaryGitRoot = snapshot.git.roots[0];
  const nextWorkflowRef = options.nextWorkflowRef ?? snapshot.workflow.nextWorkflowRef;
  const nextCommandPath = options.nextCommandPath ?? snapshot.workflow.recommendedCommandPath;
  const checkpointReasonCode =
    options.checkpointReasonCode ?? inferCheckpointReasonCode(options.summaryOutcome, commitShas, dirtyPathNotes);

  return {
    "closeout.summary-required": dataRecord([
      ["subjectId", subjectId],
      ["summaryId", latestSummaryId],
      ["summaryUri", latestSummaryUri],
      ["evidenceIds", evidenceIds],
      ["verificationIds", verificationIds],
      ["commitShas", commitShas],
      ["dirtyPathNotes", dirtyPathNotes],
      ["summaryStatus", options.summaryStatus],
      ["summaryOutcome", options.summaryOutcome],
      ["closeReason", options.closeReason ?? snapshot.work.subject?.closedReason],
      ["duplicateOf", options.duplicateOf],
      ["forceReasonCode", options.forceReasonCode],
      ["forceComment", options.forceComment]
    ]),
    "git.checkpoint-required": dataRecord([
      ["gitRoot", primaryGitRoot?.root],
      ["commitShas", commitShas],
      ["dirtyPathNotes", dirtyPathNotes],
      ["reasonCode", checkpointReasonCode],
      ["branchName", primaryGitRoot?.branchName]
    ]),
    "verification.evidence-required": dataRecord([
      ["subjectId", subjectId],
      ["command", options.validationCommand ?? latestEvidenceCommand(snapshot)],
      ["expectedVerdict", options.expectedVerificationVerdict ?? "passed"],
      ["evidenceIds", evidenceIds],
      ["verificationIds", verificationIds]
    ]),
    "handoff.session-summary": dataRecord([
      ["workId", subjectId],
      ["summaryUri", latestSummaryUri],
      ["nextWorkflow", nextWorkflowRef],
      ["reservationIds", snapshot.actor.activeReservationIds],
      ["commitShas", commitShas]
    ]),
    "container.descendant-closeout": dataRecord([
      ["containerId", subjectId],
      ["openDescendantIds", snapshot.work.openDescendantIds],
      ["requiredGateIds", snapshot.gate.openGateIds],
      ["childSummaryIds", snapshot.summary.childSummaryIds],
      ["closeReason", options.closeReason ?? snapshot.work.subject?.closedReason]
    ]),
    "workflow_next.canonical-next-step": dataRecord([
      ["workflowRef", nextWorkflowRef],
      ["commandPath", nextCommandPath],
      ["requiredInputs", options.nextRequiredInputs ?? snapshot.workflow.requiredInputNames],
      ["currentStatus", snapshot.work.subject?.status],
      ["subjectId", subjectId]
    ])
  };
}

export function compileCloseoutAgentDirectiveBundle(
  input: AgentDirectiveCloseoutCompilationInput
): AgentDirectiveCloseoutCompilationResult {
  const dataByRegistryId = {
    ...closeoutDirectiveDataByRegistryId(input.snapshot, input),
    ...input.dataByRegistryId
  };
  const result = assembleAgentDirectiveBundle({
    snapshot: input.snapshot,
    dataByRegistryId,
    registry: input.registry,
    generatedAt: input.generatedAt,
    bundleId: input.bundleId
  });
  return {
    ...result,
    dataByRegistryId
  };
}

export function summaryDirectiveDataByRegistryId(
  snapshot: AgentDirectiveSnapshot,
  options: AgentDirectiveSummaryDataOptions = {}
): AgentDirectiveAssemblyDataByRegistryId {
  const subjectId = snapshot.work.subject?.id;
  const childWorkIds = options.childWorkIds ?? snapshot.work.childWorkIds;
  const childSummaryIds = options.childSummaryIds ?? snapshot.summary.childSummaryIds;
  const childStatuses = childStatusDataValues(options.childStatuses ?? []);
  const carryoverWorkIds = options.carryoverWorkIds ?? snapshot.work.openDescendantIds;
  const deferredWorkIds =
    options.deferredWorkIds ?? (options.childStatuses ?? []).filter((child) => child.deferred === true).map((child) => child.workId);
  const evidenceIds = snapshot.evidence.evidenceIds;
  const verificationIds = snapshot.evidence.verificationIds;
  const commitShas = uniqueStrings([...snapshot.git.checkpointCommitShas, ...snapshot.summary.commitShas]);
  const dirtyPathNotes = uniqueStrings([...snapshot.git.dirtyPathNotes, ...snapshot.summary.dirtyPathNotes]);
  const summaryUri = snapshot.summary.latestSummaryUri ?? last(snapshot.summary.artifactUris);
  const gateState = gateStateDataValues(snapshot);
  const allGateIds = uniqueStrings([
    ...snapshot.gate.requiredGates.map((gate) => gate.id),
    ...snapshot.gate.openGateIds,
    ...snapshot.gate.satisfiedGateIds,
    ...snapshot.gate.forcedGateIds
  ]);

  return {
    ...closeoutDirectiveDataByRegistryId(snapshot, options),
    "review.gate-required": gateRequirementData(snapshot, "review"),
    "audit.gate-required": {
      ...gateRequirementData(snapshot, "audit"),
      ...dataRecord([["findingsDisposition", options.findingsDisposition]])
    },
    "container.descendant-closeout": dataRecord([
      ["containerId", subjectId],
      ["openDescendantIds", snapshot.work.openDescendantIds],
      ["requiredGateIds", snapshot.gate.openGateIds],
      ["childSummaryIds", childSummaryIds],
      ["childStatuses", childStatuses],
      ["evidenceIds", evidenceIds],
      ["verificationIds", verificationIds],
      ["commitShas", commitShas],
      ["dirtyPathNotes", dirtyPathNotes],
      ["deferredWorkIds", deferredWorkIds],
      ["gateState", gateState],
      ["closeReason", options.closeReason ?? snapshot.work.subject?.closedReason]
    ]),
    "phase.close-rollup": dataRecord([
      ["phaseId", subjectId],
      ["childWorkIds", childWorkIds],
      ["childSummaryIds", childSummaryIds],
      ["childStatuses", childStatuses],
      ["evidenceIds", evidenceIds],
      ["verificationIds", verificationIds],
      ["commitShas", commitShas],
      ["dirtyPathNotes", dirtyPathNotes],
      ["deferredWorkIds", deferredWorkIds],
      ["gateIds", allGateIds],
      ["gateState", gateState]
    ]),
    "sprint.close-rollup": dataRecord([
      ["sprintId", subjectId],
      ["childWorkIds", childWorkIds],
      ["carryoverWorkIds", carryoverWorkIds],
      ["childSummaryIds", childSummaryIds],
      ["childStatuses", childStatuses],
      ["evidenceIds", evidenceIds],
      ["verificationIds", verificationIds],
      ["commitShas", commitShas],
      ["dirtyPathNotes", dirtyPathNotes],
      ["deferredWorkIds", deferredWorkIds],
      ["summaryUri", summaryUri],
      ["gateIds", allGateIds],
      ["gateState", gateState]
    ])
  };
}

export function compileSummaryAgentDirectiveBundle(
  input: AgentDirectiveSummaryCompilationInput
): AgentDirectiveSummaryCompilationResult {
  const dataByRegistryId = {
    ...summaryDirectiveDataByRegistryId(input.snapshot, input),
    ...input.dataByRegistryId
  };
  const result = assembleAgentDirectiveBundle({
    snapshot: input.snapshot,
    dataByRegistryId,
    registry: input.registry,
    generatedAt: input.generatedAt,
    bundleId: input.bundleId
  });
  return {
    ...result,
    dataByRegistryId
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

function staleDataReferenceIssues(
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId,
  registry: AgentDirectiveRegistry
): readonly AgentDirectiveBundleAssemblyIssue[] {
  const knownRegistryIds = new Set<string>(registry.entries.map((entry) => entry.id));
  return Object.keys(dataByRegistryId).flatMap((registryId) =>
    knownRegistryIds.has(registryId)
      ? []
      : [
          assemblyIssue(
            "data",
            `$.dataByRegistryId.${registryId}`,
            "must reference a known registry entry"
          )
        ]
  );
}

function missingRequiredEntries(
  registryEntry: AgentDirectiveRegistryEntry,
  dataIssues: readonly AgentDirectiveBundleAssemblyIssue[],
  snapshot: AgentDirectiveSnapshot
): readonly AgentDirectiveMissingRequiredEntry[] {
  return registryEntry.dataRequirements.flatMap((requirement) => {
    if (!requirement.required) {
      return [];
    }
    const path = `$.dataByRegistryId.${registryEntry.id}.${requirement.key}`;
    const matchingIssue = dataIssues.find((dataIssue) => dataIssue.path === path);
    return matchingIssue === undefined
      ? []
      : [
          {
            registryId: registryEntry.id,
            family: registryEntry.family,
            subject: subjectForSnapshot(snapshot),
            requirement: requirement.key,
            message: matchingIssue.message
          }
        ];
  });
}

function resolveAgentDirectiveConflicts(
  directives: readonly AgentDirective[],
  registry: AgentDirectiveRegistry
) {
  const registryEntriesById = new Map<string, AgentDirectiveRegistryEntry>(
    registry.entries.map((entry) => [entry.id, entry])
  );
  const directiveByRegistryId = new Map<string, AgentDirective>(
    directives.map((directive) => [directive.registryId, directive])
  );
  const conflicts: AgentDirectiveConflict[] = [];

  for (const directive of directives) {
    const registryEntry = registryEntriesById.get(directive.registryId);
    for (const supersededRegistryId of registryEntry?.supersedes ?? []) {
      const supersededDirective = directiveByRegistryId.get(supersededRegistryId);
      if (supersededDirective === undefined) {
        continue;
      }
      conflicts.push({
        directiveIds: [supersededDirective.id, directive.id],
        reason: "Selected directive supersedes another selected registry entry.",
        resolution: "registry_order",
        resolvedDirectiveId: directive.id,
        severity: maxSeverity([supersededDirective.severity, directive.severity])
      });
    }
  }

  for (const candidate of directives) {
    if (!isBlockingDirective(candidate)) {
      continue;
    }
    for (const blocked of directives) {
      if (candidate.id === blocked.id || !blocksLowerPriorityDirective(candidate, blocked)) {
        continue;
      }
      conflicts.push({
        directiveIds: [candidate.id, blocked.id],
        reason: "Blocking directive must be resolved before the lower-priority directive can be acted on.",
        resolution: "blocking_wins",
        resolvedDirectiveId: candidate.id,
        severity: candidate.severity
      });
    }
  }

  return uniqueConflicts(conflicts);
}

function applyConflictLifecycles(
  directives: readonly AgentDirective[],
  conflicts: AgentDirectiveBundle["conflicts"]
): readonly AgentDirective[] {
  const blockedDirectiveIds = new Set<string>();
  const supersededDirectiveIds = new Set<string>();
  for (const conflict of conflicts) {
    for (const directiveId of conflict.directiveIds) {
      if (directiveId === conflict.resolvedDirectiveId) {
        continue;
      }
      if (conflict.resolution === "registry_order") {
        supersededDirectiveIds.add(directiveId);
      } else {
        blockedDirectiveIds.add(directiveId);
      }
    }
  }

  return directives.map((directive) =>
    supersededDirectiveIds.has(directive.id)
      ? { ...directive, lifecycle: "superseded" }
      : blockedDirectiveIds.has(directive.id)
        ? { ...directive, lifecycle: "blocked" }
        : directive
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

function isBlockingDirective(directive: AgentDirective): boolean {
  return directive.severity === "blocking" || directive.lifecycle === "blocked" || directive.blocksCloseout === true;
}

function blocksLowerPriorityDirective(blockingDirective: AgentDirective, candidate: AgentDirective): boolean {
  return (
    severityRank(blockingDirective.severity) > severityRank(candidate.severity) &&
    (candidate.kind === "next_step" || candidate.severity === "action" || candidate.severity === "info")
  );
}

function maxSeverity(severities: readonly AgentDirective["severity"][]): AgentDirective["severity"] {
  return severities.reduce((current, next) => (severityRank(next) > severityRank(current) ? next : current), "info");
}

function severityRank(severity: AgentDirective["severity"]): number {
  switch (severity) {
    case "blocking":
      return 3;
    case "required":
      return 2;
    case "action":
      return 1;
    case "info":
      return 0;
  }
}

function uniqueConflicts(conflicts: AgentDirectiveBundle["conflicts"]): AgentDirectiveBundle["conflicts"] {
  const seen = new Set<string>();
  const output: AgentDirectiveConflict[] = [];
  for (const conflict of conflicts) {
    const key = [
      [...conflict.directiveIds].sort().join(","),
      conflict.resolution,
      conflict.resolvedDirectiveId ?? "",
      conflict.reason
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(conflict);
  }
  return output;
}

function gateRequirementData(snapshot: AgentDirectiveSnapshot, kind: string): AgentDirectiveData {
  const gates = snapshot.gate.requiredGates.filter((gate) => gate.kind === kind);
  return dataRecord([
    ["subjectId", snapshot.work.subject?.id],
    ["gateIds", gates.map((gate) => gate.id)],
    ["requiredEvidenceKinds", uniqueStrings(gates.flatMap((gate) => gate.requiredEvidenceKinds))],
    ["minEvidenceCount", maxNumber(gates.map((gate) => gate.minEvidenceCount))],
    ["forceReasonCode", gates.find((gate) => gate.forceReasonCode !== undefined)?.forceReasonCode]
  ]);
}

function gateStateDataValues(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveDataValue[] {
  return snapshot.gate.requiredGates.map((gate) =>
    dataRecord([
      ["id", gate.id],
      ["subjectType", gate.subjectType],
      ["subjectId", gate.subjectId],
      ["kind", gate.kind],
      ["scope", gate.scope],
      ["status", gate.status],
      ["requiredEvidenceKinds", gate.requiredEvidenceKinds],
      ["minEvidenceCount", gate.minEvidenceCount],
      ["evidenceIds", gate.evidenceIds],
      ["verificationIds", gate.verificationIds],
      ["agentSummaryIds", gate.agentSummaryIds],
      ["commitShas", gate.commitShas],
      ["dirtyPathNotes", gate.dirtyPathNotes],
      ["forceReasonCode", gate.forceReasonCode]
    ])
  );
}

function childStatusDataValues(children: readonly AgentDirectiveRollupChildStatus[]): readonly AgentDirectiveDataValue[] {
  return children.map((child) =>
    dataRecord([
      ["workId", child.workId],
      ["title", child.title],
      ["status", child.status],
      ["summaryIds", child.summaryIds],
      ["evidenceIds", child.evidenceIds],
      ["verificationIds", child.verificationIds],
      ["commitShas", child.commitShas],
      ["deferred", child.deferred],
      ["deferralReason", child.deferralReason]
    ])
  );
}

function maxNumber(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function dataRecord(entries: readonly (readonly [string, AgentDirectiveDataValue | undefined])[]): AgentDirectiveData {
  const record: Record<string, AgentDirectiveDataValue> = {};
  for (const [key, value] of entries) {
    if (value !== undefined) {
      record[key] = value;
    }
  }
  return record;
}

function inferCheckpointReasonCode(
  outcome: AgentSummaryOutcome | undefined,
  commitShas: readonly string[],
  dirtyPathNotes: readonly string[]
): string | undefined {
  if (commitShas.length > 0) {
    return "scoped_commit_recorded";
  }
  if (outcome === "no_change") {
    return "no_repo_changes";
  }
  if (outcome === "duplicate") {
    return "duplicate";
  }
  if (outcome === "cancelled") {
    return "cancelled_no_work";
  }
  if (dirtyPathNotes.length > 0) {
    return "dirty_paths_documented";
  }
  return undefined;
}

function latestEvidenceCommand(snapshot: AgentDirectiveSnapshot): string | undefined {
  for (let index = snapshot.evidence.evidence.length - 1; index >= 0; index -= 1) {
    const command = snapshot.evidence.evidence[index]?.command;
    if (command !== undefined && command.trim().length > 0) {
      return command;
    }
  }
  return undefined;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function last<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
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
