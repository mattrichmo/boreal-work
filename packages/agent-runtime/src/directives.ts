import {
  agentDirectiveSnapshotHash,
  agentDirectiveSnapshotIssues,
  assembleAgentDirectiveBundleFromGaps,
  closeoutDirectiveDataByRegistryId,
  gitDirectiveDataByRegistryId,
  handoffDirectiveDataByRegistryId,
  recoveryDirectiveDataByRegistryId,
  summaryDirectiveDataByRegistryId,
  type AgentDirectiveAssemblyDataByRegistryId,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleAssemblyIssue,
  type AgentDirectiveCloseoutDataOptions,
  type AgentDirectiveGitDataOptions,
  type AgentDirectiveHandoffDataOptions,
  type AgentDirectiveMissingRequiredEntry,
  type AgentDirectiveRecoveryDataOptions,
  type AgentDirectiveRegistry,
  type AgentDirectiveSnapshot,
  type AgentDirectiveSummaryDataOptions,
  type AgentDirectiveTemplateId,
  type AgentDirectiveBundleId,
  type EnforcementGap,
  type EnforcementGapCode,
  type IsoTimestamp
} from "@boreal/core";

export const AGENT_RUNTIME_DIRECTIVE_OBLIGATIONS_SCHEMA_VERSION =
  "boreal.agent-runtime.directive-obligations.v1";

export const AGENT_RUNTIME_DIRECTIVE_CONTEXTS = ["work", "session", "closeout", "health", "handoff"] as const;

export type AgentRuntimeDirectiveContext = (typeof AGENT_RUNTIME_DIRECTIVE_CONTEXTS)[number];

export interface AgentRuntimeDirectiveObligationsInput {
  readonly context: AgentRuntimeDirectiveContext;
  readonly snapshot: AgentDirectiveSnapshot;
  readonly dataByRegistryId?: AgentDirectiveAssemblyDataByRegistryId;
  readonly registry?: AgentDirectiveRegistry;
  readonly generatedAt?: IsoTimestamp;
  readonly bundleId?: AgentDirectiveBundleId;
  readonly closeout?: AgentDirectiveCloseoutDataOptions;
  readonly git?: AgentDirectiveGitDataOptions;
  readonly handoff?: AgentDirectiveHandoffDataOptions;
  readonly recovery?: AgentDirectiveRecoveryDataOptions;
  readonly summary?: AgentDirectiveSummaryDataOptions;
}

export interface AgentRuntimeDirectiveObligationSummary {
  readonly context: AgentRuntimeDirectiveContext;
  readonly bundleCount: number;
  readonly directiveCount: number;
  readonly selectedRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly emittedRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly advisoryRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly requiredRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly blockingRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly closeoutBlockingRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly advisoryCount: number;
  readonly requiredCount: number;
  readonly blockingCount: number;
  readonly closeoutBlockingCount: number;
  readonly conflictCount: number;
  readonly deprecationCount: number;
  readonly missingRequiredCount: number;
}

