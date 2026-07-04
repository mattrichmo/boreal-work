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
  type AgentDirectiveDataValue,
  type AgentDirectiveId,
  type AgentDirectiveMissingRequiredEntry,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveSubject,
  type AgentDirectiveTemplateId
} from "./agent-directives.js";
import {
  agentDirectivePayloadFields,
  type AgentDirectivePayloadField
} from "./agent-directive-payloads.js";
import { AGENT_DIRECTIVE_REGISTRY } from "./agent-directive-registry.js";
import {
  agentDirectiveSnapshotHash,
  agentDirectiveSnapshotIssues,
  type AgentDirectiveGateStateSnapshot,
  type AgentDirectiveSnapshot
} from "./agent-directive-snapshot.js";
import type { EnforcementGap, EnforcementGapCode } from "./enforcement-gaps.js";
import { hashContent } from "./hash.js";
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

export interface AgentDirectiveGapProjectionInput {
  readonly gaps: readonly EnforcementGap[];
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
  readonly commandPath: string;
  readonly capturedAt: IsoTimestamp;
  readonly envelopeSchema?: string;
  readonly subject?: AgentDirectiveSubject;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
  readonly sourceHash?: ContentHash;
}

interface AgentDirectiveProjectionContext {
  readonly subject?: AgentDirectiveSubject;
  readonly commandPath: string;
  readonly envelopeSchema?: string;
  readonly capturedAt: IsoTimestamp;
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
  readonly noCommitReason?: string;
  readonly outOfScopeRepoNotes?: readonly string[];
  readonly repositoryChanged?: boolean;
  readonly validationCommand?: string;
  readonly expectedVerificationVerdict?: VerificationVerdict;
  readonly nextWorkflowRef?: string;
  readonly nextCommandPath?: string;
  readonly nextRequiredInputs?: readonly string[];
}

export interface AgentDirectiveGitDataOptions {
  readonly checkpointReasonCode?: string;
  readonly noCommitReason?: string;
  readonly outOfScopeRepoNotes?: readonly string[];
  readonly repositoryChanged?: boolean;
}

export interface AgentDirectiveGitCompilationInput extends AgentDirectiveGitDataOptions {
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
}

