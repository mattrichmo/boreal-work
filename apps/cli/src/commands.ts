import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hostname } from "node:os";

import {
  AGENT_DIRECTIVE_SUBJECT_TYPES,
  AGENT_DIRECTIVE_FAMILIES,
  AGENT_DIRECTIVE_REGISTRY,
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  BorealError,
  agentDirectivePayloadFields,
  agentDirectiveSnapshotHash,
  assembleAgentDirectiveBundleFromGaps,
  assertPathInside,
  closeoutDirectiveDataByRegistryId,
  createRecordMeta,
  createAgentDirectiveSnapshot,
  deterministicId,
  directiveAcknowledgementRecordSchemaIssues,
  gitDirectiveDataByRegistryId,
  hashContent,
  handoffDirectiveDataByRegistryId,
  isBorealReferenceUri,
  isBorealError,
  isIsoTimestamp,
  normalizeActorId,
  normalizeLabels,
  normalizeMachineString,
  normalizeSearchQuery,
  nowIso,
  parseBorealReferenceUri,
  parseDeclaredCommand,
  randomId,
  resolveBorealReferenceUri,
  runBoundedProcess,
  recoveryDirectiveDataByRegistryId,
  runtimeSnapshotSchemaIssues,
  selectAgentDirectiveRegistryEntriesFromGaps,
  summaryDirectiveDataByRegistryId,
  touchRecord,
  workRevisionContentHash,
  withContentHash,
  type ActorRef,
  type ActorKind,
  type AgentDirectiveAssemblyDataByRegistryId,
  type AgentDirectiveFamily,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleAssemblyIssue,
  type AgentDirectiveDiagnosticSnapshot,
  type AgentDirectiveGateStateSnapshot,
  type AgentDirectiveId,
  type AgentDirectiveLifecycle,
  type AgentDirectiveMissingRequiredEntry,
  type AgentDirectivePayloadField,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryVersion,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveSubjectType,
  type AgentDirectiveSnapshot,
  type AgentDirectiveTemplateId,
  type AgentDirectiveVersion,
  type AgentReservation,
  type AgentSummaryForceReasonCode,
  type AgentSummaryId,
  type AgentSummaryKind,
  type AgentSummaryOutcome,
  type AgentSummaryRecord,
  type AgentSummaryStatus,
  type AgentSummarySubjectType,
  type BorealReference,
  type BorealReferenceRecordKind,
  type BorealReferenceResolution,
  type ClaimId,
  type ClaimRecord,
  type CloseoutGateForceReasonCode,
  type CloseoutGateId,
  type CloseoutGateKind,
  type CloseoutGateScope,
  type ContentHash,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type DirectiveAcknowledgementId,
  type DirectiveAcknowledgementOutcome,
  type DirectiveAcknowledgementRecord,
  type EventId,
  type EvidenceId,
  type EvidenceRecord,
  type EvidenceKind,
  type EvidenceOutcome,
  type EvidenceTrustLevel,
  type EnforcementGap,
  type EnforcementGapCode,
  type GraphEdge,
  type GraphEdgeId,
  type IsoTimestamp,
  type KnowledgeSourceId,
  type OperationId,
  type ProjectRegistryEntry,
  type ProjectRollupDocument,
  type ProjectRollupWorkIndexEntry,
  type ProjectionId,
  type ReservationId,
  type ReservationStatus,
  type RequiredCloseoutGate,
  type ReviewerHeartbeatId,
  type ReviewerHeartbeatRecord,
  type RuntimeOperation,
  type RuntimeOperationStatus,
  type RuntimeEvent,
  type SourceRef,
  type VerificationId,
  type VerificationRecord,
  type VerificationVerdict,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import { inspectDaemonStatus, refreshGlobalRollupCache, type GlobalRollupCacheResult } from "@boreal/daemon";
import {
  evidenceSatisfiesTrustRequirement,
  evidenceTrustGap,
  type EvidenceTrustRequirement
} from "@boreal/evidence-engine";
import type { SearchResult } from "@boreal/search";
import {
  FileBorealStore,
  ObjectDirBorealStore,
  objectIndexPath,
  writeTextFileAtomic,
  type BorealReader,
  type BorealStore,
  type BorealWriter
} from "@boreal/storage";
import { toWorkItemView, type BorealSourceRefResolutionView, type WorkItemView, type WorkSourceRefView } from "@boreal/ui-model";
import {
  closeoutGateSubjectTypeForWorkKind,
  createRequiredCloseoutGates,
  deriveReadinessStatus,
  type RequiredCloseoutGateInput
} from "@boreal/work-engine";
import type { ExternalDependencyResolution, FinishReservedWorkSummaryFactory } from "@boreal/engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "./args.js";
import { agentCommand, agentStartCommand, type AgentCommandDependencies } from "./commands/agent.js";
import { captureCommand } from "./commands/capture.js";
import { daemonCommand, type DaemonCommandDependencies } from "./commands/daemon.js";
import { bootstrapGlobalFirstRunIfNeeded, dashboardCommand, globalCommand, linkCommand, unlinkCommand } from "./commands/dashboard.js";
import { evidenceCommand } from "./commands/evidence.js";
import { healthCommand, type HealthCommandDependencies } from "./commands/health.js";
import { integrationsCommand } from "./commands/integrations.js";
import { initCommand, installCommand, installRootFromArgs, skillInstallScopeFromArgs } from "./commands/install.js";
import { updateCommand } from "./commands/update.js";
import { upgradeCommand, validateUpgradeScope } from "./commands/upgrade.js";
import { knowledgeCommand } from "./commands/knowledge.js";
import { memoryCommand, resolveWikiPageIds } from "./commands/memory.js";
import { commandsCommand, completionCommand, HELP_SECTIONS } from "./commands/meta.js";
import { operationCommand, type OperationCommandDependencies } from "./commands/operation.js";
import { protocolCommand, type ProtocolCommandDependencies } from "./commands/protocol.js";
import { registryCommand, type RegistryCommandDependencies } from "./commands/registry.js";
import { rollupCommand } from "./commands/rollup.js";
import { eventsCommand, runCommand as executionRunCommand } from "./commands/runs.js";
import { orchestratorCommand } from "./commands/orchestrator.js";
import { sprintCommand, type SprintCommandDependencies } from "./commands/sprint.js";
import { storageCommand } from "./commands/storage.js";
import {
  buildSyncRefreshResult,
  buildSyncStatus,
  refreshGeneratedArtifactsInline,
  syncCommand,
  type SyncRefreshResult,
  type SyncStatusResult
} from "./commands/sync.js";
import { templateCommand } from "./commands/template.js";
import { vaultCommand } from "./commands/vault.js";
import { workCommand as workGroupCommand, type WorkCommandDependencies } from "./commands/work.js";
import { workflowsCommand, type WorkflowsCommandDependencies } from "./commands/workflows.js";
import { dependencyIdsForWork, type CommandResult } from "./commands/shared.js";
import {
  COMMAND_DEFINITIONS,
  commandBehavior,
  commandPath,
  findCommandDefinition,
  registryValueFlagNames,
  validateCommandBehaviorMetadata,
  validateCommandFlags,
  type CommandDefinition
} from "./command-registry.js";
import {
  OPERATION_LOG_RECOMMENDED_KEEP,
  asEvidenceId,
  asWorkId,
  runDoctor,
  strictBlockingWarning,
  type Diagnostic,
  type DoctorResult
} from "./doctor.js";
import { assertInitialized, createCliContext, type CliContext } from "./context.js";
import { inspectDocumentationTruth } from "./documentation-truth.js";
import { keyValueRows, resultSummary, section } from "./cli-ui.js";
import { workBranchName } from "./git-branch.js";
import { isMissingGit, runGit } from "./git-exec.js";
import { prepareGitWorktree, removePreparedGitWorktree, type PreparedGitWorktree } from "./git-worktree-attachment.js";
import { inspectGitWorktree } from "./git-worktree.js";
import { buildExportDocument } from "./import-export.js";
import type { RuntimeLockInspectionResult, RuntimeLockState } from "./locks.js";
import {
  attachCliErrorMetadata,
  createResultSpoolingOutput,
  formatRecord,
  table,
  type AgentDirectiveOutput,
  type CliEnvelopeMetadata,
  type CliOperationPhase,
  type CliOutput,
  type CliStateOutcome
} from "./output.js";
import { readProjectSetupConfig, readProjectStorage, type ProjectStorageKind } from "./project-setup.js";
import { listProjectRegistry } from "./registry.js";
import { writeProjectRollup, type ProjectRollupWriteOptions } from "./rollup.js";
import { runSearch, writeSearchIndex } from "./search-cli.js";
import { dirtyPathNotesHaveReasonCode, requireCommitOrDirtyPathReason } from "./summary-policy.js";
import { VAULT_SCHEMA_VERSION } from "./vault.js";
import {
  inspectWorkflowAssets,
  resolveWorkflowAssetRoots,
  validateInstalledSkillRoot,
} from "./workflow-assets.js";
import { formatVersionInfo, getVersionInfo } from "./version.js";
import { box, TAGLINE } from "./branding.js";

const DEFAULT_HANDOFF_SEARCH_LIMIT = 8;
const HANDOFF_SEARCH_MIN_CANDIDATES = 24;
const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_OPERATION_LIST_LIMIT = 50;
const DEFAULT_RESULTS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RESULTS_PRUNE_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_READY_WORK_LIMIT = 10;
const MAX_LIST_LIMIT = 1_000;
const MAX_SEARCH_LIMIT = 100;
const MAX_HANDOFF_SEARCH_LIMIT = 50;
export type { CommandResult } from "./commands/shared.js";

const CLI_RESULT_SCHEMA_VERSION = "boreal.cli.result.v1";

interface CliMutationResult {
  readonly schemaVersion: typeof CLI_RESULT_SCHEMA_VERSION;
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly subjectId: string;
}

interface WorkLineageEntry {
  readonly id: WorkId;
  readonly kind: WorkKind;
  readonly role: "issue" | "milestone" | "phase" | "sprint" | "parent";
  readonly title: string;
  readonly labels: readonly string[];
}

interface WorkListRow {
  readonly id: string;
  readonly kind: WorkKind;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly title: string;
  readonly labels: readonly string[];
  readonly hasBorealReferences?: boolean;
  readonly borealReferenceCount?: number;
  readonly containerId?: WorkId;
  readonly parentIds?: readonly WorkId[];
  readonly lineage?: readonly WorkLineageEntry[];
  readonly agentId?: string;
  readonly showCommand?: string;
  readonly agentStartCommand?: string;
  readonly workClaimCommand?: string;
}

interface BorealReferenceProjectView {
  readonly id: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly projectRoot: string;
}

interface BorealReferenceTargetView {
  readonly id?: string;
  readonly kind?: string;
  readonly title?: string;
  readonly status?: string;
}

interface BorealReferenceResolutionCliView extends BorealSourceRefResolutionView {
  readonly reference?: BorealReference;
  readonly project?: BorealReferenceProjectView;
  readonly target?: BorealReferenceTargetView;
  readonly record?: unknown;
  readonly lastKnownRollup?: unknown;
}

interface BorealResolveResult {
  readonly schemaVersion: "boreal.cli.resolve.v1";
  readonly generatedAt: IsoTimestamp;
  readonly uri: string;
  readonly registryRoot: string;
  readonly registryFile: string;
  readonly resolution: BorealReferenceResolutionCliView;
}

function withCliResult<T extends object>(
  value: T,
  result: Omit<CliMutationResult, "schemaVersion">
): T & { readonly result: CliMutationResult } {
  return {
    ...value,
    result: {
      schemaVersion: CLI_RESULT_SCHEMA_VERSION,
      ...result
    }
  };
}

function workCliResult(work: WorkItem | WorkItemView): CliMutationResult {
  const id = "meta" in work ? work.meta.id : work.id;
  return {
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    id,
    kind: work.kind,
    status: work.status,
    subjectId: id
  };
}

function evidenceCliResult(evidence: EvidenceRecord): CliMutationResult {
  return {
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    id: evidence.meta.id,
    kind: "evidence",
    status: evidence.outcome,
    subjectId: evidence.subjectId
  };
}

function verificationCliResult(verification: VerificationRecord): CliMutationResult {
  return {
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    id: verification.meta.id,
    kind: "verification",
    status: verification.verdict,
    subjectId: verification.subjectId
  };
}

function summaryCliResult(summary: AgentSummaryRecord): CliMutationResult {
  return {
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    id: summary.meta.id,
    kind: "summary",
    status: summary.status,
    subjectId: summary.subjectId
  };
}

interface WorkParallelResult {
  readonly schemaVersion: "boreal.cli.work.parallel.v1";
  readonly generatedAt: IsoTimestamp;
  readonly workspaceRoot: string;
  readonly filters: {
    readonly labels: readonly string[];
    readonly containerId?: WorkId;
    readonly limit: number;
    readonly purpose?: string;
    readonly agentMode: "default" | "single" | "round_robin" | "prefix";
  };
  readonly items: readonly WorkListRow[];
  readonly commands: {
    readonly rerunCommand: string;
    readonly reservationListCommand: string;
  };
}

interface RecentClosedWorkRow {
  readonly id: WorkId;
  readonly title: string;
  readonly kind: WorkKind;
  readonly status: "closed";
  readonly closedAt: IsoTimestamp;
  readonly closedReason?: string;
  readonly labels: readonly string[];
  readonly evidenceCount: number;
  readonly verificationCount: number;
  readonly closedEventId?: EventId;
}

type ReviewCandidateStatus = "pending" | "passed" | "forced" | "optional";

interface ReviewCandidateRow extends RecentClosedWorkRow {
  readonly reviewStatus: ReviewCandidateStatus;
  readonly reviewGateCounts: ReviewGateSummary;
  readonly pendingGateIds: readonly string[];
  readonly passedGateIds: readonly string[];
  readonly forcedGateIds: readonly string[];
  readonly reviewEvidenceCommand: string;
  readonly heartbeatAdvanceCommand?: string;
  readonly closeoutGateStatus: CloseoutGateStatusView;
}

interface ReviewGateKindSummary {
  readonly total: number;
  readonly pending: number;
  readonly passed: number;
  readonly forced: number;
}

interface ReviewGateSummary {
  readonly total: number;
  readonly pending: number;
  readonly passed: number;
  readonly forced: number;
  readonly review: ReviewGateKindSummary;
  readonly audit: ReviewGateKindSummary;
}

interface ReviewGateDetailRow {
  readonly workId: WorkId;
  readonly workTitle: string;
  readonly gateId: string;
  readonly kind: CloseoutGateKind;
  readonly scope: CloseoutGateScope;
  readonly status: CloseoutGateStatusRow["status"];
  readonly targetIds: readonly WorkId[];
  readonly pendingTargetIds: readonly WorkId[];
  readonly evidenceIds: readonly string[];
  readonly verificationIds: readonly string[];
  readonly agentSummaryIds: readonly string[];
  readonly commitShas: readonly string[];
  readonly dirtyPathNotes: readonly string[];
  readonly forceReason?: string;
  readonly forceComment?: string;
  readonly forceEvidenceIds: readonly string[];
}

interface DependencyTreeNode {
  readonly id: string;
  readonly title?: string;
  readonly status?: WorkStatus;
  readonly external?: boolean;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly workId?: WorkId;
  readonly referenceUri?: string;
  readonly reason?: string;
  readonly resolutionState?: ExternalDependencyResolutionState;
  readonly message?: string;
  readonly stale?: boolean;
  readonly missing?: boolean;
  readonly cycle?: boolean;
  readonly shared?: boolean;
  readonly dependencies: readonly DependencyTreeNode[];
}

type ExternalDependencyResolutionState =
  | "resolved-open"
  | "resolved-terminal"
  | "stale"
  | "unresolved-unlinked"
  | "unresolved-missing";

interface ReservationListRow {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly expired: boolean;
  readonly agentId: string;
  readonly workId: string;
  readonly workStatus?: string;
  readonly workTitle?: string;
  readonly reservedAt: string;
  readonly expiresAt?: string;
  readonly purpose?: string;
}

interface OperationListRow {
  readonly id: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly status: RuntimeOperationStatus;
  readonly exitCode: number;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly actorId: string;
  readonly actorKind: ActorKind;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventCount: number;
}

interface OperationPruneResult {
  readonly deleted: number;
  readonly keptBeforeOperationLog: number;
  readonly remainingAfterOperationLog: number;
  readonly keep?: number;
  readonly before?: IsoTimestamp;
  readonly deletedIds: readonly string[];
  readonly results: {
    readonly directory: string;
    readonly cutoff: IsoTimestamp;
    readonly graceMs: number;
    readonly deleted: number;
    readonly deletedBytes: number;
    readonly deletedPaths: readonly string[];
    readonly skippedYoung: number;
  };
}

interface GateCloseoutChecks {
  readonly sync: SyncRefreshResult;
  readonly doctor: DoctorResult;
  readonly schema: Awaited<ReturnType<typeof schemaValidateResult>>;
  readonly docs: Awaited<ReturnType<typeof docsCheckResult>>;
  readonly ok: boolean;
}

interface GateOperationPruneResult extends OperationPruneResult {
  readonly triggeredBy: "operation.volume";
}

interface OperationRepairResult {
  readonly dryRun: boolean;
  readonly inspected: {
    readonly operations: number;
    readonly events: number;
  };
  readonly linkedEvents: readonly string[];
  readonly markedLegacyEvents: readonly string[];
  readonly repairedOperations: readonly string[];
  readonly removedDanglingEventRefs: Array<{ readonly operationId: string; readonly eventId: string }>;
  readonly removedConflictingEventRefs: Array<{
    readonly operationId: string;
    readonly eventId: string;
    readonly eventOperationId: string;
  }>;
  readonly ambiguousEvents: Array<{ readonly eventId: string; readonly operationIds: readonly string[] }>;
}

interface AgentStatus {
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly policy: {
    readonly maxActiveReservations: number;
  };
  readonly reservations: {
    readonly activeCount: number;
    readonly expiredActiveCount: number;
    readonly capacityRemaining: number;
    readonly active: readonly ReservationListRow[];
    readonly expiredActive: readonly ReservationListRow[];
  };
  readonly readyWork: {
    readonly claimableCount: number;
    readonly next?: WorkListRow;
  };
  readonly recommendedAction: {
    readonly kind: string;
    readonly command?: string;
    readonly reason: string;
  };
}

type NextCommandState = "active_reservation" | "ready_work" | "workspace_health" | "idle";
type NextCommandDirective = AgentDirectiveBundle["directives"][number];

interface NextCommandResult {
  readonly schemaVersion: "boreal.cli.next.v1";
  readonly workspaceRoot: string;
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly state: NextCommandState;
  readonly checked: {
    readonly activeReservationIds: readonly string[];
    readonly expiredActiveReservationIds: readonly string[];
    readonly readyWorkCount: number;
    readonly readyWorkId?: string;
    readonly syncOk: boolean;
  };
  readonly subject?: NextCommandDirective["subject"];
  readonly directive: NextCommandDirective | null;
  /** @deprecated Use executableAction.argv for execution. */
  readonly command?: string;
  readonly displayCommand?: string;
  readonly executableAction?: NextExecutableAction;
  readonly why: string;
  readonly selectionKey?: string;
  readonly bundleMeta?: AgentDirectiveBundle["meta"];
}

interface NextExecutableAction {
  readonly source: "agent_directive_registry" | "boreal_runtime";
  readonly trust: "trusted";
  readonly runner: "boreal_cli" | "bounded_declared_gate";
  readonly registryId?: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly shell: false;
}

interface AgentGuideStep {
  readonly step: string;
  readonly command: string;
  readonly when: string;
}

interface AgentGuide {
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly commands: {
    readonly status: string;
    readonly start: string;
    readonly finish: string;
    readonly renew: string;
    readonly evidence: string;
    readonly verify: string;
    readonly close: string;
    readonly release: string;
    readonly doctor: string;
    readonly repair: string;
  };
  readonly validation?: {
    readonly gateId: string;
    readonly displayCommand: string;
    readonly executableAction: {
      readonly source: "agent_directive_registry";
      readonly trust: "trusted";
      readonly runner: "bounded_declared_gate";
      readonly argv: readonly string[];
      readonly shell: false;
    };
  };
  readonly loop: readonly AgentGuideStep[];
  readonly recovery: readonly AgentGuideStep[];
}

type AgentStartReason = "expired_active_reservations" | "reservation_capacity_reached" | "no_ready_work";

interface HandoffBundle {
  readonly work: WorkItemView;
  readonly contextPack: ContextPack;
  readonly contextFreshness: {
    readonly contextPackLedgerSeq: number;
    readonly currentLedgerSeq: number;
    readonly current: boolean;
  };
  readonly search: {
    readonly query: string;
    readonly results: readonly SearchResult[];
  };
}

interface HandoffWarning {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

interface HandoffSuccess extends HandoffBundle {
  readonly handoffComplete: true;
  readonly warnings: readonly HandoffWarning[];
}

interface HandoffFailure {
  readonly handoffComplete: false;
  readonly work?: WorkItemView;
  readonly warnings: readonly HandoffWarning[];
  readonly repairCommand: string;
}

type HandoffResult = HandoffSuccess | HandoffFailure;

interface AgentStartBlocked {
  readonly started: false;
  readonly reason: AgentStartReason;
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly status: AgentStatus;
  readonly recommendedAction: AgentStatus["recommendedAction"];
}

interface AgentFinishResult {
  readonly finished: true;
  readonly action: "verified_and_released" | "verified_and_closed";
  readonly agentId: string;
  readonly work: WorkItemView;
  readonly evidence: EvidenceRecord;
  readonly evidenceRefs?: readonly EvidenceId[];
  readonly inlineEvidence?: string;
  readonly gitEvidence?: EvidenceRecord;
  readonly gitEvidenceNote?: string;
  readonly verification: VerificationRecord;
  readonly reservation: AgentReservation;
  readonly closedWork?: WorkItem;
  readonly agentSummary?: AgentSummaryOutputRow;
  readonly agentSummaryArtifact?: AgentSummaryArtifactResult;
  readonly release?: ReservationLifecycleResult;
  readonly status: AgentStatus;
}

interface AgentSummaryOutputRow {
  readonly [key: string]: string | number | undefined;
  readonly id: AgentSummaryId;
  readonly subjectId: string;
  readonly subjectType: AgentSummarySubjectType;
  readonly kind: AgentSummaryKind;
  readonly status: AgentSummaryStatus;
  readonly outcome: AgentSummaryOutcome;
  readonly title: string;
  readonly artifactUri?: string;
  readonly generatedAt: IsoTimestamp;
}

type AgentProtocolKind = "prime" | "session_start" | "session_end";

interface SyncStatusBrief {
  readonly ok: boolean;
  readonly vaultOk: boolean;
  readonly ledgersOk: boolean;
  readonly searchIndexOk: boolean;
  readonly gitOk: boolean;
  readonly recommendedActions: readonly string[];
}

interface SessionOperationSummary {
  readonly sessionId: string;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly stateChanged: number;
  readonly generatedArtifactsChanged: number;
  readonly startedAt?: string;
  readonly lastFinishedAt?: string;
  readonly recent: readonly OperationListRow[];
}

interface AgentProtocolCommands {
  readonly prime: string;
  readonly sessionStart: string;
  readonly sessionEnd: string;
  readonly agentStatus: string;
  readonly agentStart: string;
  readonly reservationList: string;
  readonly operationList: string;
  readonly syncStatus: string;
  readonly doctor: string;
  readonly repair: string;
}

interface AgentProtocolBrief {
  readonly kind: AgentProtocolKind;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly checkedAt: IsoTimestamp;
  readonly sync: SyncStatusBrief;
  readonly agent: AgentStatus;
  readonly operations: SessionOperationSummary;
  readonly contextPacks: ContextPackFreshnessSummary;
  readonly commands: AgentProtocolCommands;
  readonly recommendedActions: readonly string[];
}

interface ContextPackFreshnessSummary {
  readonly currentLedgerSeq: number;
  readonly active: readonly ContextPackFreshnessRow[];
}

interface ContextPackFreshnessRow {
  readonly workId: WorkId;
  readonly contextPackId?: ProjectionId;
  readonly contextPackLedgerSeq?: number;
  readonly currentLedgerSeq: number;
  readonly current: boolean;
  readonly generatedAt?: IsoTimestamp;
}

interface CliOperationLifecycle {
  readonly operationId: OperationId;
  readonly startedAt: IsoTimestamp;
  sessionId: string;
  phase: CliOperationPhase;
  finishedAt?: IsoTimestamp;
  stateOutcome: CliStateOutcome;
  diagnosticId?: string;
  diagnosticIds?: readonly string[];
}

interface ReservationLifecycleResult {
  readonly work: WorkItem;
  readonly reservation: AgentReservation;
}

export async function runCommand(args: ParsedArgs, output: CliOutput, cwd: string): Promise<CommandResult> {
  if (args.command.length === 0) {
    output.write(helpText());
    return { exitCode: 0 };
  }
  if (args.command[0] === "help") {
    output.write(helpText(args.command[1]));
    return { exitCode: 0 };
  }
  if (hasFlag(args, "help")) {
    output.write(helpText(args.command[0]));
    return { exitCode: 0 };
  }

  const definition = findCommandDefinition(args.command);
  if (!definition) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${args.command.join(" ")}`);
  }
  validateCommandFlags(args, definition);
  if (definition.path[0] === "upgrade") {
    validateUpgradeScope(args);
  }
  const json = hasFlag(args, "json") || hasFlag(args, "brief");
  const briefJson = hasFlag(args, "brief");
  if (definition.path[0] === "commands") {
    return commandsCommand(args, output, json);
  }
  if (isStaticDirectivesCommand(definition.path)) {
    return directivesCommand(args.command[1], args.command.slice(2), args, output, json);
  }
  if (definition.path[0] === "completion") {
    return completionCommand(args, output, json);
  }
  if (definition.path[0] === "version") {
    output.write(json ? formatRecord(getVersionInfo(), true) : formatVersionInfo());
    return { exitCode: 0 };
  }

  const shouldLogOperation = shouldRecordOperation(definition);
  const operationId = shouldLogOperation ? randomId<OperationId>("operation") : undefined;
  const startedAt = shouldLogOperation ? nowIso() : undefined;
  const lifecycle: CliOperationLifecycle | undefined = operationId && startedAt
    ? {
        operationId,
        startedAt,
        sessionId: anticipatedOperationSessionId(args),
        phase: "preflight" as const,
        stateOutcome: "unknown" as const
      }
    : undefined;
  let context: CliContext | undefined;
  let eventIdsBefore: ReadonlySet<EventId> = new Set<EventId>();
  let spoolingOutput: ReturnType<typeof createResultSpoolingOutput> | undefined;
  let bufferedJsonOutput = "";
  const commandOutput = json
    ? undefined
    : output;

  let result: CommandResult | undefined;
  let thrown: unknown;
  let operationStartPersisted = false;
  try {
    await bootstrapGlobalFirstRunIfNeeded(args, output, json, cwd);
    context = await createCliContext(operationContextArgs(args, definition), cwd, {
      operationId,
      sessionId: operationSessionIdFromArgs(args),
      initializeGlobal: !usesImplicitMachineLedger(definition, args)
    });
    const commandContext = context;
    if (lifecycle) {
      lifecycle.sessionId = commandContext.sessionId;
    }
    const [group, action, ...rest] = args.command;
    if (definition.requiresWorkspace) {
      assertInitialized(context);
    }
    eventIdsBefore = shouldLogOperation ? await listEventIdsForOperation(context, definition) : new Set<EventId>();
    if (json) {
      const bufferedOutput: CliOutput = {
        write(text) {
          bufferedJsonOutput += text;
        },
        error(text) {
          output.error(text);
        }
      };
      spoolingOutput = createResultSpoolingOutput(outputWithInferredCliResult(bufferedOutput, definition, commandContext.workspaceRoot), {
        workspaceRoot: commandContext.workspaceRoot,
        command: commandPath(definition),
        maxResultSizeChars: commandBehavior(definition).maxResultSizeChars,
        jsonOutputProfile: briefJson ? "brief" : "full",
        readOnly: commandBehavior(definition).readOnly,
        jsonEnvelopeMetadata: () => ledgerEnvelopeMetadata(commandContext).then((metadata) => ({
          ...metadata,
          ...(lifecycle ? cliEnvelopeMetadata(lifecycle) : {})
        }))
      });
    }
    if (operationId && startedAt && lifecycle) {
      try {
        await recordCliOperation(
          commandContext,
          operationId,
          definition,
          args,
          startedAt,
          eventIdsBefore,
          undefined,
          undefined,
          lifecycle,
          "start"
        );
        operationStartPersisted = true;
      } catch (error) {
        if (!isRecoveryCommandDefinition(definition)) {
          throw error;
        }
        applyErrorToLifecycle(lifecycle, error);
      }
    }
    const executableOutput = json ? spoolingOutput : commandOutput;
    if (!executableOutput) {
      throw new BorealError("BOREAL_INVARIANT", "CLI output was not initialized");
    }
    if (lifecycle) {
      lifecycle.phase = "execution";
    }
    switch (group) {
      case "init":
        result = await initCommand(context, args, executableOutput, json);
        break;
      case "setup":
        result = await installCommand(undefined, context, args, executableOutput, json);
        break;
      case "work":
        result = await workGroupCommand("work", action, rest, context, args, executableOutput, json, workCommandDependencies());
        break;
      case "directives":
        result = await directiveAcknowledgementCommand(action, rest, context, args, executableOutput, json);
        break;
      case "dep":
        result = await workGroupCommand("dep", action, rest, context, args, executableOutput, json, workCommandDependencies());
        break;
      case "evidence":
        result = await evidenceCommand(action, rest, context, args, executableOutput, json, {
          requiredPositional,
          resolveWorkId,
          parseEvidenceKind,
          parseOutcome,
          resultForEvidence: (evidence) => withCliResult(evidence, evidenceCliResult(evidence)),
          borealVersion: getVersionInfo().version
        });
        break;
      case "summary":
        result = await summaryCommand(action, rest, context, args, executableOutput, json);
        break;
      case "source":
      case "claim":
      case "decision":
      case "context":
      case "search":
        result = await knowledgeCommand(group, action, rest, context, args, executableOutput, json, {
          defaultListLimit: DEFAULT_LIST_LIMIT,
          maxSearchLimit: MAX_SEARCH_LIMIT,
          parseLimit,
          requiredPositional,
          resolveWorkId,
          asSourceId,
          asClaimId,
          asDecisionId,
          asEvidenceId,
          resolveWikiPageIds,
          requireCliClaim,
          requireCliDecision,
          requireCliKnowledgeSources,
          requireCliEvidenceRecords,
          appendCliEvent,
          uniqueValues,
          uniqueStrings
        });
        break;
      case "rollup":
        result = await rollupCommand(action, context, args, executableOutput, json);
        break;
      case "reservation":
        result = await workGroupCommand("reservation", action, rest, context, args, executableOutput, json, workCommandDependencies());
        break;
      case "heartbeat":
        result = await heartbeatCommand(action, rest, context, args, executableOutput, json);
        break;
      case "run":
        result = await executionRunCommand(action, rest, context, args, executableOutput, json, {
          requiredPositional,
          resolveWorkId
        });
        break;
      case "orchestrate":
        result = await orchestratorCommand(action, rest, context, args, executableOutput, json, {
          requiredPositional,
          resolveWorkId
        });
        break;
      case "events":
        result = await eventsCommand(action, rest, context, args, executableOutput, json, { requiredPositional });
        break;
      case "prime":
        result = await protocolCommand("prime", action, context, args, executableOutput, json, protocolCommandDependencies());
        break;
      case "next":
        result = await protocolCommand("next", action, context, args, executableOutput, json, protocolCommandDependencies());
        break;
      case "agent":
        result = await agentCommand(action, rest, context, args, executableOutput, json, agentCommandDependencies());
        break;
      case "session":
        result = await protocolCommand("session", action, context, args, executableOutput, json, protocolCommandDependencies());
        break;
      case "operation":
        result = await operationCommand(action, rest, context, args, executableOutput, json, operationCommandDependencies());
        break;
      case "workflows":
        result = await workflowsCommand(action, rest, context, args, executableOutput, json, workflowsCommandDependencies());
        break;
      case "resolve":
        result = await resolveCommand(action ? [action, ...rest] : rest, args, executableOutput, json);
        break;
      case "template":
        result = await templateCommand(action, rest, context, args, executableOutput, json);
        break;
      case "start":
        result = await agentCommand("start", rest, context, args, executableOutput, json, agentCommandDependencies());
        break;
      case "done":
        result = await doneAliasCommand(context, args, executableOutput, json);
        break;
      case "pause":
        result = await pauseAliasCommand(context, args, executableOutput, json);
        break;
      case "status":
        result = await protocolCommand("status", action, context, args, executableOutput, json, protocolCommandDependencies());
        break;
      case "install":
        result = await installCommand(action, context, args, executableOutput, json);
        break;
      case "integrations":
        result = await integrationsCommand(action, rest, context, args, executableOutput, json);
        break;
      case "update":
        result = await updateCommand(action, context, args, executableOutput, json);
        break;
      case "upgrade":
        result = await upgradeCommand(context, args, executableOutput, json);
        break;
      case "registry":
        result = await registryCommand(action, rest, context, args, executableOutput, json, registryCommandDependencies());
        break;
      case "dashboard":
        result = await dashboardCommand(action, context, args, executableOutput, json);
        break;
      case "view":
        result = await dashboardCommand(undefined, context, args, executableOutput, json);
        break;
      case "global":
        result = await globalCommand(action, rest, context, args, executableOutput, json);
        break;
      case "link":
        result = await linkCommand(action, context, args, executableOutput, json);
        break;
      case "unlink":
        result = await unlinkCommand(action, args, executableOutput, json);
        break;
      case "daemon":
        result = await daemonCommand(action, context, executableOutput, json, daemonCommandDependencies());
        break;
      case "sprint":
        result = await sprintCommand(action, rest, context, args, executableOutput, json, sprintCommandDependencies());
        break;
      case "export":
      case "import":
      case "storage":
      case "ledger":
      case "snapshot":
        result = await storageCommand(group, action, rest, context, args, executableOutput, json, {
          requiredPositional,
          asWorkId,
          asEvidenceId,
          asVerificationId,
          asSourceId,
          asClaimId,
          asDecisionId,
          asGraphEdgeId,
          asReservationId,
          asProjectionId
        });
        break;
      case "vault":
        result = await vaultCommand(action, context, executableOutput, json);
        break;
      case "raw":
      case "wiki":
      case "duplicate":
      case "merge":
      case "compact":
        result = await memoryCommand(group, action, rest, context, args, executableOutput, json, {
          defaultListLimit: DEFAULT_LIST_LIMIT,
          parseLimit,
          requiredPositional
        });
        break;
      case "capture":
        result = await captureCommand(action, rest, context, args, executableOutput, json, {
          defaultListLimit: DEFAULT_LIST_LIMIT,
          parseLimit
        });
        break;
      case "sync":
        result = await syncCommand(action, context, args, executableOutput, json, {
          dashboardView,
          formatRecordWithAgentDirectives: ({ context: syncContext, args: syncArgs, result: syncResult, json: syncJson, options }) =>
            formatRecordWithAgentDirectives(syncContext, syncArgs, syncResult, syncJson, options)
        });
        break;
      case "doctor":
      case "schema":
      case "docs":
      case "gate":
      case "lock":
        result = await healthCommand(group, action, context, args, executableOutput, json, healthCommandDependencies());
        break;
      default:
        throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${group ?? ""}`);
    }
    if (context && commandChangesStorageBackend(definition)) {
      context = await createCliContext(operationContextArgs(args, definition), cwd, {
        operationId,
        sessionId: operationSessionIdFromArgs(args),
        initializeGlobal: !usesImplicitMachineLedger(definition, args)
      });
    }
  } catch (error) {
    thrown = error;
  }
  if (!thrown && result && shouldRefreshGeneratedArtifactsAfterMutation(definition)) {
    if (lifecycle) {
      lifecycle.phase = "artifact_refresh";
    }
    try {
      await refreshGeneratedArtifactsInline(context as CliContext);
    } catch (error) {
      thrown = error;
    }
  }
  if (!thrown && result?.exitCode === 0 && shouldWriteProjectRollupAfterCommand(definition)) {
    if (lifecycle) {
      lifecycle.phase = "rollup";
    }
    try {
      await writeProjectRollup(context as CliContext, projectRollupWriteOptionsForCommand(definition, result));
    } catch (rollupError) {
      thrown = rollupError;
    }
  }
  if (!thrown && !result) {
    thrown = new BorealError("BOREAL_INVARIANT", "Command did not return a result");
  }
  if (!thrown && result) {
    if (lifecycle) {
      lifecycle.phase = "completed";
      lifecycle.stateOutcome = stateOutcomeForResult(commandBehavior(definition), result);
      lifecycle.finishedAt = nowIso();
    }
    if (spoolingOutput) {
      try {
        await spoolingOutput.flush();
      } catch (error) {
        thrown = error;
        if (lifecycle) {
          lifecycle.phase = "result";
        }
      }
    }
  }
  if (lifecycle && thrown) {
    applyErrorToLifecycle(lifecycle, thrown);
    lifecycle.stateOutcome = stateOutcomeForFailure(commandBehavior(definition), lifecycle.phase, result);
    lifecycle.finishedAt = nowIso();
  }
  if (operationId && startedAt && context && operationStartPersisted) {
    try {
      await recordCliOperation(context, operationId, definition, args, startedAt, eventIdsBefore, result, thrown, lifecycle);
    } catch (operationError) {
      if (!thrown) {
        if (lifecycle) {
          lifecycle.phase = "finalization";
          lifecycle.stateOutcome = stateOutcomeForFailure(commandBehavior(definition), lifecycle.phase, result);
          lifecycle.finishedAt = nowIso();
          applyErrorToLifecycle(lifecycle, operationError);
        }
        thrown = new BorealError("BOREAL_STORAGE_ERROR", "Failed to finalize CLI operation", {
          operationId,
          message: safeErrorMessage(operationError),
          diagnosticId: lifecycle?.diagnosticId
        });
      }
    }
  }
  if (thrown) {
    throw attachCliErrorMetadata(thrown, lifecycle ? cliEnvelopeMetadata(lifecycle) : {});
  }
  if (!result) {
    throw new BorealError("BOREAL_INVARIANT", "Command did not return a result");
  }
  if (bufferedJsonOutput) {
    output.write(bufferedJsonOutput);
  }
  return result;
}

function isRecoveryCommandDefinition(definition: CommandDefinition): boolean {
  return definition.path[0] === "doctor" || definition.path[0] === "schema" || definition.path[0] === "gate";
}

function agentCommandDependencies(): AgentCommandDependencies {
  return {
    agentIdFromArgs,
    nowIso,
    labelsFromArgs,
    buildAgentGuide,
    formatAgentGuide: (guide) => formatAgentGuide(guide as AgentGuide),
    buildAgentStatus,
    dashboardView,
    formatAgentStatusDashboard: (status) => formatAgentStatusDashboard(status as AgentStatus),
    optionalContainerIdFromArgs,
    parseHandoffResultLimit,
    resolveWorkId,
    requiredPositional,
    agentStartBlocked: (agentId, labels, status, reason) =>
      agentStartBlocked(agentId, labels, status as AgentStatus, reason as AgentStartReason),
    assertExactClaimMatchesFilters,
    requireReservation,
    buildHandoffResult,
    formatRecordWithAgentDirectives,
    asWorkId,
    claimExactWork,
    parseReservationExpiresAt,
    attachGitBranchForClaim,
    parseVerdict,
    idempotentAgentFinishResult,
    assertWorkNotAlreadyClosedForAgentFinish,
    agentFinishGitPreflight,
    agentFinishSummaryFactory,
    finishEvidenceInput,
    finishReservedWorkWithCompositeState,
    writeAgentSummaryArtifact,
    captureGitFinishEvidence,
    removeGitWorktreeAfterFinish,
    agentSummaryRow,
    resultForWork: (value, work) => withCliResult(value, workCliResult(work))
  };
}

function workCommandDependencies(): WorkCommandDependencies {
  return {
    defaultListLimit: DEFAULT_LIST_LIMIT,
    defaultReadyWorkLimit: DEFAULT_READY_WORK_LIMIT,
    dependencyTypeFromArgs,
    isBorealReferenceUri,
    addExternalBlockingDependency: addExternalBlockingDependencyCommand,
    optionalAgentIdFromArgs,
    agentIdFromArgs,
    resolveWorkId,
    requiredPositional,
    parseReservationStatus,
    parseLimit,
    parseNonNegativeInteger,
    parseWorkKind,
    parsePriority,
    listStatus,
    labelsFromArgs,
    requiredCloseoutGateInputsFromArgs,
    sourceRefsFromArgs,
    optionalContainerIdFromArgs,
    containerScopeIds,
    heartbeatScopeIds: (containerId, workItems, graphEdges) =>
      heartbeatScopeIds(containerId, workItems, graphEdges as readonly GraphEdge[]),
    workLineageById: (workItems, graphEdges) =>
      workLineageById(workItems, graphEdges as readonly GraphEdge[]),
    workLineageByIdFromStore,
    claimableWorkItems: (workItems, labels, graphEdges) =>
      claimableWorkItems(workItems, labels, graphEdges as readonly GraphEdge[]),
    workListRow: (work, containerId, lineage) =>
      workListRow(work, containerId, lineage as readonly WorkLineageEntry[] | undefined),
    textWorkListRow: (row) => textWorkListRow(row as WorkListRow),
    recentClosedWorkCommand,
    reviewCandidatesCommand,
    textRecentClosedWorkRow: (row) => textRecentClosedWorkRow(row as RecentClosedWorkRow),
    textReviewCandidateRow: (row) => textReviewCandidateRow(row as ReviewCandidateRow),
    asWorkId,
    compareWorkViews,
    readyWorkCommandRow: (view, input) =>
      readyWorkCommandRow(view, {
        ...input,
        lineage: input.lineage as readonly WorkLineageEntry[]
      }),
    dashboardView,
    formatReadyWorkDashboard: (rows, containerId) =>
      formatReadyWorkDashboard(rows as readonly WorkListRow[], containerId),
    buildWorkParallelResult: (input) =>
      buildWorkParallelResult({
        ...input,
        lineageById: input.lineageById as ReadonlyMap<WorkId, readonly WorkLineageEntry[]>
      }),
    formatWorkParallelResult: (result) => formatWorkParallelResult(result as WorkParallelResult),
    workFreshnessSince,
    closeoutGateStatusForWork,
    resolveBorealSourceRefs,
    requireWork: requireCliWork,
    parseReservationExpiresAt,
    requiredReservationExpiresAt,
    requireReservation,
    agentStartCommand: (rest, context, args, output, json) =>
      agentStartCommand(rest, context, args, output, json, agentCommandDependencies()),
    parseHandoffResultLimit,
    claimExactWork,
    attachGitBranchForClaim,
    buildHandoffResult,
    idempotentWorkReleaseResult,
    asEvidenceId,
    parseVerdict,
    currentGitHead: async (context) => {
      const probe = await gitFinishProbe(context.workspaceRoot);
      return probe.insideWorktree && !probe.error ? probe.headSha : undefined;
    },
    withCliResult,
    verificationCliResult,
    workCliResult,
    activeNonExpiredReservationsForWork,
    shellArg,
    assertLeafEvidenceGateForClose,
    ensureAgentSummaryForClose,
    writeAgentSummaryArtifact,
    agentSummaryRow,
    editWorkCommand,
    cancelWorkCommand: (context, workId, reason, agentSummary) =>
      cancelWorkCommand(context, workId, reason, agentSummary),
    reopenWorkCommand,
    normalizedNonEmptyStrings,
    uniqueStrings,
    reservationListRow: (reservation, work, now) =>
      reservationListRow(reservation as AgentReservation, work as WorkItem | undefined, now) as unknown as Record<string, unknown>,
    compareReservationRows: (left, right) =>
      compareReservationRows(left as unknown as ReservationListRow, right as unknown as ReservationListRow),
    textReservationListRow: (row) => textReservationListRow(row as unknown as ReservationListRow),
    dependencyTreeForWork: (context, args, workId, workItems, graphEdges) =>
      dependencyTreeForWorkWithExternal(context, args, workId, workItems as readonly WorkItem[], graphEdges as readonly GraphEdge[]),
    formatRecordWithAgentDirectives,
    dependencyTreeRows: (tree) => dependencyTreeRows(tree as DependencyTreeNode),
    dependencyCyclesFromGraph: (graphEdges) => dependencyCyclesFromGraph(graphEdges as readonly GraphEdge[])
  };
}

function healthCommandDependencies(): HealthCommandDependencies {
  return {
    installedSkillChecks,
    formatSkillDoctor,
    doctorResultCanAttachDirectives,
    formatRecordWithAgentDirectives,
    dashboardView,
    formatDoctorDashboard,
    formatDiagnostic,
    schemaValidateResult,
    docsCheckResult,
    gateCloseoutResult,
    formatLockDashboard
  };
}

function sprintCommandDependencies(): SprintCommandDependencies {
  return {
    resolveWorkId,
    requiredPositional,
    requireWork: requireCliWork,
    formatRecordWithAgentDirectives,
    withCliResult,
    workCliResult,
    labelsFromArgs,
    uniqueStrings,
    workListRow: (work) => workListRow(work),
    parseLimit,
    parseNonNegativeInteger,
    normalizedNonEmptyStrings,
    ensureAgentSummaryForClose,
    writeAgentSummaryArtifact,
    agentSummaryRow,
    closeoutGateStatusFromSnapshot,
    reviewGateSummaryFromStatuses: (statuses) =>
      reviewGateSummaryFromStatuses(statuses as readonly CloseoutGateStatusView[]),
    reviewGateDetailRowsFromStatuses: (statuses) =>
      reviewGateDetailRowsFromStatuses(statuses as readonly CloseoutGateStatusView[]),
    formatReviewGateDetailsMarkdown,
    compareWorkViews,
    priorityRank
  };
}

function protocolCommandDependencies(): ProtocolCommandDependencies {
  return {
    agentIdFromArgs,
    labelsFromArgs,
    buildAgentProtocolBrief,
    buildNextCommandResult: (context, args, agentId, labels) =>
      buildNextCommandResult(context, args, agentId, labels) as Promise<Awaited<ReturnType<typeof buildNextCommandResult>> & Record<string, unknown>>,
    nextResultBundle: (result) => nextResultBundle(result as unknown as NextCommandResult),
    formatNextCommandResult: (result) => formatNextCommandResult(result as NextCommandResult),
    formatRecordWithAgentDirectives
  };
}

function operationCommandDependencies(): OperationCommandDependencies {
  return {
    defaultListLimit: DEFAULT_OPERATION_LIST_LIMIT,
    optionalSessionId,
    optionalCommandPath,
    parseOperationStatus,
    parseLimit,
    compareOperationsNewestFirst,
    operationListRow,
    textOperationListRow: (row) => textOperationListRow(row as OperationListRow),
    requiredPositional,
    resolveOperation,
    operationStats,
    pruneOperations,
    repairOperationLinks
  };
}

function daemonCommandDependencies(): DaemonCommandDependencies {
  return {
    inspectDaemonStatus
  };
}

function registryCommandDependencies(): RegistryCommandDependencies {
  return {
    requiredPositional
  };
}

function workflowsCommandDependencies(): WorkflowsCommandDependencies {
  return {
    dashboardView,
    requiredPositional
  };
}

async function resolveOperation(context: CliContext, value: string): Promise<RuntimeOperation> {
  if (!value.startsWith("bw_operation_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an operation id, got ${value}`);
  }
  const operations = await context.store.read((reader) => reader.listOperations());
  const exact = operations.find((operation) => operation.meta.id === value);
  if (exact) {
    return exact;
  }
  const minPrefixLength = "bw_operation_".length + 12;
  if (value.length < minPrefixLength) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Operation id prefix must include at least 12 hex characters, got ${value}`);
  }
  const candidates = operations.filter((operation) => operation.meta.id.startsWith(value));
  if (candidates.length === 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Operation not found", { operationId: value, domain: "workflow" });
  }
  if (candidates.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Operation id prefix is ambiguous", {
      operationId: value,
      candidates: candidates.map((operation) => operation.meta.id)
    });
  }
  return candidates[0] as RuntimeOperation;
}

async function operationStats(context: CliContext, args: ParsedArgs) {
  const sessionId = optionalSessionId(flagValue(args, "session-id"));
  const operations = await context.store.read(async (reader) =>
    (await reader.listOperations()).filter((operation) => !sessionId || operation.sessionId === sessionId)
  );
  const total = operations.length;
  const succeeded = operations.filter((operation) => operation.status === "succeeded").length;
  const failed = operations.filter((operation) => operation.status === "failed").length;
  const mutations = operations.filter((operation) => operation.stateChanged || operation.generatedArtifactsChanged).length;
  const readOnly = total - mutations;
  const byCommand = [...groupOperations(operations, (operation) => operation.commandPath).entries()]
    .map(([commandPathValue, items]) => ({
      commandPath: commandPathValue,
      total: items.length,
      succeeded: items.filter((operation) => operation.status === "succeeded").length,
      failed: items.filter((operation) => operation.status === "failed").length,
      stateChanged: items.filter((operation) => operation.stateChanged).length,
      generatedArtifactsChanged: items.filter((operation) => operation.generatedArtifactsChanged).length
    }))
    .sort((left, right) => right.total - left.total || left.commandPath.localeCompare(right.commandPath));
  const failureClusters = [...groupOperations(operations.filter((operation) => operation.status === "failed"), failureClusterKey).entries()]
    .map(([key, items]) => {
      const sample = items[0];
      return {
        key,
        commandPath: sample?.commandPath ?? "",
        errorCode: sample?.errorCode ?? "BOREAL_COMMAND_EXIT_NONZERO",
        errorMessage: sample?.errorMessage,
        count: items.length,
        firstStartedAt: [...items].sort(compareOperationsOldestFirst)[0]?.startedAt,
        lastFinishedAt: [...items].sort(compareOperationsNewestFirst)[0]?.finishedAt
      };
    })
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  return {
    schemaVersion: "boreal.cli.operation.stats.v1",
    generatedAt: nowIso(),
    sessionId,
    totals: {
      total,
      succeeded,
      failed,
      readOnly,
      mutations,
      readMutationRatio: mutations === 0 ? null : readOnly / mutations
    },
    perCommand: byCommand,
    failureClusters,
    longestConsecutiveIdenticalFailureRun: longestConsecutiveFailureRun(operations)
  };
}

function groupOperations(
  operations: readonly RuntimeOperation[],
  keyFor: (operation: RuntimeOperation) => string
): ReadonlyMap<string, readonly RuntimeOperation[]> {
  const groups = new Map<string, RuntimeOperation[]>();
  for (const operation of operations) {
    const key = keyFor(operation);
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }
  return groups;
}

function failureClusterKey(operation: RuntimeOperation): string {
  return [operation.commandPath, operation.errorCode ?? "BOREAL_COMMAND_EXIT_NONZERO", operation.errorMessage ?? ""].join("|");
}

function longestConsecutiveFailureRun(operations: readonly RuntimeOperation[]) {
  let best: RuntimeOperation[] = [];
  let current: RuntimeOperation[] = [];
  let currentKey = "";
  for (const operation of [...operations].sort(compareOperationsOldestFirst)) {
    const key = operation.status === "failed" ? failureClusterKey(operation) : "";
    if (!key) {
      current = [];
      currentKey = "";
      continue;
    }
    if (key === currentKey) {
      current = [...current, operation];
    } else {
      current = [operation];
      currentKey = key;
    }
    if (current.length > best.length) {
      best = current;
    }
  }
  const sample = best[0];
  return {
    count: best.length,
    commandPath: sample?.commandPath,
    errorCode: sample?.errorCode,
    errorMessage: sample?.errorMessage,
    operationIds: best.map((operation) => operation.meta.id),
    startedAt: sample?.startedAt,
    finishedAt: best.at(-1)?.finishedAt
  };
}

async function pruneOperations(context: CliContext, args: ParsedArgs): Promise<OperationPruneResult> {
  const keep = parseOperationKeep(flagValue(args, "keep"));
  const before = parseOperationBefore(flagValue(args, "before"));
  if (keep === undefined && before === undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", "operation prune requires --keep or --before");
  }

  return pruneOperationsWithPolicy(context, { keep, before });
}

async function pruneOperationsWithPolicy(
  context: CliContext,
  policy: { readonly keep?: number; readonly before?: IsoTimestamp }
): Promise<OperationPruneResult> {
  const operationResult = await context.store.write(async (writer) => {
    const operations = [...(await writer.listOperations())].sort(compareOperationsNewestFirst);
    const currentOperationId = context.operationId;
    const pruneCandidates = currentOperationId
      ? operations.filter((operation) => operation.meta.id !== currentOperationId)
      : operations;
    const beforeMs = policy.before ? Date.parse(policy.before) : undefined;
    const eligibleByAge = pruneCandidates.filter(
      (operation) => beforeMs === undefined || Date.parse(operation.finishedAt) >= beforeMs
    );
    const keepBeforeOperationLog = policy.keep === undefined
      ? eligibleByAge.length
      : Math.max(0, policy.keep - (currentOperationId ? 1 : 0));
    const keptIds = new Set(eligibleByAge.slice(0, keepBeforeOperationLog).map((operation) => operation.meta.id));
    const deleted = pruneCandidates.filter((operation) => !keptIds.has(operation.meta.id));
    for (const operation of deleted) {
      await writer.deleteOperation(operation.meta.id);
    }
    const keptBeforeOperationLog = operations.length - deleted.length;
    return {
      deleted: deleted.length,
      keptBeforeOperationLog,
      remainingAfterOperationLog: keptBeforeOperationLog + (currentOperationId ? 0 : 1),
      keep: policy.keep,
      before: policy.before,
      deletedIds: deleted.map((operation) => operation.meta.id)
    };
  });
  return {
    ...operationResult,
    results: await pruneResultFiles(context, policy.before)
  };
}

async function pruneResultFiles(context: CliContext, before: IsoTimestamp | undefined): Promise<OperationPruneResult["results"]> {
  const directory = join(context.workspaceRoot, ".boreal", "results");
  const cutoffMs = before ? Date.parse(before) : Date.now() - DEFAULT_RESULTS_RETENTION_MS;
  const cutoff = new Date(cutoffMs).toISOString() as IsoTimestamp;
  if (!existsSync(directory)) {
    return { directory: ".boreal/results", cutoff, graceMs: RESULTS_PRUNE_GRACE_MS, deleted: 0, deletedBytes: 0, deletedPaths: [], skippedYoung: 0 };
  }
  const nowMs = Date.now();
  const deletedPaths: string[] = [];
  let deletedBytes = 0;
  let skippedYoung = 0;
  for (const entry of await readdir(directory)) {
    const absolute = join(directory, entry);
    const info = await stat(absolute);
    if (!info.isFile()) {
      continue;
    }
    if (nowMs - info.mtimeMs < RESULTS_PRUNE_GRACE_MS) {
      skippedYoung += 1;
      continue;
    }
    if (info.mtimeMs >= cutoffMs) {
      continue;
    }
    await rm(absolute);
    deletedPaths.push(join(".boreal", "results", entry));
    deletedBytes += info.size;
  }
  return {
    directory: ".boreal/results",
    cutoff,
    graceMs: RESULTS_PRUNE_GRACE_MS,
    deleted: deletedPaths.length,
    deletedBytes,
    deletedPaths,
    skippedYoung
  };
}

async function repairOperationLinks(context: CliContext, dryRun: boolean): Promise<OperationRepairResult> {
  return context.store.write(async (writer) => {
    const events = await writer.listEvents();
    const operations = await writer.listOperations();
    const eventById = new Map(events.map((event) => [event.meta.id, event]));
    const operationById = new Map(operations.map((operation) => [operation.meta.id, operation]));
    const operationIdsByEvent = eventOperationReferences(operations);

    const updatedEvents = new Map<string, RuntimeEvent>();
    const updatedOperations = new Map<string, RuntimeOperation>();
    const linkedEvents: string[] = [];
    const markedLegacyEvents: string[] = [];
    const removedDanglingEventRefs: Array<{ operationId: string; eventId: string }> = [];
    const removedConflictingEventRefs: Array<{ operationId: string; eventId: string; eventOperationId: string }> = [];
    const ambiguousEvents: Array<{ eventId: string; operationIds: readonly string[] }> = [];
    const repairNow = nowIso();

    for (const operation of operations) {
      const nextEventIds = operation.eventIds.filter((eventId) => {
        const event = eventById.get(eventId);
        if (!event) {
          removedDanglingEventRefs.push({ operationId: operation.meta.id, eventId });
          return false;
        }
        if (event.operationId && event.operationId !== operation.meta.id) {
          removedConflictingEventRefs.push({
            operationId: operation.meta.id,
            eventId,
            eventOperationId: event.operationId
          });
          return false;
        }
        return true;
      });
      if (!arraysEqual(nextEventIds, operation.eventIds)) {
        updatedOperations.set(operation.meta.id, touchRecord({ ...operation, eventIds: nextEventIds }, repairNow, context.actor));
      }
    }

    for (const event of events) {
      const referencedBy = operationIdsByEvent.get(event.meta.id) ?? [];
      const retainedOperation = event.operationId ? operationById.get(event.operationId) : undefined;
      if (event.operationId && retainedOperation) {
        if (!retainedOperation.eventIds.some((eventId) => eventId === event.meta.id)) {
          const existing = updatedOperations.get(retainedOperation.meta.id) ?? retainedOperation;
          updatedOperations.set(
            retainedOperation.meta.id,
            touchRecord({ ...existing, eventIds: [...existing.eventIds, event.meta.id] }, repairNow, context.actor)
          );
        }
        if (event.operationLink === "legacy") {
          const { operationLink: _operationLink, ...nextEvent } = event;
          updatedEvents.set(event.meta.id, touchRecord(nextEvent, repairNow, context.actor));
        }
        continue;
      }

      if (event.operationId && !retainedOperation) {
        const { operationId: _operationId, ...legacyEvent } = event;
        updatedEvents.set(event.meta.id, legacyEventRecord(legacyEvent, repairNow, context.actor));
        markedLegacyEvents.push(event.meta.id);
        continue;
      }

      if (referencedBy.length === 1) {
        const nextEvent = { ...event, operationId: referencedBy[0] as OperationId, operationLink: undefined };
        updatedEvents.set(event.meta.id, touchRecord(nextEvent, repairNow, context.actor));
        linkedEvents.push(event.meta.id);
        continue;
      }

      if (referencedBy.length > 1) {
        ambiguousEvents.push({ eventId: event.meta.id, operationIds: referencedBy });
      }

      if (event.operationLink !== "legacy") {
        updatedEvents.set(event.meta.id, legacyEventRecord(event, repairNow, context.actor));
        markedLegacyEvents.push(event.meta.id);
      }
    }

    if (!dryRun) {
      for (const event of updatedEvents.values()) {
        await writer.putEvent(event);
      }
      for (const operation of updatedOperations.values()) {
        await writer.putOperation(operation);
      }
    }

    return {
      dryRun,
      inspected: {
        operations: operations.length,
        events: events.length
      },
      linkedEvents,
      markedLegacyEvents,
      repairedOperations: [...updatedOperations.keys()],
      removedDanglingEventRefs,
      removedConflictingEventRefs,
      ambiguousEvents
    };
  });
}

function eventOperationReferences(operations: readonly RuntimeOperation[]): ReadonlyMap<string, readonly OperationId[]> {
  const result = new Map<string, OperationId[]>();
  for (const operation of operations) {
    for (const eventId of operation.eventIds) {
      result.set(eventId, [...(result.get(eventId) ?? []), operation.meta.id]);
    }
  }
  return result;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function legacyEventRecord<TEvent extends RuntimeEvent | Omit<RuntimeEvent, "operationId">>(
  event: TEvent,
  now: IsoTimestamp,
  actor: ActorRef
): TEvent {
  return touchRecord({ ...event, operationLink: "legacy" }, now, actor) as TEvent;
}

function operationListRow(operation: RuntimeOperation): OperationListRow {
  return {
    id: operation.meta.id,
    sessionId: operation.sessionId,
    commandPath: operation.commandPath,
    status: operation.status,
    exitCode: operation.exitCode,
    stateChanged: operation.stateChanged,
    generatedArtifactsChanged: operation.generatedArtifactsChanged,
    actorId: operation.actorId,
    actorKind: operation.meta.createdBy.kind,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    eventCount: operation.eventIds.length
  };
}

function compareOperationsNewestFirst(left: RuntimeOperation, right: RuntimeOperation): number {
  return (
    Date.parse(right.finishedAt) - Date.parse(left.finishedAt) ||
    Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
    right.meta.id.localeCompare(left.meta.id)
  );
}

function compareOperationsOldestFirst(left: RuntimeOperation, right: RuntimeOperation): number {
  return (
    Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
    Date.parse(left.finishedAt) - Date.parse(right.finishedAt) ||
    left.meta.id.localeCompare(right.meta.id)
  );
}

function optionalSessionId(value: string | undefined): string | undefined {
  return value ? normalizeActorId(value) : undefined;
}

function optionalCommandPath(value: string | undefined): string | undefined {
  return value ? normalizeMachineString(value, "command path", { lowerCase: true }) : undefined;
}

function shouldRecordOperation(definition: CommandDefinition): boolean {
  if (definition.path[0] === "sync" && definition.path[1] === "status") {
    return false;
  }
  const behavior = commandBehavior(definition);
  return behavior.writesState || behavior.writesGeneratedArtifacts || definition.path[0] === "init";
}

function commandChangesStorageBackend(definition: CommandDefinition): boolean {
  return (
    (definition.path[0] === "storage" && definition.path[1] === "migrate") ||
    (definition.path[0] === "update" && definition.path[1] === "repo")
  );
}

function operationContextArgs(args: ParsedArgs, definition: CommandDefinition): ParsedArgs {
  const machineOperation = usesImplicitMachineLedger(definition, args);
  if (!machineOperation || hasFlag(args, "global")) {
    return args;
  }
  const flags = new Map<string, string[]>();
  for (const [name, values] of args.flags.entries()) {
    flags.set(name, [...values]);
  }
  flags.set("global", ["true"]);
  return { command: args.command, flags };
}

function usesImplicitMachineLedger(definition: CommandDefinition, args: ParsedArgs): boolean {
  const userScopedSkillInstall =
    ((definition.path[0] === "install" && definition.path.length > 1) ||
      (definition.path[0] === "integrations" && definition.path[1] === "add")) &&
    flagValue(args, "scope") === "user";
  const machineScopedUpgrade = definition.path[0] === "upgrade" && hasFlag(args, "machine");
  return (
    !hasFlag(args, "global") &&
    ((definition.path[0] === "update" && definition.path[1] === "self") || userScopedSkillInstall || machineScopedUpgrade)
  );
}

function isStaticDirectivesCommand(path: readonly string[]): boolean {
  return (
    path[0] === "directives" &&
    (path[1] === "list" || path[1] === "show" || path[1] === "compile" || path[1] === "render" || path[1] === "explain")
  );
}

async function recordCliOperation(
  context: CliContext,
  operationId: OperationId,
  definition: CommandDefinition,
  args: ParsedArgs,
  startedAt: IsoTimestamp,
  eventIdsBefore: ReadonlySet<EventId>,
  result: CommandResult | undefined,
  error: unknown,
  lifecycle: CliOperationLifecycle | undefined,
  mode: "start" | "finish" = "finish"
): Promise<void> {
  const finishedAt = mode === "start" ? startedAt : lifecycle?.finishedAt ?? nowIso();
  const exitCode = mode === "start" ? 0 : error ? commandErrorExitCode(error) : result?.exitCode ?? 1;
  const behavior = commandBehavior(definition);
  const status = mode === "start" ? "in_progress" : exitCode === 0 ? "succeeded" : "failed";
  const stateOutcome = mode === "start" ? "unknown" : lifecycle?.stateOutcome ?? stateOutcomeForResult(behavior, result);
  const generatedArtifactOutcome = stateOutcomeForOperation(stateOutcome, behavior.writesGeneratedArtifacts);
  const storageHeadSeq = await context.store.read((reader) => reader.headSeq()).catch(() => undefined);
  const operation = {
    meta: createRecordMeta({
      id: operationId,
      now: finishedAt,
      actor: context.actor,
      tags: ["operation"]
    }),
    sessionId: context.sessionId,
    commandPath: commandPath(definition),
    argv: redactedArgv(definition, args),
    actorId: String(context.actor.id),
    startedAt,
    finishedAt,
    exitCode,
    status,
    stateChanged: mode !== "start" && (stateOutcome === "changed" || stateOutcome === "partial") ? behavior.writesState : false,
    generatedArtifactsChanged:
      mode !== "start" && (stateOutcome === "changed" || stateOutcome === "partial") ? behavior.writesGeneratedArtifacts : false,
    eventIds: [],
    phase: lifecycle?.phase,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    processId: process.pid,
    host: hostname(),
    ...(storageHeadSeq === undefined ? {} : { storageHeadSeq }),
    stateChangeOutcome: stateOutcome,
    generatedArtifactOutcome,
    auditOutcome: mode === "start" ? "incomplete" : "complete",
    ...operationErrorFields(error, exitCode)
  } satisfies RuntimeOperation;

  await context.store.write(async (writer) => {
    const eventIds = (await writer.listEvents())
      .filter((event) => !eventIdsBefore.has(event.meta.id) && event.operationId === operationId)
      .map((event) => event.meta.id);
    await writer.putOperation(withContentHash({ ...operation, eventIds } satisfies RuntimeOperation));
  });
}

function stateOutcomeForOperation(
  outcome: CliStateOutcome,
  writesGeneratedArtifacts: boolean
): RuntimeOperation["generatedArtifactOutcome"] {
  if (!writesGeneratedArtifacts) {
    return "unchanged";
  }
  return outcome;
}

async function listEventIds(context: CliContext): Promise<ReadonlySet<EventId>> {
  return new Set((await context.store.read((reader) => reader.listEvents())).map((event) => event.meta.id));
}

async function listEventIdsForOperation(context: CliContext, definition: CommandDefinition): Promise<ReadonlySet<EventId>> {
  try {
    return await listEventIds(context);
  } catch (error) {
    if (definition.path[0] === "doctor") {
      return new Set();
    }
    throw error;
  }
}

async function ledgerEnvelopeMetadata(context: CliContext): Promise<{ readonly ledgerSeq: number | null }> {
  try {
    return {
      ledgerSeq: await currentLedgerSeq(context)
    };
  } catch {
    return {
      ledgerSeq: null
    };
  }
}

async function currentLedgerSeq(context: CliContext): Promise<number> {
  return context.store.read((reader) => reader.headSeq());
}

function commandErrorExitCode(error: unknown): number {
  return isBorealError(error) && (error.code === "BOREAL_INVALID_INPUT" || error.code === "BOREAL_UNSAFE_UNICODE")
    ? 2
    : 1;
}

function operationErrorFields(error: unknown, exitCode: number): Pick<RuntimeOperation, "errorCode" | "errorMessage"> {
  if (error) {
    return {
      errorCode: isBorealError(error) ? error.code : "BOREAL_UNEXPECTED_ERROR",
      errorMessage: safeErrorMessage(error)
    };
  }
  return exitCode === 0 ? {} : { errorCode: "BOREAL_COMMAND_EXIT_NONZERO", errorMessage: "Command returned a non-zero exit code" };
}

function anticipatedOperationSessionId(args: ParsedArgs): string {
  return (
    operationSessionIdFromArgs(args) ??
    normalizeActorId(flagValue(args, "session") ?? process.env.BOREAL_SESSION_ID ?? "local")
  );
}

function cliEnvelopeMetadata(lifecycle: CliOperationLifecycle): CliEnvelopeMetadata {
  return {
    operationId: lifecycle.operationId,
    sessionId: lifecycle.sessionId,
    phase: lifecycle.phase,
    startedAt: lifecycle.startedAt,
    finishedAt: lifecycle.finishedAt,
    stateOutcome: lifecycle.stateOutcome,
    ...(lifecycle.diagnosticId ? { diagnosticId: lifecycle.diagnosticId } : {}),
    ...(lifecycle.diagnosticIds && lifecycle.diagnosticIds.length > 0 ? { diagnosticIds: lifecycle.diagnosticIds } : {})
  };
}

function stateOutcomeForResult(
  behavior: ReturnType<typeof commandBehavior>,
  result: CommandResult | undefined
): CliStateOutcome {
  if (!behavior.writesState && !behavior.writesGeneratedArtifacts) {
    return "unchanged";
  }
  if (result?.exitCode === 0) {
    return "changed";
  }
  return "partial";
}

function stateOutcomeForFailure(
  behavior: ReturnType<typeof commandBehavior>,
  phase: CliOperationPhase,
  result: CommandResult | undefined
): CliStateOutcome {
  if (!behavior.writesState && !behavior.writesGeneratedArtifacts) {
    return "unchanged";
  }
  if (result || phase === "artifact_refresh" || phase === "rollup" || phase === "result" || phase === "finalization") {
    return "partial";
  }
  return "unknown";
}

function applyErrorToLifecycle(lifecycle: CliOperationLifecycle, error: unknown): void {
  const ids = diagnosticIdsForError(error);
  lifecycle.diagnosticId = ids[0];
  lifecycle.diagnosticIds = ids.length > 0 ? ids : undefined;
}

function diagnosticIdsForError(error: unknown): readonly string[] {
  const detailsValue = isBorealError(error) ? error.details : undefined;
  const details = isRecordValue(detailsValue) ? detailsValue : undefined;
  const explicit = details?.diagnosticIds;
  const explicitIds = Array.isArray(explicit)
    ? explicit.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const diagnosticId = typeof details?.diagnosticId === "string" && details.diagnosticId.length > 0 ? [details.diagnosticId] : [];
  const gapIds = isBorealError(error) ? error.gaps?.map((gap) => gap.code) ?? [] : [];
  return [...new Set([...diagnosticId, ...explicitIds, ...gapIds])];
}

function safeErrorMessage(error: unknown): string {
  if (isBorealError(error)) {
    return error.message;
  }
  return "Unexpected command failure";
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactedArgv(definition: CommandDefinition, args: ParsedArgs): readonly string[] {
  const values: string[] = [...definition.path];
  for (const positional of args.command.slice(definition.path.length)) {
    const safeId = /^bw_[a-z0-9]+_[a-z0-9_-]+$/iu.test(positional);
    values.push(safeId ? positional : `<arg:${hashContent(positional).slice(0, 20)}>`);
  }
  const valueFlags = registryValueFlagNames();
  for (const [name, flagValuesForName] of args.flags.entries()) {
    for (const value of flagValuesForName) {
      if (valueFlags.has(name)) {
        values.push(`--${name}`, "<redacted>");
      } else if (value === "false") {
        values.push(`--${name}=false`);
      } else {
        values.push(`--${name}`);
      }
    }
  }
  return values;
}

function outputWithInferredCliResult(output: CliOutput, definition: CommandDefinition, workspaceRoot: string): CliOutput {
  if (!commandBehavior(definition).writesState) {
    return output;
  }
  const command = commandPath(definition);
  return {
    write(text) {
      output.write(addInferredCliResult(text, command, workspaceRoot));
    },
    error(text) {
      output.error(text);
    }
  };
}

function addInferredCliResult(text: string, command: string, workspaceRoot: string): string {
  if (text.includes('"result"')) {
    return text;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.data) || isRecord(parsed.data.result)) {
    return text;
  }
  const result = inferCliResult(parsed.data, command, workspaceRoot);
  if (!result) {
    return text;
  }
  return `${JSON.stringify({ ...parsed, data: { ...parsed.data, result } }, null, 2)}\n`;
}

function inferCliResult(data: Record<string, unknown>, command: string, workspaceRoot: string): CliMutationResult | undefined {
  if (data.claimed === false || data.started === false || data.finished === false) {
    return undefined;
  }
  const candidates = [
    data,
    data.postMutationWork,
    data.work,
    data.closed,
    data.closedWork,
    data.summary,
    data.evidence,
    data.verification,
    data.reservation,
    data.claim,
    data.decision,
    data.source,
    data.blockedParent,
    data.child,
    data.parent
  ];
  for (const candidate of candidates) {
    const result = cliResultFromCandidate(candidate);
    if (result) {
      return result;
    }
  }
  return {
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    id: cliResultFallbackId(data, workspaceRoot),
    kind: command.replace(/\s+/gu, "."),
    status: cliResultStatus(data) ?? "succeeded",
    subjectId: typeof data.subjectId === "string" ? data.subjectId : workspaceRoot
  };
}

function cliResultFromCandidate(value: unknown): CliMutationResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const meta = isRecord(value.meta) ? value.meta : undefined;
  const id = typeof meta?.id === "string" ? meta.id : typeof value.id === "string" ? value.id : undefined;
  if (!id) {
    return undefined;
  }
  return {
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    id,
    kind: typeof value.kind === "string" ? value.kind : cliResultKindFromId(id),
    status: cliResultStatus(value) ?? "succeeded",
    subjectId: typeof value.subjectId === "string" ? value.subjectId : id
  };
}

function cliResultStatus(value: Record<string, unknown>): string | undefined {
  for (const key of ["status", "outcome", "verdict"] as const) {
    if (typeof value[key] === "string") {
      return value[key];
    }
  }
  if (typeof value.ok === "boolean") {
    return value.ok ? "passed" : "failed";
  }
  return undefined;
}

function cliResultKindFromId(id: string): string {
  if (id.startsWith("bw_work_")) return "work";
  if (id.startsWith("bw_evidence_")) return "evidence";
  if (id.startsWith("bw_verification_")) return "verification";
  if (id.startsWith("bw_summary_")) return "summary";
  if (id.startsWith("bw_reservation_")) return "reservation";
  if (id.startsWith("bw_source_")) return "source";
  if (id.startsWith("bw_claim_")) return "claim";
  if (id.startsWith("bw_decision_")) return "decision";
  if (id.startsWith("bw_edge_")) return "graph_edge";
  if (id.startsWith("bw_operation_")) return "operation";
  if (id.startsWith("bw_projection_")) return "projection";
  return "record";
}

function cliResultFallbackId(data: Record<string, unknown>, workspaceRoot: string): string {
  for (const key of ["id", "eventId", "path", "workspaceRoot"] as const) {
    if (typeof data[key] === "string") {
      return data[key];
    }
  }
  return workspaceRoot;
}

const DIRECTIVE_REGISTRY_STATUS_VALUES = [
  "active",
  "deprecated",
  "removed",
  "proposed",
  "satisfied",
  "acknowledged",
  "superseded",
  "blocked"
] as const;

type DirectiveRegistryStatus = (typeof DIRECTIVE_REGISTRY_STATUS_VALUES)[number];

interface DirectiveRegistryReplacementMetadata {
  readonly status: DirectiveRegistryStatus;
  readonly removed: boolean;
  readonly supersedes: readonly AgentDirectiveTemplateId[];
  readonly deprecatedBy: readonly AgentDirectiveTemplateId[];
}

interface DirectiveRegistryListEntry {
  readonly id: AgentDirectiveTemplateId;
  readonly version: string;
  readonly family: AgentDirectiveFamily;
  readonly severity: string;
  readonly audience: string;
  readonly kind: string;
  readonly lifecycle: AgentDirectiveLifecycle;
  readonly status: DirectiveRegistryStatus;
  readonly title: string;
  readonly blocksCloseout: boolean;
  readonly supersedes: readonly AgentDirectiveTemplateId[];
  readonly deprecatedBy: readonly AgentDirectiveTemplateId[];
}

interface DirectiveRegistryFamilySummary {
  readonly family: AgentDirectiveFamily;
  readonly total: number;
  readonly active: number;
  readonly deprecated: number;
  readonly removed: number;
}

interface DirectiveRegistryListResult {
  readonly schemaVersion: "boreal.cli.directives.list.v1";
  readonly registryVersion: string;
  readonly sourcePath: string;
  readonly filters: {
    readonly family?: AgentDirectiveFamily;
    readonly status?: DirectiveRegistryStatus;
  };
  readonly families: readonly DirectiveRegistryFamilySummary[];
  readonly directives: readonly DirectiveRegistryListEntry[];
}

interface DirectiveRegistryShowEntry extends DirectiveRegistryListEntry {
  readonly instruction: string;
  readonly defaultLifecycle: AgentDirectiveLifecycle;
  readonly sourcePath: string;
  readonly triggerCodes: AgentDirectiveRegistryEntry["triggerCodes"];
  readonly nextCommandTemplate: AgentDirectiveRegistryEntry["nextCommandTemplate"];
  readonly acknowledgement?: AgentDirectiveRegistryEntry["acknowledgement"];
  readonly payloadFields: readonly AgentDirectivePayloadField[];
  readonly replacementMetadata: DirectiveRegistryReplacementMetadata;
}

interface DirectiveRegistryShowResult {
  readonly schemaVersion: "boreal.cli.directives.show.v1";
  readonly registryVersion: string;
  readonly sourcePath: string;
  readonly directive: DirectiveRegistryShowEntry;
}

const DIRECTIVE_DEBUG_FIXTURE_IDS = ["blocked-work", "closeout-success", "doctor-recovery", "session-handoff"] as const;

type DirectiveDebugFixtureId = (typeof DIRECTIVE_DEBUG_FIXTURE_IDS)[number];
type DirectiveRenderFormat = "markdown" | "json";

interface DirectiveCompileSelection {
  readonly registryId: AgentDirectiveTemplateId;
  readonly selectedBy: readonly string[];
}

interface DirectiveDebugInput {
  readonly fixture?: DirectiveDebugFixtureId;
  readonly snapshot: AgentDirectiveSnapshot;
  readonly gaps: readonly EnforcementGap[];
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
  readonly selections: readonly DirectiveCompileSelection[];
}

interface DirectiveCompileResult {
  readonly schemaVersion: "boreal.cli.directives.compile.v1";
  readonly registryVersion: string;
  readonly sourcePath: string;
  readonly fixture?: DirectiveDebugFixtureId;
  readonly commandPath: string;
  readonly subject?: AgentDirectiveSnapshot["work"]["subject"];
  readonly gaps: readonly EnforcementGap[];
  readonly selectedRegistryIds: readonly AgentDirectiveTemplateId[];
  readonly selections: readonly DirectiveCompileSelection[];
  readonly issueCount: number;
  readonly issues: readonly AgentDirectiveBundleAssemblyIssue[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
  readonly dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId;
  readonly bundle?: AgentDirectiveBundle;
}

interface DirectiveRenderResult {
  readonly schemaVersion: "boreal.cli.directives.render.v1";
  readonly registryVersion: string;
  readonly sourcePath: string;
  readonly fixture: DirectiveDebugFixtureId;
  readonly format: DirectiveRenderFormat;
  readonly content: string;
  readonly compile: DirectiveCompileResult;
}

interface DirectiveExplainResult {
  readonly schemaVersion: "boreal.cli.directives.explain.v1";
  readonly registryVersion: string;
  readonly sourcePath: string;
  readonly fixture?: DirectiveDebugFixtureId;
  readonly directiveId: AgentDirectiveTemplateId;
  readonly commandPath: string;
  readonly subjectTypes: readonly AgentDirectiveSubjectType[];
  readonly selected: boolean;
  readonly emitted: boolean;
  readonly reason: string;
  readonly selectedBy: readonly string[];
  readonly selectorChecks: {
    readonly lifecycleActive: boolean;
    readonly dataPresent: boolean;
    readonly matchedTriggerCodes: readonly string[];
    readonly configuredTriggerCodes: readonly string[];
  };
  readonly dataPresent: boolean;
  readonly issues: readonly AgentDirectiveBundleAssemblyIssue[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
  readonly conflicts: AgentDirectiveBundle["conflicts"];
  readonly directive?: AgentDirectiveBundle["directives"][number];
}

interface DirectiveAcknowledgementCreateResult {
  readonly schemaVersion: "boreal.cli.directives.ack.create.v1";
  readonly created: true;
  readonly acknowledgement: DirectiveAcknowledgementRecord;
  readonly event: RuntimeEvent;
}

interface DirectiveAcknowledgementListResult {
  readonly schemaVersion: "boreal.cli.directives.ack.list.v1";
  readonly filters: {
    readonly subjectId?: string;
    readonly directiveId?: AgentDirectiveId;
    readonly outcome?: DirectiveAcknowledgementOutcome;
  };
  readonly acknowledgements: readonly DirectiveAcknowledgementRecord[];
}

interface DirectiveAcknowledgementShowResult {
  readonly schemaVersion: "boreal.cli.directives.ack.show.v1";
  readonly acknowledgement: DirectiveAcknowledgementRecord;
}

function directivesCommand(
  action: string | undefined,
  rest: readonly string[],
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): CommandResult {
  switch (action) {
    case "list": {
      const result = listDirectiveRegistry(args);
      output.write(json ? formatRecord(result, true) : formatDirectiveRegistryList(result));
      return { exitCode: 0 };
    }
    case "show": {
      const result = showDirectiveRegistryEntry(requiredPositional(rest, 0, "directive id"));
      output.write(json ? formatRecord(result, true) : formatDirectiveRegistryShow(result));
      return { exitCode: 0 };
    }
    case "compile": {
      const result = compileDirectiveDebugBundle(args);
      output.write(json ? formatRecord(result, true) : formatDirectiveCompile(result));
      return { exitCode: 0 };
    }
    case "render": {
      const result = renderDirectiveDebugBundle(args);
      output.write(json ? formatRecord(result, true) : result.content);
      return { exitCode: 0 };
    }
    case "explain": {
      const result = explainDirectiveEmission(requiredPositional(rest, 0, "directive id"), args);
      output.write(json ? formatRecord(result, true) : formatDirectiveExplain(result));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directives command: ${action ?? ""}`);
  }
}

async function directiveAcknowledgementCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "ack") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directives command: ${action ?? ""}`);
  }
  const subcommand = rest[0];
  const subrest = rest.slice(1);
  switch (subcommand) {
    case "create": {
      const result = await createDirectiveAcknowledgement(context, requiredPositional(subrest, 0, "directive id"), args);
      output.write(json ? formatRecord(result, true) : formatDirectiveAcknowledgementCreate(result));
      return { exitCode: 0 };
    }
    case "list": {
      const result = await listDirectiveAcknowledgements(context, args);
      output.write(json ? formatRecord(result, true) : formatDirectiveAcknowledgementList(result));
      return { exitCode: 0 };
    }
    case "show": {
      const result = await showDirectiveAcknowledgement(context, requiredPositional(subrest, 0, "acknowledgement id"));
      output.write(json ? formatRecord(result, true) : formatDirectiveAcknowledgementShow(result));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directives ack command: ${subcommand ?? ""}`);
  }
}

async function createDirectiveAcknowledgement(
  context: CliContext,
  directiveRef: string,
  args: ParsedArgs
): Promise<DirectiveAcknowledgementCreateResult> {
  const current = nowIso();
  const directiveId = asAgentDirectiveId(directiveRef);
  const explicitRegistryId = flagValue(args, "registry-id");
  const directiveRegistryId = explicitRegistryId
    ? asAgentDirectiveTemplateId(explicitRegistryId)
    : inferDirectiveRegistryId(directiveId);
  const registryEntry = directiveRegistryId
    ? AGENT_DIRECTIVE_REGISTRY.entries.find((entry) => entry.id === directiveRegistryId)
    : undefined;
  if (explicitRegistryId && !registryEntry) {
    throw new BorealError("BOREAL_NOT_FOUND", "Directive registry entry not found", {
      registryId: directiveRegistryId,
      domain: "workflow"
    });
  }
  const directiveVersion = asAgentDirectiveVersion(flagValue(args, "version") ?? registryEntry?.version ?? "v1");
  const outcome = parseDirectiveAcknowledgementOutcome(requiredFlag(args, "outcome"));
  const evidenceIds = uniqueValues(flagValues(args, "evidence").map(asEvidenceId));
  const agentSummaryIds = uniqueValues(flagValues(args, "summary").map(asAgentSummaryId));
  const verificationIds = uniqueValues(flagValues(args, "verification").map(asVerificationId));
  const artifactUris = uniqueStrings(flagValues(args, "artifact-uri").map(normalizeDirectiveArtifactUri));
  const handoffIds = uniqueStrings(flagValues(args, "handoff").map((value) => normalizeMachineString(value, "handoff id")));
  const reasonCode = optionalDirectiveReasonCode(flagValue(args, "reason-code"));
  const reason = optionalTrimmedText(flagValue(args, "reason"));
  assertDirectiveAcknowledgementPolicy({
    outcome,
    evidenceIds,
    agentSummaryIds,
    verificationIds,
    artifactUris,
    handoffIds,
    reasonCode,
    reason
  });

  const subjectType = parseAgentDirectiveSubjectType(requiredFlag(args, "subject-type"));
  const explicitSubjectId = optionalTrimmedText(flagValue(args, "subject-id"));
  const commandPathValue = optionalCommandPath(requiredFlag(args, "command"));
  if (!commandPathValue) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--command must name the directive source command");
  }
  const generatedAt = parseOptionalIsoTimestamp(flagValue(args, "generated-at"), "--generated-at") ?? current;
  const registryVersion = (flagValue(args, "registry-version") ?? AGENT_DIRECTIVE_REGISTRY.version) as AgentDirectiveRegistryVersion;
  const sourceSnapshotHash = optionalContentHash(flagValue(args, "source-hash"));
  const envelopeSchema = optionalMachineString(flagValue(args, "envelope-schema"), "envelope schema");
  const bundleId = optionalMachineString(flagValue(args, "bundle-id"), "bundle id");

  return context.store.write(async (writer) => {
    const subjectWork = isWorkLikeDirectiveSubject(subjectType)
      ? await requireDirectiveAcknowledgementWorkSubject(writer, explicitSubjectId, subjectType)
      : undefined;
    await requireDirectiveAcknowledgementEvidence(writer, evidenceIds);
    await requireDirectiveAcknowledgementSummaries(writer, agentSummaryIds);
    await requireDirectiveAcknowledgementVerifications(writer, verificationIds);
    const subjectId = subjectWork?.meta.id ?? explicitSubjectId;
    const subjectTitle = optionalTrimmedText(flagValue(args, "subject-title")) ?? subjectWork?.title;
    const acknowledgement = withContentHash({
      meta: createRecordMeta({
        id: randomId<DirectiveAcknowledgementId>("acknowledgement"),
        now: current,
        actor: context.actor,
        tags: ["directive-acknowledgement", outcome]
      }),
      directiveId,
      directiveVersion,
      ...(directiveRegistryId ? { directiveRegistryId } : {}),
      bundleSource: {
        ...(bundleId ? { bundleId } : {}),
        registryVersion,
        commandPath: commandPathValue,
        ...(envelopeSchema ? { envelopeSchema } : {}),
        ...(sourceSnapshotHash ? { sourceSnapshotHash } : {}),
        generatedAt
      },
      actor: context.actor,
      subjectType,
      ...(subjectId ? { subjectId } : {}),
      ...(subjectTitle ? { subjectTitle } : {}),
      commandPath: commandPathValue,
      outcome,
      evidenceIds,
      agentSummaryIds,
      verificationIds,
      artifactUris,
      handoffIds,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reason ? { reason } : {}),
      acknowledgedAt: current
    } satisfies DirectiveAcknowledgementRecord);
    const schemaIssues = directiveAcknowledgementRecordSchemaIssues(acknowledgement);
    if (schemaIssues.length > 0) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Directive acknowledgement failed schema validation", { issues: schemaIssues });
    }
    await writer.putDirectiveAcknowledgement(acknowledgement);
    const event = await appendCliEvent(writer, context, "directive_acknowledgement.created", acknowledgement.meta.id, "directive_acknowledgement", {
      directiveId,
      directiveRegistryId,
      outcome,
      subjectType,
      subjectId,
      evidenceIds,
      agentSummaryIds,
      verificationIds,
      artifactUris,
      handoffIds
    }, current);
    return {
      schemaVersion: "boreal.cli.directives.ack.create.v1",
      created: true,
      acknowledgement,
      event
    };
  });
}

async function listDirectiveAcknowledgements(
  context: CliContext,
  args: ParsedArgs
): Promise<DirectiveAcknowledgementListResult> {
  const subjectId = optionalTrimmedText(flagValue(args, "subject-id"));
  const directiveId = flagValue(args, "directive-id") ? asAgentDirectiveId(requiredFlag(args, "directive-id")) : undefined;
  const outcome = flagValue(args, "outcome") ? parseDirectiveAcknowledgementOutcome(requiredFlag(args, "outcome")) : undefined;
  const acknowledgements = await context.store.read(async (reader) => {
    const records = subjectId
      ? await reader.listDirectiveAcknowledgementsForSubject(subjectId)
      : await reader.listDirectiveAcknowledgements();
    return records
      .filter((record) => (directiveId ? record.directiveId === directiveId : true))
      .filter((record) => (outcome ? record.outcome === outcome : true))
      .sort((left, right) => right.acknowledgedAt.localeCompare(left.acknowledgedAt));
  });
  return {
    schemaVersion: "boreal.cli.directives.ack.list.v1",
    filters: {
      ...(subjectId ? { subjectId } : {}),
      ...(directiveId ? { directiveId } : {}),
      ...(outcome ? { outcome } : {})
    },
    acknowledgements
  };
}

async function showDirectiveAcknowledgement(
  context: CliContext,
  acknowledgementRef: string
): Promise<DirectiveAcknowledgementShowResult> {
  const acknowledgementId = asDirectiveAcknowledgementId(acknowledgementRef);
  const acknowledgement = await context.store.read((reader) => reader.getDirectiveAcknowledgement(acknowledgementId));
  if (!acknowledgement) {
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement not found", {
      acknowledgementId,
      domain: "workflow"
    });
  }
  return {
    schemaVersion: "boreal.cli.directives.ack.show.v1",
    acknowledgement
  };
}

function listDirectiveRegistry(args: ParsedArgs): DirectiveRegistryListResult {
  const family = directiveFamilyFilter(args);
  const status = directiveStatusFilter(args);
  const replacements = directiveReplacementIndex(AGENT_DIRECTIVE_REGISTRY);
  const directives = AGENT_DIRECTIVE_REGISTRY.entries
    .map((entry) => directiveListEntry(entry, replacements))
    .filter((entry) => (family ? entry.family === family : true))
    .filter((entry) => (status ? entry.status === status : true))
    .sort(compareDirectiveListEntries);
  return {
    schemaVersion: "boreal.cli.directives.list.v1",
    registryVersion: AGENT_DIRECTIVE_REGISTRY.version,
    sourcePath: "packages/core/src/agent-directive-registry.ts",
    filters: {
      ...(family ? { family } : {}),
      ...(status ? { status } : {})
    },
    families: directiveFamilySummaries(AGENT_DIRECTIVE_REGISTRY, replacements),
    directives
  };
}

function showDirectiveRegistryEntry(id: string): DirectiveRegistryShowResult {
  const entry = AGENT_DIRECTIVE_REGISTRY.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new BorealError("BOREAL_NOT_FOUND", `Directive registry entry not found: ${id}`, {
      registryId: id,
      domain: "workflow"
    });
  }
  const replacements = directiveReplacementIndex(AGENT_DIRECTIVE_REGISTRY);
  return {
    schemaVersion: "boreal.cli.directives.show.v1",
    registryVersion: AGENT_DIRECTIVE_REGISTRY.version,
    sourcePath: "packages/core/src/agent-directive-registry.ts",
    directive: directiveShowEntry(entry, replacements)
  };
}

function compileDirectiveDebugBundle(args: ParsedArgs): DirectiveCompileResult {
  const input = directiveDebugInput(args, { defaultFixture: "blocked-work" });
  const result = assembleAgentDirectiveBundleFromGaps({
    gaps: input.gaps,
    dataByRegistryId: input.dataByRegistryId,
    commandPath: input.snapshot.command.path,
    capturedAt: input.snapshot.capturedAt,
    envelopeSchema: input.snapshot.command.envelopeSchema,
    subject: input.snapshot.work.subject,
    sourceHash: agentDirectiveSnapshotHash(input.snapshot)
  });
  return {
    schemaVersion: "boreal.cli.directives.compile.v1",
    registryVersion: AGENT_DIRECTIVE_REGISTRY.version,
    sourcePath: "packages/core/src/agent-directive-registry.ts",
    ...(input.fixture ? { fixture: input.fixture } : {}),
    commandPath: input.snapshot.command.path,
    ...(input.snapshot.work.subject ? { subject: input.snapshot.work.subject } : {}),
    gaps: input.gaps,
    selectedRegistryIds: result.selectedRegistryIds,
    selections: input.selections,
    issueCount: result.issues.length,
    issues: result.issues,
    missingRequired: result.missingRequired,
    dataByRegistryId: input.dataByRegistryId,
    ...(result.bundle ? { bundle: result.bundle } : {})
  };
}

function renderDirectiveDebugBundle(args: ParsedArgs): DirectiveRenderResult {
  const fixture = directiveDebugFixtureId(args) ?? "blocked-work";
  const format = parseDirectiveRenderFormat(flagValue(args, "format"));
  const compile = compileDirectiveDebugBundle(argsWithDirectiveFixture(args, fixture));
  const content = format === "json" ? `${JSON.stringify(compile.bundle ?? {}, null, 2)}\n` : renderDirectiveBundleMarkdown(compile);
  return {
    schemaVersion: "boreal.cli.directives.render.v1",
    registryVersion: AGENT_DIRECTIVE_REGISTRY.version,
    sourcePath: "packages/core/src/agent-directive-registry.ts",
    fixture,
    format,
    content,
    compile
  };
}

function explainDirectiveEmission(id: string, args: ParsedArgs): DirectiveExplainResult {
  const entry = AGENT_DIRECTIVE_REGISTRY.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new BorealError("BOREAL_NOT_FOUND", `Directive registry entry not found: ${id}`, {
      registryId: id,
      domain: "workflow"
    });
  }
  const input = directiveDebugInput(args, { defaultFixture: "blocked-work" });
  const result = assembleAgentDirectiveBundleFromGaps({
    gaps: input.gaps,
    dataByRegistryId: input.dataByRegistryId,
    commandPath: input.snapshot.command.path,
    capturedAt: input.snapshot.capturedAt,
    envelopeSchema: input.snapshot.command.envelopeSchema,
    subject: input.snapshot.work.subject,
    sourceHash: agentDirectiveSnapshotHash(input.snapshot)
  });
  const directive = result.bundle?.directives.find((candidate) => candidate.registryId === entry.id);
  const selected = result.selectedRegistryIds.includes(entry.id);
  const issues = result.issues.filter((issue) => issue.registryId === entry.id);
  const missingRequired = result.missingRequired.filter((missing) => missing.registryId === entry.id);
  const selectedBy = directive?.source.selectedBy ?? input.selections.find((selection) => selection.registryId === entry.id)?.selectedBy ?? [];
  const conflicts = result.bundle?.conflicts.filter((conflict) =>
    directive ? conflict.directiveIds.includes(directive.id) : conflict.directiveIds.some((directiveId) => directiveId.includes(entry.id))
  ) ?? [];
  return {
    schemaVersion: "boreal.cli.directives.explain.v1",
    registryVersion: AGENT_DIRECTIVE_REGISTRY.version,
    sourcePath: "packages/core/src/agent-directive-registry.ts",
    ...(input.fixture ? { fixture: input.fixture } : {}),
    directiveId: entry.id,
    commandPath: input.snapshot.command.path,
    subjectTypes: directiveDebugSubjectTypes(input.snapshot),
    selected,
    emitted: directive !== undefined,
    reason: directiveExplainReason({ selected, emitted: directive !== undefined, issues, missingRequired, conflicts }),
    selectedBy,
    selectorChecks: directiveSelectorChecks(entry, input.dataByRegistryId, selectedBy),
    dataPresent: input.dataByRegistryId[entry.id] !== undefined,
    issues,
    missingRequired,
    conflicts,
    ...(directive ? { directive } : {})
  };
}

function directiveDebugInput(
  args: ParsedArgs,
  options: { readonly defaultFixture?: DirectiveDebugFixtureId } = {}
): DirectiveDebugInput {
  const fixture = directiveDebugFixtureId(args) ?? (flagValue(args, "command") ? undefined : options.defaultFixture);
  const baseSnapshot = fixture ? directiveDebugFixtureSnapshot(fixture) : directiveDebugBaseSnapshot();
  const snapshot = applyDirectiveDebugOverrides(baseSnapshot, args);
  const dataByRegistryId = directiveDebugDataByRegistryId(snapshot);
  const gaps = cliAgentDirectiveGapsForSnapshot(snapshot, dataByRegistryId);
  const selections = selectAgentDirectiveRegistryEntriesFromGaps(gaps, AGENT_DIRECTIVE_REGISTRY, {
    dataByRegistryId
  }).map((selection) => ({
    registryId: selection.registryEntry.id,
    selectedBy: selection.selectedBy
  }));
  return {
    ...(fixture ? { fixture } : {}),
    snapshot,
    gaps,
    dataByRegistryId,
    selections
  };
}

function cliAgentDirectiveGapsForSnapshot(
  snapshot: AgentDirectiveSnapshot,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId
): readonly EnforcementGap[] {
  const codes = new Set<EnforcementGapCode>();

  if (snapshot.work.activeBlockerIds.length > 0 || snapshot.work.blockedByIds.length > 0) {
    codes.add("work.blocked.open-dependency");
  }
  if (snapshot.work.openDescendantIds.length > 0) {
    codes.add("work.container.open-descendant");
  }

  for (const gate of snapshot.gate.requiredGates) {
    if (gate.status !== "open") {
      continue;
    }
    if (gate.declaredCommand !== undefined) {
      codes.add("gate.declared-command.missing");
    }
    if (gate.expectedObservable !== undefined) {
      codes.add("gate.expected-observable.missing");
    }
    switch (gate.kind) {
      case "verification":
        codes.add("gate.verification.unsatisfied");
        break;
      case "checkpoint":
        codes.add("gate.checkpoint.unsatisfied");
        break;
      case "review":
        codes.add("gate.review.unsatisfied");
        break;
      case "audit":
        codes.add("gate.audit.unsatisfied");
        break;
    }
  }

  if (cliNeedsDoctorRecoveryDirective(snapshot)) {
    codes.add("doctor.recovery.required");
    if (!snapshot.sync.searchIndexFresh) {
      codes.add("search.index-stale");
    }
  }

  if (cliCloseoutSummaryRequired(snapshot, dataByRegistryId["closeout.summary-required"])) {
    codes.add("closeout.user-summary.required");
  }
  if (cliGitCheckpointRequired(snapshot, dataByRegistryId["git.checkpoint-required"])) {
    codes.add("git.checkpoint.required");
  }
  if (cliVerificationEvidenceRequired(dataByRegistryId["verification.evidence-required"])) {
    codes.add("gate.verification.unsatisfied");
  }
  if (dataByRegistryId["workflow_next.canonical-next-step"] !== undefined) {
    codes.add("directive.workflow-next.available");
  }
  if (dataByRegistryId["memory.reconcile-source"] !== undefined) {
    codes.add("memory.reconcile-source.required");
  }
  if (
    dataByRegistryId["handoff.session-summary"] !== undefined &&
    (snapshot.work.subject?.type === "session" || snapshot.actor.activeReservationIds.length > 0) &&
    cliDataHasAnyString(dataByRegistryId["handoff.session-summary"], ["summaryUri", "summaryId"])
  ) {
    codes.add("handoff.session-summary.required");
  }
  if (
    dataByRegistryId["phase.close-rollup"] !== undefined &&
    ["summary compose", "summary show", "sprint metrics", "sprint report"].includes(snapshot.command.path) &&
    (snapshot.work.subject?.type === "phase" || snapshot.work.subject?.type === "milestone")
  ) {
    codes.add("phase.close-rollup.required");
  }
  if (
    dataByRegistryId["sprint.close-rollup"] !== undefined &&
    ["summary compose", "summary show", "sprint metrics", "sprint report"].includes(snapshot.command.path) &&
    snapshot.work.subject?.type === "sprint"
  ) {
    codes.add("sprint.close-rollup.required");
  }
  if (dataByRegistryId["sprint.launch-plan"] !== undefined) {
    codes.add("sprint.launch-plan.required");
  }

  return [...codes].sort().map((code) => cliEnforcementGapForSnapshotCode(snapshot, code));
}

function cliEnforcementGapForSnapshotCode(snapshot: AgentDirectiveSnapshot, code: EnforcementGapCode): EnforcementGap {
  const subject = snapshot.work.subject;
  return {
    code,
    subjectType: (subject?.type ?? "command") as EnforcementGap["subjectType"],
    subjectId: subject?.id ?? snapshot.command.path,
    data: cliEnforcementGapDataForSnapshotCode(snapshot, code)
  };
}

function cliEnforcementGapDataForSnapshotCode(
  snapshot: AgentDirectiveSnapshot,
  code: EnforcementGapCode
): EnforcementGap["data"] | undefined {
  if (code === "work.blocked.open-dependency") {
    return {
      blockerIds: uniqueStrings([...snapshot.work.activeBlockerIds, ...snapshot.work.blockedByIds]) as readonly WorkId[]
    };
  }
  if (code === "work.container.open-descendant") {
    return { blockerIds: snapshot.work.openDescendantIds as readonly WorkId[] };
  }
  if (code.startsWith("gate.")) {
    const openGates = snapshot.gate.requiredGates.filter((gate) => gate.status === "open");
    return {
      gateIds: openGates.map((gate) => gate.id),
      requiredEvidenceKinds: uniqueStrings(openGates.flatMap((gate) => gate.requiredEvidenceKinds)) as readonly EvidenceKind[],
      minEvidenceCount: maxNumber(openGates.map((gate) => gate.minEvidenceCount)),
      declaredCommand: firstString(openGates.map((gate) => gate.declaredCommand)),
      expectedObservable: firstString(openGates.map((gate) => gate.expectedObservable))
    };
  }
  if (code === "doctor.recovery.required" || code === "search.index-stale") {
    return { reason: cliRecoveryDiagnostics(snapshot).map((diagnostic) => diagnostic.code).join(",") };
  }
  return undefined;
}

function cliNeedsDoctorRecoveryDirective(snapshot: AgentDirectiveSnapshot): boolean {
  const recoveryDiagnostics = cliRecoveryDiagnostics(snapshot);
  const commandSelfRefreshesGeneratedArtifacts = cliCommandSelfRefreshesGeneratedArtifacts(snapshot);
  const syncNeedsRefresh =
    !snapshot.sync.ok ||
    !snapshot.sync.ledgersFresh ||
    !snapshot.sync.searchIndexFresh ||
    !snapshot.sync.sqliteCacheFresh;
  const operationNeedsPrune =
    snapshot.sync.operationCount !== undefined &&
    snapshot.sync.warningThreshold !== undefined &&
    snapshot.sync.operationCount >= snapshot.sync.warningThreshold;
  const generatedArtifactsNeedRefresh =
    syncNeedsRefresh && !commandSelfRefreshesGeneratedArtifacts && recoveryDiagnostics.length > 0;
  const doctorNeedsRecovery =
    !snapshot.doctor.ok &&
    (operationNeedsPrune || recoveryDiagnostics.length > 0);
  if (cliCommandEmitsHealthRecovery(snapshot.command.path)) {
    return (
      doctorNeedsRecovery ||
      generatedArtifactsNeedRefresh ||
      operationNeedsPrune ||
      recoveryDiagnostics.length > 0
    );
  }
  return recoveryDiagnostics.length > 0;
}

function cliAttentionDiagnostics(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveDiagnosticSnapshot[] {
  return snapshot.doctor.diagnostics.filter(
    (diagnostic) =>
      !isNonBlockingCollaborationDiagnostic(diagnostic) &&
      (diagnostic.severity === "warning" ||
        diagnostic.severity === "error" ||
        diagnostic.blocking)
  );
}

function isNonBlockingCollaborationDiagnostic(diagnostic: AgentDirectiveDiagnosticSnapshot): boolean {
  return diagnostic.code === "git.dirty_collaboration_path" && !diagnostic.blocking;
}

function cliRecoveryDiagnostics(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveDiagnosticSnapshot[] {
  const diagnostics = cliAttentionDiagnostics(snapshot);
  if (cliCommandEmitsHealthRecovery(snapshot.command.path)) {
    if (cliCommandSelfRefreshesGeneratedArtifacts(snapshot)) {
      return diagnostics.filter((diagnostic) => !isGeneratedArtifactStalenessDiagnostic(diagnostic.code));
    }
    return diagnostics;
  }
  return diagnostics.filter((diagnostic) => !isCloseoutHealthDiagnostic(diagnostic.code));
}

function cliCommandSelfRefreshesGeneratedArtifacts(snapshot: AgentDirectiveSnapshot): boolean {
  if (!snapshot.command.mutatesState) {
    return false;
  }
  if (!INLINE_GENERATED_ARTIFACT_REFRESH_COMMANDS.has(snapshot.command.path)) {
    return false;
  }
  const definition = findCommandDefinition(snapshot.command.path.split(/\s+/u));
  if (!definition) {
    return false;
  }
  const behavior = commandBehavior(definition);
  return behavior.writesState && behavior.writesGeneratedArtifacts;
}

function isGeneratedArtifactStalenessDiagnostic(code: string): boolean {
  return code === "ledger.status" || code === "search.index" || code === "cache.sqlite";
}

function cliCommandEmitsHealthRecovery(commandPath: string): boolean {
  return cliCloseoutRelevantHealthCommand(commandPath) || cliHealthCommand(commandPath);
}

function cliCloseoutRelevantHealthCommand(commandPath: string): boolean {
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

function cliHealthCommand(commandPath: string): boolean {
  return (
    commandPath === "doctor" ||
    commandPath === "prime" ||
    commandPath === "sync refresh" ||
    commandPath === "sync status" ||
    commandPath.startsWith("lock ")
  );
}

function isCloseoutHealthDiagnostic(code: string): boolean {
  return code === "operation.volume" || isGeneratedArtifactStalenessDiagnostic(code);
}

function maxNumber(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function firstString(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function cliDataHasAnyString(data: AgentDirectiveAssemblyDataByRegistryId[string], keys: readonly string[]): boolean {
  if (data === undefined) {
    return false;
  }
  return keys.some((key) => {
    const value = data[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function cliCloseoutSummaryRequired(
  snapshot: AgentDirectiveSnapshot,
  data: AgentDirectiveAssemblyDataByRegistryId[string]
): boolean {
  if (data === undefined) {
    return false;
  }
  const hasSummary = cliDataString(data, "summaryId") !== undefined || cliDataString(data, "summaryUri") !== undefined;
  if (hasSummary) {
    return false;
  }
  return snapshot.work.subject?.status === "closed" || snapshot.work.subject?.status === "cancelled" || closeoutCommandRequiresCheckpoint(snapshot.command.path);
}

function cliGitCheckpointRequired(
  snapshot: AgentDirectiveSnapshot,
  data: AgentDirectiveAssemblyDataByRegistryId[string]
): boolean {
  if (data === undefined) {
    return false;
  }
  if (cliDataStringArray(data, "commitShas").length > 0) {
    return false;
  }
  const reasonCode = cliDataString(data, "reasonCode") ?? cliDataString(data, "noCommitReason");
  const repositoryChanged = cliDataBoolean(data, "repositoryChanged") === true;
  const scopedChangedPaths = cliDataArray(data, "scopedChangedPaths");
  const blockingDirtyPaths = cliDataArray(data, "blockingDirtyPaths");
  if (repositoryChanged || scopedChangedPaths.length > 0 || blockingDirtyPaths.length > 0) {
    return true;
  }
  return closeoutCommandRequiresCheckpoint(snapshot.command.path) && reasonCode === undefined;
}

function cliVerificationEvidenceRequired(data: AgentDirectiveAssemblyDataByRegistryId[string]): boolean {
  if (data === undefined || cliDataStringArray(data, "verificationIds").length > 0) {
    return false;
  }
  return (
    cliDataHasAnyString(data, ["command", "expectedObservable"]) ||
    cliDataHasAnyNonEmptyArray(data, ["declaredCommands", "expectedObservables"])
  );
}

function cliDataHasAnyNonEmptyArray(
  data: AgentDirectiveAssemblyDataByRegistryId[string],
  keys: readonly string[]
): boolean {
  if (data === undefined) {
    return false;
  }
  return keys.some((key) => cliDataArray(data, key).length > 0);
}

function cliDataString(data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function cliDataBoolean(data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>, key: string): boolean | undefined {
  const value = data[key];
  return typeof value === "boolean" ? value : undefined;
}

function cliDataStringArray(
  data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>,
  key: string
): readonly string[] {
  return cliDataArray(data, key).filter((value): value is string => typeof value === "string");
}

function cliDataArray(
  data: NonNullable<AgentDirectiveAssemblyDataByRegistryId[string]>,
  key: string
): readonly unknown[] {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

function closeoutCommandRequiresCheckpoint(commandPath: string): boolean {
  return ["agent finish", "summary compose", "summary show", "work cancel", "work close", "sprint close"].includes(commandPath);
}

function directiveDebugDataByRegistryId(snapshot: AgentDirectiveSnapshot): AgentDirectiveAssemblyDataByRegistryId {
  return {
    ...closeoutDirectiveDataByRegistryId(snapshot),
    ...summaryDirectiveDataByRegistryId(snapshot),
    ...gitDirectiveDataByRegistryId(snapshot),
    ...handoffDirectiveDataByRegistryId(snapshot),
    ...recoveryDirectiveDataByRegistryId(snapshot)
  };
}

function directiveDebugFixtureId(args: ParsedArgs): DirectiveDebugFixtureId | undefined {
  const fixture = flagValue(args, "fixture");
  if (!fixture) {
    return undefined;
  }
  if ((DIRECTIVE_DEBUG_FIXTURE_IDS as readonly string[]).includes(fixture)) {
    return fixture as DirectiveDebugFixtureId;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directive fixture: ${fixture}`, {
    fixture,
    validFixtures: DIRECTIVE_DEBUG_FIXTURE_IDS
  });
}

function argsWithDirectiveFixture(args: ParsedArgs, fixture: DirectiveDebugFixtureId): ParsedArgs {
  if (flagValue(args, "fixture")) {
    return args;
  }
  const flags = new Map(args.flags);
  flags.set("fixture", [fixture]);
  return { command: args.command, flags };
}

function directiveDebugFixtureSnapshot(fixture: DirectiveDebugFixtureId): AgentDirectiveSnapshot {
  switch (fixture) {
    case "blocked-work":
      return directiveDebugBaseSnapshot({
        commandPath: "work show",
        subjectType: "work",
        subjectId: "bw_work_blocked00000001",
        subjectTitle: "Blocked fixture work",
        workStatus: "blocked",
        dependencyIds: ["bw_work_blocker0000001" as WorkId],
        activeBlockerIds: ["bw_work_blocker0000001" as WorkId],
        labels: ["agent-directives", "fixture"]
      });
    case "closeout-success":
      return directiveDebugBaseSnapshot({
        commandPath: "agent finish",
        subjectType: "work",
        subjectId: "bw_work_closed00000001",
        subjectTitle: "Closed fixture work",
        workStatus: "closed",
        labels: ["agent-directives", "fixture"],
        evidenceIds: ["bw_evidence_fixture0001" as EvidenceId],
        verificationIds: ["bw_verification_fixture01" as VerificationId],
        summaryIds: ["bw_summary_fixture000001" as AgentSummaryId],
        artifactUris: ["memory://agent-summaries/works/bw_work_closed00000001/bw_summary_fixture000001.md"],
        commitShas: ["abc1234"]
      });
    case "doctor-recovery":
      return directiveDebugBaseSnapshot({
        commandPath: "doctor",
        subjectType: "workspace",
        subjectId: "workspace",
        subjectTitle: "Workspace",
        doctorOk: false,
        syncOk: false,
        diagnostics: [
          {
            code: "search.index",
            severity: "warning",
            message: "Search index is not fresh",
            blocking: false,
            recommendedCommands: ["bwrk sync refresh --json"]
          }
        ],
        workflowRef: "workflows/60-health/sync-and-doctor.md",
        recommendedCommandPath: "bwrk sync refresh --json"
      });
    case "session-handoff":
      return directiveDebugBaseSnapshot({
        commandPath: "session end",
        subjectType: "session",
        subjectId: "local",
        subjectTitle: "Session local",
        labels: ["agent-directives", "fixture"],
        evidenceIds: ["bw_evidence_fixture0002" as EvidenceId],
        verificationIds: ["bw_verification_fixture02" as VerificationId],
        summaryIds: ["bw_summary_fixture000002" as AgentSummaryId],
        artifactUris: ["memory://handoffs/session/local/bw_summary_fixture000002.md"],
        commitShas: ["def5678"],
        activeReservationIds: ["bw_reservation_fixture01" as ReservationId],
        workflowRef: "workflows/50-handoff/session-closeout.md",
        recommendedCommandPath: "bwrk work list --ready --json"
      });
  }
}

function directiveDebugBaseSnapshot(
  input: {
    readonly commandPath?: string;
    readonly subjectType?: AgentDirectiveSubjectType;
    readonly subjectId?: string;
    readonly subjectTitle?: string;
    readonly workStatus?: WorkStatus;
    readonly dependencyIds?: readonly WorkId[];
    readonly activeBlockerIds?: readonly WorkId[];
    readonly openDescendantIds?: readonly WorkId[];
    readonly labels?: readonly string[];
    readonly evidenceIds?: readonly EvidenceId[];
    readonly verificationIds?: readonly VerificationId[];
    readonly summaryIds?: readonly AgentSummaryId[];
    readonly artifactUris?: readonly string[];
    readonly commitShas?: readonly string[];
    readonly dirtyPathNotes?: readonly string[];
    readonly activeReservationIds?: readonly ReservationId[];
    readonly doctorOk?: boolean;
    readonly syncOk?: boolean;
    readonly diagnostics?: readonly AgentDirectiveDiagnosticSnapshot[];
    readonly workflowRef?: string;
    readonly recommendedCommandPath?: string;
  } = {}
): AgentDirectiveSnapshot {
  const commandPath = input.commandPath ?? "work show";
  const workflowRef = input.workflowRef ?? directiveDebugWorkflowRef(commandPath);
  const recommendedCommandPath = input.recommendedCommandPath ?? directiveDebugRecommendedCommand(commandPath, input.subjectId);
  const summaryIds = input.summaryIds ?? [];
  const latestSummaryId = summaryIds.at(-1);
  const latestSummaryUri = input.artifactUris?.at(-1);
  return createAgentDirectiveSnapshot({
    capturedAt: "2026-01-01T00:00:00.000Z" as IsoTimestamp,
    work: {
      ...(input.subjectType && input.subjectId && input.subjectTitle
        ? {
            subject: {
              type: input.subjectType,
              id: input.subjectId,
              title: input.subjectTitle,
              ...(input.workStatus ? { status: input.workStatus } : {})
            }
          }
        : {}),
      labels: input.labels ?? [],
      dependencyIds: input.dependencyIds ?? [],
      activeBlockerIds: input.activeBlockerIds ?? [],
      blockedByIds: input.activeBlockerIds ?? [],
      childWorkIds: input.dependencyIds ?? [],
      descendantWorkIds: input.dependencyIds ?? [],
      openDescendantIds: input.openDescendantIds ?? []
    },
    summary: {
      summaryIds,
      finalSummaryIds: summaryIds,
      childSummaryIds: [],
      artifactUris: input.artifactUris ?? [],
      commitShas: input.commitShas ?? [],
      dirtyPathNotes: input.dirtyPathNotes ?? [],
      ...(latestSummaryId ? { latestSummaryId } : {}),
      ...(latestSummaryUri ? { latestSummaryUri } : {})
    },
    gate: {
      requiredGates: [],
      openGateIds: [],
      satisfiedGateIds: [],
      forcedGateIds: []
    },
    evidence: {
      evidenceIds: input.evidenceIds ?? [],
      verificationIds: input.verificationIds ?? [],
      evidence: [],
      verifications: []
    },
    git: {
      roots: [
        {
          root: "/workspace",
          branchName: "main",
          detached: false,
          protectedBranch: true,
          clean: (input.dirtyPathNotes ?? []).length === 0,
          scopedChangedPaths: [],
          collaborationDirtyPaths: [],
          blockingDirtyPaths: [],
          untrackedPaths: []
        }
      ],
      checkpointCommitShas: input.commitShas ?? [],
      dirtyPathNotes: input.dirtyPathNotes ?? []
    },
    workflow: {
      workflowRefs: [workflowRef],
      skillRefs: ["boreal-work-execution"],
      requiredInputNames: AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
      nextWorkflowRef: workflowRef,
      recommendedCommandPath,
      assetManifestHash: hashContent({ commandPath, workflowRef }) as ContentHash
    },
    doctor: {
      ok: input.doctorOk ?? true,
      strict: true,
      diagnostics: input.diagnostics ?? []
    },
    sync: {
      ok: input.syncOk ?? true,
      refreshed: true,
      ledgersFresh: input.syncOk ?? true,
      searchIndexFresh: input.syncOk ?? true,
      sqliteCacheFresh: true,
      operationCount: 0,
      warningThreshold: 1250
    },
    command: {
      path: commandPath,
      argv: ["bwrk", ...commandPath.split(/\s+/u)],
      envelopeSchema: `boreal.cli.${commandPath.replace(/\s+/gu, ".")}.v1`,
      json: true,
      mutatesState: false,
      resultOk: true
    },
    actor: {
      actor: {
        id: "fixture-agent",
        kind: "agent"
      },
      activeAgentId: "fixture-agent",
      activeReservationIds: input.activeReservationIds ?? []
    }
  });
}

function applyDirectiveDebugOverrides(snapshot: AgentDirectiveSnapshot, args: ParsedArgs): AgentDirectiveSnapshot {
  const commandPath = flagValue(args, "command") ?? snapshot.command.path;
  const labels = flagValues(args, "label").length > 0 ? normalizeLabels(flagValues(args, "label")) : snapshot.work.labels;
  const dependencyIds = flagValues(args, "dependency").length > 0
    ? flagValues(args, "dependency").map(asWorkId)
    : snapshot.work.dependencyIds;
  const activeBlockerIds = flagValues(args, "active-blocker").length > 0
    ? flagValues(args, "active-blocker").map(asWorkId)
    : snapshot.work.activeBlockerIds;
  const openDescendantIds = flagValues(args, "open-descendant").length > 0
    ? flagValues(args, "open-descendant").map(asWorkId)
    : snapshot.work.openDescendantIds;
  const evidenceIds = flagValues(args, "evidence").length > 0
    ? flagValues(args, "evidence").map(asEvidenceId)
    : snapshot.evidence.evidenceIds;
  const verificationIds = flagValues(args, "verification").length > 0
    ? flagValues(args, "verification").map(asVerificationId)
    : snapshot.evidence.verificationIds;
  const summaryIds = flagValue(args, "summary-id")
    ? [asAgentSummaryId(requiredFlag(args, "summary-id"))]
    : snapshot.summary.summaryIds;
  const artifactUris = flagValue(args, "summary-uri") ? [requiredFlag(args, "summary-uri")] : snapshot.summary.artifactUris;
  const commitShas = flagValues(args, "commit").length > 0 ? flagValues(args, "commit") : snapshot.summary.commitShas;
  const dirtyPathNotes = flagValues(args, "dirty-path").length > 0 ? flagValues(args, "dirty-path") : snapshot.summary.dirtyPathNotes;
  const subject = directiveDebugSubjectOverride(snapshot, args);
  return createAgentDirectiveSnapshot({
    ...snapshot,
    work: {
      ...snapshot.work,
      ...(subject ? { subject } : {}),
      labels,
      dependencyIds,
      activeBlockerIds,
      blockedByIds: activeBlockerIds,
      childWorkIds: dependencyIds,
      descendantWorkIds: dependencyIds,
      openDescendantIds
    },
    summary: {
      ...snapshot.summary,
      summaryIds,
      finalSummaryIds: summaryIds,
      artifactUris,
      commitShas,
      dirtyPathNotes,
      ...(summaryIds.at(-1) ? { latestSummaryId: summaryIds.at(-1) } : {}),
      ...(artifactUris.at(-1) ? { latestSummaryUri: artifactUris.at(-1) } : {})
    },
    evidence: {
      ...snapshot.evidence,
      evidenceIds,
      verificationIds
    },
    git: {
      ...snapshot.git,
      checkpointCommitShas: commitShas,
      dirtyPathNotes
    },
    workflow: {
      ...snapshot.workflow,
      workflowRefs: [directiveDebugWorkflowRef(commandPath)],
      nextWorkflowRef: directiveDebugWorkflowRef(commandPath),
      recommendedCommandPath: directiveDebugRecommendedCommand(commandPath, subject?.id),
      assetManifestHash: hashContent({ commandPath, workflowRef: directiveDebugWorkflowRef(commandPath) }) as ContentHash
    },
    command: {
      ...snapshot.command,
      path: commandPath,
      argv: ["bwrk", ...commandPath.split(/\s+/u)],
      envelopeSchema: `boreal.cli.${commandPath.replace(/\s+/gu, ".")}.v1`
    }
  });
}

function directiveDebugSubjectOverride(
  snapshot: AgentDirectiveSnapshot,
  args: ParsedArgs
): AgentDirectiveSnapshot["work"]["subject"] | undefined {
  const hasSubjectOverride = ["subject-type", "subject-id", "subject-title", "status"].some((name) => flagValue(args, name) !== undefined);
  if (!hasSubjectOverride) {
    return snapshot.work.subject;
  }
  const type = parseAgentDirectiveSubjectType(flagValue(args, "subject-type") ?? snapshot.work.subject?.type ?? "work");
  const status = parseWorkStatus(flagValue(args, "status")) ?? snapshot.work.subject?.status;
  return {
    type,
    id: flagValue(args, "subject-id") ?? snapshot.work.subject?.id ?? directiveDebugDefaultSubjectId(type),
    title: flagValue(args, "subject-title") ?? snapshot.work.subject?.title ?? directiveDebugDefaultSubjectTitle(type),
    ...(status ? { status } : {})
  };
}

function parseAgentDirectiveSubjectType(value: string): AgentDirectiveSubjectType {
  if ((AGENT_DIRECTIVE_SUBJECT_TYPES as readonly string[]).includes(value)) {
    return value as AgentDirectiveSubjectType;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directive subject type: ${value}`, {
    subjectType: value,
    validSubjectTypes: AGENT_DIRECTIVE_SUBJECT_TYPES
  });
}

function parseDirectiveAcknowledgementOutcome(value: string): DirectiveAcknowledgementOutcome {
  const normalized = value === "not-applicable" ? "not_applicable" : value;
  if (
    normalized === "satisfied" ||
    normalized === "deferred" ||
    normalized === "noncompliant" ||
    normalized === "not_applicable"
  ) {
    return normalized;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--outcome must be satisfied, deferred, noncompliant, or not-applicable", {
    outcome: value
  });
}

function parseOptionalIsoTimestamp(value: string | undefined, label: string): IsoTimestamp | undefined {
  if (!value) {
    return undefined;
  }
  if (!isIsoTimestamp(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be an ISO timestamp`);
  }
  return value;
}

function parseDirectiveRenderFormat(value: string | undefined): DirectiveRenderFormat {
  if (value === undefined || value === "markdown") {
    return "markdown";
  }
  if (value === "json") {
    return "json";
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directive render format: ${value}`, {
    format: value,
    validFormats: ["markdown", "json"]
  });
}

function directiveDebugDefaultSubjectId(type: AgentDirectiveSubjectType): string {
  return type === "workspace" ? "workspace" : `${type}.fixture`;
}

function directiveDebugDefaultSubjectTitle(type: AgentDirectiveSubjectType): string {
  return type === "workspace" ? "Workspace" : `${type} fixture`;
}

function directiveDebugWorkflowRef(commandPath: string): string {
  if (["doctor", "lock inspect", "prime", "sync refresh", "sync status"].includes(commandPath)) {
    return "workflows/60-health/sync-and-doctor.md";
  }
  if (commandPath === "session end") {
    return "workflows/50-handoff/session-closeout.md";
  }
  return "workflows/40-work/claim-and-finish-work.md";
}

function directiveDebugRecommendedCommand(commandPath: string, subjectId: string | undefined): string {
  if (["doctor", "lock inspect", "prime", "sync refresh", "sync status"].includes(commandPath)) {
    return "bwrk sync refresh --json";
  }
  if (subjectId) {
    return `bwrk work show ${subjectId} --json`;
  }
  return "bwrk work list --ready --json";
}

function directiveDebugSubjectTypes(snapshot: AgentDirectiveSnapshot): readonly AgentDirectiveSubjectType[] {
  const subjectTypes = new Set<AgentDirectiveSubjectType>(["command"]);
  if (snapshot.work.subject) {
    subjectTypes.add(snapshot.work.subject.type);
  } else {
    subjectTypes.add("workspace");
  }
  return [...subjectTypes];
}

function directiveSelectorChecks(
  entry: AgentDirectiveRegistryEntry,
  dataByRegistryId: AgentDirectiveAssemblyDataByRegistryId,
  selectedBy: readonly string[]
): DirectiveExplainResult["selectorChecks"] {
  return {
    lifecycleActive: entry.lifecycle === "active",
    dataPresent: dataByRegistryId[entry.id] !== undefined,
    matchedTriggerCodes: selectedBy.flatMap((selector) =>
      selector.startsWith("gap.") ? [selector.replace(/^gap\./u, "")] : []
    ),
    configuredTriggerCodes: entry.triggerCodes
  };
}

function directiveExplainReason(input: {
  readonly selected: boolean;
  readonly emitted: boolean;
  readonly issues: readonly AgentDirectiveBundleAssemblyIssue[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
  readonly conflicts: AgentDirectiveBundle["conflicts"];
}): string {
  if (input.emitted && input.conflicts.length > 0) {
    return "emitted with conflict resolution metadata";
  }
  if (input.emitted) {
    return "emitted";
  }
  if (input.selected && (input.issues.length > 0 || input.missingRequired.length > 0)) {
    return "selected but missing or invalid directive data";
  }
  if (input.selected) {
    return "selected but not emitted";
  }
  return "not selected by registry trigger codes";
}

function renderDirectiveBundleMarkdown(result: DirectiveCompileResult): string {
  const bundle = result.bundle;
  const lines = [
    "# Agent Directive Bundle",
    "",
    keyValueRows([
      { key: "registry", value: result.registryVersion },
      { key: "fixture", value: result.fixture ?? "custom" },
      { key: "command", value: result.commandPath },
      { key: "subject", value: result.subject ? `${result.subject.type}:${result.subject.id}` : "none" },
      { key: "gaps", value: String(result.gaps.length) },
      { key: "selected", value: result.selectedRegistryIds.join(", ") || "none" },
      { key: "issues", value: String(result.issueCount) }
    ]),
    ""
  ];
  if (!bundle || bundle.directives.length === 0) {
    lines.push("No directives were emitted.", "");
  } else {
    lines.push(
      section(
        "Directives",
        bundle.directives.map(
          (directive) =>
            `${directive.registryId} [${directive.severity}] - ${directive.title} (${directive.source.selectedBy.join(", ")})`
        )
      ),
      ""
    );
  }
  if (result.missingRequired.length > 0) {
    lines.push(
      section(
        "Missing Required",
        result.missingRequired.map((missing) => `${missing.registryId}: ${missing.requirement}`)
      ),
      ""
    );
  }
  if (result.issues.length > 0) {
    lines.push(
      section(
        "Issues",
        result.issues.map((issue) => `${issue.phase} ${issue.path}: ${issue.message}`)
      ),
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatDirectiveCompile(result: DirectiveCompileResult): string {
  return renderDirectiveBundleMarkdown(result);
}

function formatDirectiveExplain(result: DirectiveExplainResult): string {
  const lines = [
    keyValueRows([
      { key: "directive", value: result.directiveId },
      { key: "command", value: result.commandPath },
      { key: "fixture", value: result.fixture ?? "custom" },
      { key: "selected", value: String(result.selected) },
      { key: "emitted", value: String(result.emitted) },
      { key: "reason", value: result.reason },
      { key: "selectedBy", value: result.selectedBy.join(", ") || "none" }
    ]),
    "",
    section("Selector Checks", Object.entries(result.selectorChecks).map(([key, value]) => `${key}: ${String(value)}`))
  ];
  if (result.issues.length > 0) {
    lines.push("", section("Issues", result.issues.map((issue) => `${issue.phase} ${issue.path}: ${issue.message}`)));
  }
  if (result.missingRequired.length > 0) {
    lines.push("", section("Missing Required", result.missingRequired.map((missing) => `${missing.registryId}: ${missing.requirement}`)));
  }
  return `${lines.join("\n")}\n`;
}

function formatDirectiveAcknowledgementCreate(result: DirectiveAcknowledgementCreateResult): string {
  return `${section("Directive Acknowledgement", [
    `created ${result.acknowledgement.meta.id}`,
    `directive ${result.acknowledgement.directiveId}@${result.acknowledgement.directiveVersion}`,
    `outcome ${result.acknowledgement.outcome}`,
    `subject ${directiveAcknowledgementSubjectLabel(result.acknowledgement)}`
  ])}\n`;
}

function formatDirectiveAcknowledgementList(result: DirectiveAcknowledgementListResult): string {
  if (result.acknowledgements.length === 0) {
    return "No directive acknowledgements found.\n";
  }
  return `${table(
    result.acknowledgements.map((record) => ({
      id: record.meta.id,
      directive: record.directiveRegistryId ?? record.directiveId,
      outcome: record.outcome,
      subject: directiveAcknowledgementSubjectLabel(record),
      acknowledged: record.acknowledgedAt
    }))
  )}\n`;
}

function formatDirectiveAcknowledgementShow(result: DirectiveAcknowledgementShowResult): string {
  const record = result.acknowledgement;
  return `${keyValueRows([
    { key: "id", value: record.meta.id },
    { key: "directive", value: `${record.directiveId}@${record.directiveVersion}` },
    { key: "registryId", value: record.directiveRegistryId ?? "none" },
    { key: "outcome", value: record.outcome },
    { key: "command", value: record.commandPath },
    { key: "subject", value: directiveAcknowledgementSubjectLabel(record) },
    { key: "evidence", value: record.evidenceIds.join(", ") || "none" },
    { key: "summaries", value: record.agentSummaryIds.join(", ") || "none" },
    { key: "verifications", value: record.verificationIds?.join(", ") || "none" },
    { key: "artifacts", value: record.artifactUris?.join(", ") || "none" },
    { key: "handoffs", value: record.handoffIds.join(", ") || "none" },
    { key: "reason", value: record.reason ?? record.reasonCode ?? "none" },
    { key: "acknowledgedAt", value: record.acknowledgedAt }
  ])}\n`;
}

function directiveAcknowledgementSubjectLabel(record: DirectiveAcknowledgementRecord): string {
  return `${record.subjectType}:${record.subjectId ?? "none"}${record.subjectTitle ? ` ${record.subjectTitle}` : ""}`;
}

function directiveFamilyFilter(args: ParsedArgs): AgentDirectiveFamily | undefined {
  const family = flagValue(args, "family");
  if (!family) {
    return undefined;
  }
  if ((AGENT_DIRECTIVE_FAMILIES as readonly string[]).includes(family)) {
    return family as AgentDirectiveFamily;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directive family: ${family}`, {
    family,
    validFamilies: AGENT_DIRECTIVE_FAMILIES
  });
}

function directiveStatusFilter(args: ParsedArgs): DirectiveRegistryStatus | undefined {
  const status = flagValue(args, "status");
  if (!status) {
    return undefined;
  }
  if ((DIRECTIVE_REGISTRY_STATUS_VALUES as readonly string[]).includes(status)) {
    return status as DirectiveRegistryStatus;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown directive status: ${status}`, {
    status,
    validStatuses: DIRECTIVE_REGISTRY_STATUS_VALUES
  });
}

function directiveReplacementIndex(
  registry: AgentDirectiveRegistry
): ReadonlyMap<AgentDirectiveTemplateId, readonly AgentDirectiveTemplateId[]> {
  const replacements = new Map<AgentDirectiveTemplateId, AgentDirectiveTemplateId[]>();
  for (const entry of registry.entries) {
    for (const supersededId of entry.supersedes ?? []) {
      const current = replacements.get(supersededId) ?? [];
      current.push(entry.id);
      replacements.set(supersededId, current);
    }
  }
  return new Map(
    [...replacements.entries()].map(([id, replacementIds]) => [
      id,
      replacementIds.sort((left, right) => left.localeCompare(right))
    ])
  );
}

function directiveListEntry(
  entry: AgentDirectiveRegistryEntry,
  replacements: ReadonlyMap<AgentDirectiveTemplateId, readonly AgentDirectiveTemplateId[]>
): DirectiveRegistryListEntry {
  const deprecatedBy = replacements.get(entry.id) ?? [];
  return {
    id: entry.id,
    version: entry.version,
    family: entry.family,
    severity: entry.severity,
    audience: entry.audience,
    kind: entry.kind,
    lifecycle: entry.lifecycle,
    status: directiveRegistryStatus(entry, deprecatedBy),
    title: entry.title,
    blocksCloseout: Boolean(entry.blocksCloseout),
    supersedes: entry.supersedes ?? [],
    deprecatedBy
  };
}

function directiveShowEntry(
  entry: AgentDirectiveRegistryEntry,
  replacements: ReadonlyMap<AgentDirectiveTemplateId, readonly AgentDirectiveTemplateId[]>
): DirectiveRegistryShowEntry {
  const base = directiveListEntry(entry, replacements);
  return {
    ...base,
    instruction: entry.instruction,
    defaultLifecycle: entry.defaultLifecycle,
    sourcePath: entry.sourcePath,
    triggerCodes: entry.triggerCodes,
    nextCommandTemplate: entry.nextCommandTemplate,
    acknowledgement: entry.acknowledgement,
    payloadFields: agentDirectivePayloadFields(entry.id),
    replacementMetadata: {
      status: base.status,
      removed: base.status === "removed",
      supersedes: base.supersedes,
      deprecatedBy: base.deprecatedBy
    }
  };
}

function directiveRegistryStatus(
  entry: AgentDirectiveRegistryEntry,
  deprecatedBy: readonly AgentDirectiveTemplateId[]
): DirectiveRegistryStatus {
  if (deprecatedBy.length > 0 || entry.lifecycle === "superseded") {
    return "deprecated";
  }
  return entry.lifecycle;
}

function directiveFamilySummaries(
  registry: AgentDirectiveRegistry,
  replacements: ReadonlyMap<AgentDirectiveTemplateId, readonly AgentDirectiveTemplateId[]>
): readonly DirectiveRegistryFamilySummary[] {
  return AGENT_DIRECTIVE_FAMILIES.map((family) => {
    const entries = registry.entries
      .filter((entry) => entry.family === family)
      .map((entry) => directiveListEntry(entry, replacements));
    return {
      family,
      total: entries.length,
      active: entries.filter((entry) => entry.status === "active").length,
      deprecated: entries.filter((entry) => entry.status === "deprecated").length,
      removed: entries.filter((entry) => entry.status === "removed").length
    };
  });
}

function compareDirectiveListEntries(left: DirectiveRegistryListEntry, right: DirectiveRegistryListEntry): number {
  return left.family.localeCompare(right.family) || left.id.localeCompare(right.id);
}

function formatDirectiveRegistryList(result: DirectiveRegistryListResult): string {
  const lines = [
    `Agent Directive Registry ${result.registryVersion}`,
    `Source: ${result.sourcePath}`,
    `Filters: ${directiveFilterSummary(result.filters)}`,
    ""
  ];
  if (result.directives.length === 0) {
    lines.push("No directive registry entries match the filters.");
  } else {
    lines.push(
      table(
        result.directives.map((directive) => ({
          id: directive.id,
          family: directive.family,
          status: directive.status,
          severity: directive.severity,
          kind: directive.kind,
          title: directive.title
        }))
      ).trimEnd()
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatDirectiveRegistryShow(result: DirectiveRegistryShowResult): string {
  const directive = result.directive;
  const lines = [
    keyValueRows([
      { key: "id", value: directive.id },
      { key: "title", value: directive.title },
      { key: "family", value: directive.family },
      { key: "status", value: directive.status },
      { key: "severity", value: directive.severity },
      { key: "audience", value: directive.audience },
      { key: "kind", value: directive.kind },
      { key: "blocksCloseout", value: String(directive.blocksCloseout) },
      { key: "source", value: directive.sourcePath },
      { key: "nextCommand", value: directive.nextCommandTemplate },
      { key: "supersedes", value: formatDirectiveIdList(directive.replacementMetadata.supersedes) },
      { key: "deprecatedBy", value: formatDirectiveIdList(directive.replacementMetadata.deprecatedBy) }
    ]),
    "",
    section("Instruction", [directive.instruction]),
    "",
    section("Trigger Codes", directive.triggerCodes),
    "",
    section(
      "Payload Fields",
      directive.payloadFields.map(
        (payloadField) =>
          `${payloadField.key} (${payloadField.valueType}${payloadField.required ? ", required" : ", optional"}): ${payloadField.description}`
      )
    )
  ];
  if (directive.acknowledgement) {
    lines.push(
      "",
      section("Acknowledgement", [
        `requiredBefore: ${directive.acknowledgement.requiredBefore}`,
        `evidenceKind: ${directive.acknowledgement.evidenceKind ?? "none"}`,
        directive.acknowledgement.message
      ])
    );
  }
  return `${lines.join("\n")}\n`;
}

function directiveFilterSummary(filters: DirectiveRegistryListResult["filters"]): string {
  const parts = [
    filters.family ? `family=${filters.family}` : undefined,
    filters.status ? `status=${filters.status}` : undefined
  ].filter((value): value is string => typeof value === "string");
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatDirectiveIdList(ids: readonly AgentDirectiveTemplateId[]): string {
  return ids.length > 0 ? ids.join(", ") : "none";
}

function dashboardView(args: ParsedArgs): boolean {
  const view = flagValue(args, "view");
  if (view === undefined) {
    return false;
  }
  if (view === "dashboard") {
    return true;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--view must be dashboard");
}

function formatReadyWorkDashboard(rows: readonly WorkListRow[], containerId?: WorkId): string {
  const containerArg = containerId ? ` --container ${containerId}` : "";
  return [
    resultSummary({ status: rows.length > 0 ? "success" : "pending", title: "Ready work", detail: `${rows.length} claimable items` }),
    section(
      "Queue",
      rows.length > 0
        ? rows.map((row) => {
            const parents = compactLineage(row.lineage);
            return `${row.priority.padEnd(8)} ${row.id}${parents ? ` parents:${parents}` : ""} ${row.title}${row.labels.length > 0 ? ` [${row.labels.join(", ")}]` : ""}`;
          })
        : ["No ready work matches the selected filters."]
    ),
    section("Actions", rows.length > 0 ? [`bwrk work claim${containerArg} --label <label> --agent <agent-id> --json`] : [`bwrk work list${containerArg} --json`])
  ].join("\n\n") + "\n";
}

function formatWorkParallelResult(result: WorkParallelResult): string {
  return [
    resultSummary({
      status: result.items.length > 0 ? "success" : "pending",
      title: "Parallel work queue",
      detail: `${result.items.length} ready items`
    }),
    table(
      result.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        priority: item.priority,
        agent: item.agentId ?? "",
        title: item.title
      }))
    ),
    section(
      "Start commands",
      result.items.length > 0
        ? result.items.map((item) => item.agentStartCommand ?? "")
        : ["No ready work matches the selected filters."]
    ),
    section("Refresh", [result.commands.rerunCommand, result.commands.reservationListCommand])
  ].join("\n\n") + "\n";
}

function formatAgentStatusDashboard(status: AgentStatus): string {
  return [
    resultSummary({
      status: status.reservations.expiredActiveCount > 0 ? "warning" : status.readyWork.claimableCount > 0 ? "success" : "pending",
      title: `Agent ${status.agentId}`,
      detail: status.recommendedAction.reason
    }),
    section(
      "Reservations",
      keyValueRows([
        { key: "active", value: status.reservations.activeCount },
        { key: "expired", value: status.reservations.expiredActiveCount },
        { key: "capacity", value: status.reservations.capacityRemaining }
      ]).split("\n")
    ),
    section(
      "Ready work",
      [
        `claimable ${status.readyWork.claimableCount}`,
        status.readyWork.next ? `next ${status.readyWork.next.id} ${status.readyWork.next.title}` : "next none"
      ]
    ),
    section("Action", [status.recommendedAction.command ?? "none"])
  ].join("\n\n") + "\n";
}

function formatDoctorDashboard(result: Awaited<ReturnType<typeof runDoctor>>): string {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const fixed = result.diagnostics.filter((diagnostic) => diagnostic.severity === "fixed");
  return [
    resultSummary({
      status: result.ok ? "success" : "error",
      title: "Doctor",
      detail: `${errors.length} errors, ${warnings.length} warnings, ${fixed.length} fixed`
    }),
    section(
      "Findings",
      result.diagnostics.length > 0 ? result.diagnostics.map(formatDiagnostic) : ["No diagnostics returned."]
    )
  ].join("\n\n") + "\n";
}

function formatLockDashboard(result: RuntimeLockInspectionResult): string {
  return [
    resultSummary({
      status: result.ok ? "success" : "warning",
      title: "Runtime locks",
      detail: result.ok ? "no stale locks" : "stale lock present"
    }),
    ...result.locks.map((lock) => section(lock.label, formatRuntimeLockDashboardRows(lock))),
    section("Actions", result.locks.some((lock) => lock.status === "stale") ? ["bwrk doctor --fix --json"] : ["none"])
  ].join("\n\n") + "\n";
}

function formatRuntimeLockDashboardRows(lock: RuntimeLockState): readonly string[] {
  return keyValueRows([
    { key: "path", value: lock.inspection.lockDir },
    { key: "status", value: lock.status },
    { key: "stale", value: lock.inspection.stale },
    { key: "ageMs", value: lock.inspection.ageMs ?? "" },
    { key: "staleReason", value: lock.inspection.staleReason ?? "" },
    { key: "owner", value: lock.inspection.owner ? `${lock.inspection.owner.hostname}:${lock.inspection.owner.pid}` : "" }
  ]).split("\n");
}

interface FinishEvidencePayload {
  readonly evidence?: {
    readonly kind: EvidenceKind;
    readonly summary: string;
    readonly outcome: EvidenceOutcome;
    readonly command?: string;
    readonly uri?: string;
  };
  readonly evidenceId?: EvidenceId;
  readonly evidenceRefs: readonly EvidenceId[];
  readonly inlineEvidence?: string;
}

async function finishEvidenceInput(
  context: CliContext,
  args: ParsedArgs,
  workId: WorkId,
  verdict: VerificationVerdict
): Promise<FinishEvidencePayload> {
  const evidenceValues = flagValues(args, "evidence");
  const explicitSummary = flagValue(args, "summary");
  const referencedEvidenceIds = evidenceValues.filter((value) => value.startsWith("bw_evidence_")).map(asEvidenceId);
  const inlineEvidence = evidenceValues.find((value) => !value.startsWith("bw_evidence_"));
  if (flagValue(args, "command")) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      "Agent finish does not execute --command and cannot record it as witnessed evidence; run `bwrk evidence run` for a declared gate or `bwrk evidence add`, then pass --evidence <evidence-id>"
    );
  }
  if (referencedEvidenceIds.length > 1) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish accepts exactly one referenced evidence id", {
      workId,
      evidenceIds: referencedEvidenceIds
    });
  }
  const referencedEvidence = referencedEvidenceIds[0]
    ? await context.store.read((reader) => reader.getEvidence(referencedEvidenceIds[0] as EvidenceId))
    : undefined;
  if (referencedEvidenceIds[0] && !referencedEvidence) {
    throw new BorealError("BOREAL_NOT_FOUND", "Referenced finish evidence was not found", {
      workId,
      evidenceId: referencedEvidenceIds[0],
      domain: "evidence"
    });
  }
  if (referencedEvidence && referencedEvidence.subjectId !== workId) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Referenced finish evidence belongs to a different subject", {
      workId,
      evidenceId: referencedEvidence.meta.id,
      evidenceSubjectId: referencedEvidence.subjectId
    });
  }
  if (referencedEvidence) {
    const incompatibleFlags = [
      explicitSummary ? "--summary" : undefined,
      inlineEvidence ? "--evidence <inline-text>" : undefined,
      flagValue(args, "kind") ? "--kind" : undefined,
      flagValue(args, "outcome") ? "--outcome" : undefined,
      flagValue(args, "uri") ? "--uri" : undefined
    ].filter((value): value is string => value !== undefined);
    if (incompatibleFlags.length > 0) {
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        "Referenced finish evidence is immutable; do not combine --evidence <evidence-id> with inline evidence fields",
        { workId, evidenceId: referencedEvidence.meta.id, incompatibleFlags }
      );
    }
    return {
      evidenceId: referencedEvidence.meta.id,
      evidenceRefs: [referencedEvidence.meta.id]
    };
  }
  const summary = explicitSummary ?? inlineEvidence;
  if (!summary?.trim()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish requires --summary or --evidence <inline-or-evidence-id>");
  }
  return {
    evidence: {
      kind: parseEvidenceKind(flagValue(args, "kind")),
      summary,
      outcome: parseFinishOutcome(flagValue(args, "outcome"), verdict),
      uri: flagValue(args, "uri")
    },
    evidenceRefs: referencedEvidenceIds,
    ...(inlineEvidence ? { inlineEvidence } : {})
  };
}

async function finishReservedWorkWithCompositeState(
  context: CliContext,
  workId: WorkId,
  input: Parameters<CliContext["runtime"]["finishReservedWork"]>[0]
): ReturnType<CliContext["runtime"]["finishReservedWork"]> {
  try {
    return await context.runtime.finishReservedWork(input);
  } catch (error) {
    const resultingWork = await context.runtime.getWorkView(workId).catch(() => undefined);
    if (error instanceof BorealError) {
      throw new BorealError(
        error.code,
        error.message,
        {
          originalDetails: error.details,
          composite: {
            command: "agent finish",
            completed: false,
            partialMutation: false,
            resultingWork
          },
          domain: "work"
        },
        error.gaps
      );
    }
    throw error;
  }
}

async function idempotentAgentFinishResult(
  context: CliContext,
  workId: WorkId,
  agentId: string,
  args: ParsedArgs
): Promise<Record<string, unknown> | undefined> {
  const snapshot = await context.store.read(async (reader) => {
    const work = await reader.getWorkItem(workId);
    if (!work || work.status !== "closed") {
      return undefined;
    }
    const closed = await closedWorkMetadata(reader, work);
    const normalizedAgentId = normalizeActorId(agentId);
    if (closed.closedBy !== normalizedAgentId && String(work.meta.updatedBy.id) !== normalizedAgentId) {
      return undefined;
    }
    const summaries = await reader.listAgentSummariesForSubject(work.meta.id);
    const latestSummary = [...summaries].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)).at(0);
    return {
      work,
      closed,
      latestSummary,
      evidenceIds: latestSummary?.evidenceIds ?? work.evidenceIds,
      verificationIds: latestSummary?.verificationIds ?? work.verificationIds
    };
  });
  if (!snapshot) {
    return undefined;
  }
  const [evidence, verifications] = await context.store.read(async (reader) =>
    Promise.all([
      Promise.all(snapshot.evidenceIds.map((id) => reader.getEvidence(id))),
      Promise.all(snapshot.verificationIds.map((id) => reader.getVerification(id)))
    ])
  );
  const workView = await context.runtime.getWorkView(workId);
  return {
    finished: true,
    noop: true,
    action: "already_closed",
    agentId: normalizeActorId(agentId),
    work: workView,
    evidence: evidence.filter(isEvidenceRecord),
    verification: verifications.filter(isVerificationRecord),
    agentSummary: snapshot.latestSummary ? agentSummaryRow(snapshot.latestSummary) : undefined,
    existingSummary: snapshot.latestSummary ? agentSummaryRow(snapshot.latestSummary) : undefined,
    closedBy: snapshot.closed.closedBy,
    closedAt: snapshot.closed.closedAt,
    closingEventId: snapshot.closed.closingEventId,
    status: await buildAgentStatus(context, agentId, labelsFromArgs(args))
  };
}

async function assertWorkNotAlreadyClosedForAgentFinish(context: CliContext, workId: WorkId): Promise<void> {
  const closed = await context.store.read(async (reader) => {
    const work = await reader.getWorkItem(workId);
    return work?.status === "closed" ? closedWorkMetadata(reader, work) : undefined;
  });
  if (!closed) {
    return;
  }
  throw new BorealError("BOREAL_NOT_FOUND", "Work item is already closed", {
    workId,
    closedBy: closed.closedBy,
    closedAt: closed.closedAt,
    closingEventId: closed.closingEventId,
    domain: "work"
  });
}

async function captureGitFinishEvidence(
  context: CliContext,
  workId: WorkId,
  gitRoot?: string
): Promise<{ readonly evidence?: EvidenceRecord; readonly note?: string }> {
  const probe = await gitFinishProbe(gitRoot ?? context.cwd);
  if (!probe.insideWorktree) {
    return { note: probe.note ?? "No git worktree detected; finish continued without git evidence." };
  }
  if (probe.error) {
    return { note: `Git probe failed; finish continued without blocking: ${probe.error}` };
  }
  const dirtyStatus = probe.dirtyPaths.length > 0 ? "dirty" : "clean";
  const evidence = await context.runtime.recordEvidence({
    subjectId: workId,
    subjectType: "work",
    kind: "diff",
    outcome: "observed",
    summary: `Git finish evidence: HEAD ${probe.headSha ?? "unknown"} on ${probe.branch ?? "detached"} (${dirtyStatus}); root ${probe.root ?? context.cwd}`,
    command: "git rev-parse HEAD && git branch --show-current && git status --short",
    uri: probe.root
  });
  return { evidence };
}

async function removeGitWorktreeAfterFinish(
  context: CliContext,
  worktreePath: string | undefined
): Promise<{ readonly removed: boolean; readonly worktreePath?: string; readonly warning?: string } | undefined> {
  if (!worktreePath) {
    return {
      removed: false,
      warning: "No recorded worktreePath found on the reservation; nothing to remove."
    };
  }
  const removed = await runGit(context.workspaceRoot, ["worktree", "remove", worktreePath]);
  if (removed.ok) {
    return { removed: true, worktreePath };
  }
  return {
    removed: false,
    worktreePath,
    warning: removed.stderr.trim() || removed.error || "git worktree remove failed"
  };
}

async function gitFinishProbe(cwd: string): Promise<{
  readonly insideWorktree: boolean;
  readonly root?: string;
  readonly headSha?: string;
  readonly branch?: string;
  readonly dirtyPaths: readonly string[];
  readonly error?: string;
  readonly note?: string;
}> {
  const root = await runGitForFinish(cwd, ["rev-parse", "--show-toplevel"]);
  if (root.exitCode !== 0) {
    return {
      insideWorktree: false,
      dirtyPaths: [],
      note: root.stderr || root.stdout || "git rev-parse reported this directory is outside a worktree"
    };
  }
  const rootDir = root.stdout.trim();
  const [head, branch, status] = await Promise.all([
    runGitForFinish(rootDir, ["rev-parse", "HEAD"]),
    runGitForFinish(rootDir, ["branch", "--show-current"]),
    runGitForFinish(rootDir, ["status", "--short"])
  ]);
  const error = [head, branch, status].find((result) => result.exitCode !== 0);
  return {
    insideWorktree: true,
    root: rootDir,
    headSha: head.stdout.trim() || undefined,
    branch: branch.stdout.trim() || undefined,
    dirtyPaths: status.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean),
    error: error ? (error.stderr || error.stdout || `git exited ${error.exitCode}`) : undefined
  };
}

async function runGitForFinish(
  cwd: string,
  args: readonly string[]
): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  try {
    const result = await runBoundedProcess({
      command: "git",
      args,
      cwd,
      timeoutMs: 5_000,
      stdoutMaxBytes: 64 * 1024,
      stderrMaxBytes: 64 * 1024
    });
    return { exitCode: result.exitCode, stdout: result.stdout.text, stderr: result.stderr.text };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

async function idempotentWorkReleaseResult(context: CliContext, workId: WorkId): Promise<Record<string, unknown> | undefined> {
  const snapshot = await context.store.read(async (reader) => {
    const work = await reader.getWorkItem(workId);
    if (!work || work.reservationId) {
      return undefined;
    }
    const latestReleased = [...(await reader.listReservationsForWork(workId))]
      .filter((reservation) => reservation.status === "released")
      .sort((left, right) => right.meta.updatedAt.localeCompare(left.meta.updatedAt))
      .at(0);
    if (!latestReleased || String(latestReleased.agentId) !== String(context.actor.id)) {
      return undefined;
    }
    return { work, reservation: latestReleased };
  });
  if (!snapshot) {
    return undefined;
  }
  const postMutationWork = await context.runtime.getWorkView(workId);
  return {
    noop: true,
    work: snapshot.work,
    reservation: snapshot.reservation,
    postMutationWork
  };
}

async function closedWorkMetadata(
  reader: BorealReader,
  work: WorkItem
): Promise<{ readonly closedBy: string; readonly closedAt: IsoTimestamp; readonly closingEventId?: EventId }> {
  const events = (await reader.listEvents()).filter(
    (event) =>
      event.subjectId === work.meta.id &&
      (event.type === "work.closed" || event.type === "agent.finished")
  );
  const closing = [...events].sort((left, right) => right.meta.createdAt.localeCompare(left.meta.createdAt)).at(0);
  const payloadAgentId = closing && isRecord(closing.payload) && typeof closing.payload.agentId === "string"
    ? closing.payload.agentId
    : undefined;
  return {
    closedBy: normalizeActorId(payloadAgentId ?? String(closing?.meta.createdBy.id ?? work.meta.updatedBy.id)),
    closedAt: closing?.meta.createdAt ?? work.closedAt ?? work.meta.updatedAt,
    closingEventId: closing?.meta.id
  };
}

function isEvidenceRecord(value: EvidenceRecord | undefined): value is EvidenceRecord {
  return value !== undefined;
}

function isVerificationRecord(value: VerificationRecord | undefined): value is VerificationRecord {
  return value !== undefined;
}

async function doneAliasCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  return finishCurrentReservationCommand({
    context,
    args,
    output,
    json,
    close: true,
    release: false,
    verdict: "passed"
  });
}

async function pauseAliasCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  return finishCurrentReservationCommand({
    context,
    args,
    output,
    json,
    close: false,
    release: true,
    verdict: parseVerdict(flagValue(args, "verdict") ?? "failed")
  });
}

async function finishCurrentReservationCommand(input: {
  readonly context: CliContext;
  readonly args: ParsedArgs;
  readonly output: CliOutput;
  readonly json: boolean;
  readonly close: boolean;
  readonly release: boolean;
  readonly verdict: VerificationVerdict;
}): Promise<CommandResult> {
  const agentId = agentIdFromArgs(input.args, input.context.actor.id);
  const workId = await resolveWorkId(input.context, "current", { agentId });
  const closeReason = input.close ? requiredFlag(input.args, "reason") : undefined;
  const closeoutSummaryFactory = closeReason
    ? await agentFinishSummaryFactory(input.context, input.args, workId, closeReason)
    : undefined;
  const finishEvidence = await finishEvidenceInput(input.context, input.args, workId, input.verdict);
  const finished = await finishReservedWorkWithCompositeState(input.context, workId, {
    workId,
    agentId,
    ...(finishEvidence.evidenceId
      ? { evidenceId: finishEvidence.evidenceId }
      : { evidence: finishEvidence.evidence as NonNullable<typeof finishEvidence.evidence> }),
    verification: {
      verdict: input.verdict,
      notes: flagValue(input.args, "notes")
    },
    close: closeReason ? { reason: closeReason, agentSummary: closeoutSummaryFactory } : undefined,
    release: input.release
  });
  const closeoutSummaryArtifact = finished.agentSummary
    ? await writeAgentSummaryArtifact(input.context, finished.agentSummary)
    : undefined;
  const gitEvidence = await captureGitFinishEvidence(input.context, workId);

  const result = {
    finished: true,
    action: input.close ? "verified_and_closed" : "verified_and_released",
    agentId,
    work: await input.context.runtime.getWorkView(workId),
    evidence: finished.evidence,
    evidenceRefs: finishEvidence.evidenceRefs,
    inlineEvidence: finishEvidence.inlineEvidence,
    gitEvidence: gitEvidence.evidence,
    gitEvidenceNote: gitEvidence.note,
    verification: finished.verification,
    reservation: finished.reservation,
    closedWork: finished.closedWork,
    agentSummary: finished.agentSummary ? agentSummaryRow(finished.agentSummary) : undefined,
    agentSummaryArtifact: closeoutSummaryArtifact,
    release: finished.release,
    status: await buildAgentStatus(input.context, agentId, [])
  } satisfies AgentFinishResult;
  input.output.write(await formatRecordWithAgentDirectives(input.context, input.args, result, input.json, {
    subjectWork: finished.closedWork ?? finished.work
  }));
  return { exitCode: 0 };
}

async function heartbeatCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const name = heartbeatName(requiredPositional(rest, 0, "heartbeat name"));
      const reviewerId = reviewerIdFromArgs(args, context);
      const containerId = await optionalHeartbeatContainerId(context, args);
      const current = nowIso();
      const heartbeatId = heartbeatIdFor(name, reviewerId, containerId);
      const cursor = await heartbeatCursorFromArgs(context, args, containerId);
      const result = await context.store.write(async (writer) => {
        if (await writer.getReviewerHeartbeat(heartbeatId)) {
          throw new BorealError("BOREAL_CONFLICT", "Reviewer heartbeat already exists", {
            heartbeatId,
            name,
            reviewerId,
            containerId
          });
        }
        const heartbeat = withContentHash({
          meta: createRecordMeta({
            id: heartbeatId,
            now: current,
            actor: context.actor,
            tags: ["reviewer-heartbeat"]
          }),
          name,
          reviewerId,
          containerId,
          lastClosedAt: cursor.lastClosedAt,
          lastEventId: cursor.lastEventId,
          lastWorkId: cursor.lastWorkId,
          advancedAt: current
        } satisfies ReviewerHeartbeatRecord);
        await writer.putReviewerHeartbeat(heartbeat);
        const event = await appendCliEvent(writer, context, "reviewer_heartbeat.created", heartbeat.meta.id, "reviewer_heartbeat", {
          name,
          reviewerId,
          containerId,
          lastClosedAt: heartbeat.lastClosedAt,
          lastEventId: heartbeat.lastEventId,
          lastWorkId: heartbeat.lastWorkId
        }, current);
        return heartbeatPayload(context, heartbeat, event);
      });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "show": {
      const heartbeat = await resolveReviewerHeartbeat(context, requiredPositional(rest, 0, "heartbeat name or id"), args);
      output.write(formatRecord(heartbeatPayload(context, heartbeat), json));
      return { exitCode: 0 };
    }
    case "advance": {
      const target = requiredPositional(rest, 0, "heartbeat name or id");
      const current = nowIso();
      const existing = await resolveReviewerHeartbeat(context, target, args);
      const cursor = await heartbeatCursorFromArgs(context, args, existing.containerId, true);
      const result = await context.store.write(async (writer) => {
        const stored = await writer.getReviewerHeartbeat(existing.meta.id);
        if (!stored) {
          throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat not found", {
            heartbeatId: existing.meta.id,
            domain: "work"
          });
        }
        const heartbeat = withContentHash(
          touchRecord(
            {
              ...stored,
              lastClosedAt: cursor.lastClosedAt,
              lastEventId: cursor.lastEventId,
              lastWorkId: cursor.lastWorkId,
              advancedAt: current
            },
            current,
            context.actor
          )
        );
        await writer.putReviewerHeartbeat(heartbeat);
        const event = await appendCliEvent(writer, context, "reviewer_heartbeat.advanced", heartbeat.meta.id, "reviewer_heartbeat", {
          name: heartbeat.name,
          reviewerId: heartbeat.reviewerId,
          containerId: heartbeat.containerId,
          lastClosedAt: heartbeat.lastClosedAt,
          lastEventId: heartbeat.lastEventId,
          lastWorkId: heartbeat.lastWorkId
        }, current);
        return heartbeatPayload(context, heartbeat, event);
      });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown heartbeat command: ${action ?? ""}`);
  }
}

interface HeartbeatCursor {
  readonly lastClosedAt?: IsoTimestamp;
  readonly lastEventId?: EventId;
  readonly lastWorkId?: WorkId;
}

function heartbeatPayload(context: CliContext, heartbeat: ReviewerHeartbeatRecord, event?: RuntimeEvent) {
  return {
    schemaVersion: "boreal.cli.heartbeat.v1",
    generatedAt: nowIso(),
    workspaceRoot: context.workspaceRoot,
    heartbeat,
    sinceHeartbeat: {
      closedAt: heartbeat.lastClosedAt,
      eventId: heartbeat.lastEventId,
      workId: heartbeat.lastWorkId,
      includeEqualClosedAt: true
    },
    event
  };
}

function heartbeatName(value: string): string {
  return normalizeMachineString(value, "heartbeat name");
}

function reviewerIdFromArgs(args: ParsedArgs, context: CliContext): string {
  return normalizeActorId(flagValue(args, "reviewer") ?? flagValue(args, "agent") ?? String(context.actor.id));
}

function heartbeatIdFor(name: string, reviewerId: string, containerId: WorkId | undefined): ReviewerHeartbeatId {
  return deterministicId<ReviewerHeartbeatId>("heartbeat", {
    name,
    reviewerId,
    containerId: containerId ?? null
  });
}

async function optionalHeartbeatContainerId(context: CliContext, args: ParsedArgs): Promise<WorkId | undefined> {
  const containerRef = flagValue(args, "container");
  return containerRef ? resolveWorkId(context, containerRef) : undefined;
}

async function resolveReviewerHeartbeat(
  context: CliContext,
  value: string,
  args: ParsedArgs
): Promise<ReviewerHeartbeatRecord> {
  if (value.startsWith("bw_heartbeat_")) {
    const heartbeat = await context.store.read((reader) => reader.getReviewerHeartbeat(asReviewerHeartbeatId(value)));
    if (!heartbeat) {
      throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat not found", { heartbeatId: value, domain: "work" });
    }
    return heartbeat;
  }
  const name = heartbeatName(value);
  const reviewerId = reviewerIdFromArgs(args, context);
  const containerId = await optionalHeartbeatContainerId(context, args);
  const heartbeatId = heartbeatIdFor(name, reviewerId, containerId);
  const heartbeat = await context.store.read((reader) => reader.getReviewerHeartbeat(heartbeatId));
  if (!heartbeat) {
    throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat not found", {
      heartbeatId,
      name,
      reviewerId,
      containerId,
      domain: "work"
    });
  }
  return heartbeat;
}

async function heartbeatCursorFromArgs(
  context: CliContext,
  args: ParsedArgs,
  containerId: WorkId | undefined,
  defaultToLatest = false
): Promise<HeartbeatCursor> {
  const workRef = flagValue(args, "work");
  const closedAtValue = flagValue(args, "closed-at");
  const eventValue = flagValue(args, "event");
  if (workRef && closedAtValue) {
    throw new BorealError("BOREAL_INVALID_INPUT", "heartbeat cursor cannot combine --work with --closed-at");
  }

  if (workRef) {
    const workId = await resolveWorkId(context, workRef);
    return context.store.read(async (reader) => {
      const [work, graphEdges, events] = await Promise.all([
        reader.getWorkItem(workId),
        reader.listGraphEdges(),
        reader.listEvents()
      ]);
      if (!work) {
        throw new BorealError("BOREAL_NOT_FOUND", "Heartbeat work cursor not found", { workId, domain: "work" });
      }
      if (!work.closedAt) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Heartbeat work cursor must reference closed work", {
          workId,
          status: work.status
        });
      }
      await assertWorkInHeartbeatScope(reader, work.meta.id, containerId, graphEdges);
      const explicitEventId = eventValue ? asEventId(eventValue) : undefined;
      if (explicitEventId && !events.some((event) => event.meta.id === explicitEventId)) {
        throw new BorealError("BOREAL_NOT_FOUND", "Heartbeat event cursor not found", {
          eventId: explicitEventId,
          domain: "work"
        });
      }
      const eventId = explicitEventId ?? workClosedEventId(events, work.meta.id);
      return {
        lastClosedAt: work.closedAt,
        lastEventId: eventId,
        lastWorkId: work.meta.id
      };
    });
  }

  const explicitClosedAt = closedAtValue ? parseHeartbeatIsoTimestamp(closedAtValue, "--closed-at") : undefined;
  const explicitEventId = eventValue ? asEventId(eventValue) : undefined;
  if (explicitEventId) {
    await context.store.read(async (reader) => {
      if (!(await reader.listEvents()).some((event) => event.meta.id === explicitEventId)) {
        throw new BorealError("BOREAL_NOT_FOUND", "Heartbeat event cursor not found", {
          eventId: explicitEventId,
          domain: "work"
        });
      }
    });
  }
  if (explicitClosedAt || explicitEventId) {
    return {
      lastClosedAt: explicitClosedAt,
      lastEventId: explicitEventId
    };
  }
  return defaultToLatest ? latestClosedHeartbeatCursor(context, containerId) : {};
}

async function latestClosedHeartbeatCursor(context: CliContext, containerId: WorkId | undefined): Promise<HeartbeatCursor> {
  return context.store.read(async (reader) => {
    const [workItems, graphEdges, events] = await Promise.all([
      reader.listWorkItems(),
      reader.listGraphEdges(),
      reader.listEvents()
    ]);
    const scopedIds = containerId ? heartbeatScopeIds(containerId, workItems, graphEdges) : undefined;
    const latest = workItems
      .filter((work) => work.closedAt && (!scopedIds || scopedIds.has(work.meta.id)))
      .sort(compareClosedWorkWatermark)
      .at(0);
    if (!latest?.closedAt) {
      return {};
    }
    return {
      lastClosedAt: latest.closedAt,
      lastEventId: workClosedEventId(events, latest.meta.id),
      lastWorkId: latest.meta.id
    };
  });
}

async function assertWorkInHeartbeatScope(
  reader: BorealReader,
  workId: WorkId,
  containerId: WorkId | undefined,
  graphEdges: readonly GraphEdge[]
): Promise<void> {
  if (!containerId) {
    return;
  }
  const workItems = await reader.listWorkItems();
  const scopedIds = heartbeatScopeIds(containerId, workItems, graphEdges);
  if (!scopedIds.has(workId)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Heartbeat work cursor is outside the container scope", {
      workId,
      containerId
    });
  }
}

function heartbeatScopeIds(containerId: WorkId, workItems: readonly WorkItem[], graphEdges: readonly GraphEdge[]): ReadonlySet<WorkId> {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const ids = new Set<WorkId>([containerId]);
  const visit = (workId: WorkId): void => {
    const work = workById.get(workId);
    if (!work) {
      return;
    }
    for (const dependencyId of dependencyIdsForWork(work, graphEdges)) {
      if (ids.has(dependencyId)) {
        continue;
      }
      ids.add(dependencyId);
      visit(dependencyId);
    }
  };
  visit(containerId);
  return ids;
}

async function optionalContainerIdFromArgs(context: CliContext, args: ParsedArgs): Promise<WorkId | undefined> {
  const container = flagValue(args, "container");
  return container ? resolveWorkId(context, container) : undefined;
}

async function containerScopeIds(context: CliContext, containerId: WorkId): Promise<ReadonlySet<WorkId>> {
  return context.store.read(async (reader) => {
    const [workItems, graphEdges] = await Promise.all([reader.listWorkItems(), reader.listGraphEdges()]);
    return heartbeatScopeIds(containerId, workItems, graphEdges);
  });
}

function workClosedEventId(events: readonly RuntimeEvent[], workId: WorkId): EventId | undefined {
  return events
    .filter((event) => event.type === "work.closed" && event.subjectId === workId)
    .sort((left, right) => right.meta.createdAt.localeCompare(left.meta.createdAt) || right.meta.id.localeCompare(left.meta.id))
    .at(0)?.meta.id;
}

function compareClosedWorkWatermark(left: WorkItem, right: WorkItem): number {
  return (
    (right.closedAt ?? "").localeCompare(left.closedAt ?? "") ||
    right.meta.id.localeCompare(left.meta.id)
  );
}

type RecentClosedOrder = "asc" | "desc";

interface RecentClosedCursor {
  readonly value: string;
  readonly source: "iso" | "checkpoint";
  readonly closedAt?: IsoTimestamp;
  readonly eventId?: EventId;
  readonly workId?: WorkId;
  readonly includeEqualClosedAt: boolean;
}

async function recentClosedWorkCommand(context: CliContext, args: ParsedArgs) {
  const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
  const order = parseRecentClosedOrder(flagValue(args, "order"));
  const since = parseRecentClosedSince(flagValue(args, "since"));
  const after = await recentClosedCursorFromArgs(context, flagValue(args, "after"));
  const kind = parseRecentClosedKind(flagValue(args, "kind"));
  const phase = hasFlag(args, "phase");
  if (phase && kind && kind !== "milestone") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--phase can only be combined with --kind milestone");
  }
  const containerId = flagValue(args, "container")
    ? await resolveWorkId(context, requiredFlag(args, "container"))
    : undefined;
  const snapshot = await context.store.read(async (reader) => ({
    workItems: await reader.listWorkItems(),
    graphEdges: await reader.listGraphEdges(),
    events: await reader.listEvents()
  }));
  const scopedIds = containerId ? heartbeatScopeIds(containerId, snapshot.workItems, snapshot.graphEdges) : undefined;
  const rows = snapshot.workItems
    .filter((work): work is WorkItem & { readonly status: "closed"; readonly closedAt: IsoTimestamp } =>
      work.status === "closed" && work.closedAt !== undefined
    )
    .filter((work) => !kind || work.kind === kind)
    .filter((work) => !phase || (work.kind === "milestone" && work.labels.includes("phase")))
    .filter((work) => !scopedIds || scopedIds.has(work.meta.id))
    .filter((work) => !since || work.closedAt >= since)
    .filter((work) => recentClosedWorkIsAfterCursor(work, after))
    .map((work) => recentClosedWorkRow(work, snapshot.events))
    .sort((left, right) => compareRecentClosedRows(left, right, order))
    .slice(0, limit);
  return {
    schemaVersion: "boreal.cli.work.recent_closed.v1",
    generatedAt: nowIso(),
    workspaceRoot: context.workspaceRoot,
    filters: {
      since,
      after,
      containerId,
      kind,
      phase,
      order,
      limit
    },
    items: rows
  };
}

async function reviewCandidatesCommand(context: CliContext, args: ParsedArgs) {
  const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
  const order = parseRecentClosedOrder(flagValue(args, "order"));
  const since = parseRecentClosedSince(flagValue(args, "since"));
  const after = await recentClosedCursorFromArgs(context, flagValue(args, "after"));
  const kind = parseRecentClosedKind(flagValue(args, "kind"));
  const phase = hasFlag(args, "phase");
  const includeOptional = hasFlag(args, "include-optional");
  const reviewStatus = parseReviewCandidateStatus(flagValue(args, "review-status"));
  if (phase && kind && kind !== "milestone") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--phase can only be combined with --kind milestone");
  }
  const containerId = flagValue(args, "container")
    ? await resolveWorkId(context, requiredFlag(args, "container"))
    : undefined;
  const snapshot = await context.store.read(async (reader) => ({
    workItems: await reader.listWorkItems(),
    graphEdges: await reader.listGraphEdges(),
    events: await reader.listEvents(),
    evidence: await reader.listEvidence(),
    verifications: await reader.listVerifications(),
    summaries: await reader.listAgentSummaries()
  }));
  const scopedIds = containerId ? heartbeatScopeIds(containerId, snapshot.workItems, snapshot.graphEdges) : undefined;
  const allCandidates = snapshot.workItems
    .filter((work): work is WorkItem & { readonly status: "closed"; readonly closedAt: IsoTimestamp } =>
      work.status === "closed" && work.closedAt !== undefined
    )
    .filter((work) => !kind || work.kind === kind)
    .filter((work) => !phase || (work.kind === "milestone" && work.labels.includes("phase")))
    .filter((work) => !scopedIds || scopedIds.has(work.meta.id))
    .filter((work) => !since || work.closedAt >= since)
    .filter((work) => recentClosedWorkIsAfterCursor(work, after))
    .map((work) => reviewCandidateRow(work, snapshot, after))
    .filter((row): row is ReviewCandidateRow => row !== undefined && (includeOptional || row.reviewStatus !== "optional"))
    .sort((left, right) => compareRecentClosedRows(left, right, order));
  const rows = allCandidates
    .filter((row) => reviewStatus === "all" || row.reviewStatus === reviewStatus)
    .slice(0, limit);
  return {
    schemaVersion: "boreal.cli.work.review_candidates.v1",
    generatedAt: nowIso(),
    workspaceRoot: context.workspaceRoot,
    filters: {
      since,
      after,
      containerId,
      kind,
      phase,
      includeOptional,
      reviewStatus,
      order,
      limit
    },
    summary: {
      total: allCandidates.length,
      returned: rows.length,
      pending: allCandidates.filter((row) => row.reviewStatus === "pending").length,
      passed: allCandidates.filter((row) => row.reviewStatus === "passed").length,
      forced: allCandidates.filter((row) => row.reviewStatus === "forced").length,
      optional: allCandidates.filter((row) => row.reviewStatus === "optional").length,
      reviewGates: reviewGateSummaryFromStatuses(allCandidates.map((row) => row.closeoutGateStatus))
    },
    optionalRecentClosedCommand: recentClosedCommandForFilters({ since, after, containerId, kind, phase, order, limit }),
    items: rows
  };
}

function recentClosedWorkRow(work: WorkItem & { readonly status: "closed"; readonly closedAt: IsoTimestamp }, events: readonly RuntimeEvent[]): RecentClosedWorkRow {
  return {
    id: work.meta.id,
    title: work.title,
    kind: work.kind,
    status: work.status,
    closedAt: work.closedAt,
    closedReason: work.closedReason,
    labels: [...work.labels],
    evidenceCount: work.evidenceIds.length,
    verificationCount: work.verificationIds.length,
    closedEventId: workClosedEventId(events, work.meta.id)
  };
}

function reviewCandidateRow(
  work: WorkItem & { readonly status: "closed"; readonly closedAt: IsoTimestamp },
  snapshot: {
    readonly workItems: readonly WorkItem[];
    readonly graphEdges: readonly GraphEdge[];
    readonly events: readonly RuntimeEvent[];
    readonly evidence: readonly EvidenceRecord[];
    readonly verifications: readonly VerificationRecord[];
    readonly summaries: readonly AgentSummaryRecord[];
  },
  after: RecentClosedCursor | undefined
): ReviewCandidateRow | undefined {
  const closeoutGateStatus = closeoutGateStatusFromSnapshot(
    work,
    snapshot.workItems,
    snapshot.graphEdges,
    snapshot.evidence,
    snapshot.verifications,
    snapshot.summaries
  );
  const gateCounts = reviewGateSummaryFromStatus(closeoutGateStatus);
  const reviewStatus = reviewCandidateStatus(closeoutGateStatus);
  if (!reviewStatus) {
    return undefined;
  }
  const reviewGates = closeoutGateStatus.requiredGates.filter(isReviewCandidateGate);
  return {
    ...recentClosedWorkRow(work, snapshot.events),
    reviewStatus,
    reviewGateCounts: gateCounts,
    pendingGateIds: reviewGates.filter((gate) => gate.status === "open").map((gate) => gate.id),
    passedGateIds: reviewGates.filter((gate) => gate.status === "satisfied").map((gate) => gate.id),
    forcedGateIds: reviewGates.filter((gate) => gate.status === "forced").map((gate) => gate.id),
    reviewEvidenceCommand: `bwrk evidence add ${shellArg(work.meta.id)} --kind review --outcome passed --summary ${shellArg(`review passed for ${work.title}`)} --json`,
    heartbeatAdvanceCommand: after?.source === "checkpoint" ? `bwrk heartbeat advance ${shellArg(after.value)} --work ${shellArg(work.meta.id)} --json` : undefined,
    closeoutGateStatus
  };
}

function reviewCandidateStatus(status: CloseoutGateStatusView): ReviewCandidateStatus | undefined {
  const reviewGates = status.requiredGates.filter(isReviewCandidateGate);
  if (reviewGates.length === 0) {
    return "optional";
  }
  if (reviewGates.some((gate) => gate.status === "open")) {
    return "pending";
  }
  if (reviewGates.some((gate) => gate.status === "forced")) {
    return "forced";
  }
  return "passed";
}

function isReviewCandidateGate(gate: Pick<CloseoutGateStatusRow, "kind">): boolean {
  return gate.kind === "review" || gate.kind === "audit";
}

function recentClosedWorkIsAfterCursor(work: WorkItem & { readonly closedAt: IsoTimestamp }, cursor: RecentClosedCursor | undefined): boolean {
  if (!cursor?.closedAt) {
    return true;
  }
  if (work.closedAt > cursor.closedAt) {
    return true;
  }
  if (work.closedAt < cursor.closedAt) {
    return false;
  }
  if (!cursor.includeEqualClosedAt) {
    return false;
  }
  if (!cursor.workId) {
    return true;
  }
  return work.meta.id.localeCompare(cursor.workId) > 0;
}

function compareRecentClosedRows(left: RecentClosedWorkRow, right: RecentClosedWorkRow, order: RecentClosedOrder): number {
  const ascending = left.closedAt.localeCompare(right.closedAt) || left.id.localeCompare(right.id);
  return order === "asc" ? ascending : -ascending;
}

function textRecentClosedWorkRow(row: RecentClosedWorkRow) {
  return {
    id: row.id,
    kind: row.kind,
    closedAt: row.closedAt,
    evidence: row.evidenceCount,
    verification: row.verificationCount,
    title: row.title
  };
}

function textReviewCandidateRow(row: ReviewCandidateRow) {
  return {
    id: row.id,
    status: row.reviewStatus,
    review: `${row.reviewGateCounts.review.pending}/${row.reviewGateCounts.review.passed}/${row.reviewGateCounts.review.forced}`,
    audit: `${row.reviewGateCounts.audit.pending}/${row.reviewGateCounts.audit.passed}/${row.reviewGateCounts.audit.forced}`,
    closedAt: row.closedAt,
    title: row.title
  };
}

function parseRecentClosedOrder(value: string | undefined): RecentClosedOrder {
  if (!value || value === "desc") {
    return "desc";
  }
  if (value === "asc") {
    return "asc";
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--order must be asc or desc");
}

function parseRecentClosedKind(value: string | undefined): WorkKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "issue" || value === "task" || value === "sprint" || value === "milestone") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be issue, task, sprint, or milestone");
}

function parseReviewCandidateStatus(value: string | undefined): ReviewCandidateStatus | "all" {
  if (!value) {
    return "pending";
  }
  if (value === "pending" || value === "passed" || value === "forced" || value === "optional" || value === "all") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--review-status must be pending, passed, forced, optional, or all");
}

function parseRecentClosedSince(value: string | undefined): IsoTimestamp | undefined {
  if (!value) {
    return undefined;
  }
  if (isIsoTimestamp(value)) {
    return value as IsoTimestamp;
  }
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--since must be an ISO timestamp or positive duration like 30m, 2h, or 1d");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() - amount * multiplier).toISOString() as IsoTimestamp;
}

async function recentClosedCursorFromArgs(context: CliContext, value: string | undefined): Promise<RecentClosedCursor | undefined> {
  if (!value) {
    return undefined;
  }
  if (isIsoTimestamp(value)) {
    return {
      value,
      source: "iso",
      closedAt: value as IsoTimestamp,
      includeEqualClosedAt: false
    };
  }
  if (!value.startsWith("bw_heartbeat_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--after must be an ISO timestamp or reviewer heartbeat checkpoint id");
  }
  const heartbeat = await context.store.read((reader) => reader.getReviewerHeartbeat(asReviewerHeartbeatId(value)));
  if (!heartbeat) {
    throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat checkpoint not found", {
      checkpointId: value,
      domain: "work"
    });
  }
  return {
    value,
    source: "checkpoint",
    closedAt: heartbeat.lastClosedAt,
    eventId: heartbeat.lastEventId,
    workId: heartbeat.lastWorkId,
    includeEqualClosedAt: true
  };
}

function recentClosedCommandForFilters(input: {
  readonly since: IsoTimestamp | undefined;
  readonly after: RecentClosedCursor | undefined;
  readonly containerId: WorkId | undefined;
  readonly kind: WorkKind | undefined;
  readonly phase: boolean;
  readonly order: RecentClosedOrder;
  readonly limit: number;
}): string {
  const args = ["bwrk", "work", "recent-closed"];
  if (input.containerId) args.push("--container", input.containerId);
  if (input.after) args.push("--after", input.after.value);
  if (input.since) args.push("--since", input.since);
  if (input.kind) args.push("--kind", input.kind);
  if (input.phase) args.push("--phase");
  args.push("--order", input.order, "--limit", String(input.limit), "--json");
  return args.map(shellArg).join(" ");
}

function readyWorkCommandRow(
  view: WorkItemView,
  input: {
    readonly containerId?: WorkId;
    readonly lineage?: readonly WorkLineageEntry[];
    readonly labels: readonly string[];
    readonly agentId: string;
    readonly purpose?: string;
    readonly sessionId?: string;
  }
): WorkListRow {
  const workId = asWorkId(view.id);
  const row = workViewListRow(view, input.containerId, input.lineage);
  return {
    ...row,
    agentId: input.agentId,
    showCommand: bwrkCommand(["work", "show", workId, ...sessionArgs(input.sessionId), "--json"]),
    agentStartCommand: bwrkCommand([
      "agent",
      "start",
      workId,
      ...sessionArgs(input.sessionId),
      "--agent",
      input.agentId,
      ...repeatedFlagArgs("label", input.labels),
      ...namedFlagArgs("container", input.containerId),
      ...namedFlagArgs("purpose", input.purpose),
      "--json"
    ]),
    workClaimCommand: bwrkCommand([
      "work",
      "claim",
      workId,
      ...sessionArgs(input.sessionId),
      "--agent",
      input.agentId,
      ...repeatedFlagArgs("label", input.labels),
      ...namedFlagArgs("container", input.containerId),
      ...namedFlagArgs("purpose", input.purpose),
      "--json"
    ])
  };
}

function buildWorkParallelResult(input: {
  readonly context: CliContext;
  readonly args: ParsedArgs;
  readonly labels: readonly string[];
  readonly containerId?: WorkId;
  readonly limit: number;
  readonly views: readonly WorkItemView[];
  readonly lineageById: ReadonlyMap<WorkId, readonly WorkLineageEntry[]>;
}): WorkParallelResult {
  const purpose = flagValue(input.args, "purpose");
  const explicitSessionId = flagValue(input.args, "session");
  const agentSelection = workParallelAgentSelection(input.context, input.args);
  const items = input.views.map((view, index) =>
    readyWorkCommandRow(view, {
      containerId: input.containerId,
      lineage: input.lineageById.get(asWorkId(view.id)) ?? [],
      labels: input.labels,
      agentId: agentSelection.agentIdForIndex(index),
      purpose,
      sessionId: explicitSessionId
    })
  );
  return {
    schemaVersion: "boreal.cli.work.parallel.v1",
    generatedAt: nowIso(),
    workspaceRoot: input.context.workspaceRoot,
    filters: {
      labels: input.labels,
      ...(input.containerId ? { containerId: input.containerId } : {}),
      limit: input.limit,
      ...(purpose ? { purpose } : {}),
      agentMode: agentSelection.mode
    },
    items,
    commands: {
      rerunCommand: workParallelCommandForFilters({
        labels: input.labels,
        containerId: input.containerId,
        limit: input.limit,
        purpose,
        sessionId: explicitSessionId,
        agentValues: agentSelection.agentValues,
        agentPrefix: agentSelection.agentPrefix
      }),
      reservationListCommand: bwrkCommand([
        "reservation",
        "list",
        ...sessionArgs(explicitSessionId),
        "--status",
        "active",
        "--json"
      ])
    }
  };
}

function workParallelAgentSelection(
  context: CliContext,
  args: ParsedArgs
): {
  readonly mode: WorkParallelResult["filters"]["agentMode"];
  readonly agentValues: readonly string[];
  readonly agentPrefix?: string;
  agentIdForIndex(index: number): string;
} {
  const agentValues = flagValues(args, "agent").map((value) => normalizeActorId(value));
  const agentPrefix = flagValue(args, "agent-prefix");
  if (agentValues.length > 0 && agentPrefix) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Use either --agent or --agent-prefix, not both");
  }
  if (agentPrefix) {
    return {
      mode: "prefix",
      agentValues: [],
      agentPrefix,
      agentIdForIndex(index) {
        return normalizeActorId(`${agentPrefix}-${index + 1}`);
      }
    };
  }
  if (agentValues.length > 1) {
    return {
      mode: "round_robin",
      agentValues,
      agentIdForIndex(index) {
        return agentValues[index % agentValues.length] ?? normalizeActorId(String(context.actor.id));
      }
    };
  }
  if (agentValues.length === 1) {
    const agentId = agentValues[0] ?? normalizeActorId(String(context.actor.id));
    return {
      mode: "single",
      agentValues,
      agentIdForIndex() {
        return agentId;
      }
    };
  }
  const defaultAgentId = normalizeActorId(String(context.actor.id));
  return {
    mode: "default",
    agentValues: [defaultAgentId],
    agentIdForIndex() {
      return defaultAgentId;
    }
  };
}

function workParallelCommandForFilters(input: {
  readonly labels: readonly string[];
  readonly containerId?: WorkId;
  readonly limit: number;
  readonly purpose?: string;
  readonly sessionId?: string;
  readonly agentValues: readonly string[];
  readonly agentPrefix?: string;
}): string {
  return bwrkCommand([
    "work",
    "parallel",
    ...sessionArgs(input.sessionId),
    ...repeatedFlagArgs("label", input.labels),
    ...namedFlagArgs("container", input.containerId),
    "--limit",
    String(input.limit),
    ...repeatedFlagArgs("agent", input.agentValues),
    ...namedFlagArgs("agent-prefix", input.agentPrefix),
    ...namedFlagArgs("purpose", input.purpose),
    "--json"
  ]);
}

function bwrkCommand(args: readonly string[]): string {
  return ["bwrk", ...args].map(shellArg).join(" ");
}

async function workLineageByIdFromStore(context: CliContext): Promise<ReadonlyMap<WorkId, readonly WorkLineageEntry[]>> {
  return context.store.read(async (reader) => {
    const [workItems, graphEdges] = await Promise.all([reader.listWorkItems(), reader.listGraphEdges()]);
    return workLineageById(workItems, graphEdges);
  });
}

function sessionArgs(sessionId: string | undefined): readonly string[] {
  return sessionId ? ["--session", sessionId] : [];
}

function namedFlagArgs(name: string, value: string | undefined): readonly string[] {
  return value ? [`--${name}`, value] : [];
}

function repeatedFlagArgs(name: string, values: readonly string[]): readonly string[] {
  return values.flatMap((value) => [`--${name}`, value]);
}

async function claimExactWork(
  context: CliContext,
  input: {
    readonly workId: WorkId;
    readonly agentId: string;
    readonly labels: readonly string[];
    readonly containerId?: WorkId;
    readonly purpose?: string;
    readonly expiresAt?: IsoTimestamp;
  }
): Promise<Awaited<ReturnType<CliContext["runtime"]["claimWork"]>>> {
  await assertExactClaimMatchesFilters(context, input.workId, input.labels, input.containerId);
  return context.runtime.claimWork({
    workId: input.workId,
    agentId: input.agentId,
    purpose: input.purpose,
    expiresAt: input.expiresAt
  });
}

type ClaimResult = Awaited<ReturnType<CliContext["runtime"]["claimWork"]>>;

type GitBranchAttachment =
  | {
      readonly status: "recorded";
      readonly branch: string;
      readonly baseSha: string;
      readonly worktreePath?: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: "git_unavailable" | "not_git_repository" | "detached_head" | "head_unavailable";
    };

async function attachGitBranchForClaim(
  context: CliContext,
  args: ParsedArgs,
  claim: ClaimResult
): Promise<{ readonly reservation: AgentReservation; readonly gitBranch?: GitBranchAttachment }> {
  try {
    if (hasFlag(args, "no-branch")) {
      return { reservation: claim.reservation };
    }

    const root = await runGit(context.workspaceRoot, ["rev-parse", "--show-toplevel"]);
    if (!root.ok) {
      return {
        reservation: claim.reservation,
        gitBranch: {
          status: "skipped",
          reason: isMissingGit(root) ? "git_unavailable" : "not_git_repository"
        }
      };
    }

    const repoRoot = root.stdout.trim();
    const currentBranch = await runGit(context.workspaceRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const targetBranch = workBranchName(claim.work);
    if (hasFlag(args, "worktree")) {
      return attachGitWorktreeForClaim(context, claim, repoRoot);
    }

    if (!currentBranch.ok || currentBranch.stdout.trim().length === 0) {
      return {
        reservation: claim.reservation,
        gitBranch: {
          status: "skipped",
          reason: "detached_head"
        }
      };
    }

    if (currentBranch.stdout.trim() !== targetBranch) {
      const existing = await runGit(context.workspaceRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${targetBranch}`]);
      const switched = existing.ok
        ? await runGit(context.workspaceRoot, ["switch", targetBranch])
        : await runGit(context.workspaceRoot, ["switch", "-c", targetBranch]);
      if (!switched.ok) {
        throw new BorealError("BOREAL_CONFLICT", "Unable to switch to work branch", {
          branch: targetBranch,
          stderr: switched.stderr.trim(),
          error: switched.error
        });
      }
    }

    const head = await runGit(context.workspaceRoot, ["rev-parse", "HEAD"]);
    if (!head.ok || head.stdout.trim().length === 0) {
      return {
        reservation: claim.reservation,
        gitBranch: {
          status: "skipped",
          reason: "head_unavailable"
        }
      };
    }

    const git = {
      branch: targetBranch,
      baseSha: head.stdout.trim()
    };
    const reservation = await context.runtime.attachReservationGit({
      reservationId: claim.reservation.meta.id,
      git
    });
    return {
      reservation,
      gitBranch: {
        status: "recorded",
        ...git
      }
    };
  } catch (error) {
    await context.runtime.releaseWorkReservation(claim.work.meta.id).catch(() => undefined);
    throw error;
  }
}

async function attachGitWorktreeForClaim(
  context: CliContext,
  claim: ClaimResult,
  repoRoot: string
): Promise<{ readonly reservation: AgentReservation; readonly gitBranch?: GitBranchAttachment }> {
  let prepared: PreparedGitWorktree | undefined;
  try {
    prepared = await prepareGitWorktree(repoRoot, claim.work);
    const reservation = await context.runtime.attachReservationGit({
      reservationId: claim.reservation.meta.id,
      git: prepared.git
    });
    return {
      reservation,
      gitBranch: {
        status: "recorded",
        ...prepared.git
      }
    };
  } catch (error) {
    if (prepared) {
      await removePreparedGitWorktree(prepared).catch(() => undefined);
    }
    throw error;
  }
}

async function agentFinishGitPreflight(
  context: CliContext,
  workId: WorkId,
  agentId: string
): Promise<NonNullable<WorkItem["git"]> | undefined> {
  const normalizedAgentId = normalizeActorId(agentId);
  const reservation = await context.store.read(async (reader) => {
    const work = await reader.getWorkItem(workId);
    const activeReservations = (await reader.listReservationsForWork(workId)).filter((candidate) => candidate.status === "active");
    return work?.reservationId
      ? activeReservations.find((candidate) => candidate.meta.id === work.reservationId)
      : activeReservations.find((candidate) => String(candidate.agentId) === normalizedAgentId);
  });
  if (!reservation?.git) {
    return undefined;
  }

  const gitRoot = reservation.git.worktreePath ?? context.workspaceRoot;
  const branch = await runGit(gitRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const currentBranch = branch.ok ? branch.stdout.trim() : "HEAD";
  if (currentBranch !== reservation.git.branch) {
    const gap: EnforcementGap = {
      code: "git.branch-mismatch",
      subjectType: "work",
      subjectId: workId,
      data: {
        observed: [currentBranch],
        reason: `finish must run from recorded work branch ${reservation.git.branch}`,
        ...(reservation.git.worktreePath ? { worktreePath: reservation.git.worktreePath } : {})
      }
    };
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Agent finish must verify the recorded work branch",
      {
        workId,
        reservationId: reservation.meta.id,
        expectedBranch: reservation.git.branch,
        actualBranch: currentBranch,
        ...(reservation.git.worktreePath ? { worktreePath: reservation.git.worktreePath } : {}),
        repairCommand: reservation.git.worktreePath
          ? `git -C ${reservation.git.worktreePath} switch ${reservation.git.branch}`
          : `git switch ${reservation.git.branch}`,
        gaps: [gap],
        domain: "work"
      },
      [gap]
    );
  }

  const dirty = await runGit(gitRoot, ["status", "--porcelain", "--untracked-files=no"]);
  const dirtyPaths = dirty.ok ? dirty.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean) : [];
  if (dirtyPaths.length > 0) {
    const gap: EnforcementGap = {
      code: "git.checkpoint.required",
      subjectType: "work",
      subjectId: workId,
      data: {
        reason: "recorded worktree has uncommitted tracked changes",
        observed: dirtyPaths
      }
    };
    throw new BorealError(
      "BOREAL_POLICY_VIOLATION",
      "Agent finish requires a clean recorded worktree",
      {
        workId,
        reservationId: reservation.meta.id,
        dirtyPaths,
        gitRoot,
        branch: reservation.git.branch,
        ...(reservation.git.worktreePath ? { worktreePath: reservation.git.worktreePath } : {}),
        gaps: [gap],
        domain: "work"
      },
      [gap]
    );
  }

  const head = await runGit(gitRoot, ["rev-parse", "HEAD"]);
  if (!head.ok || head.stdout.trim().length === 0) {
    return undefined;
  }
  return {
    branch: reservation.git.branch,
    headSha: head.stdout.trim(),
    ...(reservation.git.worktreePath ? { worktreePath: reservation.git.worktreePath } : {})
  };
}

async function assertExactClaimMatchesFilters(
  context: CliContext,
  workId: WorkId,
  labels: readonly string[],
  containerId: WorkId | undefined
): Promise<void> {
  const view = await context.runtime.getWorkView(workId);
  const missingLabels = labels.filter((label) => !view.labels.includes(label));
  if (missingLabels.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Exact work claim does not match --label filters", {
      workId,
      missingLabels
    });
  }
  if (!containerId) {
    return;
  }
  const scopedIds = await containerScopeIds(context, containerId);
  if (!scopedIds.has(workId)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Exact work claim is outside the container scope", {
      workId,
      containerId
    });
  }
}

function parseHeartbeatIsoTimestamp(value: string, label: string): IsoTimestamp {
  if (!isIsoTimestamp(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be an ISO timestamp`, { value });
  }
  return value as IsoTimestamp;
}

async function buildAgentStatus(
  context: CliContext,
  agentId: string,
  labels: readonly string[]
): Promise<AgentStatus> {
  const normalizedAgentId = normalizeActorId(agentId);
  const normalizedLabels = normalizeLabels(labels);
  const now = Date.now();
  const maxActiveReservations = context.runtime.policy.maxActiveReservationsPerAgent;
  return context.store.read(async (reader) => {
    const [reservations, workItems, graphEdges] = await Promise.all([
      reader.listReservations(),
      reader.listWorkItems(),
      reader.listGraphEdges()
    ]);
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    const reservationRows = reservations.map((reservation) => reservationListRow(reservation, workById.get(reservation.workId), now));
    const active = reservationRows
      .filter((row) => row.agentId === normalizedAgentId && row.status === "active")
      .sort(compareReservationRows);
    const expiredActive = active.filter((row) => row.expired);
    const claimableWork = [...claimableWorkItems(workItems, normalizedLabels, graphEdges)].sort(compareWorkItems);
    const capacityRemaining = Math.max(0, maxActiveReservations - active.length);

    return {
      agentId: normalizedAgentId,
      labels: normalizedLabels,
      policy: {
        maxActiveReservations
      },
      reservations: {
        activeCount: active.length,
        expiredActiveCount: expiredActive.length,
        capacityRemaining,
        active,
        expiredActive
      },
      readyWork: {
        claimableCount: claimableWork.length,
        next: claimableWork[0] ? workListRow(claimableWork[0]) : undefined
      },
      recommendedAction: recommendedAgentAction({
        agentId: normalizedAgentId,
        labels: normalizedLabels,
        active,
        expiredActive,
        capacityRemaining,
        claimableWork
      })
    };
  });
}

async function editWorkCommand(context: CliContext, workId: WorkId, args: ParsedArgs) {
  const title = flagValue(args, "title");
  const description = flagValue(args, "description");
  const kind = parseWorkKind(flagValue(args, "kind"));
  const priority = parsePriority(flagValue(args, "priority"));
  const labels = flagValues(args, "label");
  const acceptanceCriteria = flagValues(args, "acceptance");
  const requiredCloseoutGateInputs = requiredCloseoutGateInputsFromArgs(args);
  const clearRequiredCloseoutGates = hasFlag(args, "clear-required-gates");
  const forceGateRefs = flagValues(args, "force-gate");
  const forceGateReason = flagValue(args, "force-gate-reason");
  const forceGateComment = flagValue(args, "force-gate-comment");
  const forceGateEvidenceIds = flagValues(args, "force-gate-evidence").map(asEvidenceId);
  if (
    title === undefined &&
    description === undefined &&
    kind === undefined &&
    priority === undefined &&
    labels.length === 0 &&
    acceptanceCriteria.length === 0 &&
    requiredCloseoutGateInputs.length === 0 &&
    !clearRequiredCloseoutGates &&
    forceGateRefs.length === 0
  ) {
    throw new BorealError("BOREAL_INVALID_INPUT", "work edit requires at least one mutable field flag");
  }
  if (requiredCloseoutGateInputs.length > 0 && clearRequiredCloseoutGates) {
    throw new BorealError("BOREAL_INVALID_INPUT", "work edit cannot combine --required-gate with --clear-required-gates");
  }
  if (forceGateRefs.length > 0 && clearRequiredCloseoutGates) {
    throw new BorealError("BOREAL_INVALID_INPUT", "work edit cannot combine --force-gate with --clear-required-gates");
  }
  if (forceGateRefs.length > 0 && (!forceGateReason || !forceGateComment?.trim())) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--force-gate requires --force-gate-reason and --force-gate-comment");
  }
  if (forceGateRefs.length === 0 && (forceGateReason || forceGateComment || forceGateEvidenceIds.length > 0)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--force-gate-reason, --force-gate-comment, and --force-gate-evidence require --force-gate");
  }

  const current = nowIso();
  const result = await context.store.write(async (writer) => {
    const work = await requireCliWork(writer, workId);
    const nextLabels = labels.length > 0 ? labelsFromArgs(args) : work.labels;
    const nextKind = kind ?? work.kind;
    let requiredCloseoutGates =
      requiredCloseoutGateInputs.length > 0
        ? createRequiredCloseoutGates({
            subjectId: work.meta.id,
            subjectType: closeoutGateSubjectTypeForWorkKind(nextKind),
            inputs: requiredCloseoutGateInputs,
            actor: context.actor,
            now: current
          })
        : clearRequiredCloseoutGates
          ? undefined
          : work.requiredCloseoutGates;
    if (forceGateRefs.length > 0) {
      await requireCliEvidenceRecords(writer, forceGateEvidenceIds);
      requiredCloseoutGates = forceRequiredCloseoutGates({
        gates: requiredCloseoutGates ?? [],
        refs: forceGateRefs,
        reason: parseCloseoutGateForceReason(forceGateReason),
        comment: forceGateComment?.trim() ?? "",
        evidenceIds: forceGateEvidenceIds,
        actor: context.actor,
        now: current
      });
    }
    const updated = touchRecord(
      {
        ...work,
        kind: nextKind,
        title: title ?? work.title,
        description: description ?? work.description,
        priority: priority ?? work.priority,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? normalizedNonEmptyStrings(acceptanceCriteria) : work.acceptanceCriteria,
        requiredCloseoutGates,
        labels: nextLabels,
        meta: {
          ...work.meta,
          tags: nextLabels
        }
      },
      current,
      context.actor
    );
    await writer.putWorkItem(updated);
    const event = await appendCliEvent(writer, context, "work.edited", updated.meta.id, "work", {
      changedFields: workEditChangedFields(work, updated)
    }, current);
    return { work: updated, event };
  });
  await context.runtime.refreshWorkContext(workId);
  return result;
}

function assertLeafEvidenceGateForClose(work: WorkItem, args: ParsedArgs): void {
  if ((work.kind !== "task" && work.kind !== "issue") || work.evidenceIds.length > 0 || hasFlag(args, "force-summary")) {
    return;
  }
  const remediationCommand =
    `bwrk evidence add ${work.meta.id} --summary '<evidence summary>' --kind command --outcome passed ` +
    "--command '<validation command>' --json";
  const gaps = [
    {
      code: "gate.verification.unsatisfied",
      subjectType: "work",
      subjectId: work.meta.id,
      data: {
        requiredEvidenceKinds: ["command", "test", "diff", "review", "artifact", "note"],
        minEvidenceCount: 1,
        reason: "leaf work cannot close with zero evidence records"
      }
    }
  ] satisfies readonly EnforcementGap[];
  throw new BorealError(
    "BOREAL_POLICY_VIOLATION",
    "Leaf work cannot close with zero evidence records",
    {
      workId: work.meta.id,
      gateCode: "gate.verification.unsatisfied",
      remedialCommand: remediationCommand,
      forcePath: "Use --force-summary with --force-reason and --force-comment only for an audited bypass.",
      gaps,
      domain: "evidence"
    },
    gaps
  );
}

async function workFreshnessSince(
  context: CliContext,
  workId: WorkId,
  since: number
): Promise<{ readonly unchanged: boolean; readonly ledgerSeq: number; readonly latestTouchSeq: number }> {
  const events = await context.store.read((reader) => reader.listEvents());
  const latestTouchSeq = events.reduce((latest, event, index) => {
    return eventTouchesWork(event, workId) ? Math.max(latest, index + 1) : latest;
  }, 0);
  return {
    unchanged: latestTouchSeq <= since,
    ledgerSeq: events.length,
    latestTouchSeq
  };
}

function eventTouchesWork(event: RuntimeEvent, workId: WorkId): boolean {
  if (event.subjectId === workId) {
    return true;
  }
  const payload = event.payload;
  if (!isRecord(payload)) {
    return false;
  }
  return payload.subjectId === workId || payload.workId === workId || payload.blockingWorkId === workId;
}

async function cancelWorkCommand(
  context: CliContext,
  workId: WorkId,
  reason: string,
  agentSummary?: AgentSummaryRecord
) {
  const current = nowIso();
  const result = await context.store.write(async (writer) => {
    const work = await requireCliWork(writer, workId);
    if (work.status === "closed" || work.status === "cancelled") {
      throw new BorealError("BOREAL_INVALID_INPUT", "Only open work can be cancelled", {
        workId,
        status: work.status
      });
    }
    const activeReservations = await activeNonExpiredReservationsForWork(writer, workId, current);
    if (activeReservations.length > 0) {
      throw new BorealError("BOREAL_POLICY_VIOLATION", "Cannot cancel work with an active non-expired reservation", {
        workId,
        reservationIds: activeReservations.map((reservation) => reservation.meta.id),
        domain: "work"
      });
    }
    const expiredReservationIds = await expireStaleReservationsForWork(writer, workId, current, context.actor);
    const updated = touchRecord(
      {
        ...work,
        status: "cancelled" as const,
        reservationId: undefined,
        closedAt: current,
        closedReason: reason.trim()
      },
      current,
      context.actor
    ) satisfies WorkItem;
    if (agentSummary) {
      await requireSummaryReferences(writer, {
        evidenceIds: agentSummary.evidenceIds,
        verificationIds: agentSummary.verificationIds,
        childSummaryIds: agentSummary.childSummaryIds
      });
      await writer.putAgentSummary(agentSummary);
      await appendCliEvent(
        writer,
        context,
        agentSummary.status === "forced" ? "agent_summary.forced_closeout" : "agent_summary.closeout_created",
        agentSummary.meta.id,
        "agent_summary",
        {
          subjectId: agentSummary.subjectId,
          subjectType: agentSummary.subjectType,
          workId: work.meta.id,
          closeReason: reason,
          forceReasonCode: agentSummary.forceReasonCode
        },
        current
      );
    }
    await writer.putWorkItem(updated);
    const event = await appendCliEvent(writer, context, "work.cancelled", updated.meta.id, "work", {
      reason,
      expiredReservationIds
    }, current);
    return { work: updated, event, expiredReservationIds };
  });
  await context.runtime.recomputeReadiness();
  return result;
}

async function reopenWorkCommand(context: CliContext, workId: WorkId, args: ParsedArgs) {
  const current = nowIso();
  const ready = hasFlag(args, "ready");
  const reason = flagValue(args, "reason");
  const result = await context.store.write(async (writer) => {
    const work = await requireCliWork(writer, workId);
    if (work.status !== "closed" && work.status !== "cancelled") {
      throw new BorealError("BOREAL_INVALID_INPUT", "Only closed or cancelled work can be reopened", {
        workId,
        status: work.status
      });
    }
    const expiredReservationIds = await expireStaleReservationsForWork(writer, workId, current, context.actor);
    const [workItems, graphEdges] = await Promise.all([writer.listWorkItems(), writer.listGraphEdges()]);
    const workById = new Map(workItems.map((item) => [item.meta.id, item]));
    const dependencyIds = dependencyIdsByWorkFromGraph(workItems, graphEdges).get(work.meta.id) ?? work.dependencyIds;
    const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
    const reopenedBase = {
      ...work,
      status: "draft" as const,
      dependencyIds,
      reservationId: undefined,
      closedAt: undefined,
      closedReason: undefined
    };
    const updated = touchRecord(
      {
        ...reopenedBase,
        status: ready ? deriveReadinessStatus(reopenedBase, dependencies) : "draft"
      },
      current,
      context.actor
    );
    await writer.putWorkItem(updated);
    const event = await appendCliEvent(writer, context, "work.reopened", updated.meta.id, "work", {
      reason,
      status: updated.status,
      expiredReservationIds
    }, current);
    return { work: updated, event, expiredReservationIds };
  });
  if (ready) {
    await context.runtime.recomputeReadiness();
  }
  return result;
}

function workEditChangedFields(before: WorkItem, after: WorkItem): readonly string[] {
  const changed: string[] = [];
  if (before.title !== after.title) changed.push("title");
  if (before.description !== after.description) changed.push("description");
  if (before.kind !== after.kind) changed.push("kind");
  if (before.priority !== after.priority) changed.push("priority");
  if (!arraysEqual(before.labels, after.labels)) changed.push("labels");
  if (!arraysEqual(before.acceptanceCriteria, after.acceptanceCriteria)) changed.push("acceptanceCriteria");
  if (JSON.stringify(before.requiredCloseoutGates ?? []) !== JSON.stringify(after.requiredCloseoutGates ?? [])) {
    changed.push("requiredCloseoutGates");
  }
  return changed;
}

function forceRequiredCloseoutGates(input: {
  readonly gates: readonly RequiredCloseoutGate[];
  readonly refs: readonly string[];
  readonly reason: CloseoutGateForceReasonCode;
  readonly comment: string;
  readonly evidenceIds: readonly EvidenceRecord["meta"]["id"][];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}): readonly RequiredCloseoutGate[] {
  if (input.gates.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Cannot force a required gate because the work item has no required gates");
  }
  const refs = input.refs.map(parseCloseoutGateRef);
  const matched = refs.map(() => false);
  const forced = input.gates.map((gate) => {
    const shouldForce = refs.some((ref, index) => {
      const matches = closeoutGateRefMatches(gate, ref);
      if (matches) {
        matched[index] = true;
      }
      return matches;
    });
    if (!shouldForce) {
      return gate;
    }
    return {
      ...gate,
      status: "forced" as const,
      force: {
        reason: input.reason,
        comment: input.comment,
        actor: input.actor,
        evidenceIds: input.evidenceIds.length > 0 ? input.evidenceIds : undefined,
        ...(gate.force?.directiveIds && gate.force.directiveIds.length > 0 ? { directiveIds: gate.force.directiveIds } : {}),
        ...(gate.force?.acknowledgementIds && gate.force.acknowledgementIds.length > 0
          ? { acknowledgementIds: gate.force.acknowledgementIds }
          : {}),
        forcedAt: input.now
      }
    };
  });
  const missing = input.refs.filter((_, index) => !matched[index]);
  if (missing.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Required closeout gate not found for force request", {
      missing,
      availableGates: input.gates.map((gate) => `${gate.id}:${gate.kind}:${gate.scope}`),
      domain: "work"
    });
  }
  return forced;
}

type CloseoutGateRef =
  | { readonly id: string; readonly kind?: undefined; readonly scope?: undefined }
  | { readonly id?: undefined; readonly kind: CloseoutGateKind; readonly scope?: CloseoutGateScope };

function parseCloseoutGateRef(value: string): CloseoutGateRef {
  if (value.startsWith("bw_gate_")) {
    return { id: value };
  }
  const [kindValue, scopeValue, extra] = value.split(":");
  if (!kindValue || extra !== undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--force-gate must use gate id, kind, or kind:scope");
  }
  return {
    kind: parseCloseoutGateKind(kindValue),
    scope: parseCloseoutGateScope(scopeValue)
  };
}

function closeoutGateRefMatches(gate: RequiredCloseoutGate, ref: CloseoutGateRef): boolean {
  if (ref.id) {
    return gate.id === ref.id;
  }
  return gate.kind === ref.kind && (!ref.scope || gate.scope === ref.scope);
}

async function summaryCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const subject = await resolveSummarySubject(context, requiredPositional(rest, 0, "summary subject reference"), args);
      const result = await createAgentSummaryCommand(context, args, subject, {
        body: requiredFlag(args, "body"),
        title: flagValue(args, "title")
      });
      const outputResult = withCliResult(
        { ...result, closeoutGateStatus: await closeoutGateStatusForSummary(context, result.summary) },
        summaryCliResult(result.summary)
      );
      output.write(await formatRecordWithAgentDirectives(context, args, outputResult, json, {
        subjectWorkId: result.summary.subjectId.startsWith("bw_work_") ? result.summary.subjectId as WorkId : undefined
      }));
      return { exitCode: 0 };
    }
    case "compose": {
      const subject = await resolveSummarySubject(context, requiredPositional(rest, 0, "summary subject reference"), args);
      const body = await composeAgentSummaryBody(context, subject);
      const result = await createAgentSummaryCommand(context, args, subject, {
        body,
        title: flagValue(args, "title") ?? `Closeout summary: ${subject.title}`
      });
      const outputResult = withCliResult(
        { ...result, closeoutGateStatus: await closeoutGateStatusForSummary(context, result.summary) },
        summaryCliResult(result.summary)
      );
      output.write(await formatRecordWithAgentDirectives(context, args, outputResult, json, {
        subjectWorkId: result.summary.subjectId.startsWith("bw_work_") ? result.summary.subjectId as WorkId : undefined
      }));
      return { exitCode: 0 };
    }
    case "show": {
      const ref = requiredPositional(rest, 0, "summary or subject reference");
      const summary = ref.startsWith("bw_summary_")
        ? await context.store.read(async (reader) => requireAgentSummary(reader, asAgentSummaryId(ref)))
        : await latestSummaryForSubject(context, await resolveSummarySubject(context, ref, args));
      const result = { ...summary, closeoutGateStatus: await closeoutGateStatusForSummary(context, summary) };
      output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
        subjectWorkId: summary.subjectId.startsWith("bw_work_") ? summary.subjectId as WorkId : undefined
      }));
      return { exitCode: 0 };
    }
    case "list": {
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const subjectRef = flagValue(args, "subject");
      const summaries = await context.store.read(async (reader) =>
        subjectRef
          ? reader.listAgentSummariesForSubject((await resolveSummarySubject(context, subjectRef, args)).subjectId)
          : reader.listAgentSummaries()
      );
      const rows = [...summaries]
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || left.meta.id.localeCompare(right.meta.id))
        .slice(0, limit)
        .map(agentSummaryRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "render": {
      const summaryId = asAgentSummaryId(requiredPositional(rest, 0, "summary id"));
      const result = await renderExistingAgentSummary(context, summaryId, flagValue(args, "out"));
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "backfill": {
      const result = await backfillAgentSummaries(context, args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown summary command: ${action ?? ""}`);
  }
}

interface SummarySubject {
  readonly subjectId: string;
  readonly subjectType: AgentSummarySubjectType;
  readonly summaryKind: AgentSummaryKind;
  readonly title: string;
  readonly work?: WorkItem;
}

async function createAgentSummaryCommand(
  context: CliContext,
  args: ParsedArgs,
  subject: SummarySubject,
  input: {
    readonly title?: string;
    readonly body: string;
  }
): Promise<{ readonly summary: AgentSummaryRecord; readonly artifact?: AgentSummaryArtifactResult; readonly event: RuntimeEvent }> {
  const current = nowIso();
  const outcome = parseSummaryOutcome(flagValue(args, "outcome"));
  const status = parseSummaryStatus(flagValue(args, "status"), flagValue(args, "force-reason"));
  const forceReasonCode = parseSummaryForceReason(flagValue(args, "force-reason"));
  const forceComment = flagValue(args, "force-comment");
  if (status === "forced" && (!forceReasonCode || !forceComment?.trim())) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Forced summaries require --force-reason and --force-comment");
  }
  const title = normalizeMachineString(input.title ?? `Agent summary: ${subject.title}`, "summary title");
  const body = input.body.trim();
  if (!body) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Summary body is required");
  }
  const evidenceIds = uniqueValues(flagValues(args, "evidence").map(asEvidenceId));
  const verificationIds = uniqueValues(flagValues(args, "verification").map(asVerificationId));
  const commitShas = uniqueStrings(flagValues(args, "commit").map(normalizeCommitSha));
  const dirtyPathNotes = normalizedNonEmptyStrings(flagValues(args, "dirty-path"));
  await assertDirtyPathReasonMatchesGitState(context, dirtyPathNotes);
  const childSummaryIds = uniqueValues(flagValues(args, "child-summary").map(asAgentSummaryId));
  const parentSummaryId = flagValue(args, "parent-summary") ? asAgentSummaryId(requiredFlag(args, "parent-summary")) : undefined;
  const duplicateOf = flagValue(args, "duplicate-of");
  const completedWork = summaryCompletedWorkFromArgs(args, subject, outcome, body);
  const summaryId = deterministicId<AgentSummaryId>("summary", {
    subjectId: subject.subjectId,
    subjectType: subject.subjectType,
    title,
    body,
    generatedAt: current
  });
  const artifactUri = hasFlag(args, "no-render")
    ? flagValue(args, "artifact-uri")
    : flagValue(args, "artifact-uri") ?? defaultAgentSummaryArtifactUri({ ...subject, summaryId });

  const result = await context.store.write(async (writer) => {
    await requireSummaryReferences(writer, {
      evidenceIds,
      verificationIds,
      childSummaryIds,
      parentSummaryId
    });
    const summary = withContentHash({
      meta: createRecordMeta({
        id: summaryId,
        now: current,
        actor: context.actor,
        tags: ["agent-summary", subject.summaryKind]
      }),
      subjectId: subject.subjectId,
      subjectType: subject.subjectType,
      summaryKind: subject.summaryKind,
      status,
      outcome,
      title,
      body,
      completedWork,
      evidenceIds,
      verificationIds,
      commitShas,
      dirtyPathNotes,
      childSummaryIds,
      parentSummaryId,
      artifactUri,
      duplicateOf,
      forceReasonCode,
      forceComment,
      generatedAt: current
    } satisfies AgentSummaryRecord);
    await writer.putAgentSummary(summary);
    const event = await appendCliEvent(writer, context, "agent_summary.created", summary.meta.id, "agent_summary", {
      subjectId: summary.subjectId,
      subjectType: summary.subjectType,
      status: summary.status,
      outcome: summary.outcome
    }, current);
    return { summary, event };
  });
  const artifact = hasFlag(args, "no-render") ? undefined : await writeAgentSummaryArtifact(context, result.summary);
  return { ...result, artifact };
}

async function resolveSummarySubject(context: CliContext, ref: string, args: ParsedArgs): Promise<SummarySubject> {
  const explicitSubjectType = parseSummarySubjectType(flagValue(args, "subject-type"));
  if (explicitSubjectType === "phase" || explicitSubjectType === "project" || explicitSubjectType === "session") {
    return {
      subjectId: ref,
      subjectType: explicitSubjectType,
      summaryKind: explicitSubjectType,
      title: ref
    };
  }

  const workId = await resolveWorkId(context, ref);
  const work = await context.store.read(async (reader) => requireCliWork(reader, workId));
  const subjectType =
    explicitSubjectType ??
    (work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work");
  if (subjectType === "sprint" && work.kind !== "sprint") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Summary subject type sprint requires a sprint work item", { workId });
  }
  if (subjectType === "milestone" && work.kind !== "milestone") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Summary subject type milestone requires a milestone work item", { workId });
  }
  return {
    subjectId: work.meta.id,
    subjectType,
    summaryKind: parseSummaryKind(flagValue(args, "kind")) ?? summaryKindForWork(work, subjectType),
    title: work.title,
    work
  };
}

async function composeAgentSummaryBody(context: CliContext, subject: SummarySubject): Promise<string> {
  if (!subject.work) {
    return [
      `Subject: ${subject.subjectType}:${subject.subjectId}`,
      "",
      "## Outcome",
      "",
      "No repository work item is attached to this summary subject."
    ].join("\n");
  }
  const snapshot = await context.store.read(async (reader) => ({
    workItems: await reader.listWorkItems(),
    graphEdges: await reader.listGraphEdges(),
    evidence: await reader.listEvidence(),
    verifications: await reader.listVerifications(),
    summaries: await reader.listAgentSummaries()
  }));
  const subjectEvidence = snapshot.evidence.filter((record) => record.subjectId === subject.work?.meta.id);
  const subjectVerifications = snapshot.verifications.filter((record) => record.subjectId === subject.work?.meta.id);
  const subjectSummaries = snapshot.summaries.filter((record) => record.subjectId === subject.work?.meta.id);
  const tree = dependencyTreeForWork(subject.work.meta.id, snapshot.workItems, snapshot.graphEdges);
  const descendants = flattenDependencyTree(tree).filter((node) => node.id !== subject.work?.meta.id);
  const closeoutGateStatus = closeoutGateStatusFromSnapshot(
    subject.work,
    snapshot.workItems,
    snapshot.graphEdges,
    snapshot.evidence,
    snapshot.verifications,
    snapshot.summaries
  );
  const reviewGateDetails = reviewGateDetailRowsFromStatuses(
    closeoutGateStatusesForWorkScope(
      subject.work,
      snapshot.workItems,
      snapshot.graphEdges,
      snapshot.evidence,
      snapshot.verifications,
      snapshot.summaries
    )
  );
  return [
    `Subject: ${subject.subjectType}:${subject.subjectId}`,
    `Status: ${subject.work.status}`,
    `Priority: ${subject.work.priority}`,
    "",
    "## Outcome",
    "",
    subject.work.closedReason ?? (subject.work.description || "No close reason or description is recorded."),
    "",
    "## Evidence",
    "",
    subjectEvidence.length > 0
      ? subjectEvidence.map((record) => `- ${record.meta.id}: ${record.outcome} ${record.summary}`).join("\n")
      : "None.",
    "",
    "## Verification",
    "",
    subjectVerifications.length > 0
      ? subjectVerifications.map((record) => `- ${record.meta.id}: ${record.verdict}${record.notes ? ` ${record.notes}` : ""}`).join("\n")
      : "None.",
    "",
    "## Closeout Gates",
    "",
    formatCloseoutGateStatusMarkdown(closeoutGateStatus),
    "",
    "## Review/Audit Gate Details",
    "",
    formatReviewGateDetailsMarkdown(reviewGateDetails),
    "",
    "## Child Work",
    "",
    descendants.length > 0
      ? descendants.map((node) => `- ${node.id}: ${node.status ?? "missing"} ${node.title ?? ""}`.trim()).join("\n")
      : "None.",
    "",
    "## Prior Summaries",
    "",
    subjectSummaries.length > 0
      ? subjectSummaries.map((record) => `- ${record.meta.id}: ${record.status} ${record.outcome} ${record.title}`).join("\n")
      : "None."
  ].join("\n");
}

interface CloseoutGateStatusView {
  readonly subjectId: WorkId;
  readonly subjectType: string;
  readonly title: string;
  readonly summary: {
    readonly total: number;
    readonly open: number;
    readonly satisfied: number;
    readonly forced: number;
    readonly reviewGates: ReviewGateSummary;
  };
  readonly requiredGates: readonly CloseoutGateStatusRow[];
  readonly gateGaps: readonly CloseoutGateGapRow[];
  readonly gaps: readonly EnforcementGap[];
}

interface CloseoutGateStatusRow {
  readonly id: string;
  readonly kind: CloseoutGateKind;
  readonly scope: CloseoutGateScope;
  readonly status: "open" | "satisfied" | "forced";
  readonly recordedStatus: "open" | "satisfied" | "forced";
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly requiredOutcome: "passed";
  readonly minEvidenceCount: number;
  readonly requiredTrustLevels?: readonly EvidenceTrustLevel[];
  readonly requireCurrentRevision?: boolean;
  readonly requireCurrentGitHead?: boolean;
  readonly declaredCommand?: string;
  readonly expectedObservable?: string;
  readonly satisfiedBy?: RequiredCloseoutGate["satisfiedBy"];
  readonly force?: RequiredCloseoutGate["force"];
  readonly targets: readonly CloseoutGateTargetStatusRow[];
}

interface CloseoutGateTargetStatusRow {
  readonly targetId: WorkId;
  readonly title: string;
  readonly workStatus: WorkStatus;
  readonly status: "open" | "satisfied";
  readonly satisfiedBy?: RequiredCloseoutGate["satisfiedBy"];
  readonly gap?: EnforcementGap;
}

interface CloseoutGateGapRow {
  readonly code: EnforcementGap["code"];
  readonly gateId: string;
  readonly gateKind: CloseoutGateKind;
  readonly gateScope: CloseoutGateScope;
  readonly subjectType: EnforcementGap["subjectType"];
  readonly subjectId: WorkId;
  readonly targetId: WorkId;
  readonly reason: string;
  readonly data?: EnforcementGap["data"];
}

async function closeoutGateStatusForSummary(
  context: CliContext,
  summary: AgentSummaryRecord
): Promise<CloseoutGateStatusView | undefined> {
  if (
    (summary.subjectType !== "work" && summary.subjectType !== "sprint" && summary.subjectType !== "milestone") ||
    !summary.subjectId.startsWith("bw_work_")
  ) {
    return undefined;
  }
  return closeoutGateStatusForWork(context, summary.subjectId as WorkId);
}

async function closeoutGateStatusForWork(context: CliContext, workId: WorkId): Promise<CloseoutGateStatusView> {
  const status = await context.store.read(async (reader) => {
    const [work, workItems, graphEdges, evidence, verifications, summaries] = await Promise.all([
      requireCliWork(reader, workId),
      reader.listWorkItems(),
      reader.listGraphEdges(),
      reader.listEvidence(),
      reader.listVerifications(),
      reader.listAgentSummaries()
    ]);
    return closeoutGateStatusFromSnapshot(work, workItems, graphEdges, evidence, verifications, summaries);
  });
  const externalGaps = await externalReadinessGapsForWork(context, workId);
  return externalGaps.length > 0 ? { ...status, gaps: [...status.gaps, ...externalGaps] } : status;
}

function closeoutGateStatusFromSnapshot(
  work: WorkItem,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[],
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): CloseoutGateStatusView {
  const requiredGates = (work.requiredCloseoutGates ?? []).map((gate) =>
    closeoutGateStatusRow(gate, work, workItems, graphEdges, evidence, verifications, summaries)
  );
  const gateGaps = requiredGates.flatMap((gate) =>
    gate.status === "open"
      ? gate.targets
          .filter((target) => target.status === "open")
          .map((target) => closeoutGateGapRow(gate, work, target))
      : []
  );
  return {
    subjectId: work.meta.id,
    subjectType: closeoutGateSubjectTypeForWorkKind(work.kind),
    title: work.title,
    summary: {
      total: requiredGates.length,
      open: requiredGates.filter((gate) => gate.status === "open").length,
      satisfied: requiredGates.filter((gate) => gate.status === "satisfied").length,
      forced: requiredGates.filter((gate) => gate.status === "forced").length,
      reviewGates: reviewGateSummaryFromRows(requiredGates)
    },
    requiredGates,
    gateGaps,
    gaps: gateGaps.map(enforcementGapFromCloseoutGateGapRow)
  };
}

async function externalReadinessGapsForWork(context: CliContext, workId: WorkId): Promise<readonly EnforcementGap[]> {
  const externalEdges = await context.store.read(async (reader) =>
    (await reader.listGraphEdges()).filter((edge) => isExternalBlockingWorkEdgeFor(edge, workId))
  );
  if (externalEdges.length === 0) {
    return [];
  }
  const rollups = await refreshGlobalRollupCache({
    registryRoot: context.workspaceRoot,
    source: "lazy"
  });
  const blockers = externalEdges
    .map((edge) => externalDependencyResolutionFromRollups(externalReferenceUriFromEdge(edge), rollups))
    .filter((resolution) => !resolution.terminal);
  if (blockers.length === 0) {
    return [];
  }
  return [
    {
      code: "work.blocked.open-dependency",
      subjectType: "work",
      subjectId: workId,
      data: {
        blockerIds: blockers.map((blocker) => blocker.referenceUri as WorkId),
        externalBlockers: blockers.map((blocker) => ({
          uri: blocker.referenceUri,
          projectId: blocker.projectId,
          workId: blocker.workId,
          status: blocker.status,
          title: blocker.title,
          reason: blocker.reason ?? "open",
          message: blocker.message
        }))
      }
    }
  ];
}

function isExternalBlockingWorkEdgeFor(edge: GraphEdge, workId: WorkId): boolean {
  return edge.kind === "blocks" &&
    edge.fromType === "work" &&
    edge.toType === "work" &&
    edge.toId === workId &&
    edge.fromProjectId !== undefined &&
    edge.toProjectId === undefined;
}

function externalReferenceUriFromEdge(edge: GraphEdge): string {
  return `boreal://${edge.fromProjectId ?? "unknown"}/${edge.fromId}`;
}

async function externalActiveBlockerIdsFromGraph(
  context: CliContext,
  workId: WorkId,
  graphEdges: readonly GraphEdge[]
): Promise<readonly string[]> {
  const externalEdges = graphEdges.filter((edge) => isExternalBlockingWorkEdgeFor(edge, workId));
  if (externalEdges.length === 0) {
    return [];
  }
  const rollups = await refreshGlobalRollupCache({
    registryRoot: context.workspaceRoot,
    source: "lazy"
  });
  return externalEdges
    .map((edge) => externalDependencyResolutionFromRollups(externalReferenceUriFromEdge(edge), rollups))
    .filter((resolution) => !resolution.terminal)
    .map((resolution) => resolution.referenceUri);
}

function closeoutGateStatusRow(
  gate: RequiredCloseoutGate,
  owner: WorkItem,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[],
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): CloseoutGateStatusRow {
  const targets = closeoutGateTargets(gate, owner, workItems, graphEdges).map((target) => {
    const satisfiedBy = closeoutGateTargetSatisfaction(gate, target, evidence, verifications, summaries);
    return {
      targetId: target.meta.id,
      title: target.title,
      workStatus: target.status,
      status: satisfiedBy ? "satisfied" as const : "open" as const,
      satisfiedBy,
      gap: satisfiedBy ? undefined : closeoutGateTrustGap(gate, target, evidence, verifications, summaries)
    };
  });
  const status =
    gate.status === "forced"
      ? "forced"
      : gate.status === "satisfied" || targets.every((target) => target.status === "satisfied")
        ? "satisfied"
        : "open";
  return {
    id: gate.id,
    kind: gate.kind,
    scope: gate.scope,
    status,
    recordedStatus: gate.status,
    requiredEvidenceKinds: gate.requiredEvidenceKinds,
    requiredOutcome: gate.requiredOutcome,
    minEvidenceCount: gate.minEvidenceCount,
    requiredTrustLevels: gate.requiredTrustLevels,
    requireCurrentRevision: gate.requireCurrentRevision,
    requireCurrentGitHead: gate.requireCurrentGitHead,
    declaredCommand: gate.declaredCommand,
    expectedObservable: gate.expectedObservable,
    satisfiedBy: gate.satisfiedBy ?? mergeCloseoutGateSatisfactions(targets.flatMap((target) => target.satisfiedBy ? [target.satisfiedBy] : [])),
    force: gate.force,
    targets
  };
}

function closeoutGateTargets(
  gate: RequiredCloseoutGate,
  owner: WorkItem,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): readonly WorkItem[] {
  switch (gate.scope) {
    case "self":
      return [owner];
    case "direct_children": {
      const workById = new Map(workItems.map((work) => [work.meta.id, work]));
      return dependencyIdsForWork(owner, graphEdges).map((id) => workById.get(id)).filter(isWorkItem);
    }
    case "descendants": {
      const descendantIds = new Set(flattenDependencyTree(dependencyTreeForWork(owner.meta.id, workItems, graphEdges))
        .filter((node) => node.id !== owner.meta.id)
        .map((node) => node.id));
      return workItems.filter((item) => descendantIds.has(item.meta.id));
    }
  }
}

function closeoutGateTargetSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): RequiredCloseoutGate["satisfiedBy"] | undefined {
  switch (gate.kind) {
    case "verification":
      return verificationGateStatusSatisfaction(gate, target, evidence, verifications, summaries);
    case "checkpoint":
      return checkpointGateStatusSatisfaction(gate, target, summaries);
    case "review":
    case "audit":
      return evidenceGateStatusSatisfaction(gate, target, evidence, summaries);
  }
}

function verificationGateStatusSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): RequiredCloseoutGate["satisfiedBy"] | undefined {
  const evidenceById = new Map(evidence.map((record) => [record.meta.id, record]));
  const matches = verifications.filter((verification) => {
    if (verification.subjectId !== target.meta.id || verification.verdict !== "passed") {
      return false;
    }
    return verification.evidenceIds.some((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return (
        record?.subjectId === target.meta.id &&
        (record.outcome === "passed" || record.outcome === "observed") &&
        evidenceSatisfiesCloseoutGate(gate, record, target, summaries)
      );
    });
  });
  const evidenceIds = uniqueValues(matches.flatMap((verification) =>
    verification.evidenceIds.filter((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return (
        record?.subjectId === target.meta.id &&
        (record.outcome === "passed" || record.outcome === "observed") &&
        evidenceSatisfiesCloseoutGate(gate, record, target, summaries)
      );
    })
  ));
  if (evidenceIds.length < gate.minEvidenceCount) {
    return undefined;
  }
  return {
    evidenceIds,
    verificationIds: uniqueValues(matches.map((verification) => verification.meta.id)),
    agentSummaryIds: [],
    commitShas: [],
    dirtyPathNotes: []
  };
}

function checkpointGateStatusSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  summaries: readonly AgentSummaryRecord[]
): RequiredCloseoutGate["satisfiedBy"] | undefined {
  const matches = summaries.filter(
    (summary) =>
      summary.subjectId === target.meta.id &&
      (summary.status === "final" || summary.status === "forced") &&
      (summary.commitShas.length > 0 || closeoutDirtyPathNotesHaveReasonCode(summary.dirtyPathNotes))
  );
  if (matches.length < gate.minEvidenceCount) {
    return undefined;
  }
  return {
    evidenceIds: uniqueValues(matches.flatMap((summary) => summary.evidenceIds)),
    verificationIds: uniqueValues(matches.flatMap((summary) => summary.verificationIds)),
    agentSummaryIds: uniqueValues(matches.map((summary) => summary.meta.id)),
    commitShas: uniqueStrings(matches.flatMap((summary) => summary.commitShas)),
    dirtyPathNotes: uniqueStrings(matches.flatMap((summary) => summary.dirtyPathNotes))
  };
}

function evidenceGateStatusSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  summaries: readonly AgentSummaryRecord[]
): RequiredCloseoutGate["satisfiedBy"] | undefined {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  const matches = evidence.filter(
    (record) =>
      record.subjectId === target.meta.id &&
      record.outcome === gate.requiredOutcome &&
      allowedKinds.has(record.kind) &&
      evidenceSatisfiesCloseoutGate(gate, record, target, summaries)
  );
  if (matches.length < gate.minEvidenceCount) {
    return undefined;
  }
  return {
    evidenceIds: uniqueValues(matches.map((record) => record.meta.id)),
    verificationIds: [],
    agentSummaryIds: [],
    commitShas: [],
    dirtyPathNotes: []
  };
}

function evidenceSatisfiesCloseoutGate(
  gate: RequiredCloseoutGate,
  record: EvidenceRecord,
  target: WorkItem,
  summaries: readonly AgentSummaryRecord[]
): boolean {
  if (gate.declaredCommand && record.command !== gate.declaredCommand) {
    return false;
  }
  if (gate.expectedObservable && !record.summary.includes(gate.expectedObservable)) {
    return false;
  }
  const requirement = closeoutTrustRequirement(gate, target, summaries);
  return requirement ? evidenceSatisfiesTrustRequirement(record, requirement) : true;
}

function closeoutGateGapRow(
  gate: CloseoutGateStatusRow,
  owner: WorkItem,
  target: CloseoutGateTargetStatusRow
): CloseoutGateGapRow {
  const trustReason = typeof target.gap?.data?.reason === "string" ? target.gap.data.reason : undefined;
  const reason = trustReason ?? declaredGateGapReason(gate) ?? "required gate has no satisfying evidence";
  const code = target.gap?.code ?? declaredGateGapCode(gate) ?? defaultCloseoutGateGapCode(gate.kind);
  return {
    code,
    gateId: gate.id,
    gateKind: gate.kind,
    gateScope: gate.scope,
    subjectType: closeoutGateSubjectTypeForWorkKind(owner.kind),
    subjectId: owner.meta.id,
    targetId: target.targetId,
    reason,
    data: {
      gateIds: [gate.id as CloseoutGateId],
      requiredEvidenceKinds: gate.requiredEvidenceKinds,
      minEvidenceCount: gate.minEvidenceCount,
      ...(gate.requiredTrustLevels?.length ? { requiredTrustLevels: gate.requiredTrustLevels } : {}),
      ...(gate.requireCurrentRevision ? { requiredRevision: workRevisionContentHash(owner) } : {}),
      ...(gate.requireCurrentGitHead ? { requiredGitHead: "0000000000000000000000000000000000000000" } : {}),
      ...(gate.declaredCommand ? { declaredCommand: gate.declaredCommand } : {}),
      ...(gate.expectedObservable ? { expectedObservable: gate.expectedObservable } : {}),
      ...target.gap?.data,
      reason
    }
  };
}

function closeoutGateTrustGap(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): EnforcementGap | undefined {
  const requirement = closeoutTrustRequirement(gate, target, summaries);
  if (!requirement || gate.kind === "checkpoint") {
    return undefined;
  }
  const available = closeoutCandidateEvidence(gate, target, evidence, verifications);
  const commandMatches = gate.declaredCommand
    ? available.filter((record) => record.command === gate.declaredCommand)
    : available;
  if (gate.declaredCommand && commandMatches.length === 0) {
    return undefined;
  }
  const candidates = commandMatches.filter((record) =>
    (!gate.declaredCommand || record.command === gate.declaredCommand) &&
    (!gate.expectedObservable || record.summary.includes(gate.expectedObservable))
  );
  if (gate.expectedObservable && candidates.length === 0) {
    return undefined;
  }
  return candidates.some((record) => evidenceSatisfiesTrustRequirement(record, requirement))
    ? undefined
    : evidenceTrustGap(target.meta.id, "work", candidates, requirement);
}

function closeoutCandidateEvidence(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[]
): readonly EvidenceRecord[] {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  if (gate.kind === "verification") {
    const verifiedEvidenceIds = new Set(verifications
      .filter((verification) => verification.subjectId === target.meta.id && verification.verdict === "passed")
      .flatMap((verification) => verification.evidenceIds));
    return evidence.filter((record) => verifiedEvidenceIds.has(record.meta.id) && record.subjectId === target.meta.id);
  }
  return evidence.filter((record) => record.subjectId === target.meta.id && allowedKinds.has(record.kind));
}

function closeoutTrustRequirement(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  summaries: readonly AgentSummaryRecord[]
): EvidenceTrustRequirement | undefined {
  if (!gate.requiredTrustLevels?.length && !gate.requireCurrentRevision && !gate.requireCurrentGitHead) {
    return undefined;
  }
  const currentGitHead = summaries
    .filter((summary) => summary.subjectId === target.meta.id && (summary.status === "final" || summary.status === "forced"))
    .flatMap((summary) => summary.commitShas)
    .at(0);
  return {
    gateId: gate.id,
    ...(gate.requiredTrustLevels?.length ? { requiredTrustLevels: gate.requiredTrustLevels } : {}),
    ...(gate.requireCurrentRevision ? { currentRevision: workRevisionContentHash(target) } : {}),
    ...(gate.requireCurrentGitHead ? { currentGitHead: currentGitHead ?? "0000000000000000000000000000000000000000" } : {}),
    rerunCommand: `bwrk evidence run ${target.meta.id} --gate ${gate.id} --json`
  };
}

function declaredGateGapCode(gate: CloseoutGateStatusRow): EnforcementGap["code"] | undefined {
  if (gate.declaredCommand) {
    return "gate.declared-command.missing";
  }
  if (gate.expectedObservable) {
    return "gate.expected-observable.missing";
  }
  return undefined;
}

function declaredGateGapReason(gate: CloseoutGateStatusRow): string | undefined {
  if (gate.declaredCommand) {
    return "required gate has no evidence matching declaredCommand";
  }
  if (gate.expectedObservable) {
    return "required gate has no evidence summary containing expectedObservable";
  }
  return undefined;
}

function defaultCloseoutGateGapCode(kind: CloseoutGateKind): EnforcementGap["code"] {
  switch (kind) {
    case "verification":
      return "gate.verification.unsatisfied";
    case "checkpoint":
      return "gate.checkpoint.unsatisfied";
    case "review":
      return "gate.review.unsatisfied";
    case "audit":
      return "gate.audit.unsatisfied";
  }
}

function enforcementGapFromCloseoutGateGapRow(gap: CloseoutGateGapRow): EnforcementGap {
  return {
    code: gap.code,
    subjectType: gap.subjectType,
    subjectId: gap.subjectId,
    targetId: gap.targetId,
    data: gap.data ?? { reason: gap.reason }
  };
}

function mergeCloseoutGateSatisfactions(
  values: readonly NonNullable<RequiredCloseoutGate["satisfiedBy"]>[]
): RequiredCloseoutGate["satisfiedBy"] | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const directiveIds = uniqueValues(values.flatMap((value) => value.directiveIds ?? []));
  const acknowledgementIds = uniqueStrings(values.flatMap((value) => value.acknowledgementIds ?? []));
  return {
    evidenceIds: uniqueValues(values.flatMap((value) => value.evidenceIds ?? [])),
    verificationIds: uniqueValues(values.flatMap((value) => value.verificationIds ?? [])),
    agentSummaryIds: uniqueValues(values.flatMap((value) => value.agentSummaryIds ?? [])),
    commitShas: uniqueStrings(values.flatMap((value) => value.commitShas ?? [])),
    dirtyPathNotes: uniqueStrings(values.flatMap((value) => value.dirtyPathNotes ?? [])),
    ...(directiveIds.length > 0 ? { directiveIds } : {}),
    ...(acknowledgementIds.length > 0 ? { acknowledgementIds } : {})
  };
}

function emptyReviewGateKindSummary(): ReviewGateKindSummary {
  return {
    total: 0,
    pending: 0,
    passed: 0,
    forced: 0
  };
}

function emptyReviewGateSummary(): ReviewGateSummary {
  return {
    total: 0,
    pending: 0,
    passed: 0,
    forced: 0,
    review: emptyReviewGateKindSummary(),
    audit: emptyReviewGateKindSummary()
  };
}

function reviewGateSummaryFromStatus(status: CloseoutGateStatusView): ReviewGateSummary {
  return reviewGateSummaryFromRows(status.requiredGates);
}

function reviewGateSummaryFromStatuses(statuses: readonly CloseoutGateStatusView[]): ReviewGateSummary {
  return reviewGateSummaryFromRows(statuses.flatMap((status) => status.requiredGates));
}

function reviewGateSummaryFromRows(rows: readonly CloseoutGateStatusRow[]): ReviewGateSummary {
  if (rows.length === 0) {
    return emptyReviewGateSummary();
  }
  const review = { ...emptyReviewGateKindSummary() };
  const audit = { ...emptyReviewGateKindSummary() };
  for (const gate of rows.filter(isReviewCandidateGate)) {
    const bucket = gate.kind === "review" ? review : audit;
    incrementReviewGateSummary(bucket, gate.status);
  }
  return {
    total: review.total + audit.total,
    pending: review.pending + audit.pending,
    passed: review.passed + audit.passed,
    forced: review.forced + audit.forced,
    review,
    audit
  };
}

function incrementReviewGateSummary(summary: { total: number; pending: number; passed: number; forced: number }, status: CloseoutGateStatusRow["status"]): void {
  summary.total += 1;
  if (status === "open") {
    summary.pending += 1;
  } else if (status === "satisfied") {
    summary.passed += 1;
  } else {
    summary.forced += 1;
  }
}

function closeoutDirtyPathNotesHaveReasonCode(notes: readonly string[]): boolean {
  return dirtyPathNotesHaveReasonCode(notes);
}

function formatCloseoutGateStatusMarkdown(status: CloseoutGateStatusView): string {
  if (status.requiredGates.length === 0) {
    return "None.";
  }
  const counts = status.summary.reviewGates;
  const lines = [
    `Review gates: pending ${counts.review.pending}, passed ${counts.review.passed}, forced bypass ${counts.review.forced}`,
    `Audit gates: pending ${counts.audit.pending}, passed ${counts.audit.passed}, forced bypass ${counts.audit.forced}`
  ];
  return [...lines, ...status.requiredGates.map((gate) => {
    const satisfied = gate.satisfiedBy;
    const evidence = satisfied?.evidenceIds?.length ? ` evidence=${satisfied.evidenceIds.join(",")}` : "";
    const verification = satisfied?.verificationIds?.length ? ` verification=${satisfied.verificationIds.join(",")}` : "";
    const summaries = satisfied?.agentSummaryIds?.length ? ` summaries=${satisfied.agentSummaryIds.join(",")}` : "";
    const commits = satisfied?.commitShas?.length ? ` commits=${satisfied.commitShas.join(",")}` : "";
    const dirty = satisfied?.dirtyPathNotes?.length ? ` dirty_paths=${satisfied.dirtyPathNotes.join("; ")}` : "";
    const forced = gate.force ? ` forced=${gate.force.reason} ${gate.force.comment}` : "";
    const recorded = gate.recordedStatus !== gate.status ? ` recorded=${gate.recordedStatus}` : "";
    return `- ${gate.kind}:${gate.scope} ${gate.status}${recorded}${evidence}${verification}${summaries}${commits}${dirty}${forced}`;
  })].join("\n");
}

function closeoutGateStatusesForWorkScope(
  work: WorkItem,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[],
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  summaries: readonly AgentSummaryRecord[]
): readonly CloseoutGateStatusView[] {
  const scopedIds = new Set([
    work.meta.id,
    ...flattenDependencyTree(dependencyTreeForWork(work.meta.id, workItems, graphEdges))
      .filter((node) => node.id !== work.meta.id)
      .map((node) => node.id as WorkId)
  ]);
  return workItems
    .filter((candidate) => scopedIds.has(candidate.meta.id))
    .map((candidate) => closeoutGateStatusFromSnapshot(candidate, workItems, graphEdges, evidence, verifications, summaries));
}

function reviewGateDetailRowsFromStatuses(statuses: readonly CloseoutGateStatusView[]): readonly ReviewGateDetailRow[] {
  return statuses.flatMap((status) =>
    status.requiredGates
      .filter(isReviewCandidateGate)
      .map((gate) => reviewGateDetailRow(status, gate))
  );
}

function reviewGateDetailRow(status: CloseoutGateStatusView, gate: CloseoutGateStatusRow): ReviewGateDetailRow {
  const satisfied = gate.satisfiedBy;
  return {
    workId: status.subjectId,
    workTitle: status.title,
    gateId: gate.id,
    kind: gate.kind,
    scope: gate.scope,
    status: gate.status,
    targetIds: gate.targets.map((target) => target.targetId),
    pendingTargetIds: gate.targets.filter((target) => target.status === "open").map((target) => target.targetId),
    evidenceIds: satisfied?.evidenceIds ?? [],
    verificationIds: satisfied?.verificationIds ?? [],
    agentSummaryIds: satisfied?.agentSummaryIds ?? [],
    commitShas: satisfied?.commitShas ?? [],
    dirtyPathNotes: satisfied?.dirtyPathNotes ?? [],
    forceReason: gate.force?.reason,
    forceComment: gate.force?.comment,
    forceEvidenceIds: gate.force?.evidenceIds ?? []
  };
}

function formatReviewGateDetailsMarkdown(rows: readonly ReviewGateDetailRow[]): string {
  if (rows.length === 0) {
    return "None.";
  }
  return rows.map((row) => {
    const pending = row.pendingTargetIds.length > 0 ? ` pending_targets=${row.pendingTargetIds.join(",")}` : "";
    const targets = row.targetIds.length > 0 ? ` targets=${row.targetIds.join(",")}` : "";
    const evidence = row.evidenceIds.length > 0 ? ` evidence=${row.evidenceIds.join(",")}` : "";
    const verification = row.verificationIds.length > 0 ? ` verification=${row.verificationIds.join(",")}` : "";
    const summaries = row.agentSummaryIds.length > 0 ? ` summaries=${row.agentSummaryIds.join(",")}` : "";
    const commits = row.commitShas.length > 0 ? ` commits=${row.commitShas.join(",")}` : "";
    const dirty = row.dirtyPathNotes.length > 0 ? ` dirty_paths=${row.dirtyPathNotes.join("; ")}` : "";
    const forced = row.forceReason
      ? ` forced=${row.forceReason}${row.forceComment ? ` ${row.forceComment}` : ""}${row.forceEvidenceIds.length > 0 ? ` force_evidence=${row.forceEvidenceIds.join(",")}` : ""}`
      : "";
    return `- ${row.workTitle} (${row.workId}) ${row.kind}:${row.scope} ${row.status} gate=${row.gateId}${targets}${pending}${evidence}${verification}${summaries}${commits}${dirty}${forced}`;
  }).join("\n");
}

function flattenDependencyTree(tree: DependencyTreeNode): readonly DependencyTreeNode[] {
  return [tree, ...tree.dependencies.flatMap((child) => flattenDependencyTree(child))];
}

async function latestSummaryForSubject(context: CliContext, subject: SummarySubject): Promise<AgentSummaryRecord> {
  const summaries = await context.store.read((reader) => reader.listAgentSummariesForSubject(subject.subjectId));
  const summary = [...summaries].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)).at(0);
  if (!summary) {
    throw new BorealError("BOREAL_NOT_FOUND", "No agent summary found for subject", {
      subjectId: subject.subjectId,
      subjectType: subject.subjectType,
      domain: "summary"
    });
  }
  return summary;
}

interface AgentSummaryArtifactResult {
  readonly path: string;
  readonly uri: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
}

async function renderExistingAgentSummary(
  context: CliContext,
  summaryId: AgentSummaryId,
  out: string | undefined
): Promise<{ readonly summary: AgentSummaryRecord; readonly artifact: AgentSummaryArtifactResult; readonly event?: RuntimeEvent }> {
  const current = nowIso();
  const summary = await context.store.read(async (reader) => requireAgentSummary(reader, summaryId));
  const artifact = await writeAgentSummaryArtifact(context, out ? { ...summary, artifactUri: out } : summary);
  const event = await context.store.write(async (writer) => {
    const currentSummary = await requireAgentSummary(writer, summaryId);
    const updated = touchRecord({ ...currentSummary, artifactUri: artifact.uri }, current, context.actor);
    await writer.putAgentSummary(updated);
    return appendCliEvent(writer, context, "agent_summary.rendered", updated.meta.id, "agent_summary", {
      artifactUri: artifact.uri,
      path: artifact.path
    }, current);
  });
  return {
    summary: await context.store.read(async (reader) => requireAgentSummary(reader, summaryId)),
    artifact,
    event
  };
}

async function backfillAgentSummaries(context: CliContext, args: ParsedArgs) {
  const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
  const current = nowIso();
  const closedOnly = hasFlag(args, "closed-only") || !hasFlag(args, "all");
  const candidates = await context.store.read(async (reader) => {
    const summaries = await reader.listAgentSummaries();
    const summarizedSubjectIds = new Set(summaries.map((summary) => summary.subjectId));
    return (await reader.listWorkItems())
      .filter((work) => !summarizedSubjectIds.has(work.meta.id))
      .filter((work) => !closedOnly || work.status === "closed" || work.status === "cancelled")
      .slice(0, limit);
  });
  const created: AgentSummaryRecord[] = [];
  for (const work of candidates) {
    const subject: SummarySubject = {
      subjectId: work.meta.id,
      subjectType: work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work",
      summaryKind: work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "legacy_backfill",
      title: work.title,
      work
    };
    const summary = await context.store.write(async (writer) => {
      const id = deterministicId<AgentSummaryId>("summary", {
        subjectId: work.meta.id,
        subjectType: subject.subjectType,
        title: work.title,
        generatedAt: current,
        backfill: created.length
      });
      const record = withContentHash({
        meta: createRecordMeta({
          id,
          now: current,
          actor: context.actor,
          tags: ["agent-summary", "legacy-backfill"]
        }),
        subjectId: work.meta.id,
        subjectType: subject.subjectType,
        summaryKind: subject.summaryKind,
        status: "final",
        outcome: work.status === "cancelled" ? "cancelled" : "completed",
        title: `Legacy summary: ${work.title}`,
        body: work.closedReason ?? (work.description || "Legacy backfill summary generated from existing work metadata."),
        completedWork: [
          {
            workId: work.meta.id,
            title: work.title,
            outcome: work.status === "cancelled" ? "cancelled" : "completed",
            notes: work.closedReason ?? work.description
          }
        ],
	        evidenceIds: work.evidenceIds,
	        verificationIds: work.verificationIds,
	        commitShas: [],
	        dirtyPathNotes: ["legacy_backfill: checkpoint unavailable for pre-policy terminal work"],
	        childSummaryIds: [],
        artifactUri: defaultAgentSummaryArtifactUri({ ...subject, summaryId: id }),
        generatedAt: current
      } satisfies AgentSummaryRecord);
      await writer.putAgentSummary(record);
      await appendCliEvent(writer, context, "agent_summary.backfilled", record.meta.id, "agent_summary", {
        subjectId: record.subjectId,
        subjectType: record.subjectType
      }, current);
      return record;
    });
    await writeAgentSummaryArtifact(context, summary);
    created.push(summary);
  }
  return {
    schemaVersion: "boreal.cli.summary.backfill.v1",
    generatedAt: current,
    scanned: candidates.length,
    created: created.map(agentSummaryRow)
  };
}

function agentSummaryRow(summary: AgentSummaryRecord): AgentSummaryOutputRow {
  return {
    id: summary.meta.id,
    subjectId: summary.subjectId,
    subjectType: summary.subjectType,
    kind: summary.summaryKind,
    status: summary.status,
    outcome: summary.outcome,
    title: summary.title,
    artifactUri: summary.artifactUri,
    generatedAt: summary.generatedAt
  };
}

async function requireAgentSummary(reader: BorealReader, summaryId: AgentSummaryId): Promise<AgentSummaryRecord> {
  const summary = await reader.getAgentSummary(summaryId);
  if (!summary) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary not found", { summaryId, domain: "summary" });
  }
  return summary;
}

async function requireSummaryReferences(
  reader: BorealReader,
  input: {
    readonly evidenceIds: readonly EvidenceRecord["meta"]["id"][];
    readonly verificationIds: readonly VerificationRecord["meta"]["id"][];
    readonly childSummaryIds: readonly AgentSummaryId[];
    readonly parentSummaryId?: AgentSummaryId;
  }
): Promise<void> {
  await requireCliEvidenceRecords(reader, input.evidenceIds);
  const missingVerificationIds: VerificationId[] = [];
  for (const verificationId of input.verificationIds) {
    if (!(await reader.getVerification(verificationId))) {
      missingVerificationIds.push(verificationId);
    }
  }
  if (missingVerificationIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing verification", {
      missingVerificationIds,
      domain: "evidence"
    });
  }
  const summaryIds = [...input.childSummaryIds, ...(input.parentSummaryId ? [input.parentSummaryId] : [])];
  const missingSummaryIds: AgentSummaryId[] = [];
  for (const summaryId of summaryIds) {
    if (!(await reader.getAgentSummary(summaryId))) {
      missingSummaryIds.push(summaryId);
    }
  }
  if (missingSummaryIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing summary", {
      missingSummaryIds,
      domain: "summary"
    });
  }
}

function summaryCompletedWorkFromArgs(
  args: ParsedArgs,
  subject: SummarySubject,
  outcome: AgentSummaryOutcome,
  body: string
): readonly AgentSummaryRecord["completedWork"][number][] {
  const explicit = flagValues(args, "completed").map((value) => parseCompletedWork(value, outcome));
  if (explicit.length > 0) {
    return explicit;
  }
  return [
    {
      workId: subject.work?.meta.id,
      title: subject.title,
      outcome,
      notes: body.split("\n").find((line) => line.trim().length > 0)?.trim() ?? ""
    }
  ];
}

function parseCompletedWork(value: string, fallbackOutcome: AgentSummaryOutcome): AgentSummaryRecord["completedWork"][number] {
  const [workIdOrTitle, maybeTitle, maybeOutcome, ...notes] = value.split("|").map((part) => part.trim());
  if (!workIdOrTitle) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--completed entries must not be empty");
  }
  const hasWorkId = workIdOrTitle.startsWith("bw_work_");
  return {
    workId: hasWorkId ? asWorkId(workIdOrTitle) : undefined,
    title: hasWorkId ? maybeTitle || workIdOrTitle : workIdOrTitle,
    outcome: maybeOutcome ? parseSummaryOutcome(maybeOutcome) : fallbackOutcome,
    notes: notes.join("|") || (hasWorkId ? "" : maybeTitle ?? "")
  };
}

async function writeAgentSummaryArtifact(context: CliContext, summary: AgentSummaryRecord): Promise<AgentSummaryArtifactResult> {
  const memoryRoot = await agentSummaryMemoryRoot(context);
  const uri = summary.artifactUri ?? defaultAgentSummaryArtifactUri({
    subjectId: summary.subjectId,
    subjectType: summary.subjectType,
    summaryKind: summary.summaryKind,
    title: summary.title,
    summaryId: summary.meta.id
  });
  const relativePath = uri.startsWith("memory://") ? uri.slice("memory://".length) : uri;
  const path = resolve(memoryRoot, relativePath);
  assertPathInside(memoryRoot, path);
  await mkdir(dirname(path), { recursive: true });
  const content = renderAgentSummaryMarkdown(summary);
  await writeTextFileAtomic(path, content);
  return {
    path,
    uri: uri.startsWith("memory://") ? uri : `memory://${relativePath}`,
    contentHash: hashContent(content),
    sizeBytes: Buffer.byteLength(content, "utf8")
  };
}

async function agentSummaryMemoryRoot(context: CliContext): Promise<string> {
  const config = await readProjectSetupConfig(context.workspaceRoot).catch(() => undefined);
  return config?.memoryRoot ?? join(context.workspaceRoot, "memory");
}

function defaultAgentSummaryArtifactUri(input: {
  readonly subjectId: string;
  readonly subjectType: AgentSummarySubjectType;
  readonly summaryKind: AgentSummaryKind;
  readonly title: string;
  readonly summaryId: AgentSummaryId;
}): string {
  const subjectFolder = `${input.subjectType}s`;
  return `memory://agent-summaries/${subjectFolder}/${input.subjectId}/${input.summaryId}.md`;
}

function renderAgentSummaryMarkdown(summary: AgentSummaryRecord): string {
  return [
    "---",
    `id: ${summary.meta.id}`,
    `subject_id: ${summary.subjectId}`,
    `subject_type: ${summary.subjectType}`,
    `summary_kind: ${summary.summaryKind}`,
    `status: ${summary.status}`,
    `outcome: ${summary.outcome}`,
    `generated_at: ${summary.generatedAt}`,
    summary.parentSummaryId ? `parent_summary: ${summary.parentSummaryId}` : undefined,
    summary.artifactUri ? `artifact_uri: ${summary.artifactUri}` : undefined,
    summary.duplicateOf ? `duplicate_of: ${summary.duplicateOf}` : undefined,
    summary.forceReasonCode ? `force_reason: ${summary.forceReasonCode}` : undefined,
    summary.forceComment ? `force_comment: ${JSON.stringify(summary.forceComment)}` : undefined,
    "---",
    "",
    `# ${summary.title}`,
    "",
    `- Subject: ${summary.subjectType}:${summary.subjectId}`,
    `- Status: ${summary.status}`,
    `- Outcome: ${summary.outcome}`,
    `- Evidence: ${summary.evidenceIds.length > 0 ? summary.evidenceIds.join(", ") : "none"}`,
    `- Verification: ${summary.verificationIds.length > 0 ? summary.verificationIds.join(", ") : "none"}`,
    `- Commits: ${summary.commitShas.length > 0 ? summary.commitShas.join(", ") : "none"}`,
    "",
    "## Summary",
    "",
    summary.body,
    "",
    "## Completed Work",
    "",
    summary.completedWork.length > 0
      ? summary.completedWork.map((work) => `- ${work.title}${work.workId ? ` (${work.workId})` : ""}: ${work.outcome}${work.notes ? ` - ${work.notes}` : ""}`).join("\n")
      : "None.",
    "",
    "## Dirty Path Notes",
    "",
    summary.dirtyPathNotes.length > 0 ? summary.dirtyPathNotes.map((note) => `- ${note}`).join("\n") : "None.",
    "",
    "## Child Summaries",
    "",
    summary.childSummaryIds.length > 0 ? summary.childSummaryIds.map((id) => `- ${id}`).join("\n") : "None."
  ].filter((line): line is string => line !== undefined).join("\n") + "\n";
}

interface CloseoutAgentSummaryResult {
  readonly summaries: readonly AgentSummaryRecord[];
  readonly created?: {
    readonly summary: AgentSummaryRecord;
  };
}

async function ensureAgentSummaryForClose(
  context: CliContext,
  args: ParsedArgs,
  work: WorkItem,
  closeReason: string,
  options: {
    readonly outcome?: AgentSummaryOutcome;
  } = {}
): Promise<CloseoutAgentSummaryResult> {
  const explicitSummaryIds = flagValues(args, "agent-summary").map(asAgentSummaryId);
  if (explicitSummaryIds.length > 0) {
    if (closeoutSummaryMetadataRequested(args, options)) {
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        "--agent-summary cannot be combined with closeout summary metadata flags; update the summary first or omit --agent-summary"
      );
    }
    const summaries = await context.store.read(async (reader) => {
      const records: AgentSummaryRecord[] = [];
      for (const summaryId of explicitSummaryIds) {
        records.push(await requireAgentSummary(reader, summaryId));
      }
      return records;
    });
    assertCloseoutSummariesMatchWork(work, summaries);
    return { summaries };
  }

  const shouldCreateFreshSummary = closeoutSummaryMetadataRequested(args, options);
  const existing = shouldCreateFreshSummary ? [] : await latestFinalSummariesForSubject(context, work.meta.id);
  if (!shouldCreateFreshSummary && existing.length > 0) {
    return { summaries: existing };
  }

  const summary = await buildCloseoutAgentSummaryRecord(context, args, work, closeReason, {
    force: hasFlag(args, "force-summary"),
    outcome: options.outcome
  });
  return { summaries: [summary], created: { summary } };
}

function closeoutSummaryMetadataRequested(
  args: ParsedArgs,
  options: { readonly outcome?: AgentSummaryOutcome } = {}
): boolean {
  return (
    options.outcome !== undefined ||
    hasFlag(args, "force-summary") ||
    flagValue(args, "force-reason") !== undefined ||
    flagValue(args, "force-comment") !== undefined ||
    flagValue(args, "outcome") !== undefined ||
    flagValues(args, "commit").length > 0 ||
    flagValues(args, "dirty-path").length > 0
  );
}

async function assertDirtyPathReasonMatchesGitState(
  context: CliContext,
  dirtyPathNotes: readonly string[]
): Promise<void> {
  if (!dirtyPathNotes.some((note) => dirtyPathReasonCode(note) === "no_repo_changes")) {
    return;
  }

  const git = await inspectGitWorktree(context, { checkedPaths: ["."] });
  if (!git.available || !git.insideWorktree) {
    return;
  }

  const dirtyPaths = uniqueGitPaths([...git.collaborationDirtyPaths, ...git.blockingDirtyPaths]);
  if (dirtyPaths.length === 0) {
    return;
  }

  const gap: EnforcementGap = {
    code: "git.checkpoint.required",
    subjectType: "workspace",
    subjectId: context.workspaceRoot,
    data: {
      reason: `no_repo_changes reason is invalid while scoped git paths are dirty: ${dirtyPaths.map((path) => path.path).join(", ")}`
    }
  };
  throw new BorealError(
    "BOREAL_POLICY_VIOLATION",
    "Dirty-path reason no_repo_changes is invalid while the scoped git worktree has changes",
    {
      reasonCode: "no_repo_changes",
      dirtyPaths,
      gitRoot: git.gitRoot,
      branch: git.branch,
      domain: "work"
    },
    [gap]
  );
}

function dirtyPathReasonCode(note: string): string | undefined {
  const [code] = note.trim().split(":", 1);
  return code && code.length > 0 ? code : undefined;
}

async function agentFinishSummaryFactory(
  context: CliContext,
  args: ParsedArgs,
  workId: WorkId,
  reason: string
): Promise<FinishReservedWorkSummaryFactory> {
  const work = await context.store.read((reader) => requireCliWork(reader, workId));
  const childSummaryIds = await childAgentSummaryIdsForWork(context, work);
  const evidenceValues = flagValues(args, "evidence");
  const referencedEvidenceId = evidenceValues.find((value) => value.startsWith("bw_evidence_"));
  const referencedEvidence = referencedEvidenceId
    ? await context.store.read((reader) => reader.getEvidence(asEvidenceId(referencedEvidenceId)))
    : undefined;
  const summaryText =
    flagValue(args, "summary") ??
    evidenceValues.find((value) => !value.startsWith("bw_evidence_")) ??
    referencedEvidence?.summary;
  if (!summaryText?.trim()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish closeout summary requires --summary or valid --evidence");
  }
  const body = [
    "## Agent Finish Summary",
    "",
    summaryText,
    "",
    `Close reason: ${reason}`
  ].join("\n");
  return (input) => buildCloseoutAgentSummaryRecord(context, args, input.closedWork, reason, {
    body,
    evidenceIds: [input.evidence.meta.id],
    verificationIds: [input.verification.meta.id],
    childSummaryIds
  });
}

async function latestFinalSummariesForSubject(context: CliContext, subjectId: string): Promise<readonly AgentSummaryRecord[]> {
  const summaries = await context.store.read((reader) => reader.listAgentSummariesForSubject(subjectId));
  return [...summaries]
    .filter((summary) => summary.status === "final" || summary.status === "forced")
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    .slice(0, 1);
}

function assertCloseoutSummariesMatchWork(work: WorkItem, summaries: readonly AgentSummaryRecord[]): void {
  if (summaries.length === 0) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Closeout requires at least one agent summary", {
      domain: "summary"
    });
  }
  const expectedSubjectType = summarySubjectForWork(work).subjectType;
  const mismatches = summaries.filter(
    (summary) =>
      summary.subjectId !== work.meta.id ||
      summary.subjectType !== expectedSubjectType ||
      (summary.status !== "final" && summary.status !== "forced")
  );
  if (mismatches.length > 0) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Closeout summary must be final or forced and match the work subject", {
      workId: work.meta.id,
      expectedSubjectType,
      summaryIds: summaries.map((summary) => summary.meta.id),
      mismatches: mismatches.map((summary) => ({
        summaryId: summary.meta.id,
        subjectId: summary.subjectId,
        subjectType: summary.subjectType,
        status: summary.status
      })),
      domain: "summary"
    });
  }
}

async function buildCloseoutAgentSummaryRecord(
  context: CliContext,
  args: ParsedArgs,
  work: WorkItem,
  closeReason: string,
  options: {
    readonly force?: boolean;
    readonly outcome?: AgentSummaryOutcome;
    readonly body?: string;
    readonly evidenceIds?: readonly EvidenceRecord["meta"]["id"][];
    readonly verificationIds?: readonly VerificationRecord["meta"]["id"][];
    readonly childSummaryIds?: readonly AgentSummaryId[];
  } = {}
): Promise<AgentSummaryRecord> {
  const subject = summarySubjectForWork(work);
  const current = nowIso();
  const forceReasonCode = options.force ? parseSummaryForceReason(requiredFlag(args, "force-reason")) : undefined;
  const forceComment = options.force ? requiredFlag(args, "force-comment").trim() : undefined;
  if (options.force && !forceComment) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Forced closeout summaries require --force-comment");
  }
  const evidenceIds = uniqueValues(options.evidenceIds ?? work.evidenceIds);
  const verificationIds = uniqueValues(options.verificationIds ?? work.verificationIds);
  const commitShas = uniqueStrings(flagValues(args, "commit").map(normalizeCommitSha));
  const dirtyPathNotes = normalizedNonEmptyStrings(flagValues(args, "dirty-path"));
  requireCommitOrDirtyPathReason(commitShas, dirtyPathNotes);
  await assertDirtyPathReasonMatchesGitState(context, dirtyPathNotes);
  const childSummaryIds = options.childSummaryIds ?? await childAgentSummaryIdsForWork(context, work);
  const outcome = options.outcome ?? (options.force ? parseSummaryOutcome(flagValue(args, "outcome")) : "completed");
  const body = options.body?.trim() || await composedCloseoutSummaryBody(context, subject, closeReason, {
    forceReasonCode,
    forceComment,
    commitShas,
    dirtyPathNotes,
    childSummaryIds
  });
  const summaryId = deterministicId<AgentSummaryId>("summary", {
    subjectId: subject.subjectId,
    subjectType: subject.subjectType,
    title: `Closeout summary: ${subject.title}`,
    body,
    generatedAt: current
  });
  const summary = withContentHash({
    meta: createRecordMeta({
      id: summaryId,
      now: current,
      actor: context.actor,
      tags: ["agent-summary", "closeout", subject.summaryKind]
    }),
    subjectId: subject.subjectId,
    subjectType: subject.subjectType,
    summaryKind: subject.summaryKind,
    status: options.force ? "forced" : "final",
    outcome,
    title: `${options.force ? "Forced closeout summary" : "Closeout summary"}: ${subject.title}`,
    body,
    completedWork: [
      {
        workId: work.meta.id,
        title: work.title,
        outcome,
        notes: closeReason
      }
    ],
    evidenceIds,
    verificationIds,
    commitShas,
    dirtyPathNotes,
    childSummaryIds,
    artifactUri: defaultAgentSummaryArtifactUri({ ...subject, summaryId }),
    forceReasonCode,
    forceComment,
    generatedAt: current
  } satisfies AgentSummaryRecord);
  return summary;
}

function summarySubjectForWork(work: WorkItem): SummarySubject {
  const subjectType = work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work";
  return {
    subjectId: work.meta.id,
    subjectType,
    summaryKind: summaryKindForWork(work, subjectType),
    title: work.title,
    work
  };
}

async function composedCloseoutSummaryBody(
  context: CliContext,
  subject: SummarySubject,
  closeReason: string,
  input: {
    readonly forceReasonCode?: AgentSummaryForceReasonCode;
    readonly forceComment?: string;
    readonly commitShas: readonly string[];
    readonly dirtyPathNotes: readonly string[];
    readonly childSummaryIds: readonly AgentSummaryId[];
  }
): Promise<string> {
  const composed = await composeAgentSummaryBody(context, subject);
  return [
    `Close reason: ${closeReason}`,
    input.forceReasonCode ? `Force reason: ${input.forceReasonCode}` : undefined,
    input.forceComment ? `Force comment: ${input.forceComment}` : undefined,
    input.commitShas.length > 0 ? `Commits: ${input.commitShas.join(", ")}` : "Commits: none recorded",
    input.dirtyPathNotes.length > 0 ? `Dirty path notes: ${input.dirtyPathNotes.join("; ")}` : "Dirty path notes: none",
    input.childSummaryIds.length > 0 ? `Child summaries: ${input.childSummaryIds.join(", ")}` : "Child summaries: none",
    "",
    composed
  ].filter((line): line is string => line !== undefined).join("\n");
}

async function childAgentSummaryIdsForWork(context: CliContext, work: WorkItem): Promise<readonly AgentSummaryId[]> {
  const snapshot = await context.store.read(async (reader) => ({
    workItems: await reader.listWorkItems(),
    graphEdges: await reader.listGraphEdges(),
    summaries: await reader.listAgentSummaries()
  }));
  const tree = dependencyTreeForWork(work.meta.id, snapshot.workItems, snapshot.graphEdges);
  const descendantIds = new Set(flattenDependencyTree(tree).filter((node) => node.id !== work.meta.id).map((node) => node.id));
  if (descendantIds.size === 0) {
    return [];
  }
  const latestBySubject = new Map<string, AgentSummaryRecord>();
  for (const summary of snapshot.summaries) {
    if (!descendantIds.has(summary.subjectId) || (summary.status !== "final" && summary.status !== "forced")) {
      continue;
    }
    const existing = latestBySubject.get(summary.subjectId);
    if (!existing || summary.generatedAt.localeCompare(existing.generatedAt) > 0) {
      latestBySubject.set(summary.subjectId, summary);
    }
  }
  return [...latestBySubject.values()].map((summary) => summary.meta.id).sort();
}

function shouldRefreshGeneratedArtifactsAfterMutation(definition: CommandDefinition): boolean {
  const behavior = commandBehavior(definition);
  return (
    INLINE_GENERATED_ARTIFACT_REFRESH_COMMANDS.has(definition.path.join(" ")) &&
    behavior.writesState &&
    behavior.writesGeneratedArtifacts
  );
}

function shouldWriteProjectRollupAfterCommand(definition: CommandDefinition): boolean {
  const behavior = commandBehavior(definition);
  return (
    behavior.writesState &&
    (definition.requiresWorkspace || definition.path[0] === "init" || commandPath(definition) === "doctor")
  );
}

function projectRollupWriteOptionsForCommand(
  definition: CommandDefinition,
  result: CommandResult
): ProjectRollupWriteOptions {
  const command = commandPath(definition);
  return {
    ...(command === "doctor" ? { doctorOk: result.exitCode === 0 } : {}),
    ...(command === "sync refresh" ? { syncOk: result.exitCode === 0 } : {})
  };
}

// Inline refresh after mutations was removed: it rewrote every projection,
// the full search index, all ledgers, and the sqlite cache on each mutating
// command (O(all records) per mutation). Artifacts are content-hash stamped;
// staleness is detected by sync status/doctor and rebuilt by `sync refresh`.
const INLINE_GENERATED_ARTIFACT_REFRESH_COMMANDS = new Set<string>([]);

interface CliAgentDirectiveSubject {
  readonly type: AgentDirectiveSubjectType;
  readonly id: string;
  readonly title: string;
  readonly status?: WorkStatus;
}

interface CliAgentDirectiveOptions {
  readonly subjectWorkId?: WorkId;
  readonly subjectWork?: WorkItem;
  readonly subject?: CliAgentDirectiveSubject;
  readonly syncStatus?: SyncStatusResult;
  readonly syncRefreshed?: boolean;
  readonly doctorResult?: DoctorResult;
  readonly resultOk?: boolean;
  readonly nextWorkflowRef?: string;
  readonly recommendedCommandPath?: string;
}

interface CliAgentDirectiveWorkScope {
  readonly subjectWork?: WorkItem;
  readonly workItems: readonly WorkItem[];
  readonly graphEdges: readonly GraphEdge[];
}

const AGENT_DIRECTIVE_SESSION_CACHE_SCHEMA_VERSION = "boreal.agent-directive-session-cache.v1";
const AGENT_DIRECTIVE_SESSION_CACHE_LIMIT = 200;

interface AgentDirectiveSessionCache {
  readonly schemaVersion: typeof AGENT_DIRECTIVE_SESSION_CACHE_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly sourceHashes: readonly ContentHash[];
}

async function formatRecordWithAgentDirectives(
  context: CliContext,
  args: ParsedArgs,
  value: unknown,
  json: boolean,
  options: CliAgentDirectiveOptions = {}
): Promise<string> {
  if (!json) {
    return formatRecord(value, false);
  }
  if (args.command[0] === "sync" && args.command[1] === "status" && options.syncStatus?.ok) {
    return formatRecord(value, true);
  }
  const agentDirectives = await compileCliAgentDirectiveBundles(context, args, options);
  const outputDirectives = await agentDirectiveOutputForSession(context, agentDirectives);
  return formatRecord(value, true, { agentDirectives: outputDirectives });
}

async function agentDirectiveOutputForSession(
  context: CliContext,
  bundles: readonly AgentDirectiveBundle[]
): Promise<AgentDirectiveOutput> {
  if (bundles.length === 0) {
    return [];
  }
  const sourceHashes = uniqueStrings(
    bundles
      .map((bundle) => bundle.meta.sourceSnapshotHash)
      .filter((hash): hash is ContentHash => typeof hash === "string" && hash.startsWith("sha256:"))
  ) as unknown as readonly ContentHash[];
  if (sourceHashes.length === 0) {
    return bundles;
  }

  const cache = await readAgentDirectiveSessionCache(context);
  const previousHashes = new Set(cache.sourceHashes);
  const unchanged = sourceHashes.every((hash) => previousHashes.has(hash));
  const nextHashes = uniqueStrings([...cache.sourceHashes, ...sourceHashes]).slice(
    -AGENT_DIRECTIVE_SESSION_CACHE_LIMIT
  ) as unknown as readonly ContentHash[];
  if (!arraysEqual(cache.sourceHashes, nextHashes)) {
    await writeAgentDirectiveSessionCache(context, {
      schemaVersion: AGENT_DIRECTIVE_SESSION_CACHE_SCHEMA_VERSION,
      sessionId: context.sessionId,
      sourceHashes: nextHashes
    });
  }

  if (!unchanged) {
    return bundles;
  }
  return {
    unchanged: true,
    sourceHash: sourceHashes.length === 1 ? sourceHashes[0] as string : hashContent(sourceHashes)
  };
}

async function readAgentDirectiveSessionCache(context: CliContext): Promise<AgentDirectiveSessionCache> {
  const empty = {
    schemaVersion: AGENT_DIRECTIVE_SESSION_CACHE_SCHEMA_VERSION,
    sessionId: context.sessionId,
    sourceHashes: []
  } satisfies AgentDirectiveSessionCache;
  try {
    const parsed = JSON.parse(await readFile(agentDirectiveSessionCachePath(context), "utf8")) as unknown;
    if (isAgentDirectiveSessionCache(parsed) && parsed.sessionId === context.sessionId) {
      return parsed;
    }
  } catch {
    return empty;
  }
  return empty;
}

async function writeAgentDirectiveSessionCache(context: CliContext, cache: AgentDirectiveSessionCache): Promise<void> {
  const path = agentDirectiveSessionCachePath(context);
  await mkdir(dirname(path), { recursive: true });
  await writeTextFileAtomic(path, `${JSON.stringify(cache, null, 2)}\n`);
}

function agentDirectiveSessionCachePath(context: CliContext): string {
  const safeSessionId = context.sessionId.replace(/[^a-z0-9._-]+/giu, "-").slice(0, 120) || "local";
  return join(context.workspaceRoot, ".boreal", "cache", "agent-directives", `${safeSessionId}.json`);
}

function isAgentDirectiveSessionCache(value: unknown): value is AgentDirectiveSessionCache {
  return (
    isRecord(value) &&
    value.schemaVersion === AGENT_DIRECTIVE_SESSION_CACHE_SCHEMA_VERSION &&
    typeof value.sessionId === "string" &&
    Array.isArray(value.sourceHashes) &&
    value.sourceHashes.every((hash) => typeof hash === "string" && hash.startsWith("sha256:"))
  );
}

async function compileCliAgentDirectiveBundles(
  context: CliContext,
  args: ParsedArgs,
  options: CliAgentDirectiveOptions
): Promise<readonly AgentDirectiveBundle[]> {
  const snapshot = await buildCliAgentDirectiveSnapshot(context, args, options);
  const dataByRegistryId = cliDirectiveDataByRegistryId(snapshot);
  const gaps = cliAgentDirectiveGapsForSnapshot(snapshot, dataByRegistryId);
  const result = assembleAgentDirectiveBundleFromGaps({
    gaps,
    dataByRegistryId,
    commandPath: snapshot.command.path,
    capturedAt: snapshot.capturedAt,
    envelopeSchema: snapshot.command.envelopeSchema,
    subject: snapshot.work.subject,
    sourceHash: agentDirectiveSnapshotHash(snapshot)
  });
  if (!result.bundle && (result.selectedRegistryIds.length > 0 || result.issues.length > 0)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "agentDirectives failed schema validation", {
      selectedRegistryIds: result.selectedRegistryIds,
      issues: result.issues,
      missingRequired: result.missingRequired
    });
  }
  return result.bundle && result.selectedRegistryIds.length > 0 ? [result.bundle] : [];
}

function cliDirectiveDataByRegistryId(snapshot: AgentDirectiveSnapshot): AgentDirectiveAssemblyDataByRegistryId {
  const command = snapshot.command.path;
  const base = recoveryDirectiveDataByRegistryId(snapshot);
  if (["agent finish", "work cancel", "work close"].includes(command)) {
    return {
      ...base,
      ...closeoutDirectiveDataByRegistryId(snapshot),
      ...gitDirectiveDataByRegistryId(snapshot),
      ...handoffDirectiveDataByRegistryId(snapshot)
    };
  }
  if (["gate closeout", "sprint metrics", "sprint report", "summary compose", "summary show"].includes(command)) {
    return {
      ...base,
      ...summaryDirectiveDataByRegistryId(snapshot)
    };
  }
  if (["sync status"].includes(command)) {
    return {
      ...base,
      ...gitDirectiveDataByRegistryId(snapshot)
    };
  }
  return base;
}

async function buildCliAgentDirectiveSnapshot(
  context: CliContext,
  args: ParsedArgs,
  options: CliAgentDirectiveOptions
): Promise<AgentDirectiveSnapshot> {
  const command = cliDirectiveCommandPath(args);
  const syncStatus = options.syncStatus ?? (cliCommandIsReadOnly(args) ? unprobedSyncStatus(context) : await buildSyncStatus(context));
  const doctor = options.doctorResult;
  const actorId = optionalAgentIdFromArgs(args) ?? String(context.actor.id);
  const generatedAt = nowIso();
  return context.store.read(async (reader) => {
    const workScope = await readCliAgentDirectiveWorkScope(reader, options);
    const { subjectWork, workItems, graphEdges } = workScope;
    const subjectWorkId = subjectWork?.meta.id;
    const subjectSubtreeWorkIds = subjectWork ? workItems.map((work) => work.meta.id) : [];
    const [evidence, verifications, summaries, reservations] = subjectWork
      ? await Promise.all([
          readEvidenceForSubjects(reader, subjectSubtreeWorkIds),
          readVerificationsForSubjects(reader, subjectSubtreeWorkIds),
          readAgentSummariesForSubjects(reader, subjectSubtreeWorkIds),
          readReservationsForWorks(reader, subjectSubtreeWorkIds)
        ])
      : await Promise.all([
          Promise.resolve([] as readonly EvidenceRecord[]),
          Promise.resolve([] as readonly VerificationRecord[]),
          Promise.resolve([] as readonly AgentSummaryRecord[]),
          reader.listReservations()
        ]);
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    const dependencyIds = subjectWork ? dependencyIdsForWork(subjectWork, graphEdges) : [];
    const dependencyWork = dependencyIds.map((id) => workById.get(id)).filter(isWorkItem);
    const externalActiveBlockerIds = subjectWork
      ? await externalActiveBlockerIdsFromGraph(context, subjectWork.meta.id, graphEdges)
      : [];
    const activeBlockerIds = uniqueStrings([
      ...dependencyWork.filter((work) => isOpenWorkStatus(work.status)).map((work) => work.meta.id),
      ...externalActiveBlockerIds
    ]) as readonly WorkId[];
    const tree = subjectWork ? dependencyTreeForWork(subjectWork.meta.id, workItems, graphEdges) : undefined;
    const descendantNodes = tree ? flattenDependencyTree(tree).filter((node) => node.id !== subjectWorkId) : [];
    const descendantWorkIds = descendantNodes.map((node) => node.id as WorkId);
    const openDescendantIds = descendantNodes
      .filter((node) => node.status !== undefined && isOpenWorkStatus(node.status))
      .map((node) => node.id as WorkId);
    const subjectEvidence = subjectWorkId ? evidence.filter((record) => record.subjectId === subjectWorkId) : [];
    const subjectVerifications = subjectWorkId ? verifications.filter((record) => record.subjectId === subjectWorkId) : [];
    const subjectSummaries = subjectWorkId ? summaries.filter((summary) => summary.subjectId === subjectWorkId) : [];
    const latestSummary = [...subjectSummaries].sort(compareAgentSummariesNewestFirst)[0];
    const gateStatus = subjectWork
      ? closeoutGateStatusFromSnapshot(subjectWork, workItems, graphEdges, evidence, verifications, summaries)
      : undefined;
    const activeReservations = reservations.filter((reservation) => reservation.status === "active");
    const subjectReservation = subjectWorkId
      ? activeReservations.find((reservation) => reservation.workId === subjectWorkId)
      : undefined;
    const subject = subjectWork
      ? {
          type: closeoutGateSubjectTypeForWorkKind(subjectWork.kind) as AgentDirectiveSubjectType,
          id: subjectWork.meta.id,
          title: subjectWork.title,
          kind: subjectWork.kind,
          status: subjectWork.status,
          priority: subjectWork.priority,
          ...(subjectReservation?.meta.id ?? subjectWork.reservationId
            ? { reservationId: subjectReservation?.meta.id ?? subjectWork.reservationId }
            : {}),
          ...(subjectWork.closedReason ? { closedReason: subjectWork.closedReason } : {})
        }
      : options.subject
        ? {
            type: options.subject.type,
            id: options.subject.id,
            title: options.subject.title,
            ...(options.subject.status ? { status: options.subject.status } : {})
          }
        : undefined;

    return createAgentDirectiveSnapshot({
      capturedAt: generatedAt,
      work: {
        subject,
        labels: subjectWork?.labels ?? [],
        dependencyIds,
        activeBlockerIds,
        blockedByIds: activeBlockerIds,
        childWorkIds: dependencyIds,
        descendantWorkIds,
        openDescendantIds
      },
      summary: {
        summaryIds: subjectSummaries.map((summary) => summary.meta.id),
        finalSummaryIds: subjectSummaries.filter((summary) => summary.status === "final").map((summary) => summary.meta.id),
        childSummaryIds: uniqueStrings(subjectSummaries.flatMap((summary) => summary.childSummaryIds)) as readonly AgentSummaryId[],
        artifactUris: subjectSummaries.flatMap((summary) => summary.artifactUri ? [summary.artifactUri] : []),
        commitShas: uniqueStrings(subjectSummaries.flatMap((summary) => summary.commitShas)),
        dirtyPathNotes: uniqueStrings(subjectSummaries.flatMap((summary) => summary.dirtyPathNotes)),
        ...(latestSummary ? { latestSummaryId: latestSummary.meta.id } : {}),
        ...(latestSummary?.artifactUri ? { latestSummaryUri: latestSummary.artifactUri } : {})
      },
      gate: {
        requiredGates: gateStatus ? directiveGateStatesFromCloseoutStatus(gateStatus) : [],
        openGateIds: gateStatus
          ? gateStatus.requiredGates.filter((gate) => gate.status === "open").map((gate) => gate.id as CloseoutGateId)
          : [],
        satisfiedGateIds: gateStatus
          ? gateStatus.requiredGates.filter((gate) => gate.status === "satisfied").map((gate) => gate.id as CloseoutGateId)
          : [],
        forcedGateIds: gateStatus
          ? gateStatus.requiredGates.filter((gate) => gate.status === "forced").map((gate) => gate.id as CloseoutGateId)
          : []
      },
      evidence: {
        evidenceIds: subjectEvidence.map((record) => record.meta.id),
        verificationIds: subjectVerifications.map((record) => record.meta.id),
        evidence: subjectEvidence.map((record) => ({
          id: record.meta.id,
          subjectId: record.subjectId,
          subjectType: record.subjectType,
          kind: record.kind,
          outcome: record.outcome,
          summary: record.summary,
          ...(record.command ? { command: record.command } : {}),
          ...(record.uri ? { uri: record.uri } : {}),
          observedAt: record.observedAt
        })),
        verifications: subjectVerifications.map((record) => ({
          id: record.meta.id,
          subjectId: record.subjectId,
          subjectType: record.subjectType,
          verdict: record.verdict,
          evidenceIds: record.evidenceIds,
          verifiedAt: record.verifiedAt
        }))
      },
      git: gitDirectiveSnapshot(syncStatus, subjectSummaries),
      workflow: {
        workflowRefs: [options.nextWorkflowRef ?? directiveWorkflowRef(command, subjectWork, syncStatus, doctor)],
        skillRefs: directiveSkillRefs(command, doctor, syncStatus),
        requiredInputNames: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
        nextWorkflowRef: options.nextWorkflowRef ?? directiveWorkflowRef(command, subjectWork, syncStatus, doctor),
        recommendedCommandPath: options.recommendedCommandPath ?? directiveRecommendedCommand(command, subjectWork, syncStatus, doctor),
        assetManifestHash: hashContent({ command, workflowRefs: directiveSkillRefs(command, doctor, syncStatus) }) as ContentHash
      },
      doctor: doctorDirectiveSnapshot(doctor, syncStatus),
      sync: {
        ok: syncStatus.ok,
        refreshed: options.syncRefreshed ?? false,
        ledgersFresh: syncStatus.ledgers.ok,
        searchIndexFresh: syncStatus.searchIndex.ok,
        sqliteCacheFresh: true
      },
      command: {
        path: command,
        argv: cliDirectiveArgv(args),
        envelopeSchema: `boreal.cli.${command.replace(/\s+/gu, ".")}.v1`,
        json: hasFlag(args, "json"),
        mutatesState: cliCommandMutatesState(args),
        resultOk: options.resultOk ?? true
      },
      actor: {
        actor: context.actor,
        activeAgentId: actorId,
        activeReservationIds: activeReservations.map((reservation) => reservation.meta.id),
        ...(subjectReservation?.purpose ? { purpose: subjectReservation.purpose } : {})
      }
    });
  });
}

async function readCliAgentDirectiveWorkScope(
  reader: BorealReader,
  options: CliAgentDirectiveOptions
): Promise<CliAgentDirectiveWorkScope> {
  const subjectWork = options.subjectWork ?? (options.subjectWorkId ? await reader.getWorkItem(options.subjectWorkId) : undefined);
  if (!subjectWork) {
    return {
      workItems: [],
      graphEdges: []
    };
  }

  const workById = new Map<WorkId, WorkItem>([[subjectWork.meta.id, subjectWork]]);
  const graphEdgesById = new Map<GraphEdgeId, GraphEdge>();
  const visited = new Set<WorkId>();
  const pending: WorkId[] = [subjectWork.meta.id];

  while (pending.length > 0) {
    const workId = pending.shift() as WorkId;
    if (visited.has(workId)) {
      continue;
    }
    visited.add(workId);

    const work = workById.get(workId);
    const graphEdges = await reader.listGraphEdgesForSubject(workId);
    for (const edge of graphEdges) {
      graphEdgesById.set(edge.meta.id, edge);
    }

    if (!work) {
      continue;
    }
    for (const dependencyId of dependencyIdsForWork(work, graphEdges)) {
      if (!workById.has(dependencyId)) {
        const dependency = await reader.getWorkItem(dependencyId);
        if (dependency) {
          workById.set(dependencyId, dependency);
        }
      }
      if (!visited.has(dependencyId) && workById.has(dependencyId)) {
        pending.push(dependencyId);
      }
    }
  }

  return {
    subjectWork,
    workItems: [...workById.values()],
    graphEdges: [...graphEdgesById.values()]
  };
}

async function readEvidenceForSubjects(
  reader: BorealReader,
  subjectIds: readonly WorkId[]
): Promise<readonly EvidenceRecord[]> {
  return uniqueRecordsById((await Promise.all(subjectIds.map((id) => reader.listEvidenceForSubject(id)))).flat());
}

async function readVerificationsForSubjects(
  reader: BorealReader,
  subjectIds: readonly WorkId[]
): Promise<readonly VerificationRecord[]> {
  return uniqueRecordsById((await Promise.all(subjectIds.map((id) => reader.listVerificationsForSubject(id)))).flat());
}

async function readAgentSummariesForSubjects(
  reader: BorealReader,
  subjectIds: readonly WorkId[]
): Promise<readonly AgentSummaryRecord[]> {
  return uniqueRecordsById((await Promise.all(subjectIds.map((id) => reader.listAgentSummariesForSubject(id)))).flat());
}

async function readReservationsForWorks(
  reader: BorealReader,
  workIds: readonly WorkId[]
): Promise<readonly AgentReservation[]> {
  return uniqueRecordsById((await Promise.all(workIds.map((id) => reader.listReservationsForWork(id)))).flat());
}

function uniqueRecordsById<TRecord extends { readonly meta: { readonly id: string } }>(
  records: readonly TRecord[]
): readonly TRecord[] {
  const byId = new Map<string, TRecord>();
  for (const record of records) {
    byId.set(record.meta.id, record);
  }
  return [...byId.values()];
}

function directiveGateStatesFromCloseoutStatus(status: CloseoutGateStatusView): readonly AgentDirectiveGateStateSnapshot[] {
  return status.requiredGates.map((gate) => ({
    id: gate.id as CloseoutGateId,
    subjectType: status.subjectType,
    subjectId: status.subjectId,
    kind: gate.kind,
    scope: gate.scope,
    status: gate.status,
    requiredEvidenceKinds: gate.requiredEvidenceKinds,
    minEvidenceCount: gate.minEvidenceCount,
    evidenceIds: gate.satisfiedBy?.evidenceIds ?? [],
    verificationIds: gate.satisfiedBy?.verificationIds ?? [],
    agentSummaryIds: gate.satisfiedBy?.agentSummaryIds ?? [],
    commitShas: gate.satisfiedBy?.commitShas ?? [],
    dirtyPathNotes: gate.satisfiedBy?.dirtyPathNotes ?? [],
    directiveIds: uniqueValues([...(gate.satisfiedBy?.directiveIds ?? []), ...(gate.force?.directiveIds ?? [])]),
    acknowledgementIds: uniqueStrings([...(gate.satisfiedBy?.acknowledgementIds ?? []), ...(gate.force?.acknowledgementIds ?? [])]),
    ...(gate.declaredCommand ? { declaredCommand: gate.declaredCommand } : {}),
    ...(gate.expectedObservable ? { expectedObservable: gate.expectedObservable } : {}),
    ...(gate.force ? { forceReasonCode: gate.force.reason } : {})
  }));
}

function gitDirectiveSnapshot(
  syncStatus: SyncStatusResult,
  summaries: readonly AgentSummaryRecord[]
): AgentDirectiveSnapshot["git"] {
  const git = syncStatus.git;
  const changedPaths = uniqueGitPaths([...git.collaborationDirtyPaths, ...git.blockingDirtyPaths]);
  return {
    roots: [
      {
        root: git.gitRoot ?? git.workspaceRoot,
        ...(git.branch ? { branchName: git.branch } : {}),
        detached: git.detached,
        protectedBranch: git.protectedBranch,
        clean: changedPaths.length === 0,
        scopedChangedPaths: changedPaths,
        collaborationDirtyPaths: git.collaborationDirtyPaths,
        blockingDirtyPaths: git.blockingDirtyPaths,
        untrackedPaths: changedPaths.filter((entry) => entry.status === "??").map((entry) => entry.path)
      }
    ],
    checkpointCommitShas: uniqueStrings(summaries.flatMap((summary) => summary.commitShas)),
    dirtyPathNotes: uniqueStrings(summaries.flatMap((summary) => summary.dirtyPathNotes))
  };
}

function doctorDirectiveSnapshot(
  doctor: DoctorResult | undefined,
  syncStatus: SyncStatusResult
): AgentDirectiveSnapshot["doctor"] {
  if (doctor) {
    return {
      ok: doctor.ok,
      strict: doctor.strict,
      diagnostics: doctor.diagnostics.map(doctorDiagnosticSnapshot)
    };
  }
  return {
    ok: syncStatus.ok,
    strict: false,
    diagnostics: syncStatusDiagnostics(syncStatus)
  };
}

function doctorDiagnosticSnapshot(diagnostic: Diagnostic): AgentDirectiveDiagnosticSnapshot {
  const recommendedCommands = diagnosticRecommendedCommands(diagnostic.details);
  const severity =
    diagnostic.severity === "fixed" || (diagnostic.severity === "warning" && !strictBlockingWarning(diagnostic))
      ? "info"
      : diagnostic.severity;
  return {
    code: diagnostic.code,
    severity,
    message: diagnostic.message,
    blocking: diagnostic.severity === "error" || strictBlockingWarning(diagnostic),
    recommendedCommands
  };
}

function syncStatusDiagnostics(syncStatus: SyncStatusResult): readonly AgentDirectiveDiagnosticSnapshot[] {
  const diagnostics: AgentDirectiveDiagnosticSnapshot[] = [];
  if (!syncStatus.vault.ok) {
    diagnostics.push(syncDiagnostic("vault.health", "warning", "Vault health is not ok", false, syncStatus.recommendedActions));
  }
  if (!syncStatus.ledgers.ok) {
    diagnostics.push(syncDiagnostic("ledger.status", "info", "Ledger status is not ok", false, syncStatus.recommendedActions));
  }
  if (!syncStatus.searchIndex.ok) {
    diagnostics.push(syncDiagnostic("search.index", "info", "Search index is not fresh", false, syncStatus.recommendedActions));
  }
  for (const finding of syncStatus.git.findings) {
    if (finding.severity === "info" && !finding.blocking && finding.recommendedActions.length === 0) {
      continue;
    }
    diagnostics.push(syncDiagnostic(`git.${finding.category}`, finding.severity === "error" ? "error" : "warning", finding.message, finding.blocking, finding.recommendedActions));
  }
  return diagnostics;
}

function syncDiagnostic(
  code: string,
  severity: AgentDirectiveDiagnosticSnapshot["severity"],
  message: string,
  blocking: boolean,
  recommendedCommands: readonly string[]
): AgentDirectiveDiagnosticSnapshot {
  return {
    code,
    severity,
    message,
    blocking,
    recommendedCommands
  };
}

function diagnosticRecommendedCommands(details: unknown): readonly string[] {
  if (!isRecord(details)) {
    return [];
  }
  const commands = [
    ...(typeof details.repairCommand === "string" ? [details.repairCommand] : []),
    ...(Array.isArray(details.recommendedActions) ? details.recommendedActions.filter((entry): entry is string => typeof entry === "string") : [])
  ];
  return uniqueStrings(commands);
}

function directiveWorkflowRef(
  command: string,
  work: WorkItem | undefined,
  syncStatus: SyncStatusResult,
  doctor: DoctorResult | undefined
): string {
  if (cliHealthRecoveryNeeded(command, doctor, syncStatus)) {
    return "workflows/60-health/sync-and-doctor.md";
  }
  if (command.startsWith("sprint ")) {
    return "workflows/40-work/closeout-work.md";
  }
  if (command.startsWith("summary ") || command === "gate closeout") {
    return "workflows/40-work/closeout-work.md";
  }
  if (work?.status === "blocked") {
    return "workflows/40-work/link-dependencies.md";
  }
  return "workflows/40-work/claim-and-finish-work.md";
}

function directiveRecommendedCommand(
  command: string,
  work: WorkItem | undefined,
  syncStatus: SyncStatusResult,
  doctor: DoctorResult | undefined
): string {
  if (cliHealthRecoveryNeeded(command, doctor, syncStatus)) {
    return "bwrk sync refresh --json";
  }
  if (work?.status === "blocked") {
    return `bwrk dep tree ${work.meta.id} --json`;
  }
  if (work && isOpenWorkStatus(work.status)) {
    return `bwrk work show ${work.meta.id} --json`;
  }
  if (work) {
    return `bwrk summary show ${work.meta.id} --json`;
  }
  return "bwrk work list --ready --json";
}

function directiveSkillRefs(
  command: string,
  doctor: DoctorResult | undefined,
  syncStatus: SyncStatusResult
): readonly string[] {
  if (cliHealthRecoveryNeeded(command, doctor, syncStatus)) {
    return ["boreal-health-doctor"];
  }
  if (command.startsWith("sprint ") || command.startsWith("summary ") || command === "gate closeout") {
    return ["boreal-work-execution", "boreal-handoff-builder"];
  }
  return ["boreal-work-execution"];
}

function cliHealthRecoveryNeeded(
  command: string,
  doctor: DoctorResult | undefined,
  syncStatus: SyncStatusResult
): boolean {
  const syncDiagnostics = syncStatusDiagnostics(syncStatus);
  const emitsHealthRecovery = cliCommandEmitsHealthRecovery(command);
  const actionableSyncDiagnostics = emitsHealthRecovery
    ? syncDiagnostics
    : syncDiagnostics.filter((diagnostic) => !isCloseoutHealthDiagnostic(diagnostic.code));
  const attentionSyncDiagnostics = actionableSyncDiagnostics.filter(directiveDiagnosticNeedsAttention);
  if (attentionSyncDiagnostics.length > 0 && !commandSelfRefreshesGeneratedArtifacts(command, syncDiagnostics)) {
    return true;
  }
  if (doctor) {
    const actionableDoctorDiagnostics = emitsHealthRecovery
      ? doctor.diagnostics
      : doctor.diagnostics.filter((diagnostic) => !isCloseoutHealthDiagnostic(diagnostic.code));
    return (!doctor.ok && (emitsHealthRecovery || actionableDoctorDiagnostics.length > 0)) ||
      actionableDoctorDiagnostics.some(doctorDiagnosticNeedsAttention);
  }
  if (command === "doctor" || command.startsWith("sync ") || command.startsWith("lock ")) {
    return syncDiagnostics.some(directiveDiagnosticNeedsAttention);
  }
  return false;
}

function commandSelfRefreshesGeneratedArtifacts(
  command: string,
  syncDiagnostics: readonly AgentDirectiveDiagnosticSnapshot[]
): boolean {
  const definition = findCommandDefinition(command.split(/\s+/u));
  if (!definition) {
    return false;
  }
  const behavior = commandBehavior(definition);
  return (
    INLINE_GENERATED_ARTIFACT_REFRESH_COMMANDS.has(command) &&
    behavior.writesState &&
    behavior.writesGeneratedArtifacts &&
    syncDiagnostics.length > 0 &&
    syncDiagnostics.every((diagnostic) => isGeneratedArtifactStalenessDiagnostic(diagnostic.code))
  );
}

function doctorDiagnosticNeedsAttention(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === "error" || strictBlockingWarning(diagnostic);
}

function directiveDiagnosticNeedsAttention(diagnostic: AgentDirectiveDiagnosticSnapshot): boolean {
  return diagnostic.severity === "warning" || diagnostic.severity === "error" || diagnostic.blocking;
}

function cliDirectiveCommandPath(args: ParsedArgs): string {
  const definition = findCommandDefinition(args.command);
  return definition ? commandPath(definition) : args.command.join(" ");
}

function cliDirectiveArgv(args: ParsedArgs): readonly string[] {
  const flags: string[] = [];
  for (const [name, values] of args.flags.entries()) {
    for (const value of values) {
      flags.push(`--${name}`);
      if (value !== "true") {
        flags.push(value);
      }
    }
  }
  return [...args.command, ...flags];
}

function cliCommandMutatesState(args: ParsedArgs): boolean {
  const definition = findCommandDefinition(args.command);
  if (!definition) {
    return false;
  }
  const behavior = commandBehavior(definition);
  return behavior.writesState || behavior.writesGeneratedArtifacts;
}

function cliCommandIsReadOnly(args: ParsedArgs): boolean {
  const definition = findCommandDefinition(args.command);
  if (!definition) {
    return false;
  }
  return commandBehavior(definition).readOnly;
}

function unprobedSyncStatus(context: CliContext): SyncStatusResult {
  const contentHash = hashContent({ kind: "unprobed-sync", workspaceRoot: context.workspaceRoot }) as ContentHash;
  return {
    ok: true,
    workspaceRoot: context.workspaceRoot,
    checkedAt: nowIso(),
    vault: {
      ok: true,
      initialized: false,
      rootDir: join(context.workspaceRoot, "memory"),
      schemaVersion: VAULT_SCHEMA_VERSION,
      health: {
        ok: true,
        hasWarnings: false,
        rawSourceCount: 0,
        wikiPageCount: 0,
        ledgerEventCount: 0,
        brokenLinks: [],
        orphanPages: [],
        missingSourceRefs: [],
        staleClaims: [],
        malformedRawRecords: [],
        malformedLedgerEvents: [],
        missingArchiveRefs: [],
        missingMergeRefs: []
      },
      requiredDirectories: [],
      requiredFiles: [],
      missingDirectories: [],
      missingFiles: [],
      invalidPaths: []
    },
    ledgers: {
      ok: true,
      path: join(context.workspaceRoot, ".boreal", "ledgers", "manifest.json"),
      exists: false,
      stale: false,
      expectedContentHash: contentHash,
      reconstructable: true
    },
    searchIndex: {
      ok: true,
      path: objectIndexPath(context.workspaceRoot),
      exists: false,
      stale: false,
      expectedCorpusFingerprint: contentHash,
      expectedContentHash: contentHash
    },
    projectRollup: {
      ok: true,
      path: join(context.workspaceRoot, ".boreal", "rollup.json"),
      exists: false,
      stale: false,
      expectedStateContentHash: contentHash
    },
    git: {
      ok: true,
      available: false,
      insideWorktree: false,
      workspaceRoot: context.workspaceRoot,
      detached: false,
      protectedBranch: false,
      protectedBranches: [],
      checkedPaths: [],
      collaborationDirtyPaths: [],
      blockingDirtyPaths: [],
      findings: [],
      recommendedActions: []
    },
    recommendedActions: []
  };
}

function uniqueGitPaths(paths: readonly { readonly status: string; readonly path: string }[]): readonly { readonly status: string; readonly path: string }[] {
  const byPath = new Map<string, { readonly status: string; readonly path: string }>();
  for (const path of paths) {
    byPath.set(path.path, byPath.get(path.path) ?? path);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function compareAgentSummariesNewestFirst(left: AgentSummaryRecord, right: AgentSummaryRecord): number {
  return right.generatedAt.localeCompare(left.generatedAt) || right.meta.id.localeCompare(left.meta.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function buildNextCommandResult(
  context: CliContext,
  args: ParsedArgs,
  agentId: string,
  labels: readonly string[]
): Promise<NextCommandResult> {
  const [syncStatus, status] = await Promise.all([
    buildSyncStatus(context),
    buildAgentStatus(context, agentId, labels)
  ]);
  const checked = {
    activeReservationIds: status.reservations.active.map((reservation) => reservation.id),
    expiredActiveReservationIds: status.reservations.expiredActive.map((reservation) => reservation.id),
    readyWorkCount: status.readyWork.claimableCount,
    ...(status.readyWork.next ? { readyWorkId: status.readyWork.next.id } : {}),
    syncOk: syncStatus.ok
  };

  const activeReservation = status.reservations.active.find((reservation) => !reservation.expired);
  if (activeReservation) {
    const subjectWork = await context.store.read((reader) => requireCliWork(reader, activeReservation.workId as WorkId));
    const fallbackCommand = ensureJsonBwrkCommand(status.recommendedAction.command ?? `bwrk work show ${shellArg(subjectWork.meta.id)}`);
    const selected = await nextDirectiveSelection(context, args, {
      subjectWork,
      syncStatus,
      recommendedCommandPath: fallbackCommand
    });
    return nextCommandResultFromSelection(context, status, checked, "active_reservation", selected, fallbackCommand);
  }

  if (status.reservations.expiredActive.length > 0) {
    const fallbackCommand = ensureJsonBwrkCommand(status.recommendedAction.command ?? "bwrk doctor --fix");
    const selected = await nextDirectiveSelection(context, args, {
      subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" },
      syncStatus,
      recommendedCommandPath: fallbackCommand,
      nextWorkflowRef: "workflows/60-health/sync-and-doctor.md"
    });
    return nextCommandResultFromSelection(context, status, checked, "workspace_health", selected, fallbackCommand);
  }

  const nextReadyWork = status.readyWork.next;
  if (nextReadyWork) {
    const subjectWork = await context.store.read((reader) => requireCliWork(reader, nextReadyWork.id as WorkId));
    const fallbackCommand = ensureJsonBwrkCommand(status.recommendedAction.command ?? `bwrk work claim --agent ${shellArg(status.agentId)}${labelFlags(status.labels)}`);
    const readyWorkDirectiveFilter = (directive: NextCommandDirective) =>
      syncStatus.ok
        ? directive.registryId === "workflow_next.canonical-next-step"
        : directive.family === "doctor" || directive.registryId === "workflow_next.canonical-next-step";
    const selected = await nextDirectiveSelection(context, args, {
      subjectWork,
      syncStatus,
      recommendedCommandPath: fallbackCommand
    }, readyWorkDirectiveFilter);
    return nextCommandResultFromSelection(context, status, checked, "ready_work", selected, fallbackCommand);
  }

  if (!syncStatus.ok) {
    const fallbackCommand = ensureJsonBwrkCommand(syncStatus.recommendedActions[0] ?? "bwrk sync refresh --json");
    const selected = await nextDirectiveSelection(context, args, {
      subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" },
      syncStatus,
      recommendedCommandPath: fallbackCommand,
      nextWorkflowRef: "workflows/60-health/sync-and-doctor.md"
    });
    return nextCommandResultFromSelection(context, status, checked, "workspace_health", selected, fallbackCommand);
  }

  return {
    schemaVersion: "boreal.cli.next.v1",
    workspaceRoot: context.workspaceRoot,
    agentId: status.agentId,
    labels: status.labels,
    state: "idle",
    checked,
    directive: null,
    why: "No active reservation, no expired reservation, no claimable ready work, and workspace health is clean."
  };
}

async function nextDirectiveSelection(
  context: CliContext,
  args: ParsedArgs,
  options: CliAgentDirectiveOptions,
  filter: (directive: NextCommandDirective) => boolean = () => true
): Promise<{ readonly bundle: AgentDirectiveBundle; readonly directive: NextCommandDirective } | undefined> {
  const bundles = await compileCliAgentDirectiveBundles(context, args, options);
  const candidates = bundles.flatMap((bundle) => bundle.directives.map((directive) => ({ bundle, directive }))).filter(({ directive }) => filter(directive));
  const selected = [...candidates].sort((left, right) => compareNextDirective(left.directive, right.directive))[0];
  if (!selected) {
    return undefined;
  }
  return {
    bundle: {
      ...selected.bundle,
      directives: [selected.directive],
      conflicts: [],
      deprecations: [],
      missingRequired: []
    },
    directive: selected.directive
  };
}

function nextCommandResultFromSelection(
  context: CliContext,
  status: AgentStatus,
  checked: NextCommandResult["checked"],
  state: Exclude<NextCommandState, "idle">,
  selected: { readonly bundle: AgentDirectiveBundle; readonly directive: NextCommandDirective } | undefined,
  fallbackCommand: string | undefined
): NextCommandResult {
  if (!selected) {
    const fallbackAction = runtimeExecutableAction(context.workspaceRoot, fallbackCommand);
    return {
      schemaVersion: "boreal.cli.next.v1",
      workspaceRoot: context.workspaceRoot,
      agentId: status.agentId,
      labels: status.labels,
      state,
      checked,
      directive: null,
      command: fallbackAction?.command,
      displayCommand: fallbackAction?.command,
      executableAction: fallbackAction?.executableAction,
      why: status.recommendedAction.reason
    };
  }
  const action = executableActionForDirective(context.workspaceRoot, selected.directive, fallbackCommand);
  if (!action) {
    throw new BorealError("BOREAL_INVARIANT", "Selected next directive does not include an executable command", {
      registryId: selected.directive.registryId,
      state
    });
  }
  return {
    schemaVersion: "boreal.cli.next.v1",
    workspaceRoot: context.workspaceRoot,
    agentId: status.agentId,
    labels: status.labels,
    state,
    checked,
    subject: selected.directive.subject,
    directive: selected.directive,
    command: action.command,
    displayCommand: action.displayCommand,
    executableAction: action.executableAction,
    why: `${selected.directive.title}: ${selected.directive.instruction}`,
    selectionKey: nextDirectiveSelectionKey(selected.directive),
    bundleMeta: selected.bundle.meta
  };
}

function runtimeExecutableAction(
  workspaceRoot: string,
  command: string | undefined
): { readonly command: string; readonly executableAction: NextExecutableAction } | undefined {
  const normalized = ensureJsonBwrkCommand(command);
  if (!normalized?.startsWith("bwrk ")) {
    return undefined;
  }
  const argv = parseTrustedBwrkArgv(normalized, "boreal-runtime-fallback");
  const rendered = shellCommandFromArgv(argv);
  return {
    command: rendered,
    executableAction: {
      source: "boreal_runtime",
      trust: "trusted",
      runner: "boreal_cli",
      argv,
      cwd: workspaceRoot,
      shell: false
    }
  };
}

function nextResultBundle(result: NextCommandResult): AgentDirectiveBundle {
  if (!result.directive || !result.bundleMeta) {
    throw new BorealError("BOREAL_INVARIANT", "Next command result has no directive bundle");
  }
  return {
    meta: result.bundleMeta,
    directives: [result.directive],
    conflicts: [],
    deprecations: [],
    missingRequired: []
  };
}

function executableActionForDirective(
  workspaceRoot: string,
  directive: NextCommandDirective,
  fallbackCommand: string | undefined
): {
  readonly command: string;
  readonly displayCommand: string;
  readonly executableAction: NextExecutableAction;
} | undefined {
  const data = isRecord(directive.data) ? directive.data : {};
  const workAuthoredDisplayCommand =
    stringDataValue(data, "command") ?? firstStringArrayValue(data, "declaredCommands");
  const subjectId = stringDataValue(data, "subjectId") ?? directive.subject?.id;
  const gateId = firstStringArrayValue(data, "gateIds");

  if (directive.registryId === "verification.evidence-required" && subjectId && gateId) {
    const argv = ["bwrk", "evidence", "run", subjectId, "--gate", gateId, "--json"] as const;
    const command = shellCommandFromArgv(argv);
    return {
      command,
      displayCommand: workAuthoredDisplayCommand ?? command,
      executableAction: {
        source: "agent_directive_registry",
        trust: "trusted",
        runner: "bounded_declared_gate",
        registryId: directive.registryId,
        argv,
        cwd: workspaceRoot,
        shell: false
      }
    };
  }

  const directCommand =
    stringDataValue(data, "commandPath") ??
    firstStringArrayValue(data, "recommendedCommands") ??
    stringDataValue(data, "nextCommandPath");
  const preferredCommand = ensureJsonBwrkCommand(directCommand);
  const candidate = preferredCommand?.startsWith("bwrk ") ? preferredCommand : ensureJsonBwrkCommand(fallbackCommand);
  const safeCommand = candidate?.startsWith("bwrk ")
    ? candidate
    : subjectId
      ? `bwrk work show ${shellArg(subjectId)} --json`
      : undefined;
  if (!safeCommand) {
    return undefined;
  }
  const argv = parseTrustedBwrkArgv(safeCommand, directive.registryId);
  const command = shellCommandFromArgv(argv);
  return {
    command,
    displayCommand: workAuthoredDisplayCommand ?? command,
    executableAction: {
      source: "agent_directive_registry",
      trust: "trusted",
      runner: "boreal_cli",
      registryId: directive.registryId,
      argv,
      cwd: workspaceRoot,
      shell: false
    }
  };
}

function parseTrustedBwrkArgv(command: string, registryId: string): readonly string[] {
  let argv: readonly string[];
  try {
    argv = parseDeclaredCommand(command);
  } catch (error) {
    throw new BorealError("BOREAL_INVARIANT", "Registry-projected next action is not a safe exact-argv command", {
      registryId,
      command,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (argv[0] !== "bwrk") {
    throw new BorealError("BOREAL_INVARIANT", "Registry-projected next action must invoke the Boreal CLI", {
      registryId,
      command,
      executable: argv[0]
    });
  }
  return argv;
}

function shellCommandFromArgv(argv: readonly string[]): string {
  return argv.map(shellArg).join(" ");
}

function stringDataValue(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function firstStringArrayValue(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return Array.isArray(value) ? value.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : undefined;
}

function ensureJsonBwrkCommand(command: string | undefined): string | undefined {
  if (!command || !command.startsWith("bwrk ")) {
    return command;
  }
  return /\s--json(?:\s|$)/u.test(command) ? command : `${command} --json`;
}

function compareNextDirective(left: NextCommandDirective, right: NextCommandDirective): number {
  return (
    nextDirectiveSeverityRank(left.severity) - nextDirectiveSeverityRank(right.severity) ||
    triggerCodesKey(left).localeCompare(triggerCodesKey(right)) ||
    (left.subject?.id ?? "").localeCompare(right.subject?.id ?? "") ||
    left.registryId.localeCompare(right.registryId) ||
    left.id.localeCompare(right.id)
  );
}

function nextDirectiveSelectionKey(directive: NextCommandDirective): string {
  return [
    nextDirectiveSeverityRank(directive.severity),
    triggerCodesKey(directive),
    directive.subject?.id ?? "",
    directive.registryId
  ].join("|");
}

function nextDirectiveSeverityRank(severity: NextCommandDirective["severity"]): number {
  switch (severity) {
    case "blocking":
      return 0;
    case "required":
      return 1;
    case "advisory":
      return 2;
    default:
      return 3;
  }
}

function triggerCodesKey(directive: NextCommandDirective): string {
  return [...directive.triggerCodes].sort((left, right) => left.localeCompare(right)).join(",");
}

function formatNextCommandResult(result: NextCommandResult): string {
  const lines = [
    `state: ${result.state}`,
    `agent: ${result.agentId}`,
    `reason: ${result.why}`
  ];
  if (result.subject) {
    lines.push(`subject: ${result.subject.id}`);
  }
  if (result.directive) {
    lines.push(`directive: ${result.directive.registryId}`);
  }
  if (result.command) {
    lines.push(result.command);
  }
  return `${lines.join("\n")}\n`;
}

async function buildAgentProtocolBrief(
  kind: AgentProtocolKind,
  context: CliContext,
  agentId: string,
  labels: readonly string[]
): Promise<AgentProtocolBrief> {
  const [sync, agent, operations, contextPacks] = await Promise.all([
    buildSyncStatus(context),
    buildAgentStatus(context, agentId, labels),
    buildSessionOperationSummary(context, context.sessionId, 10),
    buildContextPackFreshnessSummary(context, agentId)
  ]);
  const commands = buildAgentProtocolCommands(context.sessionId, agent.agentId, agent.labels);
  return {
    kind,
    workspaceRoot: context.workspaceRoot,
    sessionId: context.sessionId,
    agentId: agent.agentId,
    labels: agent.labels,
    checkedAt: nowIso(),
    sync: syncStatusBrief(sync),
    agent,
    operations,
    contextPacks,
    commands,
    recommendedActions: protocolRecommendedActions(kind, sync, agent, operations, commands)
  };
}

async function buildContextPackFreshnessSummary(
  context: CliContext,
  agentId: string
): Promise<ContextPackFreshnessSummary> {
  const active = await context.store.read(async (reader) => {
    return (await reader.listActiveReservationsForAgent(agentId))
      .filter((reservation) => !reservation.expiresAt || Date.parse(reservation.expiresAt) > Date.now())
      .sort((left, right) => left.workId.localeCompare(right.workId));
  });
  const packs = await Promise.all(active.map((reservation) => context.runtime.getContextPack(reservation.workId)));
  const currentSeq = await currentLedgerSeq(context);
  return {
    currentLedgerSeq: currentSeq,
    active: active.map((reservation, index): ContextPackFreshnessRow => {
      const pack = packs[index];
      const packSeq = pack?.ledgerSeq;
      return {
        workId: reservation.workId,
        ...(pack ? { contextPackId: pack.id, generatedAt: pack.generatedAt } : {}),
        ...(packSeq !== undefined ? { contextPackLedgerSeq: packSeq } : {}),
        currentLedgerSeq: currentSeq,
        current: packSeq !== undefined && packSeq === currentSeq
      };
    })
  };
}

async function buildSessionOperationSummary(
  context: CliContext,
  sessionId: string,
  recentLimit: number
): Promise<SessionOperationSummary> {
  const rows = await context.store.read(async (reader) => {
    const operations = await reader.listOperations();
    return operations
      .filter((operation) => operation.sessionId === sessionId)
      .sort(compareOperationsNewestFirst)
      .map(operationListRow);
  });
  const chronologicalRows = [...rows].reverse();
  return {
    sessionId,
    total: rows.length,
    succeeded: rows.filter((row) => row.status === "succeeded").length,
    failed: rows.filter((row) => row.status === "failed").length,
    stateChanged: rows.filter((row) => row.stateChanged).length,
    generatedArtifactsChanged: rows.filter((row) => row.generatedArtifactsChanged).length,
    startedAt: chronologicalRows[0]?.startedAt,
    lastFinishedAt: rows[0]?.finishedAt,
    recent: rows.slice(0, recentLimit)
  };
}

function syncStatusBrief(sync: SyncStatusResult): SyncStatusBrief {
  return {
    ok: sync.ok,
    vaultOk: sync.vault.ok,
    ledgersOk: sync.ledgers.ok,
    searchIndexOk: sync.searchIndex.ok,
    gitOk: sync.git.ok,
    recommendedActions: sync.recommendedActions
  };
}

function buildAgentProtocolCommands(
  sessionId: string,
  agentId: string,
  labels: readonly string[]
): AgentProtocolCommands {
  const sessionFlag = `--session ${shellArg(sessionId)}`;
  const agentFlag = `--agent ${shellArg(agentId)}`;
  const scopedFlags = `${sessionFlag} ${agentFlag}${labelFlags(labels)}`;
  return {
    prime: `bwrk prime ${scopedFlags} --json`,
    sessionStart: `bwrk session start --id ${shellArg(sessionId)} ${agentFlag}${labelFlags(labels)} --json`,
    sessionEnd: `bwrk session end ${scopedFlags} --json`,
    agentStatus: `bwrk agent status ${scopedFlags} --json`,
    agentStart: `bwrk agent start ${scopedFlags} --purpose ${shellArg("start implementation")} --json`,
    reservationList: `bwrk reservation list ${sessionFlag} ${agentFlag} --status active --json`,
    operationList: `bwrk operation list ${sessionFlag} --session-id ${shellArg(sessionId)} --limit 20 --json`,
    syncStatus: `bwrk sync status ${sessionFlag} --json`,
    doctor: `bwrk doctor ${sessionFlag} --json`,
    repair: `bwrk doctor ${sessionFlag} --fix --json`
  };
}

function protocolRecommendedActions(
  kind: AgentProtocolKind,
  sync: SyncStatusResult,
  agent: AgentStatus,
  operations: SessionOperationSummary,
  commands: AgentProtocolCommands
): readonly string[] {
  const actions: string[] = [];
  if (!sync.ok) {
    actions.push(...sync.recommendedActions);
  }
  if (operations.failed > 0) {
    actions.push(`${commands.operationList.replace(" --limit 20", " --status failed --limit 20")}`);
  }
  const agentAction = protocolAgentAction(kind, agent, commands);
  if (agentAction) {
    actions.push(agentAction);
  }
  if (kind !== "session_end") {
    actions.push(commands.sessionEnd);
  }
  return uniqueStrings(actions);
}

function protocolAgentAction(
  kind: AgentProtocolKind,
  agent: AgentStatus,
  commands: AgentProtocolCommands
): string | undefined {
  if (agent.reservations.expiredActiveCount > 0) {
    return commands.repair;
  }
  if (kind === "session_end" && agent.reservations.activeCount > 0) {
    return commands.reservationList;
  }
  switch (agent.recommendedAction.kind) {
    case "claim_work":
      return agent.readyWork.next
        ? commandWithPositionalWork(commands.agentStart, agent.readyWork.next.id)
        : commands.agentStart;
    case "continue_reserved_work":
      return commands.agentStart;
    case "release_or_finish_work":
      return commands.reservationList;
    case "repair_expired_reservations":
      return commands.repair;
    case "wait_for_ready_work":
      return "bwrk work list --ready --json";
    default:
      return agent.recommendedAction.command;
  }
}

function commandWithPositionalWork(command: string, workId: string): string {
  return command.replace("bwrk agent start", `bwrk agent start ${shellArg(workId)}`);
}

function doctorResultCanAttachDirectives(result: DoctorResult): boolean {
  return !result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error" && (diagnostic.code.startsWith("state.") || diagnostic.code === "log.corrupt")
  );
}

async function schemaValidateResult(context: CliContext) {
  const generatedAt = nowIso();
  const document = await buildExportDocument(context);
  const recordIssues = runtimeSnapshotSchemaIssues(document.state);
  const commandMetadata = commandMetadataValidationResult();
  return {
    schemaVersion: "boreal.cli.schema.validate.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    ok: recordIssues.length === 0 && commandMetadata.ok,
    recordCounts: document.recordCounts,
    recordIssueCount: recordIssues.length,
    recordIssues,
    commandMetadata
  };
}

async function docsCheckResult(context: CliContext) {
  const generatedAt = nowIso();
  const assets = await inspectWorkflowAssets({ workspaceRoot: context.workspaceRoot });
  const roots = resolveWorkflowAssetRoots({ workspaceRoot: context.workspaceRoot });
  const documentationTruth = await inspectDocumentationTruth(roots.assetRoot);
  const commandMetadata = commandMetadataValidationResult();
  return {
    schemaVersion: "boreal.cli.docs.check.v1",
    generatedAt,
    ok: assets.ok && commandMetadata.ok && documentationTruth.issueCount === 0,
    workflowCount: assets.workflowCount,
    templateCount: assets.templateCount,
    skillCount: assets.skillCount,
    assetIssueCount: assets.issues.length,
    assetIssues: assets.issues,
    documentationTruth,
    commandMetadata
  };
}

async function gateCloseoutResult(context: CliContext, args: ParsedArgs) {
  const generatedAt = nowIso();
  const strict = hasFlag(args, "strict");
  const autoPruneOperations = !hasFlag(args, "no-auto-prune-operations");
  let checks = await runGateCloseoutChecks(context, strict);
  let operationPrune: GateOperationPruneResult | undefined;
  if (autoPruneOperations && shouldAutoPruneOperationVolume(checks, strict)) {
    operationPrune = {
      triggeredBy: "operation.volume",
      ...(await pruneOperationsWithPolicy(context, { keep: OPERATION_LOG_RECOMMENDED_KEEP }))
    };
    checks = await runGateCloseoutChecks(context, strict);
  }
  const reviewGates = await reviewGateSummaryForWorkspace(context);
  return {
    schemaVersion: "boreal.cli.gate.closeout.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    strict,
    autoPruneOperations,
    operationPrune,
    ok: checks.ok,
    fixed: checks.doctor.fixed || operationPrune !== undefined,
    blockingDiagnosticCodes: checks.doctor.blockingDiagnosticCodes,
    reviewGates,
    sync: gateSyncView(checks.sync),
    doctor: gateDoctorView(checks.doctor),
    schema: checks.schema,
    docs: checks.docs
  };
}

async function runGateCloseoutChecks(context: CliContext, strict: boolean): Promise<GateCloseoutChecks> {
  const sync = await buildSyncRefreshResult(context);
  const doctor = await runDoctor(context, false, strict);
  const schema = await schemaValidateResult(context);
  const docs = await docsCheckResult(context);
  const ok = sync.postRefreshStatusOk && doctor.ok && schema.ok && docs.ok;
  return { sync, doctor, schema, docs, ok };
}

function shouldAutoPruneOperationVolume(checks: GateCloseoutChecks, strict: boolean): boolean {
  if (!strict || checks.ok || !checks.sync.postRefreshStatusOk || !checks.schema.ok || !checks.docs.ok) {
    return false;
  }
  const blockingDiagnostics = checks.doctor.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error" || strictBlockingWarning(diagnostic)
  );
  return blockingDiagnostics.length === 1 && blockingDiagnostics[0]?.code === "operation.volume";
}

function gateSyncView(sync: SyncRefreshResult) {
  return {
    refreshOk: sync.refreshOk,
    postRefreshStatusOk: sync.postRefreshStatusOk,
    exitReason: sync.exitReason,
    contextViews: sync.contextViews,
    ledgersOk: sync.status.ledgers.ok,
    searchIndexOk: sync.status.searchIndex.ok,
    sqliteCacheOk: true,
    statusOk: sync.status.ok,
    recommendedActions: sync.status.recommendedActions
  };
}

function gateDoctorView(doctor: DoctorResult) {
  return {
    ok: doctor.ok,
    fixed: doctor.fixed,
    diagnosticCount: doctor.diagnostics.length,
    errors: doctor.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warnings: doctor.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    fixedCount: doctor.diagnostics.filter((diagnostic) => diagnostic.severity === "fixed").length,
    blockingDiagnosticCodes: doctor.blockingDiagnosticCodes,
    diagnostics: doctor.diagnostics
  };
}

async function reviewGateSummaryForWorkspace(context: CliContext): Promise<ReviewGateSummary> {
  return context.store.read(async (reader) => {
    const [workItems, graphEdges, evidence, verifications, summaries] = await Promise.all([
      reader.listWorkItems(),
      reader.listGraphEdges(),
      reader.listEvidence(),
      reader.listVerifications(),
      reader.listAgentSummaries()
    ]);
    return reviewGateSummaryFromStatuses(
      workItems.map((work) => closeoutGateStatusFromSnapshot(work, workItems, graphEdges, evidence, verifications, summaries))
    );
  });
}

function commandMetadataValidationResult() {
  try {
    validateCommandBehaviorMetadata();
    return {
      ok: true,
      error: undefined
    };
  } catch (error) {
    return {
      ok: false,
      error: errorDetails(error)
    };
  }
}

function formatSkillDoctor(result: Awaited<ReturnType<typeof inspectWorkflowAssets>>): string {
  return [
    `[${result.ok ? "ok" : "error"}] workflow assets`,
    `workflows: ${result.workflowCount}`,
    `templates: ${result.templateCount}`,
    `skills: ${result.skillCount}`,
    ...result.installedChecks.map(
      (check) =>
        `installed ${check.target}: ${check.skillCount} skills, ${check.expectedFileCount} expected files at ${check.skillRoot}`
    ),
    ...result.issues.map((issue) => `[error] ${issue.code}: ${issue.path}: ${issue.message}`)
  ].join("\n") + "\n";
}

async function installedSkillChecks(
  context: CliContext,
  args: ParsedArgs
): Promise<readonly Parameters<typeof validateInstalledSkillRoot>[0][]> {
  const targets = installedSkillTargets(flagValues(args, "skill-target"));
  const explicitRoot = flagValue(args, "install-root");
  const scope = skillInstallScopeFromArgs(args);
  if (!explicitRoot && targets.length === 0) {
    return [];
  }
  const resolvedTargets = targets.length > 0 ? targets : (["skills"] as const);
  return Promise.all(
    resolvedTargets.map(async (target) => ({
      target,
      installRoot: await installRootFromArgs(context, args, target, scope)
    }))
  );
}

function installedSkillTargets(values: readonly string[]): readonly ("codex" | "claude" | "skills")[] {
  const targets = values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const seen = new Set<"codex" | "claude" | "skills">();
  for (const value of targets) {
    if (value !== "codex" && value !== "claude" && value !== "skills") {
      throw new BorealError("BOREAL_INVALID_INPUT", "--skill-target must be codex, claude, or skills");
    }
    seen.add(value);
  }
  return [...seen];
}

function isOpenWorkStatus(status: WorkItemView["status"]): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "verified";
}

async function requireCliWork(reader: BorealReader, workId: WorkId): Promise<WorkItem> {
  const work = await reader.getWorkItem(workId);
  if (!work) {
    throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId, domain: "work" });
  }
  return work;
}

async function requireCliClaim(reader: BorealReader, claimId: ClaimId): Promise<ClaimRecord> {
  const claim = await reader.getClaim(claimId);
  if (!claim) {
    throw new BorealError("BOREAL_NOT_FOUND", "Claim not found", { claimId, domain: "evidence" });
  }
  return claim;
}

async function requireCliDecision(reader: BorealReader, decisionId: DecisionId): Promise<DecisionRecord> {
  const decision = await reader.getDecision(decisionId);
  if (!decision) {
    throw new BorealError("BOREAL_NOT_FOUND", "Decision not found", { decisionId, domain: "evidence" });
  }
  return decision;
}

async function requireCliKnowledgeSources(reader: BorealReader, sourceIds: readonly KnowledgeSourceId[]): Promise<void> {
  const missingSourceIds: KnowledgeSourceId[] = [];
  for (const sourceId of sourceIds) {
    if (!(await reader.getKnowledgeSource(sourceId))) {
      missingSourceIds.push(sourceId);
    }
  }
  if (missingSourceIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge record references missing source", {
      missingSourceIds,
      domain: "evidence"
    });
  }
}

async function requireCliEvidenceRecords(
  reader: BorealReader,
  evidenceIds: readonly EvidenceRecord["meta"]["id"][]
): Promise<void> {
  const missingEvidenceIds: EvidenceRecord["meta"]["id"][] = [];
  for (const evidenceId of evidenceIds) {
    if (!(await reader.getEvidence(evidenceId))) {
      missingEvidenceIds.push(evidenceId);
    }
  }
  if (missingEvidenceIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge record references missing evidence", {
      missingEvidenceIds,
      domain: "evidence"
    });
  }
}

async function appendCliEvent(
  writer: BorealWriter,
  context: CliContext,
  type: string,
  subjectId: string,
  subjectType: string,
  payload: Record<string, unknown>,
  current: IsoTimestamp = nowIso()
): Promise<RuntimeEvent> {
  const event = withContentHash({
    meta: createRecordMeta({
      id: randomId<EventId>("event"),
      now: current,
      actor: context.actor
    }),
    type,
    subjectId,
    subjectType,
    operationId: context.operationId,
    payload
  } satisfies RuntimeEvent);
  await writer.putEvent(event);
  return event;
}

async function activeNonExpiredReservationsForWork(
  reader: BorealReader,
  workId: WorkId,
  current: IsoTimestamp
): Promise<readonly AgentReservation[]> {
  return (await reader.listReservationsForWork(workId)).filter(
    (reservation) => reservation.status === "active" && !reservationExpiredAt(reservation, current)
  );
}

async function expireStaleReservationsForWork(
  writer: BorealWriter,
  workId: WorkId,
  current: IsoTimestamp,
  actor: ActorRef
): Promise<readonly ReservationId[]> {
  const expired: ReservationId[] = [];
  for (const reservation of await writer.listReservationsForWork(workId)) {
    if (reservation.status !== "active" || !reservationExpiredAt(reservation, current)) {
      continue;
    }
    const updated = touchRecord({ ...reservation, status: "expired" as const }, current, actor) satisfies AgentReservation;
    await writer.putReservation(updated);
    expired.push(updated.meta.id);
  }
  return expired;
}

function reservationExpiredAt(reservation: AgentReservation, current: IsoTimestamp): boolean {
  return Boolean(reservation.expiresAt && Date.parse(reservation.expiresAt) <= Date.parse(current));
}

function requiredPositional(values: readonly string[], index: number, label: string): string {
  const value = values[index];
  if (!value) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Missing ${label}`);
  }
  return value;
}

function asSourceId(value: string): KnowledgeSourceId {
  if (!value.startsWith("bw_source_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a source id, got ${value}`);
  }
  return value as KnowledgeSourceId;
}

function asClaimId(value: string): ClaimId {
  if (!value.startsWith("bw_claim_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a claim id, got ${value}`);
  }
  return value as ClaimId;
}

function asDecisionId(value: string): DecisionId {
  if (!value.startsWith("bw_decision_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a decision id, got ${value}`);
  }
  return value as DecisionId;
}

function asVerificationId(value: string): VerificationId {
  if (!value.startsWith("bw_verification_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a verification id, got ${value}`);
  }
  return value as VerificationId;
}

function asAgentSummaryId(value: string): AgentSummaryId {
  if (!value.startsWith("bw_summary_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an agent summary id, got ${value}`);
  }
  return value as AgentSummaryId;
}

function asDirectiveAcknowledgementId(value: string): DirectiveAcknowledgementId {
  if (!value.startsWith("bw_acknowledgement_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a directive acknowledgement id, got ${value}`);
  }
  return value as DirectiveAcknowledgementId;
}

function asAgentDirectiveId(value: string): AgentDirectiveId {
  return asAgentDirectiveLinkId(value, "directive id") as AgentDirectiveId;
}

function asAgentDirectiveTemplateId(value: string): AgentDirectiveTemplateId {
  return asAgentDirectiveLinkId(value, "directive registry id") as AgentDirectiveTemplateId;
}

function asAgentDirectiveVersion(value: string): AgentDirectiveVersion {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Directive version must not be empty");
  }
  return trimmed as AgentDirectiveVersion;
}

function asAgentDirectiveLinkId(value: string, label: string): string {
  const normalized = normalizeMachineString(value, label, { lowerCase: true });
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(normalized)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Invalid ${label}`, { value });
  }
  return normalized;
}

function asGraphEdgeId(value: string): GraphEdgeId {
  if (!value.startsWith("bw_edge_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a graph edge id, got ${value}`);
  }
  return value as GraphEdgeId;
}

function asReservationId(value: string): ReservationId {
  if (!value.startsWith("bw_reservation_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a reservation id, got ${value}`);
  }
  return value as ReservationId;
}

function asReviewerHeartbeatId(value: string): ReviewerHeartbeatId {
  if (!value.startsWith("bw_heartbeat_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a reviewer heartbeat id, got ${value}`);
  }
  return value as ReviewerHeartbeatId;
}

function asEventId(value: string): EventId {
  if (!value.startsWith("bw_event_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an event id, got ${value}`);
  }
  return value as EventId;
}

function asProjectionId(value: string): ProjectionId {
  if (!value.startsWith("bw_projection_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a projection id, got ${value}`);
  }
  return value as ProjectionId;
}

function parseWorkKind(value: string | undefined): WorkKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "issue" || value === "task" || value === "sprint" || value === "milestone") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be issue, task, sprint, or milestone");
}

function parsePriority(value: string | undefined): WorkPriority | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "low" || value === "normal" || value === "high" || value === "critical") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--priority must be low, normal, high, or critical");
}

function listStatus(args: ParsedArgs): WorkStatus | undefined {
  const status = parseWorkStatus(flagValue(args, "status"));
  if (!hasFlag(args, "ready")) {
    return status;
  }
  if (status && status !== "ready") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--ready cannot be combined with a different --status value");
  }
  return "ready";
}

function parseWorkStatus(value: string | undefined): WorkStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "draft" ||
    value === "ready" ||
    value === "reserved" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "needs_verification" ||
    value === "verified" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    "--status must be draft, ready, reserved, in_progress, blocked, needs_verification, verified, closed, or cancelled"
  );
}

function parseCloseoutGateKind(value: string): CloseoutGateKind {
  if (value === "verification" || value === "checkpoint" || value === "review" || value === "audit") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "required gate kind must be verification, checkpoint, review, or audit");
}

function parseCloseoutGateForceReason(value: string | undefined): CloseoutGateForceReasonCode {
  if (
    value === "review_unavailable" ||
    value === "audit_unavailable" ||
    value === "external_review_record" ||
    value === "legacy_backfill" ||
    value === "user_accepted_risk" ||
    value === "emergency_closeout"
  ) {
    return value;
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    "--force-gate-reason must be review_unavailable, audit_unavailable, external_review_record, legacy_backfill, user_accepted_risk, or emergency_closeout"
  );
}

function parseCloseoutGateScope(value: string | undefined): CloseoutGateScope | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "self" || value === "direct_children" || value === "descendants") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "required gate scope must be self, direct_children, or descendants");
}

function parseSummarySubjectType(value: string | undefined): AgentSummarySubjectType | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "work" || value === "sprint" || value === "milestone" || value === "phase" || value === "project" || value === "session") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--subject-type must be work, sprint, milestone, phase, project, or session");
}

function parseSummaryKind(value: string | undefined): AgentSummaryKind | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "task" ||
    value === "sprint" ||
    value === "milestone" ||
    value === "phase" ||
    value === "project" ||
    value === "session" ||
    value === "legacy_backfill"
  ) {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be task, sprint, milestone, phase, project, session, or legacy_backfill");
}

function parseSummaryStatus(value: string | undefined, forceReason: string | undefined): AgentSummaryStatus {
  if (!value) {
    return forceReason ? "forced" : "final";
  }
  if (value === "draft" || value === "final" || value === "forced") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be draft, final, or forced");
}

function parseSummaryOutcome(value: string | undefined): AgentSummaryOutcome {
  if (!value) {
    return "completed";
  }
  if (
    value === "completed" ||
    value === "partial" ||
    value === "deferred" ||
    value === "duplicate" ||
    value === "cancelled" ||
    value === "blocked" ||
    value === "no_change"
  ) {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--outcome must be completed, partial, deferred, duplicate, cancelled, blocked, or no_change");
}

function parseSummaryForceReason(value: string | undefined): AgentSummaryForceReasonCode | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "duplicate" ||
    value === "cancelled_no_work" ||
    value === "external_close" ||
    value === "legacy_backfill" ||
    value === "summary_unavailable" ||
    value === "operator_override"
  ) {
    return value;
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    "--force-reason must be duplicate, cancelled_no_work, external_close, legacy_backfill, summary_unavailable, or operator_override"
  );
}

function summaryKindForWork(work: WorkItem, subjectType: AgentSummarySubjectType): AgentSummaryKind {
  if (subjectType === "sprint" || subjectType === "milestone" || subjectType === "phase" || subjectType === "project" || subjectType === "session") {
    return subjectType;
  }
  return work.kind === "sprint" || work.kind === "milestone" ? work.kind : "task";
}

function normalizeCommitSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(normalized)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a Git commit SHA, got ${value}`);
  }
  return normalized;
}

function dependencyTypeFromArgs(args: ParsedArgs): "blocks" {
  const type = flagValue(args, "type") ?? "blocks";
  if (type !== "blocks") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Only --type blocks is currently supported");
  }
  return "blocks";
}

function parseReservationStatus(value: string | undefined): ReservationStatus | undefined {
  if (!value) {
    return "active";
  }
  if (value === "all") {
    return undefined;
  }
  if (value === "active" || value === "released" || value === "expired") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be active, released, expired, or all");
}

function parseOperationStatus(value: string | undefined): RuntimeOperationStatus | undefined {
  if (!value || value === "all") {
    return undefined;
  }
  if (value === "succeeded" || value === "failed") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be succeeded, failed, or all");
}

function parseLimit(value: string | undefined, options: { readonly max?: number } = {}): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--limit must be a positive integer");
  }
  const max = options.max ?? MAX_LIST_LIMIT;
  if (parsed > max) {
    throw new BorealError("BOREAL_INVALID_INPUT", `--limit must be at most ${max}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseHandoffResultLimit(args: ParsedArgs): number {
  return parseLimit(flagValue(args, "limit"), { max: MAX_HANDOFF_SEARCH_LIMIT }) ?? DEFAULT_HANDOFF_SEARCH_LIMIT;
}

function parseOperationKeep(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--keep must be a positive integer");
  }
  return parsed;
}

function parseOperationBefore(value: string | undefined): IsoTimestamp | undefined {
  if (!value) {
    return undefined;
  }
  if (!isIsoTimestamp(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--before must be an ISO timestamp");
  }
  return value;
}

function parseReservationExpiresAt(args: ParsedArgs): IsoTimestamp | undefined {
  const expiresAt = flagValue(args, "expires-at");
  const ttl = flagValue(args, "ttl");
  if (expiresAt && ttl) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--expires-at cannot be combined with --ttl");
  }
  if (expiresAt) {
    if (!isIsoTimestamp(expiresAt)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "--expires-at must be an ISO timestamp");
    }
    return expiresAt;
  }
  if (ttl) {
    return expiresAtFromTtl(ttl);
  }
  return undefined;
}

function requiredReservationExpiresAt(args: ParsedArgs): IsoTimestamp {
  const expiresAt = parseReservationExpiresAt(args);
  if (!expiresAt) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reservation renewal requires --expires-at or --ttl");
  }
  return expiresAt;
}

function expiresAtFromTtl(value: string): IsoTimestamp {
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--ttl must be a positive duration like 30m, 2h, or 1d");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + amount * multiplier).toISOString() as IsoTimestamp;
}

function parseEvidenceKind(value: string | undefined): EvidenceKind {
  const kind = value ?? "command";
  if (kind === "command" || kind === "test" || kind === "diff" || kind === "review" || kind === "artifact" || kind === "note") {
    return kind;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be command, test, diff, review, artifact, or note");
}

function parseOutcome(value: string | undefined): EvidenceOutcome {
  const outcome = value ?? "observed";
  if (outcome === "passed" || outcome === "failed" || outcome === "observed" || outcome === "unknown") {
    return outcome;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--outcome must be passed, failed, observed, or unknown");
}

function parseFinishOutcome(value: string | undefined, verdict: VerificationVerdict): EvidenceOutcome {
  if (value) {
    return parseOutcome(value);
  }
  return verdict === "passed" ? "passed" : "failed";
}

function parseVerdict(value: string | undefined): VerificationVerdict {
  if (value === undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--verdict is required and must be passed or failed");
  }
  const verdict = value;
  if (verdict === "passed" || verdict === "failed") {
    return verdict;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--verdict must be passed or failed");
}

function inferDirectiveRegistryId(directiveId: AgentDirectiveId): AgentDirectiveTemplateId | undefined {
  const raw = String(directiveId);
  const candidate = raw.startsWith("directive.")
    ? raw.slice("directive.".length).replace(/\.[a-f0-9]{12,64}$/u, "")
    : raw;
  return AGENT_DIRECTIVE_REGISTRY.entries.some((entry) => entry.id === candidate)
    ? (candidate as AgentDirectiveTemplateId)
    : undefined;
}

function optionalDirectiveReasonCode(value: string | undefined): string | undefined {
  return value ? asAgentDirectiveLinkId(value, "directive acknowledgement reason code") : undefined;
}

function optionalTrimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDirectiveArtifactUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Directive acknowledgement artifact URI must be non-empty");
  }
  return trimmed;
}

function optionalMachineString(value: string | undefined, label: string): string | undefined {
  return value ? normalizeMachineString(value, label, { lowerCase: true }) : undefined;
}

function optionalContentHash(value: string | undefined): ContentHash | undefined {
  if (!value) {
    return undefined;
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--source-hash must be a sha256 content hash");
  }
  return value as ContentHash;
}

function isWorkLikeDirectiveSubject(type: AgentDirectiveSubjectType): boolean {
  return type === "work" || type === "sprint" || type === "phase" || type === "milestone";
}

function assertDirectiveAcknowledgementPolicy(input: {
  readonly outcome: DirectiveAcknowledgementOutcome;
  readonly evidenceIds: readonly EvidenceId[];
  readonly agentSummaryIds: readonly AgentSummaryId[];
  readonly verificationIds: readonly VerificationId[];
  readonly artifactUris: readonly string[];
  readonly handoffIds: readonly string[];
  readonly reasonCode?: string;
  readonly reason?: string;
}): void {
  const hasEvidenceLink =
    input.evidenceIds.length > 0 ||
    input.agentSummaryIds.length > 0 ||
    input.verificationIds.length > 0 ||
    input.artifactUris.length > 0 ||
    input.handoffIds.length > 0;
  const hasReason = Boolean(input.reasonCode || input.reason);
  if (input.outcome === "satisfied" && !hasEvidenceLink && !hasReason) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      "Satisfied directive acknowledgements require --evidence, --summary, --verification, --artifact-uri, --handoff, --reason, or --reason-code"
    );
  }
  if (input.outcome !== "satisfied" && !hasReason) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Deferred, noncompliant, and not-applicable acknowledgements require --reason or --reason-code");
  }
}

async function requireDirectiveAcknowledgementWorkSubject(
  reader: BorealReader,
  subjectId: string | undefined,
  subjectType: AgentDirectiveSubjectType
): Promise<WorkItem> {
  if (!subjectId) {
    throw new BorealError("BOREAL_INVALID_INPUT", `--subject-id is required when --subject-type is ${subjectType}`);
  }
  const work = await requireCliWork(reader, asWorkId(subjectId));
  if (subjectType === "sprint" && work.kind !== "sprint") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--subject-type sprint requires a sprint work item", {
      subjectId,
      workKind: work.kind
    });
  }
  if ((subjectType === "phase" || subjectType === "milestone") && work.kind !== "milestone") {
    throw new BorealError("BOREAL_INVALID_INPUT", `--subject-type ${subjectType} requires a milestone work item`, {
      subjectId,
      workKind: work.kind
    });
  }
  return work;
}

async function requireDirectiveAcknowledgementEvidence(
  reader: BorealReader,
  evidenceIds: readonly EvidenceId[]
): Promise<void> {
  const missingEvidenceIds: EvidenceId[] = [];
  for (const evidenceId of evidenceIds) {
    if (!(await reader.getEvidence(evidenceId))) {
      missingEvidenceIds.push(evidenceId);
    }
  }
  if (missingEvidenceIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement references missing evidence", {
      missingEvidenceIds,
      domain: "evidence"
    });
  }
}

async function requireDirectiveAcknowledgementSummaries(
  reader: BorealReader,
  summaryIds: readonly AgentSummaryId[]
): Promise<void> {
  const missingSummaryIds: AgentSummaryId[] = [];
  for (const summaryId of summaryIds) {
    if (!(await reader.getAgentSummary(summaryId))) {
      missingSummaryIds.push(summaryId);
    }
  }
  if (missingSummaryIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement references missing agent summary", {
      missingSummaryIds,
      domain: "summary"
    });
  }
}

async function requireDirectiveAcknowledgementVerifications(
  reader: BorealReader,
  verificationIds: readonly VerificationId[]
): Promise<void> {
  const missingVerificationIds: VerificationId[] = [];
  for (const verificationId of verificationIds) {
    if (!(await reader.getVerification(verificationId))) {
      missingVerificationIds.push(verificationId);
    }
  }
  if (missingVerificationIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement references missing verification", {
      missingVerificationIds,
      domain: "evidence"
    });
  }
}

function agentIdFromArgs(args: ParsedArgs, fallback: string): string {
  return normalizeActorId(flagValue(args, "agent") ?? fallback);
}

function operationSessionIdFromArgs(args: ParsedArgs): string | undefined {
  const isSessionCommand = args.command[0] === "session" && (args.command[1] === "start" || args.command[1] === "end");
  if (!isSessionCommand) {
    return undefined;
  }

  const explicitId = flagValue(args, "id");
  const globalId = flagValue(args, "session");
  const envId = process.env.BOREAL_SESSION_ID;
  if (explicitId && globalId && normalizeActorId(explicitId) !== normalizeActorId(globalId)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Use either --id or --session for session commands, not conflicting values");
  }
  if (explicitId) {
    return normalizeActorId(explicitId);
  }
  if (globalId || envId) {
    return undefined;
  }
  return args.command[1] === "start" ? generatedSessionId() : undefined;
}

function generatedSessionId(): string {
  return normalizeActorId(`session-${randomId("operation", 6).replace(/^bw_operation_/u, "")}`);
}

function optionalAgentIdFromArgs(args: ParsedArgs): string | undefined {
  const value = flagValue(args, "agent");
  return value ? normalizeActorId(value) : undefined;
}

function labelsFromArgs(args: ParsedArgs): readonly string[] {
  return normalizeLabels(flagValues(args, "label"));
}

function sourceRefsFromArgs(args: ParsedArgs): readonly SourceRef[] {
  return flagValues(args, "source").map((source) => ({ uri: normalizeMachineString(source, "source ref uri") }));
}

async function resolveCommand(rest: readonly string[], args: ParsedArgs, output: CliOutput, json: boolean): Promise<CommandResult> {
  const uri = requiredPositional(rest, 0, "boreal reference uri");
  const result = await resolveBorealReferenceForCli(uri, args);
  output.write(json ? formatRecord(result, true) : formatBorealResolveResult(result));
  return { exitCode: 0 };
}

async function addExternalBlockingDependencyCommand(
  context: CliContext,
  args: ParsedArgs,
  blockedWorkId: WorkId,
  blockerUri: string
): Promise<{
  readonly schemaVersion: "boreal.cli.dep.external-add.v1";
  readonly edge: GraphEdge;
  readonly work: WorkItem;
  readonly gaps: readonly EnforcementGap[];
  readonly externalDependency: ExternalDependencyResolution;
}> {
  const parsed = parseBorealReferenceUri(blockerUri);
  if (!parsed.ok) {
    throw new BorealError("BOREAL_INVALID_INPUT", parsed.reason, { uri: blockerUri, domain: "work" });
  }
  if (parsed.reference.recordKind !== "work") {
    throw new BorealError("BOREAL_INVALID_INPUT", "External blocking dependencies must reference work records", {
      uri: blockerUri,
      recordKind: parsed.reference.recordKind,
      domain: "work"
    });
  }
  const rollups = await refreshGlobalRollupCacheForArgs(args);
  const externalDependency = externalDependencyResolutionFromRollups(parsed.reference.uri, rollups);
  const result = await context.runtime.addExternalBlockingDependency({
    blockedWorkId,
    blockerProjectId: parsed.reference.projectId,
    blockerWorkId: parsed.reference.recordId as unknown as WorkId,
    resolveExternalDependency: () => externalDependency
  });
  return {
    schemaVersion: "boreal.cli.dep.external-add.v1",
    edge: result.edge,
    work: result.work,
    gaps: result.gaps,
    externalDependency
  };
}

async function resolveBorealReferenceForCli(uri: string, args: ParsedArgs): Promise<BorealResolveResult> {
  const registry = await listProjectRegistry({ registryRoot: flagValue(args, "registry-root") });
  const parsed = parseBorealReferenceUri(uri);
  const project = parsed.ok ? registry.entries.find((entry) => entry.id === parsed.reference.projectId) : undefined;
  const lastKnownRollup = project ? await readRegisteredProjectRollup(project) : undefined;
  const resolution = await resolveBorealReferenceUri({
    registry: registry.entries,
    uri,
    readRecord: (entry, reference) => readRegisteredProjectRecord(entry, reference),
    ...(project && lastKnownRollup !== undefined ? { lastKnownRollups: { [project.id]: lastKnownRollup } } : {})
  });
  return {
    schemaVersion: "boreal.cli.resolve.v1",
    generatedAt: nowIso(),
    uri,
    registryRoot: registry.storage.rootDir,
    registryFile: registry.storage.registryFile,
    resolution: borealReferenceResolutionCliView(resolution)
  };
}

async function readRegisteredProjectRollup(project: ProjectRegistryEntry): Promise<unknown | undefined> {
  const rollupPath = join(project.borealDir, "rollup.json");
  if (!existsSync(rollupPath)) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(rollupPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function refreshGlobalRollupCacheForArgs(args: ParsedArgs): Promise<GlobalRollupCacheResult> {
  return refreshGlobalRollupCache({
    registryRoot: flagValue(args, "registry-root"),
    ttlMs: parseNonNegativeInteger(flagValue(args, "live-cache-ttl-ms"), "--live-cache-ttl-ms") ?? 60_000,
    source: "lazy"
  });
}

function externalDependencyResolutionFromRollups(
  uri: string,
  rollups: GlobalRollupCacheResult
): ExternalDependencyResolution {
  const parsed = parseBorealReferenceUri(uri);
  if (!parsed.ok) {
    return unresolvedExternalDependencyResolution(uri, "unknown", "unknown" as WorkId, parsed.reason);
  }
  const reference = parsed.reference;
  const project = rollups.projects.find((candidate) => candidate.projectId === reference.projectId);
  if (!project) {
    return unresolvedExternalDependencyResolution(
      reference.uri,
      reference.projectId,
      reference.recordId as unknown as WorkId,
      rollups.registryError ? `registry unresolved: ${rollups.registryError}` : "project not found in global rollup cache"
    );
  }
  if (project.stale || project.status === "stale") {
    return {
      referenceUri: reference.uri,
      projectId: reference.projectId,
      workId: reference.recordId as unknown as WorkId,
      terminal: false,
      reason: "stale",
      message: project.error ?? `project rollup cache is stale after ${project.cacheAgeMs ?? 0}ms`
    };
  }
  if (!project.rollup || project.status === "degraded") {
    return unresolvedExternalDependencyResolution(
      reference.uri,
      reference.projectId,
      reference.recordId as unknown as WorkId,
      project.error ?? "project rollup unavailable"
    );
  }
  const work = projectRollupWorkIndexEntry(project.rollup, reference.recordId as unknown as WorkId);
  if (!work) {
    return unresolvedExternalDependencyResolution(
      reference.uri,
      reference.projectId,
      reference.recordId as unknown as WorkId,
      project.rollup.workIndex
        ? "work record not present in project rollup workIndex"
        : "project rollup does not include workIndex"
    );
  }
  const terminal = !isOpenWorkStatus(work.status);
  return {
    referenceUri: reference.uri,
    projectId: reference.projectId,
    workId: work.workId,
    terminal,
    status: work.status,
    title: work.title,
    ...(terminal ? {} : { reason: "open" as const, message: `referenced work is ${work.status}` })
  };
}

function unresolvedExternalDependencyResolution(
  referenceUri: string,
  projectId: string,
  workId: WorkId,
  message: string
): ExternalDependencyResolution {
  return {
    referenceUri,
    projectId,
    workId,
    terminal: false,
    reason: "unresolved",
    message
  };
}

function projectRollupWorkIndexEntry(
  rollup: ProjectRollupDocument,
  workId: WorkId
): ProjectRollupWorkIndexEntry | undefined {
  return rollup.workIndex?.work.find((entry) => entry.workId === workId);
}

async function readRegisteredProjectRecord(project: ProjectRegistryEntry, reference: BorealReference): Promise<unknown | undefined> {
  try {
    if (!existsSync(project.projectRoot) || !existsSync(project.projectConfigPath)) {
      return undefined;
    }
    const storage = await readProjectStorage(project.projectRoot) ?? "file-v2";
    const store = openRegisteredProjectStoreForResolve(project.projectRoot, storage);
    return await store.read((reader) => readBorealReferenceRecord(reader, reference.recordKind, reference.recordId));
  } catch {
    return undefined;
  }
}

function openRegisteredProjectStoreForResolve(rootDir: string, storage: ProjectStorageKind): BorealStore {
  return storage === "objects-v1" ? new ObjectDirBorealStore({ rootDir }) : new FileBorealStore({ rootDir });
}

async function readBorealReferenceRecord(
  reader: BorealReader,
  recordKind: BorealReferenceRecordKind,
  recordId: string
): Promise<unknown | undefined> {
  switch (recordKind) {
    case "acknowledgement":
      return reader.getDirectiveAcknowledgement(recordId as DirectiveAcknowledgementId);
    case "claim":
      return reader.getClaim(recordId as ClaimId);
    case "decision":
      return reader.getDecision(recordId as DecisionId);
    case "edge":
      return reader.getGraphEdge(recordId as GraphEdgeId);
    case "event":
      return (await reader.listEvents()).find((event) => event.meta.id === recordId);
    case "evidence":
      return reader.getEvidence(recordId as EvidenceId);
    case "gate":
      return readRequiredGateRecord(reader, recordId);
    case "heartbeat":
      return reader.getReviewerHeartbeat(recordId as ReviewerHeartbeatId);
    case "operation":
      return reader.getOperation(recordId as OperationId);
    case "projection":
      return reader.getProjection(recordId as ProjectionId);
    case "reservation":
      return reader.getReservation(recordId as ReservationId);
    case "source":
      return reader.getKnowledgeSource(recordId as KnowledgeSourceId);
    case "summary":
      return reader.getAgentSummary(recordId as AgentSummaryId);
    case "verification":
      return reader.getVerification(recordId as VerificationId);
    case "work":
      return reader.getWorkItem(recordId as WorkId);
    case "agent":
    case "page":
      return undefined;
  }
}

async function readRequiredGateRecord(reader: BorealReader, recordId: string): Promise<RequiredCloseoutGate | undefined> {
  for (const work of await reader.listWorkItems()) {
    const gate = (work.requiredCloseoutGates ?? []).find((candidate) => candidate.id === recordId);
    if (gate) {
      return gate;
    }
  }
  return undefined;
}

function borealReferenceResolutionCliView(resolution: BorealReferenceResolution): BorealReferenceResolutionCliView {
  switch (resolution.status) {
    case "resolved": {
      const target = borealReferenceTargetView(resolution.record);
      return {
        status: "resolved",
        uri: resolution.reference.uri,
        projectId: resolution.reference.projectId,
        projectName: resolution.project.display.name,
        projectLifecycle: resolution.project.lifecycle,
        recordId: resolution.reference.recordId,
        recordKind: resolution.reference.recordKind,
        title: target.title,
        targetStatus: target.status,
        reference: resolution.reference,
        project: borealReferenceProjectView(resolution.project),
        target,
        record: resolution.record
      };
    }
    case "unresolved-unlinked":
      return {
        status: "unresolved-unlinked",
        uri: resolution.reference.uri,
        projectId: resolution.reference.projectId,
        projectName: resolution.project.display.name,
        projectLifecycle: resolution.projectLifecycle,
        recordId: resolution.reference.recordId,
        recordKind: resolution.reference.recordKind,
        reason: `project ${resolution.projectLifecycle}`,
        reference: resolution.reference,
        project: borealReferenceProjectView(resolution.project),
        lastKnownRollup: resolution.lastKnownRollup
      };
    case "unresolved-missing-project":
      return {
        status: "unresolved-missing-project",
        uri: resolution.reference.uri,
        projectId: resolution.reference.projectId,
        projectName: resolution.project?.display.name,
        projectLifecycle: resolution.projectLifecycle ?? resolution.project?.lifecycle,
        recordId: resolution.reference.recordId,
        recordKind: resolution.reference.recordKind,
        reason: resolution.projectLifecycle === "missing" ? "project missing" : "project not found in registry",
        reference: resolution.reference,
        ...(resolution.project ? { project: borealReferenceProjectView(resolution.project) } : {}),
        lastKnownRollup: resolution.lastKnownRollup
      };
    case "unresolved-missing-record":
      return {
        status: "unresolved-missing-record",
        uri: resolution.reference.uri,
        projectId: resolution.reference.projectId,
        projectName: resolution.project.display.name,
        projectLifecycle: resolution.project.lifecycle,
        recordId: resolution.reference.recordId,
        recordKind: resolution.reference.recordKind,
        reason: `${resolution.reference.recordKind} record not found`,
        reference: resolution.reference,
        project: borealReferenceProjectView(resolution.project),
        lastKnownRollup: resolution.lastKnownRollup
      };
    case "invalid-uri":
      return {
        status: "invalid-uri",
        uri: resolution.uri,
        reason: resolution.reason
      };
  }
}

function borealReferenceProjectView(project: ProjectRegistryEntry): BorealReferenceProjectView {
  return {
    id: project.id,
    name: project.display.name,
    lifecycle: project.lifecycle,
    projectRoot: project.projectRoot
  };
}

function borealReferenceTargetView(record: unknown): BorealReferenceTargetView {
  if (!isRecord(record)) {
    return {};
  }
  const meta = isRecord(record.meta) ? record.meta : undefined;
  return {
    id: typeof meta?.id === "string" ? meta.id : undefined,
    kind: typeof record.kind === "string" ? record.kind : undefined,
    title: typeof record.title === "string" ? record.title : undefined,
    status: typeof record.status === "string" ? record.status : undefined
  };
}

function borealSourceRefResolutionView(resolution: BorealReferenceResolutionCliView): BorealSourceRefResolutionView {
  return {
    status: resolution.status,
    uri: resolution.uri,
    projectId: resolution.projectId,
    projectName: resolution.projectName,
    projectLifecycle: resolution.projectLifecycle,
    recordId: resolution.recordId,
    recordKind: resolution.recordKind,
    title: resolution.title,
    targetStatus: resolution.targetStatus,
    reason: resolution.reason
  };
}

async function resolveBorealSourceRefs(_context: CliContext, args: ParsedArgs, view: WorkItemView): Promise<WorkItemView> {
  const sourceRefs = view.sourceRefs ?? [];
  if (sourceRefs.length === 0) {
    return view;
  }
  const resolvedRefs: WorkSourceRefView[] = [];
  const resolutions: BorealSourceRefResolutionView[] = [];
  for (const sourceRef of sourceRefs) {
    if (!isBorealSourceRefCandidate(sourceRef.uri)) {
      resolvedRefs.push(sourceRef);
      continue;
    }
    const result = await resolveBorealReferenceForCli(sourceRef.uri, args);
    const resolution = borealSourceRefResolutionView(result.resolution);
    resolutions.push(resolution);
    resolvedRefs.push({ ...sourceRef, borealReference: resolution });
  }
  return resolutions.length > 0 ? { ...view, sourceRefs: resolvedRefs, sourceRefResolutions: resolutions } : view;
}

function isBorealSourceRefCandidate(uri: string): boolean {
  return uri.startsWith("boreal://");
}

function formatBorealResolveResult(result: BorealResolveResult): string {
  const resolution = result.resolution;
  const target = resolution.title || resolution.recordId || result.uri;
  const suffix = resolution.status === "resolved" && resolution.targetStatus ? ` (${resolution.targetStatus})` : "";
  const reason = resolution.reason ? `: ${resolution.reason}` : "";
  return `[${resolution.status}] ${result.uri} -> ${target}${suffix}${reason}\n`;
}

function requiredCloseoutGateInputsFromArgs(args: ParsedArgs): readonly RequiredCloseoutGateInput[] {
  const gateValues = flagValues(args, "required-gate");
  const gateCommands = flagValues(args, "gate-command");
  const gateExpectedObservables = flagValues(args, "gate-expect");
  const gateTrust = flagValues(args, "gate-trust");
  const requireCurrentRevision = hasFlag(args, "gate-current-revision");
  const requireCurrentGitHead = hasFlag(args, "gate-current-git");
  if (gateValues.length === 0 && (gateCommands.length > 0 || gateExpectedObservables.length > 0)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--gate-command and --gate-expect require --required-gate");
  }
  if (gateValues.length === 0 && (gateTrust.length > 0 || requireCurrentRevision || requireCurrentGitHead)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Gate policy flags require --required-gate");
  }
  if (gateCommands.length > gateValues.length || gateExpectedObservables.length > gateValues.length) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      "--gate-command and --gate-expect must not be repeated more times than --required-gate"
    );
  }
  if (gateTrust.length > gateValues.length) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      "--gate-trust must not be repeated more times than --required-gate"
    );
  }
  return gateValues.map((value, index) => {
    const [kindValue, scopeValue, extra] = value.split(":");
    if (!kindValue || extra !== undefined) {
      throw new BorealError("BOREAL_INVALID_INPUT", "--required-gate must use kind or kind:scope");
    }
    const declaredCommand = optionalRequiredGateText(gateCommands[index], "--gate-command");
    const expectedObservable = optionalRequiredGateText(gateExpectedObservables[index], "--gate-expect");
    const requiredTrustLevels = parseGateTrustLevels(gateTrust[index]);
    return {
      kind: parseCloseoutGateKind(kindValue),
      scope: parseCloseoutGateScope(scopeValue),
      ...(declaredCommand ? { declaredCommand } : {}),
      ...(expectedObservable ? { expectedObservable } : {}),
      ...(requiredTrustLevels ? { requiredTrustLevels } : {}),
      ...(requireCurrentRevision ? { requireCurrentRevision: true } : {}),
      ...(requireCurrentGitHead ? { requireCurrentGitHead: true } : {})
    };
  });
}

function parseGateTrustLevels(value: string | undefined): readonly EvidenceTrustLevel[] | undefined {
  if (value === undefined) return undefined;
  if (value === "trusted") return ["boreal_witnessed", "external_attested"];
  if (
    value === "legacy_unattested" ||
    value === "self_reported" ||
    value === "boreal_witnessed" ||
    value === "external_attested"
  ) {
    return [value];
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    "--gate-trust must be trusted, legacy_unattested, self_reported, boreal_witnessed, or external_attested"
  );
}

function optionalRequiredGateText(value: string | undefined, flagName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${flagName} must be non-empty`);
  }
  return trimmed;
}

async function resolveWorkId(
  context: CliContext,
  value: string,
  options?: { readonly agentId?: string }
): Promise<WorkId> {
  return context.runtime.resolveWorkReference(value, options);
}

async function requireReservation(context: CliContext, reservationId: string): Promise<AgentReservation> {
  const reservation = await context.store.read((reader) => reader.getReservation(reservationId as ReservationId));
  if (!reservation || reservation.status !== "active") {
    throw new BorealError("BOREAL_CONFLICT", "Active reservation changed while starting agent", { reservationId });
  }
  return reservation;
}

async function buildHandoffBundle(
  context: CliContext,
  workId: WorkId,
  args: ParsedArgs,
  resultLimit: number
): Promise<HandoffBundle> {
  const [rawWork, contextPack] = await Promise.all([context.runtime.getWorkView(workId), context.runtime.getContextPack(workId)]);
  const work = await resolveBorealSourceRefs(context, args, rawWork);
  await writeSearchIndex(context);
  const queryFlag = flagValue(args, "query");
  const query = queryFlag ? normalizeSearchQuery(queryFlag) : handoffSearchQuery(work, contextPack);
  const results = await runSearch(context, query, {
    limit: Math.max(resultLimit, HANDOFF_SEARCH_MIN_CANDIDATES)
  });
  const ledgerSeq = await currentLedgerSeq(context);
  const contextPackLedgerSeq = contextPack.ledgerSeq ?? ledgerSeq;
  return {
    work,
    contextPack,
    contextFreshness: {
      contextPackLedgerSeq,
      currentLedgerSeq: ledgerSeq,
      current: contextPackLedgerSeq === ledgerSeq
    },
    search: {
      query,
      results: results.slice(0, resultLimit)
    }
  };
}

async function buildHandoffResult(
  context: CliContext,
  workId: WorkId,
  args: ParsedArgs,
  resultLimit: number,
  fallbackWork?: WorkItem
): Promise<HandoffResult> {
  try {
    const bundle = await buildHandoffBundle(context, workId, args, resultLimit);
    return {
      handoffComplete: true,
      warnings: [],
      ...bundle
    };
  } catch (error) {
    return {
      handoffComplete: false,
      work: await fallbackWorkView(context, workId, fallbackWork),
      warnings: [handoffFailureWarning(error)],
      repairCommand: "bwrk doctor --fix --json"
    };
  }
}

async function fallbackWorkView(
  context: CliContext,
  workId: WorkId,
  fallbackWork: WorkItem | undefined
): Promise<WorkItemView | undefined> {
  if (fallbackWork) {
    return toWorkItemView({ work: fallbackWork });
  }
  const work = await context.store.read((reader) => reader.getWorkItem(workId));
  return work ? toWorkItemView({ work }) : undefined;
}

function handoffFailureWarning(error: unknown): HandoffWarning {
  return {
    code: "handoff.failed",
    message: "Handoff generation failed after reservation; run the repair command before relying on context or search.",
    details: errorDetails(error)
  };
}

function errorDetails(error: unknown): unknown {
  if (error instanceof BorealError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      gaps: error.gaps
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message
    };
  }
  return String(error);
}

function agentStartBlocked(
  agentId: string,
  labels: readonly string[],
  status: AgentStatus,
  reason: AgentStartReason
): AgentStartBlocked {
  return {
    started: false,
    reason,
    agentId,
    labels,
    status,
    recommendedAction: status.recommendedAction
  };
}

async function buildAgentGuide(context: CliContext, agentId: string, labels: readonly string[]): Promise<AgentGuide> {
  const normalizedAgentId = normalizeActorId(agentId);
  const normalizedLabels = normalizeLabels(labels);
  const declaredGateHint = await agentGuideDeclaredGateHint(context, normalizedAgentId, normalizedLabels);
  const agentFlag = `--agent ${shellArg(normalizedAgentId)}`;
  const scopedFlags = `${agentFlag}${labelFlags(normalizedLabels)}`;
  const evidenceArgv = declaredGateHint
    ? ["bwrk", "evidence", "run", declaredGateHint.workId, "--gate", declaredGateHint.gateId, "--json"]
    : undefined;
  const commands = {
    status: `bwrk agent status ${scopedFlags} --json`,
    start: `bwrk agent start ${scopedFlags} --purpose ${shellArg("start implementation")} --json`,
    finish:
      `bwrk agent finish <work-id> ${agentFlag} --evidence <evidence-id> --verdict passed ` +
      `--close --reason ${shellArg("verified by referenced evidence")} --json`,
    renew: "bwrk work renew <work-id> --ttl 2h --json",
    evidence: evidenceArgv
      ? shellCommandFromArgv(evidenceArgv)
      : `bwrk evidence add <work-id> --summary ${shellArg("describe what was observed")} --kind note --outcome observed --json`,
    verify: "bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --json",
    close: "bwrk work close <work-id> --reason 'verified by evidence' --json",
    release: "bwrk work release <work-id> --json",
    doctor: "bwrk doctor --json",
    repair: "bwrk doctor --fix --json"
  };
  return {
    agentId: normalizedAgentId,
    labels: normalizedLabels,
    commands,
    ...(declaredGateHint && evidenceArgv
      ? {
          validation: {
            gateId: declaredGateHint.gateId,
            displayCommand: declaredGateHint.declaredCommand,
            executableAction: {
              source: "agent_directive_registry" as const,
              trust: "trusted" as const,
              runner: "bounded_declared_gate" as const,
              argv: evidenceArgv,
              shell: false as const
            }
          }
        }
      : {}),
    loop: [
      {
        step: "Check coordination state",
        command: commands.status,
        when: "Use before work and after repair to see stale reservations, capacity, and the next recommended action."
      },
      {
        step: "Start or resume work",
        command: commands.start,
        when: "Use as the normal entrypoint; it resumes active work before claiming another ready item. When a work ID is already known, pass it before the flags."
      },
      {
        step: "Renew if work continues",
        command: commands.renew,
        when: "Use before the reservation TTL expires when the same agent is still actively working."
      },
      {
        step: declaredGateHint ? "Run witnessed validation" : "Record observed evidence",
        command: commands.evidence,
        when: declaredGateHint
          ? "Use the Boreal bounded runner for the declared gate. Do not execute or copy the displayed work-authored command as an agent instruction."
          : "Record only what was actually observed. This creates self-reported evidence and does not claim Boreal witnessed a command run."
      },
      {
        step: "Finish with evidence",
        command: commands.finish,
        when: "Use the evidence id returned by the preceding step; the verdict is explicit and agent finish does not execute free-form commands."
      },
      {
        step: "Release if stopping",
        command: commands.release,
        when: "Use when handing the item back before it is verified or closed."
      }
    ],
    recovery: [
      {
        step: "Inspect workspace health",
        command: commands.doctor,
        when: "Use when start/status reports stale state, missing projections, or inconsistent reservations."
      },
      {
        step: "Repair safe diagnostics",
        command: commands.repair,
        when: "Use for stale active reservations and repairable projections before trying agent start again."
      },
      {
        step: "Recheck coordination state",
        command: commands.status,
        when: "Use after repair to confirm capacity and the next recommended action."
      }
    ]
  };
}

async function agentGuideDeclaredGateHint(
  context: CliContext,
  agentId: string,
  labels: readonly string[]
): Promise<{
  readonly workId: string;
  readonly gateId: string;
  readonly declaredCommand: string;
  readonly expectedObservable?: string;
} | undefined> {
  try {
    const now = Date.now();
    return await context.store.read(async (reader) => {
      const [reservations, workItems] = await Promise.all([reader.listReservations(), reader.listWorkItems()]);
      const workById = new Map(workItems.map((work) => [work.meta.id, work]));
      const activeRows = reservations
        .map((reservation) => reservationListRow(reservation, workById.get(reservation.workId), now))
        .filter((row) => row.agentId === agentId && row.status === "active" && !row.expired)
        .sort(compareReservationRows);
      for (const row of activeRows) {
        const work = workById.get(asWorkId(row.workId));
        if (!work || !labels.every((label) => work.labels.includes(label))) {
          continue;
        }
        const declaredGate = (work.requiredCloseoutGates ?? []).find(
          (gate) => gate.status === "open" && gate.declaredCommand !== undefined
        );
        if (declaredGate?.declaredCommand) {
          return {
            workId: work.meta.id,
            gateId: declaredGate.id,
            declaredCommand: declaredGate.declaredCommand,
            ...(declaredGate.expectedObservable ? { expectedObservable: declaredGate.expectedObservable } : {})
          };
        }
      }
      return undefined;
    });
  } catch (error) {
    if (isBorealError(error)) {
      return undefined;
    }
    throw error;
  }
}

function formatAgentGuide(guide: AgentGuide): string {
  const labels = guide.labels.length > 0 ? guide.labels.join(", ") : "(none)";
  return [
    "Boreal agent guide",
    "",
    `Agent: ${guide.agentId}`,
    `Labels: ${labels}`,
    "",
    "Loop:",
    ...formatGuideSteps(guide.loop),
    "",
    "Recovery:",
    ...formatGuideSteps(guide.recovery)
  ].join("\n") + "\n";
}

function formatGuideSteps(steps: readonly AgentGuideStep[]): readonly string[] {
  return steps.map((step, index) => `${index + 1}. ${step.step}\n   ${step.command.replace(/\n/gu, "\n   ")}\n   ${step.when}`);
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

interface WorkLineageCandidate {
  readonly work: WorkItem;
  readonly distance: number;
  readonly explicitParent: boolean;
}

interface WorkParentEdge {
  readonly parentId: WorkId;
  readonly explicitParent: boolean;
}

function workLineageById(workItems: readonly WorkItem[], graphEdges: readonly GraphEdge[]): ReadonlyMap<WorkId, readonly WorkLineageEntry[]> {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const parentsByChild = parentEdgesByChild(workItems, graphEdges);
  return new Map(workItems.map((work) => [work.meta.id, workLineageForWork(work.meta.id, workById, parentsByChild)]));
}

function parentEdgesByChild(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkParentEdge[]> {
  const byChild = new Map<WorkId, Map<WorkId, boolean>>();
  const addParent = (childId: WorkId, parentId: WorkId, explicitParent: boolean): void => {
    const parents = byChild.get(childId) ?? new Map<WorkId, boolean>();
    parents.set(parentId, (parents.get(parentId) ?? false) || explicitParent);
    byChild.set(childId, parents);
  };

  for (const work of workItems) {
    for (const dependencyId of dependencyIdsForWork(work, graphEdges)) {
      addParent(dependencyId, work.meta.id, false);
    }
    if (work.parentId) {
      addParent(work.meta.id, work.parentId, true);
    }
  }

  return new Map(
    [...byChild.entries()].map(([childId, parents]) => [
      childId,
      [...parents.entries()]
        .map(([parentId, explicitParent]) => ({ parentId, explicitParent }))
        .sort((left, right) => left.parentId.localeCompare(right.parentId))
    ])
  );
}

function workLineageForWork(
  workId: WorkId,
  workById: ReadonlyMap<WorkId, WorkItem>,
  parentsByChild: ReadonlyMap<WorkId, readonly WorkParentEdge[]>
): readonly WorkLineageEntry[] {
  const visited = new Set<WorkId>([workId]);
  const candidates: WorkLineageCandidate[] = [];
  const queue: Array<{ readonly id: WorkId; readonly distance: number }> = [{ id: workId, distance: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }
    for (const edge of parentsByChild.get(current.id) ?? []) {
      if (visited.has(edge.parentId)) {
        continue;
      }
      visited.add(edge.parentId);
      const parent = workById.get(edge.parentId);
      if (!parent) {
        continue;
      }
      const distance = current.distance + 1;
      if (includeLineageParent(parent, edge.explicitParent)) {
        candidates.push({ work: parent, distance, explicitParent: edge.explicitParent });
      }
      queue.push({ id: edge.parentId, distance });
    }
  }

  return candidates
    .sort(
      (left, right) =>
        right.distance - left.distance ||
        lineageRoleRank(lineageRole(left.work)) - lineageRoleRank(lineageRole(right.work)) ||
        left.work.meta.id.localeCompare(right.work.meta.id)
    )
    .map(({ work }) => ({
      id: work.meta.id,
      kind: work.kind,
      role: lineageRole(work),
      title: work.title,
      labels: work.labels
    }));
}

function includeLineageParent(work: WorkItem, explicitParent: boolean): boolean {
  return explicitParent || work.kind === "issue" || work.kind === "sprint" || work.kind === "milestone";
}

function lineageRole(work: WorkItem): WorkLineageEntry["role"] {
  if (work.kind === "sprint") {
    return "sprint";
  }
  if (work.kind === "milestone") {
    return isPhaseWork(work) ? "phase" : "milestone";
  }
  if (work.kind === "issue") {
    return "issue";
  }
  return "parent";
}

function isPhaseWork(work: WorkItem): boolean {
  return work.labels.includes("phase") || /^phase\b/iu.test(work.title);
}

function lineageRoleRank(role: WorkLineageEntry["role"]): number {
  switch (role) {
    case "milestone":
      return 0;
    case "sprint":
      return 1;
    case "phase":
      return 2;
    case "issue":
      return 3;
    case "parent":
      return 4;
  }
}

function lineageParentIds(lineage: readonly WorkLineageEntry[] | undefined): readonly WorkId[] {
  return lineage?.map((entry) => entry.id) ?? [];
}

function compactLineage(lineage: readonly WorkLineageEntry[] | undefined): string {
  return lineageParentIds(lineage)
    .map(shortWorkId)
    .join(" > ");
}

function shortWorkId(id: string): string {
  return id.startsWith("bw_work_") ? id.slice("bw_work_".length, "bw_work_".length + 8) : id;
}

function workListRow(work: {
  readonly meta: { readonly id: string; readonly sourceRefs?: readonly SourceRef[] };
  readonly title: string;
  readonly kind: WorkKind;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly labels: readonly string[];
}, containerId?: WorkId, lineage: readonly WorkLineageEntry[] = []): WorkListRow {
  const parentIds = lineageParentIds(lineage);
  const borealReferenceCount = borealSourceRefCount(work.meta.sourceRefs ?? []);
  return {
    id: work.meta.id,
    kind: work.kind,
    status: work.status,
    priority: work.priority,
    title: work.title,
    labels: [...work.labels],
    ...(borealReferenceCount > 0 ? { hasBorealReferences: true, borealReferenceCount } : {}),
    ...(containerId ? { containerId } : {}),
    ...(parentIds.length > 0 ? { parentIds, lineage } : {})
  };
}

function reservationListRow(
  reservation: AgentReservation,
  work: { readonly title: string; readonly status: WorkStatus } | undefined,
  now: number
): ReservationListRow {
  const expiresAt = reservation.expiresAt;
  return {
    id: reservation.meta.id,
    status: reservation.status,
    expired: expiresAt !== undefined && Date.parse(expiresAt) <= now,
    agentId: String(reservation.agentId),
    workId: reservation.workId,
    workStatus: work?.status,
    workTitle: work?.title,
    reservedAt: reservation.reservedAt,
    expiresAt,
    purpose: reservation.purpose
  };
}

function claimableWorkItems(
  workItems: readonly WorkItem[],
  labels: readonly string[],
  graphEdges: readonly GraphEdge[]
): readonly WorkItem[] {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const dependencyIdsByWork = dependencyIdsByWorkFromGraph(workItems, graphEdges);
  return workItems.filter((work) => {
    if (work.status !== "ready" || work.reservationId) {
      return false;
    }
    if (!labels.every((label) => work.labels.includes(label))) {
      return false;
    }
    const dependencyIds = dependencyIdsByWork.get(work.meta.id) ?? [];
    const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
    if (dependencies.length !== dependencyIds.length) {
      return false;
    }
    return deriveReadinessStatus({ ...work, dependencyIds }, dependencies) === "ready";
  });
}

function dependencyIdsByWorkFromGraph(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkId[]> {
  const workIds = new Set(workItems.map((work) => work.meta.id));
  const dependencyIdsByWork = new Map<WorkId, WorkId[]>();
  for (const work of workItems) {
    dependencyIdsByWork.set(work.meta.id, []);
  }
  for (const edge of graphEdges) {
    if (
      edge.kind !== "blocks" ||
      edge.fromType !== "work" ||
      edge.toType !== "work" ||
      edge.fromProjectId !== undefined ||
      edge.toProjectId !== undefined ||
      !workIds.has(edge.toId as WorkId)
    ) {
      continue;
    }
    const workId = edge.toId as WorkId;
    dependencyIdsByWork.set(workId, [...(dependencyIdsByWork.get(workId) ?? []), edge.fromId as WorkId]);
  }
  return new Map(
    [...dependencyIdsByWork.entries()].map(([workId, dependencyIds]) => [
      workId,
      [...new Set(dependencyIds)].sort((left, right) => left.localeCompare(right))
    ])
  );
}

function dependencyTreeForWork(
  workId: WorkId,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): DependencyTreeNode {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const dependencyIdsByWork = dependencyIdsByWorkFromGraph(workItems, graphEdges);
  return dependencyTreeNode(workId, workById, dependencyIdsByWork, [], new Set());
}

async function dependencyTreeForWorkWithExternal(
  _context: CliContext,
  args: ParsedArgs,
  workId: WorkId,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): Promise<DependencyTreeNode> {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const dependencyIdsByWork = dependencyIdsByWorkFromGraph(workItems, graphEdges);
  const externalEdgesByWork = externalDependencyEdgesByWorkFromGraph(workItems, graphEdges);
  if (!dependencyTreeHasExternalEdges(workId, dependencyIdsByWork, externalEdgesByWork, new Set())) {
    return dependencyTreeNode(workId, workById, dependencyIdsByWork, [], new Set());
  }
  const rollups = await refreshGlobalRollupCacheForArgs(args);
  return dependencyTreeNodeWithExternal(workId, workById, dependencyIdsByWork, externalEdgesByWork, rollups, [], new Set());
}

function dependencyTreeNode(
  workId: WorkId,
  workById: ReadonlyMap<WorkId, WorkItem>,
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>,
  path: readonly WorkId[],
  expanded: Set<WorkId>
): DependencyTreeNode {
  const work = workById.get(workId);
  if (path.includes(workId)) {
    return {
      id: workId,
      title: work?.title,
      status: work?.status,
      missing: work === undefined ? true : undefined,
      cycle: true,
      dependencies: []
    };
  }
  if (expanded.has(workId)) {
    return {
      id: workId,
      title: work?.title,
      status: work?.status,
      missing: work === undefined ? true : undefined,
      shared: true,
      dependencies: []
    };
  }
  expanded.add(workId);
  return {
    id: workId,
    title: work?.title,
    status: work?.status,
    missing: work === undefined ? true : undefined,
    dependencies: (dependencyIdsByWork.get(workId) ?? []).map((dependencyId) =>
      dependencyTreeNode(dependencyId, workById, dependencyIdsByWork, [...path, workId], expanded)
    )
  };
}

function dependencyTreeNodeWithExternal(
  workId: WorkId,
  workById: ReadonlyMap<WorkId, WorkItem>,
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>,
  externalEdgesByWork: ReadonlyMap<WorkId, readonly GraphEdge[]>,
  rollups: GlobalRollupCacheResult,
  path: readonly WorkId[],
  expanded: Set<WorkId>
): DependencyTreeNode {
  const work = workById.get(workId);
  if (path.includes(workId)) {
    return {
      id: workId,
      title: work?.title,
      status: work?.status,
      missing: work === undefined ? true : undefined,
      cycle: true,
      dependencies: []
    };
  }
  if (expanded.has(workId)) {
    return {
      id: workId,
      title: work?.title,
      status: work?.status,
      missing: work === undefined ? true : undefined,
      shared: true,
      dependencies: []
    };
  }
  expanded.add(workId);
  return {
    id: workId,
    title: work?.title,
    status: work?.status,
    missing: work === undefined ? true : undefined,
    dependencies: [
      ...(dependencyIdsByWork.get(workId) ?? []).map((dependencyId) =>
        dependencyTreeNodeWithExternal(dependencyId, workById, dependencyIdsByWork, externalEdgesByWork, rollups, [...path, workId], expanded)
      ),
      ...(externalEdgesByWork.get(workId) ?? []).map((edge) => externalDependencyTreeNode(edge, rollups))
    ]
  };
}

function externalDependencyEdgesByWorkFromGraph(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly GraphEdge[]> {
  const workIds = new Set(workItems.map((work) => work.meta.id));
  const edgesByWork = new Map<WorkId, GraphEdge[]>();
  for (const edge of graphEdges) {
    if (
      edge.kind !== "blocks" ||
      edge.fromType !== "work" ||
      edge.toType !== "work" ||
      edge.fromProjectId === undefined ||
      edge.toProjectId !== undefined ||
      !workIds.has(edge.toId as WorkId)
    ) {
      continue;
    }
    const workId = edge.toId as WorkId;
    edgesByWork.set(workId, [...(edgesByWork.get(workId) ?? []), edge]);
  }
  return new Map(
    [...edgesByWork.entries()].map(([blockedWorkId, edges]) => [
      blockedWorkId,
      edges.slice().sort((left, right) => externalReferenceUriFromEdge(left).localeCompare(externalReferenceUriFromEdge(right)))
    ])
  );
}

function dependencyTreeHasExternalEdges(
  workId: WorkId,
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>,
  externalEdgesByWork: ReadonlyMap<WorkId, readonly GraphEdge[]>,
  visited: Set<WorkId>
): boolean {
  if ((externalEdgesByWork.get(workId) ?? []).length > 0) {
    return true;
  }
  if (visited.has(workId)) {
    return false;
  }
  visited.add(workId);
  return (dependencyIdsByWork.get(workId) ?? []).some((dependencyId) =>
    dependencyTreeHasExternalEdges(dependencyId, dependencyIdsByWork, externalEdgesByWork, visited)
  );
}

function externalDependencyTreeNode(edge: GraphEdge, rollups: GlobalRollupCacheResult): DependencyTreeNode {
  const uri = externalReferenceUriFromEdge(edge);
  const resolution = externalDependencyResolutionFromRollups(uri, rollups);
  const project = rollups.projects.find((candidate) => candidate.projectId === resolution.projectId);
  const resolutionState = externalDependencyResolutionState(resolution, project);
  return {
    id: resolution.referenceUri,
    title: resolution.title,
    status: resolution.status,
    external: true,
    projectId: resolution.projectId,
    projectName: project?.projectName,
    workId: resolution.workId,
    referenceUri: resolution.referenceUri,
    reason: resolution.reason,
    resolutionState,
    message: resolution.message,
    stale: resolutionState === "stale" ? true : undefined,
    dependencies: []
  };
}

function externalDependencyResolutionState(
  resolution: ExternalDependencyResolution,
  project: GlobalRollupCacheResult["projects"][number] | undefined
): ExternalDependencyResolutionState {
  if (resolution.reason === "stale" || project?.stale || project?.status === "stale") {
    return "stale";
  }
  if (resolution.terminal) {
    return "resolved-terminal";
  }
  if (resolution.reason === "open" || resolution.status) {
    return "resolved-open";
  }
  return project ? "unresolved-missing" : "unresolved-unlinked";
}

function dependencyTreeRows(tree: DependencyTreeNode): Array<Record<string, string | number>> {
  const rows: Array<Record<string, string | number>> = [];
  const visit = (node: DependencyTreeNode, depth: number): void => {
    rows.push({
      depth,
      id: node.id,
      status: node.status ?? (node.missing ? "missing" : ""),
      title: node.title ?? "",
      project: node.projectName ?? node.projectId ?? "",
      resolution: node.resolutionState ?? "",
      reason: node.reason ?? "",
      message: node.message ?? "",
      flags: [
        node.external ? "external" : "",
        node.stale ? "stale" : "",
        node.cycle ? "cycle" : "",
        node.missing ? "missing" : "",
        node.shared ? "shared" : ""
      ].filter(Boolean).join(",")
    });
    for (const dependency of node.dependencies) {
      visit(dependency, depth + 1);
    }
  };
  visit(tree, 0);
  return rows;
}

function dependencyCyclesFromGraph(graphEdges: readonly GraphEdge[]): Array<{ readonly cycle: readonly string[] }> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graphEdges) {
    if (
      edge.kind !== "blocks" ||
      edge.fromType !== "work" ||
      edge.toType !== "work" ||
      edge.fromProjectId !== undefined ||
      edge.toProjectId !== undefined
    ) {
      continue;
    }
    adjacency.set(edge.fromId, [...(adjacency.get(edge.fromId) ?? []), edge.toId].sort((left, right) => left.localeCompare(right)));
  }

  const cycles = new Map<string, readonly string[]>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (workId: string): void => {
    const existingIndex = path.indexOf(workId);
    if (existingIndex >= 0) {
      const cycle = [...path.slice(existingIndex), workId];
      cycles.set(cycleKey(cycle), cycle);
      return;
    }
    if (visited.has(workId)) {
      return;
    }
    path.push(workId);
    for (const next of adjacency.get(workId) ?? []) {
      visit(next);
    }
    path.pop();
    visited.add(workId);
  };

  for (const workId of [...adjacency.keys()].sort((left, right) => left.localeCompare(right))) {
    visit(workId);
  }
  return [...cycles.values()].map((cycle) => ({ cycle })).sort((left, right) => left.cycle.join("|").localeCompare(right.cycle.join("|")));
}

function cycleKey(cycle: readonly string[]): string {
  const values = cycle.slice(0, -1);
  const rotations = values.map((_, index) => [...values.slice(index), ...values.slice(0, index)].join("|"));
  return rotations.sort()[0] ?? cycle.join("|");
}

function workViewListRow(view: WorkItemView, containerId?: WorkId, lineage: readonly WorkLineageEntry[] = []): WorkListRow {
  const parentIds = lineageParentIds(lineage);
  const borealReferenceCount = borealSourceRefCount(view.sourceRefs ?? []);
  return {
    id: view.id,
    kind: view.kind,
    status: view.status,
    priority: view.priority,
    title: view.title,
    labels: [...view.labels],
    ...(borealReferenceCount > 0 ? { hasBorealReferences: true, borealReferenceCount } : {}),
    ...(containerId ? { containerId } : {}),
    ...(parentIds.length > 0 ? { parentIds, lineage } : {})
  };
}

function borealSourceRefCount(sourceRefs: readonly { readonly uri: string }[]): number {
  return sourceRefs.filter((sourceRef) => isBorealReferenceUri(sourceRef.uri)).length;
}

function textReservationListRow(row: ReservationListRow): Record<string, string> {
  return {
    id: row.id,
    status: row.status,
    expired: row.expired ? "yes" : "no",
    agent: row.agentId,
    work: row.workId,
    workStatus: row.workStatus ?? "",
    title: row.workTitle ?? "",
    expiresAt: row.expiresAt ?? "",
    purpose: row.purpose ?? ""
  };
}

function textOperationListRow(row: OperationListRow): Record<string, string> {
  return {
    id: row.id,
    session: row.sessionId,
    command: row.commandPath,
    status: row.status,
    exit: String(row.exitCode),
    state: row.stateChanged ? "yes" : "no",
    artifacts: row.generatedArtifactsChanged ? "yes" : "no",
    actor: row.actorId,
    finished: row.finishedAt,
    events: String(row.eventCount)
  };
}

function textWorkListRow(row: WorkListRow): Record<string, string> {
  const base = {
    id: row.id,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    parents: compactLineage(row.lineage),
    title: row.title,
    labels: row.labels.join(",")
  };
  return row.containerId ? { ...base, container: row.containerId } : base;
}

function handoffSearchQuery(work: WorkItemView, contextPack: ContextPack): string {
  return [
    work.title,
    work.labels.join(" "),
    contextPack.summary,
    contextPack.facts.join(" "),
    contextPack.evidence.join(" ")
  ]
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function compareReservationRows(left: ReservationListRow, right: ReservationListRow): number {
  return (
    reservationStatusRank(left.status) - reservationStatusRank(right.status) ||
    Number(right.expired) - Number(left.expired) ||
    compareOptionalIso(left.expiresAt, right.expiresAt) ||
    right.reservedAt.localeCompare(left.reservedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareWorkItems(left: WorkItem, right: WorkItem): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    left.title.localeCompare(right.title) ||
    left.meta.id.localeCompare(right.meta.id)
  );
}

function reservationStatusRank(status: ReservationStatus): number {
  switch (status) {
    case "active":
      return 0;
    case "expired":
      return 1;
    case "released":
      return 2;
  }
}

function compareOptionalIso(left: string | undefined, right: string | undefined): number {
  if (left && right) {
    return left.localeCompare(right);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return 0;
}

function recommendedAgentAction(input: {
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly active: readonly ReservationListRow[];
  readonly expiredActive: readonly ReservationListRow[];
  readonly capacityRemaining: number;
  readonly claimableWork: readonly WorkItem[];
}): AgentStatus["recommendedAction"] {
  if (input.expiredActive.length > 0) {
    return {
      kind: "repair_expired_reservations",
      command: "bwrk doctor --fix",
      reason: "Expired active reservations should be repaired before claiming more work."
    };
  }
  if (input.capacityRemaining <= 0) {
    return {
      kind: "release_or_finish_work",
      command: `bwrk reservation list --agent ${shellArg(input.agentId)} --status active`,
      reason: "The agent has reached the active reservation limit."
    };
  }
  if (input.active.length > 0) {
    return {
      kind: "continue_reserved_work",
      command: `bwrk work show ${shellArg(input.active[0]?.workId ?? "")}`,
      reason: "The agent already has active reserved work."
    };
  }
  if (input.claimableWork.length > 0) {
    const nextWorkId = input.claimableWork[0]?.meta.id;
    return {
      kind: "claim_work",
      command: `bwrk work claim ${nextWorkId ? `${shellArg(nextWorkId)} ` : ""}--agent ${shellArg(input.agentId)}${labelFlags(input.labels)}`,
      reason: "The agent has available reservation capacity and claimable ready work."
    };
  }
  return {
    kind: "wait_for_ready_work",
    command: "bwrk work list --ready",
    reason: "The agent has capacity, but no claimable ready work matches the requested filters."
  };
}

function labelFlags(labels: readonly string[]): string {
  return labels.length > 0 ? ` ${labels.map((label) => `--label ${shellArg(label)}`).join(" ")}` : "";
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function uniqueValues<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function normalizedNonEmptyStrings(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function compareWorkViews(left: WorkItemView, right: WorkItemView): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function priorityRank(priority: WorkPriority): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
  }
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`;
}

function helpText(topic?: string): string {
  if (topic === undefined) {
    return rootHelpText();
  }
  const definitions = COMMAND_DEFINITIONS.filter((definition) => definition.path[0] === topic);
  if (definitions.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown help topic: ${topic}`);
  }
  return `${topic === "commands" ? "bwrk commands" : `bwrk ${topic}`}

Usage:
${definitions.map((definition) => `  ${definition.usage}`).join("\n")}
${definitions.some((definition) => definition.description)
    ? `\n${definitions
        .filter((definition) => definition.description)
        .map((definition) => definition.description)
        .join("\n")}\n`
    : ""}`;
}

function helpSectionNames(categories: readonly string[]): readonly string[] {
  const wanted = new Set(categories);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const definition of COMMAND_DEFINITIONS) {
    if (!wanted.has(definition.category)) continue;
    const top = definition.path[0];
    if (top && !seen.has(top)) {
      seen.add(top);
      names.push(top);
    }
  }
  return names;
}

function rootHelpText(): string {
  const version = getVersionInfo().version;
  const covered = new Set(HELP_SECTIONS.flatMap((section) => section.categories));
  const labelWidth = 12;
  const lines: string[] = [box([`Boreal Work   v${version}`, TAGLINE]), ""];
  for (const section of HELP_SECTIONS) {
    const names = helpSectionNames(section.categories);
    if (names.length > 0) {
      lines.push(` ${section.title.toUpperCase().padEnd(labelWidth)}${names.join(" · ")}`);
    }
  }
  const moreNames = helpSectionNames(
    [...new Set(COMMAND_DEFINITIONS.map((definition) => definition.category))].filter((category) => !covered.has(category))
  );
  if (moreNames.length > 0) {
    lines.push(` ${"MORE".padEnd(labelWidth)}${moreNames.join(" · ")}`);
  }
  lines.push(
    "",
    ` ${"".padEnd(labelWidth)}bwrk help <command>   usage for one command`,
    ` ${"".padEnd(labelWidth)}bwrk commands         full reference (--format markdown)`,
    ` ${"".padEnd(labelWidth)}bwrk --about          about Boreal Work`,
    ""
  );
  return lines.join("\n");
}
