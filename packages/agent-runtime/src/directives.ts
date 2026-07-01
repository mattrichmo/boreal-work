import {
  assembleAgentDirectiveBundle,
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
  readonly requiredRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly blockingRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly closeoutBlockingRegistryIds: readonly AgentDirectiveTemplateId[];
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
  const dataByRegistryId = agentRuntimeDirectiveDataByRegistryId(input);
  const result = assembleAgentDirectiveBundle({
    snapshot: input.snapshot,
    dataByRegistryId,
    registry: input.registry,
    generatedAt: input.generatedAt,
    bundleId: input.bundleId
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

export function summarizeAgentRuntimeDirectiveObligations(
  context: AgentRuntimeDirectiveContext,
  agentDirectives: readonly AgentDirectiveBundle[],
  selectedRegistryIds: readonly AgentDirectiveTemplateId[] = agentDirectives.flatMap((bundle) =>
    bundle.directives.map((directive) => directive.registryId)
  ),
  missingRequired: readonly AgentDirectiveMissingRequiredEntry[] = agentDirectives.flatMap((bundle) => bundle.missingRequired)
): AgentRuntimeDirectiveObligationSummary {
  const directives = agentDirectives.flatMap((bundle) => bundle.directives);
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
    requiredRegistryIds,
    blockingRegistryIds,
    closeoutBlockingRegistryIds,
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
  const allWorkData: AgentDirectiveAssemblyDataByRegistryId = {
    ...recoveryDirectiveDataByRegistryId(input.snapshot, input.recovery),
    ...gitDirectiveDataByRegistryId(input.snapshot, input.git),
    ...closeoutDirectiveDataByRegistryId(input.snapshot, input.closeout),
    ...summaryDirectiveDataByRegistryId(input.snapshot, summaryOptions),
    ...handoffDirectiveDataByRegistryId(input.snapshot, input.handoff)
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
        ...allWorkData,
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