export interface AgentDirectiveGitCompilationResult extends AgentDirectiveBundleAssemblyResult {
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
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

export interface AgentDirectiveHandoffDataOptions {
  readonly summaryId?: string;
  readonly summaryUri?: string;
  readonly nextWorkflowRef?: string;
  readonly nextCommandPath?: string;
  readonly nextRequiredInputs?: readonly string[];
}

export interface AgentDirectiveHandoffCompilationInput extends AgentDirectiveHandoffDataOptions {
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
}

export interface AgentDirectiveHandoffCompilationResult extends AgentDirectiveBundleAssemblyResult {
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
}

export type AgentDirectiveRecoveryDiagnosticSnapshot = AgentDirectiveSnapshot["doctor"]["diagnostics"][number];

export interface AgentDirectiveRecoveryDataOptions {
  readonly blockerIds?: readonly string[];
  readonly blockedByIds?: readonly string[];
  readonly blockerTitles?: readonly string[];
  readonly gateIds?: readonly string[];
  readonly diagnostics?: readonly AgentDirectiveRecoveryDiagnosticSnapshot[];
  readonly recommendedCommands?: readonly string[];
  readonly lockPaths?: readonly string[];
  readonly nextWorkflowRef?: string;
  readonly nextCommandPath?: string;
  readonly nextRequiredInputs?: readonly string[];
}

export interface AgentDirectiveRecoveryCompilationInput extends AgentDirectiveRecoveryDataOptions {
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
}

export interface AgentDirectiveRecoveryCompilationResult extends AgentDirectiveBundleAssemblyResult {
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
}

export function selectAgentDirectiveRegistryEntries(
  snapshot: AgentDirectiveSnapshot,
  registry: AgentDirectiveRegistry = AGENT_DIRECTIVE_REGISTRY,
  options: { readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId } = {}
): readonly AgentDirectiveRegistrySelection[] {
  const snapshotIssues = agentDirectiveSnapshotIssues(snapshot);
  if (snapshotIssues.length > 0) {
    return [];
  }
  void snapshot;
  void registry;
  void options;
  return [];
}

export function selectAgentDirectiveRegistryEntriesFromGaps(
  gaps: readonly EnforcementGap[],
  registry: AgentDirectiveRegistry = AGENT_DIRECTIVE_REGISTRY,
  options: { readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId } = {}
): readonly AgentDirectiveRegistrySelection[] {
  const registryIssues = agentDirectiveRegistryIssues(registry);
  if (registryIssues.length > 0) {
    return [];
  }
  const activeCodes = new Set(gaps.map((gap) => gap.code));
  const dataByRegistryId = options.dataByRegistryId ?? {};
  return registry.entries.flatMap((registryEntry) => {
    const selectedBy = registryEntrySelectedByGapCodes(registryEntry, activeCodes, dataByRegistryId);
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

  return assembleAgentDirectiveBundleFromGaps({
    gaps: [],
    dataByRegistryId: input.dataByRegistryId,
    commandPath: input.snapshot.command.path,
    capturedAt: input.snapshot.capturedAt,
    envelopeSchema: input.snapshot.command.envelopeSchema,
    subject: subjectForSnapshot(input.snapshot),
    registry,
    generatedAt: input.generatedAt,
    bundleId: input.bundleId,
    sourceHash: agentDirectiveSnapshotHash(input.snapshot)
  });
}

export function assembleAgentDirectiveBundleFromGaps(
  input: AgentDirectiveGapProjectionInput
): AgentDirectiveBundleAssemblyResult {
  const registry = input.registry ?? AGENT_DIRECTIVE_REGISTRY;
  const registryIssues = agentDirectiveRegistryIssues(registry).map((registryIssue) =>
    assemblyIssue("registry", registryIssue.path, registryIssue.message)
  );
  if (registryIssues.length > 0) {
    return {
      ok: false,
      selectedRegistryIds: [],
      issues: registryIssues,
      missingRequired: []
    };
  }

  const selections = selectAgentDirectiveRegistryEntriesFromGaps(input.gaps, registry, {
    dataByRegistryId: input.dataByRegistryId
  });
  const sourceHash = input.sourceHash ?? hashContent({
    gaps: input.gaps,
    commandPath: input.commandPath,
    envelopeSchema: input.envelopeSchema,
    subject: input.subject
  });
  const context: AgentDirectiveProjectionContext = {
    subject: input.subject,
    commandPath: input.commandPath,
    envelopeSchema: input.envelopeSchema,
    capturedAt: input.capturedAt
  };
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
      missingRequired.push(...missingRequiredEntries(registryEntry, currentDataIssues, context));
      continue;
    }

    directives.push(directiveFromRegistryEntry(registryEntry, registry, context, data, selectedBy, sourceHash));
  }

  const selectedRegistryIds = selections.map((selection) => selection.registryEntry.id);
  const conflicts = resolveAgentDirectiveConflicts(directives, registry);

  const bundle: AgentDirectiveBundle = {
    meta: {
      id: input.bundleId ?? bundleIdForCommand(input.commandPath, sourceHash),
      schemaVersion: AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
      registryVersion: registry.version,
      generatedAt: input.generatedAt ?? input.capturedAt,
      commandPath: input.commandPath,
      envelopeSchema: input.envelopeSchema,
      sourceSnapshotHash: sourceHash
    },
    directives,
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
  const nextWorkflowRef = options.nextWorkflowRef ?? snapshot.workflow.nextWorkflowRef;
  const nextCommandPath = options.nextCommandPath ?? snapshot.workflow.recommendedCommandPath;

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
    "git.checkpoint-required": gitCheckpointDirectiveData(snapshot, options.summaryOutcome, options),
    "verification.evidence-required": dataRecord([
      ["subjectId", subjectId],
      ["command", options.validationCommand ?? firstOpenDeclaredGateCommand(snapshot) ?? latestEvidenceCommand(snapshot)],
      ["expectedVerdict", options.expectedVerificationVerdict ?? "passed"],
      ["gateIds", openDeclaredGatesByKind(snapshot, "verification").map((gate) => gate.id)],
      ["declaredCommands", uniqueStrings(openDeclaredGatesByKind(snapshot, "verification").flatMap((gate) => gate.declaredCommand ? [gate.declaredCommand] : []))],
      ["expectedObservable", firstOpenDeclaredGateObservable(snapshot)],
      ["expectedObservables", uniqueStrings(openDeclaredGatesByKind(snapshot, "verification").flatMap((gate) => gate.expectedObservable ? [gate.expectedObservable] : []))],
      ["evidenceIds", evidenceIds],
      ["verificationIds", verificationIds]
    ]),
    "handoff.session-summary": handoffDirectiveData(snapshot, {
      summaryId: latestSummaryId,
      summaryUri: latestSummaryUri,
      nextWorkflowRef,
      nextCommandPath,
      nextRequiredInputs: options.nextRequiredInputs
    }),
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

export function gitDirectiveDataByRegistryId(
  snapshot: AgentDirectiveSnapshot,
  options: AgentDirectiveGitDataOptions = {}
): AgentDirectiveAssemblyDataByRegistryId {
  return {
    "git.checkpoint-required": gitCheckpointDirectiveData(snapshot, undefined, options),
    "workflow_next.canonical-next-step": workflowNextDirectiveData(snapshot)
  };
}

export function compileGitAgentDirectiveBundle(
  input: AgentDirectiveGitCompilationInput
): AgentDirectiveGitCompilationResult {
  const dataByRegistryId = {
    ...gitDirectiveDataByRegistryId(input.snapshot, input),
    ...input.dataByRegistryId
  };
  const result = assembleAgentDirectiveBundleForSnapshot(input, dataByRegistryId, gitDirectiveGaps(input.snapshot, dataByRegistryId));
  return {
    ...result,
    dataByRegistryId
  };
}

export function compileCloseoutAgentDirectiveBundle(
  input: AgentDirectiveCloseoutCompilationInput
): AgentDirectiveCloseoutCompilationResult {
  const dataByRegistryId = {
    ...closeoutDirectiveDataByRegistryId(input.snapshot, input),
    ...input.dataByRegistryId
  };
  const result = assembleAgentDirectiveBundleForSnapshot(input, dataByRegistryId, closeoutDirectiveGaps(input.snapshot, dataByRegistryId));
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
  const result = assembleAgentDirectiveBundleForSnapshot(input, dataByRegistryId, summaryDirectiveGaps(input.snapshot, dataByRegistryId));
  return {
    ...result,
    dataByRegistryId
  };
}

export function handoffDirectiveDataByRegistryId(
  snapshot: AgentDirectiveSnapshot,
  options: AgentDirectiveHandoffDataOptions = {}
): AgentDirectiveAssemblyDataByRegistryId {
  const nextWorkflowRef = options.nextWorkflowRef ?? snapshot.workflow.nextWorkflowRef;
  const nextCommandPath = options.nextCommandPath ?? snapshot.workflow.recommendedCommandPath;
  const nextRequiredInputs = options.nextRequiredInputs ?? snapshot.workflow.requiredInputNames;

  return {
    "handoff.session-summary": handoffDirectiveData(snapshot, {
      ...options,
      nextWorkflowRef,
      nextCommandPath,
      nextRequiredInputs
    }),
    "workflow_next.canonical-next-step": workflowNextDirectiveData(
      snapshot,
      nextWorkflowRef,
      nextCommandPath,
      nextRequiredInputs
    )
  };
}

export function compileHandoffAgentDirectiveBundle(
  input: AgentDirectiveHandoffCompilationInput
): AgentDirectiveHandoffCompilationResult {
  const dataByRegistryId = {
    ...handoffDirectiveDataByRegistryId(input.snapshot, input),
    ...input.dataByRegistryId
  };
  const result = assembleAgentDirectiveBundleForSnapshot(input, dataByRegistryId, handoffDirectiveGaps(input.snapshot, dataByRegistryId));
  return {
    ...result,
    dataByRegistryId
  };
}

export function recoveryDirectiveDataByRegistryId(
  snapshot: AgentDirectiveSnapshot,
  options: AgentDirectiveRecoveryDataOptions = {}
): AgentDirectiveAssemblyDataByRegistryId {
  const subjectId = snapshot.work.subject?.id;
  const blockerIds = uniqueStrings([
    ...(options.blockerIds ?? []),
    ...snapshot.work.activeBlockerIds,
    ...snapshot.work.blockedByIds
  ]);
  const blockedByIds = uniqueStrings([...(options.blockedByIds ?? []), ...snapshot.work.blockedByIds]);
  const gateIds = uniqueStrings(options.gateIds ?? snapshot.gate.openGateIds);
  const diagnostics = options.diagnostics ?? recoveryDiagnostics(snapshot);
  const nextWorkflowRef = options.nextWorkflowRef ?? snapshot.workflow.nextWorkflowRef;
  const nextCommandPath = options.nextCommandPath ?? snapshot.workflow.recommendedCommandPath;

  return {
    ...declaredGateDirectiveDataByRegistryId(snapshot),
    "blocked.resolve-blockers": dataRecord([
      ["subjectId", subjectId],
      ["blockerIds", blockerIds],
      ["blockerTitles", options.blockerTitles],
      ["gateIds", gateIds],
      ["recoveryWorkflow", nextWorkflowRef],
      ["blockedByIds", blockedByIds],
      ["recommendedCommands", blockedRecoveryCommands(subjectId, blockerIds, gateIds, options)],
      ["nextCommandPath", nextCommandPath]
    ]),
    "doctor.recovery-required": dataRecord([
      ["diagnostics", diagnosticDataValues(diagnostics)],
      ["recommendedCommands", doctorRecoveryCommands(snapshot, diagnostics, options)],
      ["syncOk", snapshot.sync.ok],
      ["doctorOk", snapshot.doctor.ok],
      ["lockPaths", options.lockPaths],
      ["diagnosticCodes", diagnostics.map((diagnostic) => diagnostic.code)],
      ["blockingDiagnosticCodes", diagnostics.filter((diagnostic) => diagnostic.blocking).map((diagnostic) => diagnostic.code)],
      ["safeWorkflow", nextWorkflowRef],
      ["nextCommandPath", nextCommandPath],
      ["operationCount", snapshot.sync.operationCount],
      ["warningThreshold", snapshot.sync.warningThreshold]
    ]),
    "workflow_next.canonical-next-step": workflowNextDirectiveData(
      snapshot,
      nextWorkflowRef,
      nextCommandPath,
      options.nextRequiredInputs
    )
  };
}

export function compileRecoveryAgentDirectiveBundle(
  input: AgentDirectiveRecoveryCompilationInput
): AgentDirectiveRecoveryCompilationResult {
  const dataByRegistryId = {
    ...recoveryDirectiveDataByRegistryId(input.snapshot, input),
    ...input.dataByRegistryId
  };
  const result = assembleAgentDirectiveBundleForSnapshot(input, dataByRegistryId, recoveryDirectiveGaps(input.snapshot, dataByRegistryId));
  return {
    ...result,
    dataByRegistryId
  };
}

function registryEntrySelectedByGapCodes(
  registryEntry: AgentDirectiveRegistryEntry,
  activeCodes: ReadonlySet<EnforcementGapCode>,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly string[] {
  if (registryEntry.lifecycle !== "active") {
    return [];
  }
  if (dataByRegistryId[registryEntry.id] === undefined) {
    return [];
  }
  const selectedCodes = registryEntry.triggerCodes.filter((code) => activeCodes.has(code));
  return selectedCodes.map((code) => `gap.${code}`);
}

function assembleAgentDirectiveBundleForSnapshot(
  input: Pick<AgentDirectiveBundleAssemblyInput, "snapshot" | "registry" | "generatedAt" | "bundleId">,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId,
  gaps: readonly EnforcementGap[]
): AgentDirectiveBundleAssemblyResult {
  return assembleAgentDirectiveBundleFromGaps({
    gaps,
    dataByRegistryId,
    commandPath: input.snapshot.command.path,
    capturedAt: input.snapshot.capturedAt,
    envelopeSchema: input.snapshot.command.envelopeSchema,
    subject: subjectForSnapshot(input.snapshot),
    registry: input.registry,
    generatedAt: input.generatedAt,
    bundleId: input.bundleId,
    sourceHash: agentDirectiveSnapshotHash(input.snapshot)
  });
}

function gitDirectiveGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  return uniqueGaps([
    ...gateGapsForSnapshot(snapshot),
    ...(gitCheckpointRequired(snapshot, dataByRegistryId["git.checkpoint-required"])
      ? [directiveGap(snapshot, "git.checkpoint.required", dataByRegistryId["git.checkpoint-required"])]
      : []),
    ...laneWorktreeGaps(snapshot, dataByRegistryId),
    ...workflowNextGaps(snapshot, dataByRegistryId)
  ]);
}

function closeoutDirectiveGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  return uniqueGaps([
    ...gateGapsForSnapshot(snapshot),
    ...(closeoutSummaryRequired(snapshot, dataByRegistryId["closeout.summary-required"])
      ? [directiveGap(snapshot, "closeout.user-summary.required", dataByRegistryId["closeout.summary-required"])]
      : []),
    ...(gitCheckpointRequired(snapshot, dataByRegistryId["git.checkpoint-required"])
      ? [directiveGap(snapshot, "git.checkpoint.required", dataByRegistryId["git.checkpoint-required"])]
      : []),
    ...laneWorktreeGaps(snapshot, dataByRegistryId),
    ...(verificationEvidenceRequired(dataByRegistryId["verification.evidence-required"])
      ? [directiveGap(snapshot, "gate.verification.unsatisfied", dataByRegistryId["verification.evidence-required"])]
      : []),
    ...(snapshot.work.openDescendantIds.length > 0
      ? [directiveGap(snapshot, "work.container.open-descendant", dataByRegistryId["container.descendant-closeout"])]
      : []),
    ...handoffDirectiveGaps(snapshot, dataByRegistryId),
    ...workflowNextGaps(snapshot, dataByRegistryId)
  ]);
}

function summaryDirectiveGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  return uniqueGaps([
    ...closeoutDirectiveGaps(snapshot, dataByRegistryId),
    ...(rollupRequired(snapshot, ["phase", "milestone"])
      ? [directiveGap(snapshot, "phase.close-rollup.required", dataByRegistryId["phase.close-rollup"])]
      : []),
    ...(rollupRequired(snapshot, ["sprint"])
      ? [directiveGap(snapshot, "sprint.close-rollup.required", dataByRegistryId["sprint.close-rollup"])]
      : [])
  ]);
}

function handoffDirectiveGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  const data = dataByRegistryId["handoff.session-summary"];
  return uniqueGaps([
    ...(data !== undefined &&
    (snapshot.work.subject?.type === "session" || snapshot.actor.activeReservationIds.length > 0) &&
    dataHasAnyString(data, ["summaryUri", "summaryId"])
      ? [directiveGap(snapshot, "handoff.session-summary.required", data)]
      : []),
    ...workflowNextGaps(snapshot, dataByRegistryId)
  ]);
}

function recoveryDirectiveGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  return uniqueGaps([
    ...gateGapsForSnapshot(snapshot),
    ...(snapshot.work.activeBlockerIds.length > 0 || snapshot.work.blockedByIds.length > 0
      ? [directiveGap(snapshot, "work.blocked.open-dependency", dataByRegistryId["blocked.resolve-blockers"])]
      : []),
    ...(needsDoctorRecoveryDirective(snapshot)
      ? [directiveGap(snapshot, snapshot.sync.searchIndexFresh ? "doctor.recovery.required" : "search.index-stale", dataByRegistryId["doctor.recovery-required"])]
      : []),
    ...laneWorktreeGaps(snapshot, dataByRegistryId),
    ...workflowNextGaps(snapshot, dataByRegistryId)
  ]);
}

function laneWorktreeGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  const data = dataByRegistryId["git.lane-worktree-required"];
  return data !== undefined && dataHasAnyKey(data, ["gitRoot", "mergeTargetBranch", "laneBranch", "worktreePath"])
    ? [directiveGap(snapshot, "git.lane-worktree.required", data)]
    : [];
}

function workflowNextGaps(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  const data = dataByRegistryId["workflow_next.canonical-next-step"];
  return data !== undefined && dataHasAnyKey(data, ["workflowRef", "commandPath", "requiredInputs"])
    ? [directiveGap(snapshot, "directive.workflow-next.available", data)]
    : [];
}