export interface AgentRuntimeDirectiveObligations {
  readonly schemaVersion: typeof AGENT_RUNTIME_DIRECTIVE_OBLIGATIONS_SCHEMA_VERSION;
  readonly generatedAt: IsoTimestamp;
  readonly context: AgentRuntimeDirectiveContext;
  readonly ok: boolean;
  readonly agentDirectives: readonly AgentDirectiveBundle[];
  readonly summary: AgentRuntimeDirectiveObligationSummary;
  readonly selectedRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
  readonly issues: readonly AgentDirectiveBundleAssemblyIssue[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
}

export function compileAgentRuntimeDirectiveObligations(
  input: AgentRuntimeDirectiveObligationsInput
): AgentRuntimeDirectiveObligations {
  const snapshotIssues = agentDirectiveSnapshotIssues(input.snapshot).map((snapshotIssue) => ({
    phase: "snapshot" as const,
    path: snapshotIssue.path,
    message: snapshotIssue.message
  }));
  if (snapshotIssues.length > 0) {
    return {
      schemaVersion: AGENT_RUNTIME_DIRECTIVE_OBLIGATIONS_SCHEMA_VERSION,
      generatedAt: input.generatedAt ?? input.snapshot.capturedAt,
      context: input.context,
      ok: false,
      agentDirectives: [],
      summary: summarizeAgentRuntimeDirectiveObligations(input.context, [], [], []),
      selectedRegistryIds: [],
      dataByRegistryId: input.dataByRegistryId ?? {},
      issues: snapshotIssues,
      missingRequired: []
    };
  }

  const dataByRegistryId = agentRuntimeDirectiveDataByRegistryId(input);
  const result = assembleAgentDirectiveBundleFromGaps({
    gaps: agentRuntimeDirectiveGaps(input.context, input.snapshot, dataByRegistryId),
    dataByRegistryId,
    commandPath: input.snapshot.command.path,
    capturedAt: input.snapshot.capturedAt,
    envelopeSchema: input.snapshot.command.envelopeSchema,
    subject: input.snapshot.work.subject,
    registry: input.registry,
    generatedAt: input.generatedAt,
    bundleId: input.bundleId,
    sourceHash: agentDirectiveSnapshotHash(input.snapshot)
  });
  const agentDirectives = result.bundle && result.selectedRegistryIds.length > 0 ? [result.bundle] : [];

  return {
    schemaVersion: AGENT_RUNTIME_DIRECTIVE_OBLIGATIONS_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? input.snapshot.capturedAt,
    context: input.context,
    ok: result.ok,
    agentDirectives,
    summary: summarizeAgentRuntimeDirectiveObligations(
      input.context,
      agentDirectives,
      result.selectedRegistryIds,
      result.missingRequired
    ),
    selectedRegistryIds: result.selectedRegistryIds,
    dataByRegistryId,
    issues: result.issues,
    missingRequired: result.missingRequired
  };
}

function agentRuntimeDirectiveGaps(
  context: AgentRuntimeDirectiveContext,
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  return uniqueGaps([
    ...gateGaps(snapshot),
    ...(snapshot.work.activeBlockerIds.length > 0 || snapshot.work.blockedByIds.length > 0
      ? [runtimeGap(snapshot, "work.blocked.open-dependency")]
      : []),
    ...(snapshot.work.openDescendantIds.length > 0 ? [runtimeGap(snapshot, "work.container.open-descendant")] : []),
    ...(needsDoctorRecovery(snapshot)
      ? [runtimeGap(snapshot, snapshot.sync.searchIndexFresh ? "doctor.recovery.required" : "search.index-stale")]
      : []),
    ...(context === "closeout" && closeoutSummaryRequired(snapshot, dataByRegistryId["closeout.summary-required"])
      ? [runtimeGap(snapshot, "closeout.user-summary.required")]
      : []),
    ...(context === "closeout" && gitCheckpointRequired(snapshot, dataByRegistryId["git.checkpoint-required"])
      ? [runtimeGap(snapshot, "git.checkpoint.required")]
      : []),
    ...(dataByRegistryId["git.lane-worktree-required"] !== undefined
      ? [runtimeGap(snapshot, "git.lane-worktree.required")]
      : []),
    ...(context === "closeout" && rollupRequired(snapshot, ["phase", "milestone"])
      ? [runtimeGap(snapshot, "phase.close-rollup.required")]
      : []),
    ...(context === "closeout" && rollupRequired(snapshot, ["sprint"])
      ? [runtimeGap(snapshot, "sprint.close-rollup.required")]
      : []),
    ...(dataByRegistryId["workflow_next.canonical-next-step"] !== undefined
      ? [runtimeGap(snapshot, "directive.workflow-next.available")]
      : []),
    ...((context === "session" || context === "handoff" || context === "closeout") &&
    handoffRequired(snapshot, dataByRegistryId["handoff.session-summary"])
      ? [runtimeGap(snapshot, "handoff.session-summary.required")]
      : [])
  ]);
}

function gateGaps(snapshot: AgentDirectiveSnapshot): readonly EnforcementGap[] {
  return snapshot.gate.requiredGates.flatMap((gate) => {
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
    return codes.map((code) => runtimeGap(snapshot, code));
  });
}

function runtimeGap(snapshot: AgentDirectiveSnapshot, code: EnforcementGapCode): EnforcementGap {
  const subject = snapshot.work.subject;
  return {
    code,
    subjectType: (subject?.type ?? "command") as EnforcementGap["subjectType"],
    subjectId: subject?.id ?? snapshot.command.path
  };
}

function uniqueGaps(gaps: readonly EnforcementGap[]): readonly EnforcementGap[] {
  const byCode = new Map<EnforcementGapCode, EnforcementGap>();
  for (const gap of gaps) {
    byCode.set(gap.code, gap);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function needsDoctorRecovery(snapshot: AgentDirectiveSnapshot): boolean {
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

function recoveryDiagnostics(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveSnapshot["doctor"]["diagnostics"][number][] {
  const diagnostics = snapshot.doctor.diagnostics.filter((diagnostic) =>
    diagnostic.severity === "warning" || diagnostic.severity === "error" || diagnostic.blocking
  );
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

function closeoutSummaryRequired(snapshot: AgentDirectiveSnapshot, data: AgentDirectiveAssemblyDataByRegistryId[string]): boolean {
  if (data === undefined || dataString(data, "summaryId") !== undefined || dataString(data, "summaryUri") !== undefined) {
    return false;
  }
  return snapshot.work.subject?.status === "closed" || snapshot.work.subject?.status === "cancelled" || closeoutCommandRequiresCheckpoint(snapshot.command.path);
}

function gitCheckpointRequired(snapshot: AgentDirectiveSnapshot, data: AgentDirectiveAssemblyDataByRegistryId[string]): boolean {
  if (data === undefined || dataStringArray(data, "commitShas").length > 0) {
    return false;
  }
  const reasonCode = dataString(data, "reasonCode") ?? dataString(data, "noCommitReason");
  const repositoryChanged = dataBoolean(data, "repositoryChanged") === true;
  if (repositoryChanged || dataArray(data, "scopedChangedPaths").length > 0 || dataArray(data, "blockingDirtyPaths").length > 0) {
    return true;
  }
  return closeoutCommandRequiresCheckpoint(snapshot.command.path) && reasonCode === undefined;
}

function rollupRequired(snapshot: AgentDirectiveSnapshot, subjectTypes: readonly string[]): boolean {
  return (
    ["summary compose", "summary show", "sprint metrics", "sprint report"].includes(snapshot.command.path) &&
    subjectTypes.includes(snapshot.work.subject?.type ?? "")
  );
}

function handoffRequired(snapshot: AgentDirectiveSnapshot, data: AgentDirectiveAssemblyDataByRegistryId[string]): boolean {
  return (
    data !== undefined &&
    (snapshot.work.subject?.type === "session" || snapshot.actor.activeReservationIds.length > 0) &&
    (dataString(data, "summaryId") !== undefined || dataString(data, "summaryUri") !== undefined)
  );
}

function closeoutCommandRequiresCheckpoint(commandPath: string): boolean {
  return ["agent finish", "summary compose", "summary show", "work cancel", "work close", "sprint close"].includes(commandPath);
}

function dataString(data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function dataBoolean(data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>, key: string): boolean | undefined {
  const value = data[key];
  return typeof value === "boolean" ? value : undefined;
}

function dataStringArray(
  data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>,
  key: string
): readonly string[] {
  return dataArray(data, key).filter((value): value is string => typeof value === "string");
}

function dataArray(data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>, key: string): readonly unknown[] {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

export function summarizeAgentRuntimeDirectiveObligations(
  context: AgentRuntimeDirectiveContext,
  agentDirectives: readonly AgentDirectiveBundle[],
  selectedRegistryIds: readonly AgentDirectiveTemplateId[] = agentDirectives.flatMap((bundle) =>
    bundle.directives.map((directive) => directive.registryId)
  ),
  missingRequired: readonly AgentDirectiveMissingRequiredEntry[] = agentDirectives.flatMap((bundle) => bundle.missingRequired)
): AgentRuntimeDirectiveObligationSummary {
  const directives = agentDirectives.flatMap((bundle) => bundle.directives);
  const advisoryRegistryIds = uniqueRegistryIds(
    directives.filter((directive) => directive.severity === "advisory").map((directive) => directive.registryId)
  );
  const requiredRegistryIds = uniqueRegistryIds(
    directives.filter((directive) => directive.severity === "required").map((directive) => directive.registryId)
  );
  const blockingRegistryIds = uniqueRegistryIds(
    directives.filter((directive) => directive.severity === "blocking").map((directive) => directive.registryId)
  );
  const closeoutBlockingRegistryIds = uniqueRegistryIds(
    directives.filter((directive) => directive.blocksCloseout === true).map((directive) => directive.registryId)
  );

  return {
    context,
    bundleCount: agentDirectives.length,
    directiveCount: directives.length,
    selectedRegistryIds: uniqueRegistryIds(selectedRegistryIds),
    emittedRegistryIds: uniqueRegistryIds(directives.map((directive) => directive.registryId)),
    advisoryRegistryIds,
    requiredRegistryIds,
    blockingRegistryIds,
    closeoutBlockingRegistryIds,
    advisoryCount: advisoryRegistryIds.length,
    requiredCount: requiredRegistryIds.length,
    blockingCount: blockingRegistryIds.length,
    closeoutBlockingCount: closeoutBlockingRegistryIds.length,
    conflictCount: agentDirectives.reduce((count, bundle) => count + bundle.conflicts.length, 0),
    deprecationCount: agentDirectives.reduce((count, bundle) => count + bundle.deprecations.length, 0),
    missingRequiredCount: missingRequired.length
  };
}

function agentRuntimeDirectiveDataByRegistryId(
  input: AgentRuntimeDirectiveObligationsInput
): AgentDirectiveAssemblyDataByRegistryId {
  const summaryOptions = {
    ...input.closeout,
    ...input.summary
  };

  switch (input.context) {
    case "health":
      return {
        ...recoveryDirectiveDataByRegistryId(input.snapshot, input.recovery),
        ...input.dataByRegistryId
      };
    case "session":
    case "handoff":
      return {
        ...handoffDirectiveDataByRegistryId(input.snapshot, input.handoff),
        ...recoveryDirectiveDataByRegistryId(input.snapshot, input.recovery),
        ...input.dataByRegistryId
      };
    case "closeout":
      return {
        ...closeoutDirectiveDataByRegistryId(input.snapshot, input.closeout),
        ...summaryDirectiveDataByRegistryId(input.snapshot, summaryOptions),
        ...gitDirectiveDataByRegistryId(input.snapshot, input.git),
        ...handoffDirectiveDataByRegistryId(input.snapshot, input.handoff),
        ...input.dataByRegistryId
      };
    case "work":
      return {
        ...recoveryDirectiveDataByRegistryId(input.snapshot, input.recovery),
        ...input.dataByRegistryId
      };
  }
}

function uniqueRegistryIds(values: readonly AgentDirectiveTemplateId[]): readonly AgentDirectiveTemplateId[] {
  const seen = new Set<string>();
  const output: AgentDirectiveTemplateId[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      output.push(value);
    }
  }
  return output;
}