function gateGapsForSnapshot(snapshot: AgentDirectiveSnapshot): readonly EnforcementGap[] {
  return uniqueGaps(snapshot.gate.requiredGates.flatMap((gate) => {
    if (gate.status !== "open") {
      return [];
    }
    const codes: EnforcementGapCode[] = [];
    if (gate.declaredCommand !== undefined) {
      codes.push("gate.declared-command.missing");
    }
    if (gate.expectedObservable !== undefined) {
      codes.push("gate.expected-observable.missing");
    }
    switch (gate.kind) {
      case "verification":
        codes.push("gate.verification.unsatisfied");
        break;
      case "checkpoint":
        codes.push("gate.checkpoint.unsatisfied");
        break;
      case "review":
        codes.push("gate.review.unsatisfied");
        break;
      case "audit":
        codes.push("gate.audit.unsatisfied");
        break;
    }
    return codes.map((code) => directiveGap(snapshot, code, gateGapData(snapshot)));
  }));
}

function directiveGap(snapshot: AgentDirectiveSnapshot, code: EnforcementGapCode, data?: AgentDirectiveData): EnforcementGap {
  const subject = snapshot.work.subject;
  return {
    code,
    subjectType: (subject?.type ?? "command") as EnforcementGap["subjectType"],
    subjectId: subject?.id ?? snapshot.command.path,
    data
  };
}

function gateGapData(snapshot: AgentDirectiveSnapshot): AgentDirectiveData {
  const openGates = snapshot.gate.requiredGates.filter((gate) => gate.status === "open");
  return dataRecord([
    ["gateIds", openGates.map((gate) => gate.id)],
    ["requiredEvidenceKinds", uniqueStrings(openGates.flatMap((gate) => gate.requiredEvidenceKinds))],
    ["minEvidenceCount", maxNumber(openGates.map((gate) => gate.minEvidenceCount))],
    ["declaredCommand", firstString(openGates.map((gate) => gate.declaredCommand))],
    ["expectedObservable", firstString(openGates.map((gate) => gate.expectedObservable))]
  ]);
}

function uniqueGaps(gaps: readonly EnforcementGap[]): readonly EnforcementGap[] {
  const byCode = new Map<EnforcementGapCode, EnforcementGap>();
  for (const gap of gaps) {
    byCode.set(gap.code, gap);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function gitCheckpointRequired(snapshot: AgentDirectiveSnapshot, data: AgentDirectiveData | undefined): boolean {
  if (data === undefined) {
    return false;
  }
  const commitShas = dataStringArray(data, "commitShas");
  if (commitShas.length > 0) {
    return false;
  }
  const reasonCode = dataString(data, "reasonCode") ?? dataString(data, "noCommitReason");
  const repositoryChanged = dataBoolean(data, "repositoryChanged") === true;
  const scopedChangedPaths = dataArray(data, "scopedChangedPaths");
  const blockingDirtyPaths = dataArray(data, "blockingDirtyPaths");
  if (repositoryChanged || scopedChangedPaths.length > 0 || blockingDirtyPaths.length > 0) {
    return true;
  }
  return closeoutCommandRequiresCheckpoint(snapshot.command.path) && reasonCode === undefined;
}

function closeoutSummaryRequired(snapshot: AgentDirectiveSnapshot, data: AgentDirectiveData | undefined): boolean {
  if (data === undefined) {
    return false;
  }
  const hasSummary = dataString(data, "summaryId") !== undefined || dataString(data, "summaryUri") !== undefined;
  if (hasSummary) {
    return false;
  }
  return snapshot.work.subject?.status === "closed" || snapshot.work.subject?.status === "cancelled" || ["agent finish", "work cancel", "work close", "sprint close"].includes(snapshot.command.path);
}

function verificationEvidenceRequired(data: AgentDirectiveData | undefined): boolean {
  if (data !== undefined && dataStringArray(data, "verificationIds").length > 0) {
    return false;
  }
  return (
    data !== undefined &&
    (dataHasAnyString(data, ["command", "expectedObservable"]) ||
      dataHasAnyNonEmptyArray(data, ["declaredCommands", "expectedObservables"]))
  );
}

function rollupRequired(
  snapshot: AgentDirectiveSnapshot,
  subjectTypes: readonly string[]
): boolean {
  return (
    ["summary compose", "summary show", "sprint metrics", "sprint report"].includes(snapshot.command.path) &&
    subjectTypes.includes(snapshot.work.subject?.type ?? "")
  );
}

function dataHasAnyKey(data: AgentDirectiveData, keys: readonly string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(data, key));
}

function dataHasAnyString(data: AgentDirectiveData, keys: readonly string[]): boolean {
  return keys.some((key) => dataString(data, key) !== undefined);
}

function dataHasAnyNonEmptyArray(data: AgentDirectiveData, keys: readonly string[]): boolean {
  return keys.some((key) => dataArray(data, key).length > 0);
}

function dataString(data: AgentDirectiveData, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function dataBoolean(data: AgentDirectiveData, key: string): boolean | undefined {
  const value = data[key];
  return typeof value === "boolean" ? value : undefined;
}

function dataStringArray(data: AgentDirectiveData, key: string): readonly string[] {
  return dataArray(data, key).filter((value): value is string => typeof value === "string");
}

function dataArray(data: AgentDirectiveData, key: string): readonly AgentDirectiveDataValue[] {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

function closeoutCommandRequiresCheckpoint(commandPath: string): boolean {
  return ["agent finish", "summary compose", "summary show", "work cancel", "work close", "sprint close"].includes(commandPath);
}

function declaredGateDirectiveDataByRegistryId(snapshot: AgentDirectiveSnapshot): AgentDirectiveAssemblyDataByRegistryId {
  const verificationGates = openDeclaredGatesByKind(snapshot, "verification");
  const reviewGates = openDeclaredGatesByKind(snapshot, "review");
  const auditGates = openDeclaredGatesByKind(snapshot, "audit");
  return {
    ...(verificationGates.length > 0
      ? { "verification.evidence-required": gateRequirementData(snapshot, "verification", verificationGates) }
      : {}),
    ...(reviewGates.length > 0 ? { "review.gate-required": gateRequirementData(snapshot, "review", reviewGates) } : {}),
    ...(auditGates.length > 0 ? { "audit.gate-required": gateRequirementData(snapshot, "audit", auditGates) } : {})
  };
}

function openDeclaredGatesByKind(
  snapshot: AgentDirectiveSnapshot,
  kind: string
): readonly AgentDirectiveGateStateSnapshot[] {
  return snapshot.gate.requiredGates.filter(
    (gate) => gate.kind === kind && gate.status === "open" && gate.declaredCommand !== undefined
  );
}

function needsDoctorRecoveryDirective(snapshot: AgentDirectiveSnapshot): boolean {
  const diagnostics = recoveryDiagnostics(snapshot);
  const commandSelfRefreshes = commandSelfRefreshesGeneratedArtifacts(snapshot.command.path);
  const syncNeedsRefresh =
    !snapshot.sync.ok ||
    !snapshot.sync.ledgersFresh ||
    !snapshot.sync.searchIndexFresh ||
    !snapshot.sync.sqliteCacheFresh;
  const operationNeedsPrune =
    snapshot.sync.operationCount !== undefined &&
    snapshot.sync.warningThreshold !== undefined &&
    snapshot.sync.operationCount >= snapshot.sync.warningThreshold;
  const generatedArtifactsNeedRefresh = syncNeedsRefresh && !commandSelfRefreshes;
  const doctorNeedsRecovery =
    !snapshot.doctor.ok && (generatedArtifactsNeedRefresh || operationNeedsPrune || diagnostics.length > 0);
  if (commandEmitsHealthRecovery(snapshot.command.path)) {
    return doctorNeedsRecovery || generatedArtifactsNeedRefresh || operationNeedsPrune || diagnostics.length > 0;
  }
  return diagnostics.length > 0;
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
    ...agentDirectivePayloadFields(registryEntry.id).flatMap((payloadField) =>
      payloadFieldIssues(registryEntry, data, payloadField, `${path}.${payloadField.key}`)
    )
  ];
}

function payloadFieldIssues(
  registryEntry: AgentDirectiveRegistryEntry,
  data: AgentDirectiveData,
  payloadField: AgentDirectivePayloadField,
  path: string
): readonly AgentDirectiveBundleAssemblyIssue[] {
  const hasValue = Object.prototype.hasOwnProperty.call(data, payloadField.key);
  if (!hasValue) {
    return payloadField.required
      ? [assemblyIssue("data", path, "missing required directive data", registryEntry.id)]
      : [];
  }
  const value = data[payloadField.key];
  return dataValueMatchesRequirement(value, payloadField.valueType)
    ? []
    : [assemblyIssue("data", path, `must be ${payloadField.valueType} directive data`, registryEntry.id)];
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
  context: AgentDirectiveProjectionContext
): readonly AgentDirectiveMissingRequiredEntry[] {
  return agentDirectivePayloadFields(registryEntry.id).flatMap((payloadField) => {
    if (!payloadField.required) {
      return [];
    }
    const path = `$.dataByRegistryId.${registryEntry.id}.${payloadField.key}`;
    const matchingIssue = dataIssues.find((dataIssue) => dataIssue.path === path);
    return matchingIssue === undefined
      ? []
      : [
          {
            registryId: registryEntry.id,
            family: registryEntry.family,
            subject: subjectForProjectionContext(context),
            requirement: payloadField.key,
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

function directiveFromRegistryEntry(
  registryEntry: AgentDirectiveRegistryEntry,
  registry: AgentDirectiveRegistry,
  context: AgentDirectiveProjectionContext,
  data: AgentDirectiveData,
  selectedBy: readonly string[],
  sourceHash: ContentHash
): AgentDirective {
  return {
    id: directiveIdForRegistryEntry(registryEntry, sourceHash),
    registryId: registryEntry.id,
    version: registryEntry.version,
    family: registryEntry.family,
    severity: registryEntry.severity,
    audience: registryEntry.audience,
    kind: registryEntry.kind,
    title: registryEntry.title,
    instruction: registryEntry.instruction,
    triggerCodes: registryEntry.triggerCodes,
    nextCommandTemplate: registryEntry.nextCommandTemplate,
    data,
    source: {
      registryVersion: registry.version,
      registryPath: registryEntry.sourcePath,
      selectedBy,
      snapshotHash: sourceHash
    },
    subject: subjectForProjectionContext(context),
    supersedes: [],
    blocksCloseout: registryEntry.blocksCloseout,
    acknowledgement: registryEntry.acknowledgement
  };
}

function subjectForProjectionContext(context: AgentDirectiveProjectionContext): AgentDirectiveSubject {
  return context.subject ?? {
    type: "command",
    id: normalizeMachineFragment(context.commandPath),
    title: context.commandPath
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

function isBlockingDirective(directive: AgentDirective): boolean {
  return directive.severity === "blocking" || directive.blocksCloseout === true;
}

function blocksLowerPriorityDirective(blockingDirective: AgentDirective, candidate: AgentDirective): boolean {
  return (
    severityRank(blockingDirective.severity) > severityRank(candidate.severity) &&
    (candidate.kind === "next_step" || candidate.severity === "advisory")
  );
}

function maxSeverity(severities: readonly AgentDirective["severity"][]): AgentDirective["severity"] {
  return severities.reduce((current, next) => (severityRank(next) > severityRank(current) ? next : current), "advisory");
}

function severityRank(severity: AgentDirective["severity"]): number {
  switch (severity) {
    case "blocking":
      return 2;
    case "required":
      return 1;
    case "advisory":
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

function gateRequirementData(
  snapshot: AgentDirectiveSnapshot,
  kind: string,
  gates: readonly AgentDirectiveGateStateSnapshot[] = snapshot.gate.requiredGates.filter((gate) => gate.kind === kind)
): AgentDirectiveData {
  return dataRecord([
    ["subjectId", snapshot.work.subject?.id],
    ["gateIds", gates.map((gate) => gate.id)],
    ["requiredEvidenceKinds", uniqueStrings(gates.flatMap((gate) => gate.requiredEvidenceKinds))],
    ["minEvidenceCount", maxNumber(gates.map((gate) => gate.minEvidenceCount))],
    ["command", firstString(gates.map((gate) => gate.declaredCommand))],
    ["expectedVerdict", "passed"],
    ["declaredCommands", uniqueStrings(gates.flatMap((gate) => gate.declaredCommand ? [gate.declaredCommand] : []))],
    ["expectedObservable", firstString(gates.map((gate) => gate.expectedObservable))],
    ["expectedObservables", uniqueStrings(gates.flatMap((gate) => gate.expectedObservable ? [gate.expectedObservable] : []))],
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
      ["declaredCommand", gate.declaredCommand],
      ["expectedObservable", gate.expectedObservable],
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

function workflowNextDirectiveData(
  snapshot: AgentDirectiveSnapshot,
  workflowRef: string | undefined = snapshot.workflow.nextWorkflowRef,
  commandPath: string | undefined = snapshot.workflow.recommendedCommandPath,
  requiredInputs: readonly string[] = snapshot.workflow.requiredInputNames
): AgentDirectiveData {
  const primaryGitRoot = snapshot.git.roots[0];
  return dataRecord([
    ["workflowRef", workflowRef],
    ["commandPath", commandPath],
    ["requiredInputs", requiredInputs],
    ["currentStatus", snapshot.work.subject?.status],
    ["subjectId", snapshot.work.subject?.id],
    ["branchName", primaryGitRoot?.branchName],
    ["gitRoot", primaryGitRoot?.root],
    ["evidenceIds", snapshot.evidence.evidenceIds],
    ["verificationIds", snapshot.evidence.verificationIds],
    ["openBlockerIds", openBlockerIds(snapshot)],
    ["openDescendantIds", snapshot.work.openDescendantIds],
    ["requiredGateIds", snapshot.gate.openGateIds],
    ["activeReservationIds", snapshot.actor.activeReservationIds],
    ["summaryUri", latestSnapshotSummaryUri(snapshot)],
    ["summaryId", latestSnapshotSummaryId(snapshot)]
  ]);
}

function handoffDirectiveData(
  snapshot: AgentDirectiveSnapshot,
  options: AgentDirectiveHandoffDataOptions = {}
): AgentDirectiveData {
  const primaryGitRoot = snapshot.git.roots[0];
  return dataRecord([
    ["workId", snapshot.work.subject?.id],
    ["summaryId", options.summaryId ?? latestSnapshotSummaryId(snapshot)],
    ["summaryUri", options.summaryUri ?? latestSnapshotSummaryUri(snapshot)],
    ["nextWorkflow", options.nextWorkflowRef ?? snapshot.workflow.nextWorkflowRef],
    ["reservationIds", snapshot.actor.activeReservationIds],
    ["commitShas", snapshotCommitShas(snapshot)],
    ["subjectStatus", snapshot.work.subject?.status],
    ["branchName", primaryGitRoot?.branchName],
    ["gitRoot", primaryGitRoot?.root],
    ["evidenceIds", snapshot.evidence.evidenceIds],
    ["verificationIds", snapshot.evidence.verificationIds],
    ["openBlockerIds", openBlockerIds(snapshot)],
    ["openDescendantIds", snapshot.work.openDescendantIds],
    ["requiredGateIds", snapshot.gate.openGateIds],
    ["nextCommandPath", options.nextCommandPath ?? snapshot.workflow.recommendedCommandPath],
    ["requiredInputs", options.nextRequiredInputs ?? snapshot.workflow.requiredInputNames]
  ]);
}

function attentionDiagnostics(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveRecoveryDiagnosticSnapshot[] {
  return snapshot.doctor.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "warning" ||
      diagnostic.severity === "error" ||
      diagnostic.blocking
  );
}

function recoveryDiagnostics(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveRecoveryDiagnosticSnapshot[] {
  const diagnostics = attentionDiagnostics(snapshot);
  if (commandEmitsHealthRecovery(snapshot.command.path)) {
    if (commandSelfRefreshesGeneratedArtifacts(snapshot.command.path)) {
      return diagnostics.filter((diagnostic) => !isGeneratedArtifactStalenessDiagnostic(diagnostic.code));
    }
    return diagnostics;
  }
  return diagnostics.filter((diagnostic) => !isCloseoutHealthDiagnostic(diagnostic.code));
}

function commandEmitsHealthRecovery(commandPath: string): boolean {
  return isCloseoutRelevantCommand(commandPath) || isHealthCommand(commandPath);
}

function isCloseoutRelevantCommand(commandPath: string): boolean {
  return [
    "agent finish",
    "gate closeout",
    "session end",
    "sprint close",
    "summary compose",
    "summary show",
    "work cancel",
    "work close"
  ].includes(commandPath);
}

function isHealthCommand(commandPath: string): boolean {
  return (
    commandPath === "doctor" ||
    commandPath === "prime" ||
    commandPath === "sync refresh" ||
    commandPath === "sync status" ||
    commandPath.startsWith("lock ")
  );
}

function commandSelfRefreshesGeneratedArtifacts(commandPath: string): boolean {
  return [
    "agent finish",
    "agent start",
    "evidence add",
    "summary compose",
    "work close",
    "work verify"
  ].includes(commandPath);
}

function isGeneratedArtifactStalenessDiagnostic(code: string): boolean {
  return code === "ledger.status" || code === "search.index" || code === "cache.sqlite";
}

function isCloseoutHealthDiagnostic(code: string): boolean {
  return code === "operation.volume" || isGeneratedArtifactStalenessDiagnostic(code);
}

function diagnosticDataValues(
  diagnostics: readonly AgentDirectiveRecoveryDiagnosticSnapshot[]
): readonly AgentDirectiveDataValue[] {
  return diagnostics.map((diagnostic) =>
    dataRecord([
      ["code", diagnostic.code],
      ["severity", diagnostic.severity],
      ["message", diagnostic.message],
      ["blocking", diagnostic.blocking],
      ["recommendedCommands", diagnostic.recommendedCommands]
    ])
  );
}

function blockedRecoveryCommands(
  subjectId: string | undefined,
  blockerIds: readonly string[],
  gateIds: readonly string[],
  options: AgentDirectiveRecoveryDataOptions
): readonly string[] {
  const commands = [...(options.recommendedCommands ?? [])];
  if (subjectId !== undefined) {
    commands.push(`bwrk dep tree ${subjectId} --json`);
  }
  commands.push(...blockerIds.map((blockerId) => `bwrk work show ${blockerId} --json`));
  if (gateIds.length > 0) {
    commands.push("bwrk gate closeout --strict --json");
  }
  return uniqueNonEmptyStrings(commands);
}

function doctorRecoveryCommands(
  snapshot: AgentDirectiveSnapshot,
  diagnostics: readonly AgentDirectiveRecoveryDiagnosticSnapshot[],
  options: AgentDirectiveRecoveryDataOptions
): readonly string[] {
  const commands = [
    ...(options.recommendedCommands ?? []),
    ...diagnostics.flatMap((diagnostic) => diagnostic.recommendedCommands)
  ];
  const syncNeedsRefresh =
    !snapshot.sync.ok ||
    !snapshot.sync.ledgersFresh ||
    !snapshot.sync.searchIndexFresh ||
    !snapshot.sync.sqliteCacheFresh;
  if (syncNeedsRefresh) {
    commands.push("bwrk sync refresh --json");
  }
  if (!snapshot.doctor.ok || diagnostics.length > 0 || syncNeedsRefresh) {
    commands.push("bwrk doctor --strict --json");
  }
  if (
    snapshot.sync.operationCount !== undefined &&
    snapshot.sync.warningThreshold !== undefined &&
    snapshot.sync.operationCount >= snapshot.sync.warningThreshold
  ) {
    commands.push("bwrk gate closeout --strict --json");
  }
  if (diagnostics.some((diagnostic) => diagnostic.code.includes("lock"))) {
    commands.push("bwrk lock inspect --json");
  }
  return uniqueNonEmptyStrings(commands);
}

function maxNumber(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function firstString(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function firstOpenDeclaredGateCommand(snapshot: AgentDirectiveSnapshot): string | undefined {
  return firstString(openDeclaredGatesByKind(snapshot, "verification").map((gate) => gate.declaredCommand));
}

function firstOpenDeclaredGateObservable(snapshot: AgentDirectiveSnapshot): string | undefined {
  return firstString(openDeclaredGatesByKind(snapshot, "verification").map((gate) => gate.expectedObservable));
}

function gitCheckpointDirectiveData(
  snapshot: AgentDirectiveSnapshot,
  outcome: AgentSummaryOutcome | undefined,
  options: AgentDirectiveGitDataOptions
): AgentDirectiveData {
  const primaryGitRoot = snapshot.git.roots[0];
  const commitShas = uniqueStrings([...snapshot.git.checkpointCommitShas, ...snapshot.summary.commitShas]);
  const dirtyPathNotes = uniqueStrings([...snapshot.git.dirtyPathNotes, ...snapshot.summary.dirtyPathNotes]);
  const scopedChangedPaths = primaryGitRoot?.scopedChangedPaths ?? [];
  const collaborationDirtyPaths = primaryGitRoot?.collaborationDirtyPaths ?? [];
  const blockingDirtyPaths = primaryGitRoot?.blockingDirtyPaths ?? [];
  const untrackedPaths = primaryGitRoot?.untrackedPaths ?? [];
  const repositoryChanged =
    options.repositoryChanged ??
    snapshot.git.roots.some(
      (root) =>
        root.scopedChangedPaths.length > 0 ||
        root.blockingDirtyPaths.length > 0 ||
        root.untrackedPaths.length > 0
    );
  const noRepoChanges = commitShas.length === 0 && repositoryChanged === false;
  const noCommitReason =
    options.noCommitReason ?? inferCheckpointReasonCode(outcome, commitShas, dirtyPathNotes, repositoryChanged);
  const reasonCode = options.checkpointReasonCode ?? noCommitReason;

  return dataRecord([
    ["gitRoot", primaryGitRoot?.root],
    ["commitShas", commitShas],
    ["dirtyPathNotes", dirtyPathNotes],
    ["reasonCode", reasonCode],
    ["branchName", primaryGitRoot?.branchName],
    ["roots", gitRootDataValues(snapshot)],
    ["protectedBranch", primaryGitRoot?.protectedBranch],
    ["detached", primaryGitRoot?.detached],
    ["clean", primaryGitRoot?.clean],
    ["repositoryChanged", repositoryChanged],
    ["noRepoChanges", noRepoChanges],
    ["scopedChangedPaths", pathDataValues(scopedChangedPaths)],
    ["collaborationDirtyPaths", pathDataValues(collaborationDirtyPaths)],
    ["blockingDirtyPaths", pathDataValues(blockingDirtyPaths)],
    ["untrackedPaths", untrackedPaths],
    ["outOfScopeRepoNotes", options.outOfScopeRepoNotes ?? dirtyPathNotes],
    ["noCommitReason", noCommitReason],
    ["protectedBranchCaveat", primaryGitRoot?.protectedBranch === true ? "protected_branch_checkpoint" : undefined],
    ["lastCommitSha", primaryGitRoot?.lastCommitSha]
  ]);
}

function gitRootDataValues(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveDataValue[] {
  return snapshot.git.roots.map((root) =>
    dataRecord([
      ["root", root.root],
      ["branchName", root.branchName],
      ["detached", root.detached],
      ["protectedBranch", root.protectedBranch],
      ["clean", root.clean],
      ["scopedChangedPaths", pathDataValues(root.scopedChangedPaths)],
      ["collaborationDirtyPaths", pathDataValues(root.collaborationDirtyPaths)],
      ["blockingDirtyPaths", pathDataValues(root.blockingDirtyPaths)],
      ["untrackedPaths", root.untrackedPaths],
      ["lastCommitSha", root.lastCommitSha]
    ])
  );
}

function pathDataValues(paths: readonly { readonly status: string; readonly path: string }[]): readonly AgentDirectiveDataValue[] {
  return paths.map((path) =>
    dataRecord([
      ["status", path.status],
      ["path", path.path]
    ])
  );
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
  dirtyPathNotes: readonly string[],
  repositoryChanged: boolean
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
  if (!repositoryChanged) {
    return "no_repo_changes";
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

function latestSnapshotSummaryId(snapshot: AgentDirectiveSnapshot): string | undefined {
  return snapshot.summary.latestSummaryId ?? last(snapshot.summary.finalSummaryIds) ?? last(snapshot.summary.summaryIds);
}

function latestSnapshotSummaryUri(snapshot: AgentDirectiveSnapshot): string | undefined {
  return snapshot.summary.latestSummaryUri ?? last(snapshot.summary.artifactUris);
}

function snapshotCommitShas(snapshot: AgentDirectiveSnapshot): readonly string[] {
  return uniqueStrings([...snapshot.git.checkpointCommitShas, ...snapshot.summary.commitShas]);
}

function openBlockerIds(snapshot: AgentDirectiveSnapshot): readonly string[] {
  return uniqueStrings([...snapshot.work.activeBlockerIds, ...snapshot.work.blockedByIds]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function uniqueNonEmptyStrings(values: readonly string[]): readonly string[] {
  return uniqueStrings(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function last<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function bundleIdForCommand(commandPath: string, sourceHash: ContentHash): AgentDirectiveBundleId {
  return `bundle.${normalizeMachineFragment(commandPath)}.${hashSuffix(sourceHash)}` as AgentDirectiveBundleId;
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
