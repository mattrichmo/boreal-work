import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  AGENT_DIRECTIVE_SUBJECT_TYPES,
  AGENT_DIRECTIVE_FAMILIES,
  AGENT_DIRECTIVE_REGISTRY,
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  BorealError,
  agentDirectiveGapsForSnapshot,
  agentDirectiveSnapshotHash,
  assembleAgentDirectiveBundleFromGaps,
  assertPathInside,
  assertRealPathInside,
  closeoutDirectiveDataByRegistryId,
  createRecordMeta,
  createAgentDirectiveSnapshot,
  deterministicId,
  directiveAcknowledgementRecordSchemaIssues,
  gitDirectiveDataByRegistryId,
  hashContent,
  handoffDirectiveDataByRegistryId,
  isBorealError,
  isIsoTimestamp,
  normalizeActorId,
  normalizeLabels,
  normalizeMachineString,
  normalizeSearchQuery,
  nowIso,
  randomId,
  recoveryDirectiveDataByRegistryId,
  runtimeSnapshotSchemaIssues,
  selectAgentDirectiveRegistryEntriesFromGaps,
  summaryDirectiveDataByRegistryId,
  touchRecord,
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
  type ClaimId,
  type ClaimRecord,
  type ClaimStatus,
  type CloseoutGateForceReasonCode,
  type CloseoutGateId,
  type CloseoutGateKind,
  type CloseoutGateScope,
  type ContentHash,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type DecisionStatus,
  type DirectiveAcknowledgementId,
  type DirectiveAcknowledgementOutcome,
  type DirectiveAcknowledgementRecord,
  type EventId,
  type EvidenceId,
  type EvidenceRecord,
  type EvidenceKind,
  type EvidenceOutcome,
  type EnforcementGap,
  type GraphEdge,
  type GraphEdgeId,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type KnowledgeSourceKind,
  type OperationId,
  type ProjectRegistryEntry as CoreProjectRegistryEntry,
  type ProjectionId,
  type ProjectionRecord,
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
import { inspectDaemonStatus, type DaemonStatusResult } from "@boreal/daemon";
import type { SearchResult } from "@boreal/search";
import {
  breakStaleFileLock,
  inspectFileLock,
  rebuildSQLiteCache,
  writeTextFileAtomic,
  type BorealReader,
  type BorealWriter,
  type SQLiteCacheRebuildResult
} from "@boreal/storage";
import {
  buildGlobalActivityView,
  buildGlobalHealthView,
  buildGlobalSearchView,
  buildGlobalSettingsView,
  buildGlobalWorkQueuesView,
  buildProjectRegistryView,
  buildSprintBoardView,
  toWorkItemView,
  type DashboardFinding,
  type GlobalActivitySourceRow,
  type GlobalSearchSourceRow,
  type GlobalSettingsProjectInput,
  type LockDashboardView,
  type ProjectRegistryEntry as DashboardProjectRegistryEntry,
  type ProjectSyncFreshness,
  type SyncDashboardView,
  type WorkItemView
} from "@boreal/ui-model";
import {
  closeoutGateSubjectTypeForWorkKind,
  createRequiredCloseoutGates,
  deriveReadinessStatus,
  type RequiredCloseoutGateInput
} from "@boreal/work-engine";
import type { FinishReservedWorkSummaryFactory } from "@boreal/engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "./args.js";
import {
  COMMAND_DEFINITIONS,
  commandBehavior,
  commandPath,
  findCommandDefinition,
  registryValueFlagNames,
  serializeCommandDefinition,
  validateCommandBehaviorMetadata,
  validateCommandFlags,
  type CommandDefinition
} from "./command-registry.js";
import { analyzeCompaction, applyCompaction, type CompactDomain } from "./compact.js";
import { COMPLETION_SHELLS, generateShellCompletion, isCompletionShell } from "./completion.js";
import {
  OPERATION_LOG_RECOMMENDED_KEEP,
  asEvidenceId,
  asWorkId,
  runDoctor,
  strictBlockingWarning,
  type Diagnostic,
  type DoctorResult
} from "./doctor.js";
import { assertInitialized, createCliContext, ensureWorkspaceDirs, isGlobalContext, type CliContext } from "./context.js";
import { keyValueRows, resultSummary, section, withPromptSession, type CliSelectOption } from "./cli-ui.js";
import { applyManualMerge, buildManualMergePlan, scanDuplicates, type DuplicateDomain } from "./duplicates.js";
import { inspectGitWorktree, type GitWorktreeInspection } from "./git-worktree.js";
import {
  inspectBorealInstallStatus,
  installStatusHealthy,
  installStatusSummary,
  type InstallStatus
} from "./install-status.js";
import {
  createSnapshot,
  buildExportDocument,
  deleteClaimWithTombstone,
  deleteDecisionWithTombstone,
  deleteEvidenceWithTombstone,
  deleteContextPackWithTombstone,
  deleteGraphEdgeWithTombstone,
  deleteKnowledgeSourceWithTombstone,
  deleteProjectionWithTombstone,
  deleteReservationWithTombstone,
  deleteVerificationWithTombstone,
  deleteWorkItemWithTombstone,
  exportLedgers,
  exportJson,
  exportMarkdown,
  importLedgers,
  importJson,
  ledgerStatus,
  listSnapshots,
  readGeneratedLedgerTombstones,
  showSnapshot,
  type LedgerStatusResult
} from "./import-export.js";
import { createResultSpoolingOutput, formatRecord, table, type CliOutput } from "./output.js";
import {
  applyProjectSetup,
  configuredInstallRootForTarget,
  configuredInstallRootMatchesTarget,
  formatProjectInstallReview,
  maybeConfigureProjectSetup,
  projectSetupInputFromArgs,
  promptProjectInstallInput,
  readProjectSetupConfig,
  validateProjectSetupInput,
  type ProjectSetupInput,
  type ProjectSetupResult
} from "./project-setup.js";
import {
  addProjectRegistryEntry,
  doctorProjectRegistry,
  importProjectSetupRegistryEntry,
  listProjectRegistry,
  removeProjectRegistryEntry,
  type RegistryAddResult,
  type RegistryDoctorResult,
  type RegistryImportSetupResult,
  type RegistryListResult,
  type RegistryRemoveResult
} from "./registry.js";
import { inspectSearchIndex, runSearch, writeSearchIndex, type SearchIndexInspection } from "./search-cli.js";
import { dirtyPathNotesHaveReasonCode, requireCommitOrDirtyPathReason } from "./summary-policy.js";
import {
  addRawSource,
  createWikiPage,
  getRawSourceDetail,
  initVault,
  inspectVault,
  VAULT_SCHEMA_VERSION,
  listVaultWikiPages,
  listRawSourceRows,
  type RawSourceRow,
  type WikiPageRecord,
  type VaultStatusResult
} from "./vault.js";
import {
  buildSkillInstallPlan,
  getWorkflowAsset,
  inspectWorkflowAssets,
  installSkillsFromPlan,
  listWorkflowAssets,
  validateInstalledSkillRoot,
  type SkillInstallPlan
} from "./workflow-assets.js";
import { formatVersionInfo, getVersionInfo } from "./version.js";
import { box, TAGLINE } from "./branding.js";

const DEFAULT_HANDOFF_SEARCH_LIMIT = 8;
const HANDOFF_SEARCH_MIN_CANDIDATES = 24;
const HANDOFF_CONTEXT_CHUNK_LIMIT_RATIO = 3;
const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_OPERATION_LIST_LIMIT = 50;
const DEFAULT_READY_WORK_LIMIT = 10;
const DEFAULT_DASHBOARD_PROJECT_LIMIT = 100;
const DEFAULT_DASHBOARD_WORK_LIMIT = 250;
const DEFAULT_DASHBOARD_QUEUE_LIMIT = 200;
const DEFAULT_DASHBOARD_SEARCH_LIMIT = 10;
const DEFAULT_DASHBOARD_ACTIVITY_LIMIT = 20;
const DEFAULT_SPRINT_LIST_LIMIT = 200;
const DEFAULT_SPRINT_SCOPE_LIMIT = 500;
const DEFAULT_RAW_PREVIEW_BYTES = 4_096;
const MAX_LIST_LIMIT = 1_000;
const MAX_RAW_PREVIEW_BYTES = 65_536;
const MAX_DASHBOARD_PROJECT_LIMIT = 100;
const MAX_SPRINT_LIST_LIMIT = 200;
const MAX_SPRINT_SCOPE_LIMIT = 500;
const MAX_SEARCH_LIMIT = 100;
const MAX_HANDOFF_SEARCH_LIMIT = 50;
const ACTIVE_SPRINT_PROJECTION_KIND = "active-sprint";
const ACTIVE_SPRINT_PROJECTION_ID = deterministicId<ProjectionId>("projection", {
  kind: ACTIVE_SPRINT_PROJECTION_KIND,
  subjectId: "workspace"
});
type SprintReportFormat = "markdown" | "html";
const SPRINT_REPORT_SCHEMA_VERSION = "boreal.cli.sprint.report.v1";
const SPRINT_REPORT_FORMATS = new Set<SprintReportFormat>(["markdown", "html"]);
const INSTALL_CONFIRM_OPTIONS: readonly CliSelectOption<"yes" | "no">[] = [
  {
    value: "yes",
    label: "Write files",
    description: "Write the planned skill files to the selected install root."
  },
  {
    value: "no",
    label: "Cancel",
    description: "Leave the filesystem unchanged."
  }
];

export interface CommandResult {
  readonly exitCode: number;
}

interface WorkListRow {
  readonly id: string;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly title: string;
  readonly labels: readonly string[];
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
  readonly missing?: boolean;
  readonly cycle?: boolean;
  readonly shared?: boolean;
  readonly dependencies: readonly DependencyTreeNode[];
}

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

interface SprintListRow extends WorkListRow {
  readonly active: boolean;
}

interface SprintScope {
  readonly directChildren: readonly WorkItemView[];
  readonly descendants: readonly WorkItemView[];
  readonly totalDescendants: number;
  readonly truncated: boolean;
}

interface SprintReportWorkRow extends WorkItemView {
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
}

interface SprintReportEvidenceRow {
  readonly id: string;
  readonly subjectId: string;
  readonly kind: EvidenceKind;
  readonly outcome: EvidenceOutcome;
  readonly summary: string;
  readonly command?: string;
  readonly uri?: string;
  readonly observedAt: string;
}

interface SprintReportDecisionRow {
  readonly id: string;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly decision: string;
  readonly consequences: readonly string[];
  readonly sourceIds: readonly string[];
}

interface SprintReportAgentSummaryRow {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectType: AgentSummarySubjectType;
  readonly summaryKind: AgentSummaryKind;
  readonly status: AgentSummaryStatus;
  readonly outcome: AgentSummaryOutcome;
  readonly title: string;
  readonly artifactUri?: string;
  readonly commitShas: readonly string[];
  readonly dirtyPathNotes: readonly string[];
  readonly childSummaryIds: readonly string[];
  readonly forceReasonCode?: AgentSummaryForceReasonCode;
  readonly forceComment?: string;
  readonly generatedAt: string;
}

interface SprintReportBlockerRow {
  readonly work: SprintReportWorkRow;
  readonly blockers: readonly SprintReportWorkRow[];
}

interface SprintReportDocument {
  readonly schemaVersion: typeof SPRINT_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly format: SprintReportFormat;
  readonly sprint: SprintReportWorkRow;
  readonly active: boolean;
  readonly activeSprintId?: string;
  readonly scope: {
    readonly directChildCount: number;
    readonly totalDescendants: number;
    readonly truncated: boolean;
    readonly limit: number;
  };
  readonly summary: {
    readonly total: number;
    readonly completed: number;
    readonly open: number;
    readonly blocked: number;
    readonly needsVerification: number;
    readonly evidence: number;
    readonly decisions: number;
    readonly agentSummaries: number;
    readonly summaryCheckpointGaps: number;
    readonly nextSprintCandidates: number;
    readonly reviewGates: ReviewGateSummary;
  };
  readonly completedWork: readonly SprintReportWorkRow[];
  readonly openWork: readonly SprintReportWorkRow[];
  readonly unresolvedBlockers: readonly SprintReportBlockerRow[];
  readonly nextSprintCandidates: readonly SprintReportWorkRow[];
  readonly agentSummaries: readonly SprintReportAgentSummaryRow[];
  readonly evidence: readonly SprintReportEvidenceRow[];
  readonly decisions: readonly SprintReportDecisionRow[];
  readonly reviewGateDetails: readonly ReviewGateDetailRow[];
  readonly closeoutEvidence: {
    readonly doctor: SprintReportEvidenceRow;
    readonly sync: SprintReportEvidenceRow;
  };
}

interface SprintReportResult {
  readonly schemaVersion: typeof SPRINT_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly format: SprintReportFormat;
  readonly path?: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly report: SprintReportDocument;
  readonly content?: string;
}

interface SyncStatusResult {
  readonly ok: boolean;
  readonly workspaceRoot: string;
  readonly checkedAt: IsoTimestamp;
  readonly vault: VaultStatusResult;
  readonly ledgers: LedgerStatusResult;
  readonly searchIndex: SearchIndexInspection & { readonly ok: boolean };
  readonly git: GitWorktreeInspection;
  readonly recommendedActions: readonly string[];
}

interface SyncRefreshResult {
  readonly refreshed: true;
  readonly refreshOk: true;
  readonly postRefreshStatusOk: boolean;
  readonly exitReason: "ok" | "post_refresh_status_unhealthy";
  readonly contextViews: number;
  readonly searchIndex: Awaited<ReturnType<typeof writeSearchIndex>>;
  readonly ledgers: Awaited<ReturnType<typeof exportLedgers>>;
  readonly sqliteCache: SQLiteCacheRebuildResult;
  readonly status: SyncStatusResult;
}

interface OperationPruneResult {
  readonly deleted: number;
  readonly keptBeforeOperationLog: number;
  readonly remainingAfterOperationLog: number;
  readonly keep?: number;
  readonly before?: IsoTimestamp;
  readonly deletedIds: readonly string[];
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
  readonly loop: readonly AgentGuideStep[];
  readonly recovery: readonly AgentGuideStep[];
}

interface SkillInstallSummary {
  readonly target: "codex" | "claude" | "skills";
  readonly installRoot: string;
  readonly skillRoot: string;
  readonly fileCount: number;
}

interface InstallSetupResult {
  readonly kind: "install";
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly initialized?: boolean;
  readonly workspaceRoot: string;
  readonly eventId?: string;
  readonly plan: {
    readonly projectRoot: string;
    readonly memoryRoot: string;
    readonly memoryLayout: string;
    readonly memoryGitMode: string;
    readonly installRoot: string;
    readonly skillTargets: readonly string[];
    readonly folderScoped: boolean;
  };
  readonly projectSetup?: ProjectSetupResult;
  readonly skillInstalls?: readonly SkillInstallSummary[];
}

type AgentStartReason = "expired_active_reservations" | "reservation_capacity_reached" | "no_ready_work";

interface HandoffBundle {
  readonly work: WorkItemView;
  readonly contextPack: ContextPack;
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

interface AgentStartReadyBase {
  readonly started: true;
  readonly action: "claimed_work" | "continue_reserved_work";
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly status: AgentStatus;
  readonly reservation: AgentReservation;
  readonly releasedReservations: readonly AgentReservation[];
}

type AgentStartReady = AgentStartReadyBase & HandoffResult;

type AgentStartResult = AgentStartBlocked | AgentStartReady;

interface AgentFinishResult {
  readonly finished: true;
  readonly action: "verified_and_released" | "verified_and_closed";
  readonly agentId: string;
  readonly work: WorkItemView;
  readonly evidence: EvidenceRecord;
  readonly verification: VerificationRecord;
  readonly reservation: AgentReservation;
  readonly closedWork?: WorkItem;
  readonly agentSummary?: AgentSummaryRecord;
  readonly agentSummaryArtifact?: AgentSummaryArtifactResult;
  readonly release?: ReservationLifecycleResult;
  readonly status: AgentStatus;
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
  readonly commands: AgentProtocolCommands;
  readonly recommendedActions: readonly string[];
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
  const json = hasFlag(args, "json");
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
  const context = await createCliContext(args, cwd, {
    operationId,
    sessionId: operationSessionIdFromArgs(args)
  });
  const [group, action, ...rest] = args.command;
  if (definition.requiresWorkspace) {
    assertInitialized(context);
  }
  const startedAt = shouldLogOperation ? nowIso() : undefined;
  const eventIdsBefore = shouldLogOperation ? await listEventIds(context) : new Set<EventId>();
  const spoolingOutput = json
    ? createResultSpoolingOutput(output, {
        workspaceRoot: context.workspaceRoot,
        command: commandPath(definition),
        maxResultSizeChars: commandBehavior(definition).maxResultSizeChars
      })
    : undefined;
  const commandOutput = spoolingOutput ?? output;

  let result: CommandResult | undefined;
  let thrown: unknown;
  try {
    switch (group) {
      case "init":
        result = await initCommand(context, args, commandOutput, json);
        break;
      case "work":
        result = await workCommand(action, rest, context, args, commandOutput, json);
        break;
      case "directives":
        result = await directiveAcknowledgementCommand(action, rest, context, args, commandOutput, json);
        break;
      case "dep":
        result = await depCommand(action, rest, context, args, commandOutput, json);
        break;
      case "evidence":
        result = await evidenceCommand(action, rest, context, args, commandOutput, json);
        break;
      case "summary":
        result = await summaryCommand(action, rest, context, args, commandOutput, json);
        break;
      case "source":
        result = await sourceCommand(action, rest, context, args, commandOutput, json);
        break;
      case "claim":
        result = await claimCommand(action, rest, context, args, commandOutput, json);
        break;
      case "decision":
        result = await decisionCommand(action, rest, context, args, commandOutput, json);
        break;
      case "context":
        result = await contextCommand(action, rest, context, args, commandOutput, json);
        break;
      case "search":
        result = await searchCommand(action, rest, context, args, commandOutput, json);
        break;
      case "reservation":
        result = await reservationCommand(action, context, args, commandOutput, json);
        break;
      case "heartbeat":
        result = await heartbeatCommand(action, rest, context, args, commandOutput, json);
        break;
      case "prime":
        result = await primeCommand(context, args, commandOutput, json);
        break;
      case "agent":
        result = await agentCommand(action, rest, context, args, commandOutput, json);
        break;
      case "session":
        result = await sessionCommand(action, context, args, commandOutput, json);
        break;
      case "operation":
        result = await operationCommand(action, rest, context, args, commandOutput, json);
        break;
      case "workflows":
        result = await workflowsCommand(action, rest, context, args, commandOutput, json);
        break;
      case "start":
        result = await agentCommand("start", rest, context, args, commandOutput, json);
        break;
      case "done":
        result = await doneAliasCommand(context, args, commandOutput, json);
        break;
      case "pause":
        result = await pauseAliasCommand(context, args, commandOutput, json);
        break;
      case "status":
        result = await primeCommand(context, args, commandOutput, json);
        break;
      case "install":
        result = await installCommand(action, context, args, commandOutput, json);
        break;
      case "registry":
        result = await registryCommand(action, rest, context, args, commandOutput, json);
        break;
      case "dashboard":
        result = await dashboardCommand(action, context, args, commandOutput, json);
        break;
      case "global":
        result = await globalCommand(action, rest, context, args, commandOutput, json);
        break;
      case "link":
        result = await linkCommand(action, context, args, commandOutput, json);
        break;
      case "unlink":
        result = await unlinkCommand(action, args, commandOutput, json);
        break;
      case "daemon":
        result = await daemonCommand(action, context, commandOutput, json);
        break;
      case "sprint":
        result = await sprintCommand(action, rest, context, args, commandOutput, json);
        break;
      case "export":
        result = await exportCommand(action, context, args, commandOutput, json);
        break;
      case "import":
        result = await importCommand(action, context, args, commandOutput, json);
        break;
      case "vault":
        result = await vaultCommand(action, context, commandOutput, json);
        break;
      case "raw":
        result = await rawCommand(action, rest, context, args, commandOutput, json);
        break;
      case "wiki":
        result = await wikiCommand(action, rest, context, args, commandOutput, json);
        break;
      case "duplicate":
        result = await duplicateCommand(action, context, args, commandOutput, json);
        break;
      case "merge":
        result = await mergeCommand(action, context, args, commandOutput, json);
        break;
      case "compact":
        result = await compactCommand(action, context, args, commandOutput, json);
        break;
      case "sync":
        result = await syncCommand(action, context, args, commandOutput, json);
        break;
      case "ledger":
        result = await ledgerCommand(action, rest, context, args, commandOutput, json);
        break;
      case "snapshot":
        result = await snapshotCommand(action, rest, context, args, commandOutput, json);
        break;
      case "doctor":
        result = await doctorCommand(action, context, args, commandOutput, json);
        break;
      case "schema":
        result = await schemaCommand(action, context, commandOutput, json);
        break;
      case "docs":
        result = await docsCommand(action, context, commandOutput, json);
        break;
      case "gate":
        result = await gateCommand(action, context, args, commandOutput, json);
        break;
      case "lock":
        result = await lockCommand(action, context, args, commandOutput, json);
        break;
      default:
        throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${group ?? ""}`);
    }
  } catch (error) {
    thrown = error;
  }
  if (operationId && startedAt) {
    await recordCliOperation(context, operationId, definition, args, startedAt, eventIdsBefore, result, thrown);
  }
  if (thrown) {
    throw thrown;
  }
  await spoolingOutput?.flush();
  if (!result) {
    throw new BorealError("BOREAL_INVARIANT", "Command did not return a result");
  }
  return result;
}

async function primeCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const agentId = agentIdFromArgs(args, context.actor.id);
  const labels = labelsFromArgs(args);
  const result = await buildAgentProtocolBrief("prime", context, agentId, labels);
  output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
    syncStatus: await buildSyncStatus(context),
    subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
  }));
  return { exitCode: 0 };
}

async function sessionCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const agentId = agentIdFromArgs(args, context.actor.id);
  const labels = labelsFromArgs(args);
  switch (action) {
    case "start":
      output.write(
        await formatRecordWithAgentDirectives(context, args, await buildAgentProtocolBrief("session_start", context, agentId, labels), json, {
          subject: { type: "session", id: context.sessionId, title: context.sessionId }
        })
      );
      return { exitCode: 0 };
    case "end":
      output.write(
        await formatRecordWithAgentDirectives(context, args, await buildAgentProtocolBrief("session_end", context, agentId, labels), json, {
          subject: { type: "session", id: context.sessionId, title: context.sessionId }
        })
      );
      return { exitCode: 0 };
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown session command: ${action ?? ""}`);
  }
}

async function operationCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const sessionId = optionalSessionId(flagValue(args, "session-id"));
      const command = optionalCommandPath(flagValue(args, "command"));
      const status = parseOperationStatus(flagValue(args, "status"));
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_OPERATION_LIST_LIMIT;
      const rows = await context.store.read(async (reader) => {
        const operations = await reader.listOperations();
        return [...operations]
          .filter((operation) => !sessionId || operation.sessionId === sessionId)
          .filter((operation) => !command || operation.commandPath === command)
          .filter((operation) => !status || operation.status === status)
          .sort(compareOperationsNewestFirst)
          .slice(0, limit)
          .map(operationListRow);
      });
      output.write(json ? formatRecord(rows, true) : table(rows.map(textOperationListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const operation = await resolveOperation(context, requiredPositional(rest, 0, "operation id"));
      output.write(formatRecord(operation, json));
      return { exitCode: 0 };
    }
    case "prune": {
      output.write(formatRecord(await pruneOperations(context, args), json));
      return { exitCode: 0 };
    }
    case "repair": {
      output.write(formatRecord(await repairOperationLinks(context, hasFlag(args, "dry-run")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown operation command: ${action ?? ""}`);
  }
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
    throw new BorealError("BOREAL_NOT_FOUND", "Operation not found", { operationId: value });
  }
  if (candidates.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Operation id prefix is ambiguous", {
      operationId: value,
      candidates: candidates.map((operation) => operation.meta.id)
    });
  }
  return candidates[0] as RuntimeOperation;
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
  return context.store.write(async (writer) => {
    const operations = [...(await writer.listOperations())].sort(compareOperationsNewestFirst);
    const beforeMs = policy.before ? Date.parse(policy.before) : undefined;
    const eligibleByAge = operations.filter(
      (operation) => beforeMs === undefined || Date.parse(operation.finishedAt) >= beforeMs
    );
    const keepBeforeOperationLog = policy.keep === undefined ? eligibleByAge.length : Math.max(0, policy.keep - 1);
    const keptIds = new Set(eligibleByAge.slice(0, keepBeforeOperationLog).map((operation) => operation.meta.id));
    const deleted = operations.filter((operation) => !keptIds.has(operation.meta.id));
    for (const operation of deleted) {
      await writer.deleteOperation(operation.meta.id);
    }
    const keptBeforeOperationLog = operations.length - deleted.length;
    return {
      deleted: deleted.length,
      keptBeforeOperationLog,
      remainingAfterOperationLog: keptBeforeOperationLog + 1,
      keep: policy.keep,
      before: policy.before,
      deletedIds: deleted.map((operation) => operation.meta.id)
    };
  });
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

function optionalSessionId(value: string | undefined): string | undefined {
  return value ? normalizeActorId(value) : undefined;
}

function optionalCommandPath(value: string | undefined): string | undefined {
  return value ? normalizeMachineString(value, "command path", { lowerCase: true }) : undefined;
}

function shouldRecordOperation(definition: CommandDefinition): boolean {
  return definition.requiresWorkspace || definition.path[0] === "init";
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
  error: unknown
): Promise<void> {
  const finishedAt = nowIso();
  const exitCode = error ? commandErrorExitCode(error) : result?.exitCode ?? 1;
  const behavior = commandBehavior(definition);
  const status = exitCode === 0 ? "succeeded" : "failed";
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
    stateChanged: status === "succeeded" && behavior.writesState,
    generatedArtifactsChanged: status === "succeeded" && behavior.writesGeneratedArtifacts,
    eventIds: [],
    ...operationErrorFields(error, exitCode)
  } satisfies RuntimeOperation;

  await context.store.write(async (writer) => {
    const eventIds = (await writer.listEvents())
      .filter((event) => !eventIdsBefore.has(event.meta.id) && event.operationId === operationId)
      .map((event) => event.meta.id);
    await writer.putOperation(withContentHash({ ...operation, eventIds } satisfies RuntimeOperation));
  });
}

async function listEventIds(context: CliContext): Promise<ReadonlySet<EventId>> {
  return new Set((await context.store.read((reader) => reader.listEvents())).map((event) => event.meta.id));
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
      errorMessage: isBorealError(error) ? error.code : "Unexpected command failure"
    };
  }
  return exitCode === 0 ? {} : { errorCode: "BOREAL_COMMAND_EXIT_NONZERO", errorMessage: "Command returned a non-zero exit code" };
}

function redactedArgv(definition: CommandDefinition, args: ParsedArgs): readonly string[] {
  const values: string[] = [...definition.path];
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

function commandsCommand(args: ParsedArgs, output: CliOutput, json: boolean): CommandResult {
  const format = commandsFormat(args);
  const registry = {
    commands: COMMAND_DEFINITIONS.map(serializeCommandDefinition)
  };
  if (json) {
    output.write(formatRecord(registry, true));
  } else if (format === "markdown") {
    output.write(commandsMarkdown());
  } else {
    output.write(formatCommandsGrouped());
  }
  return { exitCode: 0 };
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
  readonly dataRequirements: AgentDirectiveRegistryEntry["dataRequirements"];
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
    throw new BorealError("BOREAL_NOT_FOUND", "Directive registry entry not found", { registryId: directiveRegistryId });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement not found", { acknowledgementId });
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
    throw new BorealError("BOREAL_NOT_FOUND", `Directive registry entry not found: ${id}`);
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
    throw new BorealError("BOREAL_NOT_FOUND", `Directive registry entry not found: ${id}`);
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
  const gaps = agentDirectiveGapsForSnapshot(snapshot, AGENT_DIRECTIVE_REGISTRY, dataByRegistryId);
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
      warningThreshold: 1025
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
            `${directive.registryId} [${directive.severity}/${directive.lifecycle}] - ${directive.title} (${directive.source.selectedBy.join(", ")})`
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
    dataRequirements: entry.dataRequirements,
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
      { key: "lifecycle", value: directive.lifecycle },
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
      "Data Requirements",
      directive.dataRequirements.map(
        (requirement) =>
          `${requirement.key} (${requirement.valueType}${requirement.required ? ", required" : ", optional"}): ${requirement.description}`
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
  ].filter(isString);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatDirectiveIdList(ids: readonly AgentDirectiveTemplateId[]): string {
  return ids.length > 0 ? ids.join(", ") : "none";
}

function formatCommandsGrouped(): string {
  const version = getVersionInfo().version;
  const lines: string[] = [box([`Boreal Work · command reference   v${version}`]), ""];
  const covered = new Set(HELP_SECTIONS.flatMap((section) => section.categories));
  const renderSection = (title: string, defs: readonly (typeof COMMAND_DEFINITIONS)[number][]): void => {
    if (defs.length === 0) return;
    const width = defs.reduce((max, definition) => Math.max(max, commandPath(definition).length), 0);
    lines.push(`▌ ${title.toUpperCase()}`);
    for (const definition of defs) {
      lines.push(`    ${commandPath(definition).padEnd(width)}   ${definition.summary}`);
    }
    lines.push("");
  };
  for (const section of HELP_SECTIONS) {
    renderSection(
      section.title,
      COMMAND_DEFINITIONS.filter((definition) => section.categories.includes(definition.category))
    );
  }
  renderSection(
    "More",
    COMMAND_DEFINITIONS.filter((definition) => !covered.has(definition.category))
  );
  lines.push(" bwrk help <command> for full usage · bwrk commands --format markdown for docs");
  return lines.join("\n");
}

function commandsFormat(args: ParsedArgs): "table" | "markdown" {
  const format = flagValue(args, "format") ?? "table";
  if (format === "table" || format === "markdown") {
    return format;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--format must be table or markdown");
}

function completionCommand(args: ParsedArgs, output: CliOutput, json: boolean): CommandResult {
  const shell = args.command[1] ?? "";
  if (!isCompletionShell(shell)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Completion shell must be one of: ${COMPLETION_SHELLS.join(", ")}`, {
      shell
    });
  }
  const name = flagValue(args, "name") ?? "bwrk";
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--name must contain only letters, numbers, dots, underscores, or dashes", {
      name
    });
  }
  const result = generateShellCompletion(shell, name);
  output.write(json ? formatRecord(result, true) : result.script);
  return { exitCode: 0 };
}

function commandsMarkdown(): string {
  const lines = [
    "# Boreal Command Reference",
    "",
    "Generated from `COMMAND_DEFINITIONS`; use the hand-written CLI guide for workflow notes.",
    ""
  ];

  for (const definition of COMMAND_DEFINITIONS) {
    const behavior = commandBehavior(definition);
    lines.push(
      `## \`${commandPath(definition)}\``,
      "",
      "```bash",
      definition.usage,
      "```",
      "",
      definition.description ?? definition.summary,
      "",
      `- Category: \`${definition.category}\``,
      `- Requires workspace: \`${definition.requiresWorkspace ? "yes" : "no"}\``,
      `- Supports JSON: \`${definition.supportsJson ? "yes" : "no"}\``,
      `- Lock: \`${behavior.requiresLock}\``,
      `- Output schema: \`${behavior.jsonOutputSchema}\``
    );

    if (definition.flags.length > 0) {
      lines.push("", "Flags:");
      for (const flag of definition.flags) {
        const valueSuffix = flag.type === "value" ? " <value>" : "";
        const repeatable = flag.repeatable ? " Repeatable." : "";
        lines.push(`- \`--${flag.name}${valueSuffix}\`: ${flag.summary}${repeatable}`);
      }
    }

    lines.push("", "Examples:");
    for (const example of behavior.examples) {
      lines.push(`- \`${example}\``);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function workflowsCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const workflows = await listWorkflowAssets({ workspaceRoot: context.workspaceRoot });
      const rows = workflows.map((workflow) => ({
        id: workflow.id,
        title: workflow.title,
        group: workflow.group,
        path: workflow.path,
        commands: workflow.allowedCommands.length,
        templates: workflow.templates.filter((template) => template !== "none").length
      }));
      output.write(json ? formatRecord(rows, true) : dashboardView(args) ? formatWorkflowDashboard(rows) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const workflow = await getWorkflowAsset(requiredPositional(rest, 0, "workflow reference"), { workspaceRoot: context.workspaceRoot });
      output.write(json ? formatRecord(workflow, true) : workflow.text);
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown workflows command: ${action ?? ""}`);
  }
}

async function installCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action === undefined) {
    return installSetupCommand(context, args, output, json);
  }

  if (action === "status") {
    const status = await inspectBorealInstallStatus({
      workspaceRoot: context.workspaceRoot,
      checkedAt: nowIso(),
      binDir: flagValue(args, "bin-dir"),
      envPath: flagValue(args, "path")
    });
    output.write(json ? formatRecord(status, true) : formatInstallStatus(status));
    return { exitCode: installStatusHealthy(status) ? 0 : 1 };
  }

  const target = installTarget(action);
  const dryRun = hasFlag(args, "dry-run");
  const interactive = hasFlag(args, "interactive");
  if (interactive && json) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive cannot be combined with --json");
  }
  const plan = await buildSkillInstallPlan({
    target,
    dryRun,
    installRoot: await installRootFromArgs(context, args, target),
    workspaceRoot: context.workspaceRoot
  });
  if (interactive && !dryRun) {
    await confirmSkillInstallPlan(plan);
  }
  const result = dryRun ? plan : await installSkillsFromPlan(plan);
  output.write(json ? formatRecord(result, true) : formatSkillInstallPlan(result));
  return { exitCode: result.issues.length === 0 ? 0 : 1 };
}

async function installSetupCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const yes = hasFlag(args, "yes");
  const explicitDryRun = hasFlag(args, "dry-run");
  const dryRun = explicitDryRun || (json && !yes);
  const explicitInteractive = hasFlag(args, "interactive");
  const interactive = explicitInteractive || (!yes && !dryRun);
  if (yes && explicitDryRun) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk install cannot combine --yes and --dry-run");
  }
  if (yes && explicitInteractive) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk install cannot combine --yes and --interactive");
  }
  if (interactive && json) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive cannot be combined with --json");
  }

  const setupArgs = installSetupArgs(args);
  const input = interactive
    ? await promptProjectInstallInput(context, setupArgs)
    : projectSetupInputFromArgs(context, setupArgs);
  await validateProjectSetupInput(input);
  const plan = installSetupPlan(input);
  if (dryRun) {
    const result: InstallSetupResult = {
      kind: "install",
      dryRun: true,
      yes,
      workspaceRoot: context.workspaceRoot,
      plan
    };
    output.write(json ? formatRecord(result, true) : formatInstallSetupResult(result, input));
    return { exitCode: 0 };
  }

  await ensureWorkspaceDirs(context);
  const initialized = await context.runtime.ensureWorkspaceInitialized();
  const projectSetup = await applyProjectSetup(input);
  const skillInstalls = await installProjectSetupSkills(context, projectSetup);
  const result: InstallSetupResult = {
    kind: "install",
    dryRun: false,
    yes,
    initialized: initialized.initialized,
    workspaceRoot: context.workspaceRoot,
    eventId: initialized.event.meta.id,
    plan,
    projectSetup,
    skillInstalls
  };
  output.write(json ? formatRecord(result, true) : formatInstallSetupResult(result, input));
  return { exitCode: 0 };
}

function installSetupArgs(args: ParsedArgs): ParsedArgs {
  const flags = new Map<string, string[]>();
  for (const [name, values] of args.flags.entries()) {
    flags.set(name, [...values]);
  }
  if (!flags.has("folder-scoped")) {
    flags.set("folder-scoped", ["true"]);
  }
  return { command: args.command, flags };
}

function installSetupPlan(input: ProjectSetupInput): InstallSetupResult["plan"] {
  return {
    projectRoot: input.projectRoot,
    memoryRoot: input.memoryRoot,
    memoryLayout: input.memoryLayout,
    memoryGitMode: input.memoryGitMode,
    installRoot: input.installRoot,
    skillTargets: input.skillTargets,
    folderScoped: input.folderScoped
  };
}

function formatInstallSetupResult(result: InstallSetupResult, input: ProjectSetupInput): string {
  const title = result.dryRun ? "Boreal install plan" : "Boreal install complete";
  const detail = result.dryRun
    ? "No files were written. Run bwrk install --yes to apply this plan."
    : "Workspace runtime, child memory, Git guards, and agent skills are ready.";
  const lines = [
    box(["Boreal Install", "Clean local setup for project memory and agent skills"]),
    "",
    resultSummary({ status: result.dryRun ? "pending" : "success", title, detail }),
    "",
    formatProjectInstallReview(input)
  ];
  if (result.projectSetup) {
    lines.push(
      "",
      section(
        "Written",
        [
          `config ${result.projectSetup.configPath}`,
          `memory directories ${result.projectSetup.createdDirectories.length} created, ${result.projectSetup.existingDirectories.length} existing`,
          `memory files ${result.projectSetup.createdFiles.length} created, ${result.projectSetup.existingFiles.length} existing`,
          `project gitignore ${result.projectSetup.gitSetup.projectGitignoreUpdated ? "updated" : "unchanged"}`,
          `memory repo ${result.projectSetup.gitSetup.memoryRepoInitialized ? "initialized" : "already present"}`
        ]
      )
    );
  }
  if (result.skillInstalls && result.skillInstalls.length > 0) {
    lines.push(
      "",
      section(
        "Skills",
        result.skillInstalls.map((install) => `${install.target} ${install.skillRoot} (${install.fileCount} files)`)
      )
    );
  }
  return `${lines.join("\n")}\n`;
}

function installTarget(action: string | undefined): "codex" | "claude" | "skills" {
  if (action === "codex" || action === "claude" || action === "skills") {
    return action;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown install command: ${action ?? ""}`);
}

function formatInstallStatus(status: InstallStatus): string {
  const globalProbe = status.globalCommand.probe;
  return [
    resultSummary({
      status: installStatusHealthy(status) ? "success" : "warning",
      title: "bwrk install status",
      detail: installStatusSummary(status)
    }),
    section(
      "Package",
      keyValueRows([
        { key: "name", value: status.package.name },
        { key: "version", value: status.package.version },
        { key: "node", value: status.package.node },
        { key: "packageManager", value: status.package.packageManager ?? "unknown" }
      ]).split("\n")
    ),
    section(
      "Local source runner",
      keyValueRows([
        { key: "available", value: status.localSource.available },
        { key: "command", value: status.localSource.command },
        { key: "sourceRoot", value: status.localSource.sourceRoot },
        { key: "packageScript", value: status.localSource.packageScript || "missing" },
        { key: "reason", value: status.localSource.reason ?? "none" }
      ]).split("\n")
    ),
    section(
      "Global command",
      keyValueRows([
        { key: "found", value: status.globalCommand.found },
        { key: "path", value: status.globalCommand.path ?? "not found" },
        { key: "probe", value: globalProbe ? (globalProbe.ok ? "passed" : "failed") : "not run" },
        { key: "versionOutput", value: globalProbe?.stdout || "none" },
        { key: "probeError", value: globalProbe?.error ?? "none" }
      ]).split("\n")
    ),
    section(
      "PATH",
      keyValueRows([
        { key: "shimPath", value: status.localShim.path },
        { key: "shimExecutable", value: status.localShim.executable },
        { key: "binDirOnPath", value: status.path.binDirOnPath },
        { key: "addToPath", value: status.path.addToPathCommand ?? "none" }
      ]).split("\n")
    ),
    section("Recommended actions", status.recommendedActions.length > 0 ? status.recommendedActions : ["none"])
  ].join("\n\n") + "\n";
}

async function installRootFromArgs(context: CliContext, args: ParsedArgs, target: "codex" | "claude" | "skills"): Promise<string> {
  const explicit = flagValue(args, "install-root");
  if (explicit) {
    return resolve(context.workspaceRoot, explicit);
  }
  const config = await readProjectSetupConfig(context.workspaceRoot);
  if (config?.installRoot && (target === "skills" || configuredInstallRootMatchesTarget(config.installRoot, target))) {
    return config.installRoot;
  }
  if (config && target !== "skills") {
    const targetRoot = config.skillInstallRoots?.find((entry) => entry.target === target)?.installRoot;
    if (targetRoot) {
      return targetRoot;
    }
  }
  return defaultInstallRoot(context.workspaceRoot, target);
}

function defaultInstallRoot(workspaceRoot: string, target: "codex" | "claude" | "skills"): string {
  switch (target) {
    case "codex":
      return join(workspaceRoot, ".agents");
    case "claude":
      return join(workspaceRoot, ".claude");
    case "skills":
      return join(workspaceRoot, ".agents", "skills");
  }
}

async function confirmSkillInstallPlan(plan: SkillInstallPlan): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive requires a TTY; use --dry-run to review install plans in automation");
  }
  const accepted = await withPromptSession({ input: process.stdin, output: process.stdout }, async (prompt) => {
    prompt.writeIntro("Boreal skill install review", formatSkillInstallPlan(plan));
    return prompt.select("Write install files", INSTALL_CONFIRM_OPTIONS, "yes");
  });
  if (accepted !== "yes") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Skill install cancelled", { reason: "cancelled" });
  }
}

function formatSkillInstallPlan(plan: SkillInstallPlan): string {
  const summaryStatus = plan.issues.length > 0 ? "warning" : plan.dryRun ? "pending" : "success";
  const fileRows = plan.files.map((file) => {
    const action = file.wouldWrite ? "write" : "skip";
    return `${action} ${file.destination} (${file.workflowRefs.length} workflows)`;
  });
  return [
    resultSummary({
      status: summaryStatus,
      title: `${plan.target} skill install ${plan.dryRun ? "plan" : "result"}`,
      detail: `${plan.files.length} files, ${plan.issues.length} issues`
    }),
    section(
      "Paths",
      keyValueRows([
        { key: "target", value: plan.target },
        { key: "dryRun", value: plan.dryRun },
        { key: "assetRoot", value: plan.assetRoot },
        { key: "installRoot", value: plan.installRoot },
        { key: "skillRoot", value: plan.skillRoot }
      ]).split("\n")
    ),
    section("Files", fileRows.length > 0 ? fileRows : ["none"]),
    plan.issues.length > 0
      ? section(
          "Issues",
          plan.issues.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`)
        )
      : undefined
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n\n") + "\n";
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

function formatWorkflowDashboard(
  rows: readonly {
    readonly id: string;
    readonly title: string;
    readonly group: string;
    readonly path: string;
    readonly commands: number;
    readonly templates: number;
  }[]
): string {
  const groups = [...new Set(rows.map((row) => row.group))].sort();
  return [
    resultSummary({ status: "info", title: "Workflow picker", detail: `${rows.length} workflows available` }),
    ...groups.map((group) =>
      section(
        group,
        rows
          .filter((row) => row.group === group)
          .sort((left, right) => left.path.localeCompare(right.path))
          .map((row) => `${row.path} - ${row.title} (${row.commands} commands, ${row.templates} templates)`)
      )
    )
  ].join("\n\n") + "\n";
}

function formatReadyWorkDashboard(rows: readonly WorkListRow[]): string {
  return [
    resultSummary({ status: rows.length > 0 ? "success" : "pending", title: "Ready work", detail: `${rows.length} claimable items` }),
    section(
      "Queue",
      rows.length > 0
        ? rows.map((row) => `${row.priority.padEnd(8)} ${row.id} ${row.title}${row.labels.length > 0 ? ` [${row.labels.join(", ")}]` : ""}`)
        : ["No ready work matches the selected filters."]
    ),
    section("Actions", rows.length > 0 ? ["bwrk work claim --label <label> --agent <agent-id> --json"] : ["bwrk work list --json"])
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

function formatSyncDashboard(status: SyncStatusResult): string {
  return [
    resultSummary({
      status: status.ok ? "success" : "warning",
      title: "Sync status",
      detail: status.workspaceRoot
    }),
    section(
      "Checks",
      keyValueRows([
        { key: "vault", value: status.vault.ok },
        { key: "ledgers", value: status.ledgers.ok },
        { key: "searchIndex", value: status.searchIndex.ok },
        { key: "git", value: status.git.ok }
      ]).split("\n")
    ),
    section("Recommended actions", status.recommendedActions.length > 0 ? status.recommendedActions : ["none"])
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

function formatLockDashboard(inspection: Awaited<ReturnType<typeof inspectFileLock>>): string {
  return [
    resultSummary({
      status: !inspection.exists ? "success" : inspection.stale ? "warning" : "info",
      title: "State lock",
      detail: inspection.exists ? (inspection.stale ? "stale lock present" : "active lock present") : "no active lock"
    }),
    section(
      "Details",
      keyValueRows([
        { key: "lockDir", value: inspection.lockDir },
        { key: "exists", value: inspection.exists },
        { key: "stale", value: inspection.stale },
        { key: "ageMs", value: inspection.ageMs ?? "" },
        { key: "owner", value: inspection.owner ? `${inspection.owner.hostname}:${inspection.owner.pid}` : "" }
      ]).split("\n")
    ),
    section("Actions", inspection.exists && inspection.stale ? ["bwrk lock break --stale-only --json"] : ["none"])
  ].join("\n\n") + "\n";
}

async function agentCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "guide": {
      const guide = await buildAgentGuide(context, agentIdFromArgs(args, context.actor.id), labelsFromArgs(args));
      output.write(json ? formatRecord(guide, true) : formatAgentGuide(guide));
      return { exitCode: 0 };
    }
    case "finish":
      return agentFinishCommand(rest, context, args, output, json);
    case "start":
      return agentStartCommand(context, args, output, json);
    case "status": {
      const agentId = agentIdFromArgs(args, context.actor.id);
      const labels = labelsFromArgs(args);
      const status = await buildAgentStatus(context, agentId, labels);
      output.write(json ? formatRecord(status, true) : dashboardView(args) ? formatAgentStatusDashboard(status) : formatRecord(status, false));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown agent command: ${action ?? ""}`);
  }
}

async function agentStartCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const agentId = agentIdFromArgs(args, context.actor.id);
  const labels = labelsFromArgs(args);
  const handoffResultLimit = parseHandoffResultLimit(args);
  const status = await buildAgentStatus(context, agentId, labels);

  if (status.reservations.expiredActiveCount > 0) {
    output.write(formatRecord(agentStartBlocked(agentId, labels, status, "expired_active_reservations"), json));
    return { exitCode: 1 };
  }

  const activeReservation = status.reservations.active[0];
  if (activeReservation) {
    const reservation = await requireReservation(context, activeReservation.id);
    const handoff = await buildHandoffResult(context, asWorkId(activeReservation.workId), args, handoffResultLimit);
    const result = {
      started: true,
      action: "continue_reserved_work",
      agentId,
      labels,
      status: await buildAgentStatus(context, agentId, labels),
      reservation,
      releasedReservations: [],
      ...handoff
    } satisfies AgentStartResult;
    output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
      subjectWorkId: asWorkId(activeReservation.workId)
    }));
    return { exitCode: 0 };
  }

  if (status.reservations.capacityRemaining <= 0) {
    output.write(formatRecord(agentStartBlocked(agentId, labels, status, "reservation_capacity_reached"), json));
    return { exitCode: 1 };
  }

  const claim = await context.runtime.claimNextWork({
    agentId,
    labels,
    purpose: flagValue(args, "purpose"),
    expiresAt: parseReservationExpiresAt(args)
  });
  if (!claim) {
    const currentStatus = await buildAgentStatus(context, agentId, labels);
    output.write(formatRecord(agentStartBlocked(agentId, labels, currentStatus, "no_ready_work"), json));
    return { exitCode: 0 };
  }

  const handoff = await buildHandoffResult(context, claim.work.meta.id, args, handoffResultLimit, claim.work);
  const result = {
    started: true,
    action: "claimed_work",
    agentId,
    labels,
    status: await buildAgentStatus(context, agentId, labels),
    reservation: claim.reservation,
    releasedReservations: claim.releasedReservations,
    ...handoff
  } satisfies AgentStartResult;
  output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
    subjectWork: claim.work
  }));
  return { exitCode: 0 };
}

async function agentFinishCommand(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const agentId = agentIdFromArgs(args, context.actor.id);
  const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"), { agentId });
  const verdict = parseVerdict(flagValue(args, "verdict"));
  const close = hasFlag(args, "close");
  const release = hasFlag(args, "release");

  if (close && release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--close and --release cannot be used together");
  }
  if (!close && !release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish requires --close or --release");
  }
  if (close && verdict !== "passed") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--close requires a passed verification verdict");
  }

  const closeReason = close ? requiredFlag(args, "reason") : undefined;
  const closeoutSummaryFactory = closeReason
    ? await agentFinishSummaryFactory(context, args, workId, closeReason)
    : undefined;
  const finished = await context.runtime.finishReservedWork({
    workId,
    agentId,
    evidence: {
      kind: parseEvidenceKind(flagValue(args, "kind")),
      summary: requiredFlag(args, "summary"),
      outcome: parseFinishOutcome(flagValue(args, "outcome"), verdict),
      command: flagValue(args, "command"),
      uri: flagValue(args, "uri")
    },
    verification: {
      verdict,
      notes: flagValue(args, "notes")
    },
    close: closeReason ? { reason: closeReason, agentSummary: closeoutSummaryFactory } : undefined,
    release
  });
  const closeoutSummaryArtifact = finished.agentSummary
    ? await writeAgentSummaryArtifact(context, finished.agentSummary)
    : undefined;

  const result = {
    finished: true,
    action: close ? "verified_and_closed" : "verified_and_released",
    agentId,
    work: await context.runtime.getWorkView(workId),
    evidence: finished.evidence,
    verification: finished.verification,
    reservation: finished.reservation,
    closedWork: finished.closedWork,
    agentSummary: finished.agentSummary,
    agentSummaryArtifact: closeoutSummaryArtifact,
    release: finished.release,
    status: await buildAgentStatus(context, agentId, [])
  } satisfies AgentFinishResult;
  output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
    subjectWork: finished.closedWork ?? finished.work
  }));
  return { exitCode: 0 };
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
  const finished = await input.context.runtime.finishReservedWork({
    workId,
    agentId,
    evidence: {
      kind: parseEvidenceKind(flagValue(input.args, "kind")),
      summary: requiredFlag(input.args, "summary"),
      outcome: parseFinishOutcome(flagValue(input.args, "outcome"), input.verdict),
      command: flagValue(input.args, "command"),
      uri: flagValue(input.args, "uri")
    },
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

  const result = {
    finished: true,
    action: input.close ? "verified_and_closed" : "verified_and_released",
    agentId,
    work: await input.context.runtime.getWorkView(workId),
    evidence: finished.evidence,
    verification: finished.verification,
    reservation: finished.reservation,
    closedWork: finished.closedWork,
    agentSummary: finished.agentSummary,
    agentSummaryArtifact: closeoutSummaryArtifact,
    release: finished.release,
    status: await buildAgentStatus(input.context, agentId, [])
  } satisfies AgentFinishResult;
  input.output.write(await formatRecordWithAgentDirectives(input.context, input.args, result, input.json, {
    subjectWork: finished.closedWork ?? finished.work
  }));
  return { exitCode: 0 };
}

async function reservationCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "list") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown reservation command: ${action ?? ""}`);
  }

  const agentId = optionalAgentIdFromArgs(args);
  const workRef = flagValue(args, "work");
  const workId = workRef ? await resolveWorkId(context, workRef, agentId ? { agentId } : undefined) : undefined;
  const status = parseReservationStatus(flagValue(args, "status"));
  const onlyExpired = hasFlag(args, "expired");
  const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
  const now = Date.now();
  const rows = await context.store.read(async (reader) => {
    const reservations = await reader.listReservations();
    const workItems = await reader.listWorkItems();
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    return reservations
      .map((reservation) => reservationListRow(reservation, workById.get(reservation.workId), now))
      .filter((row) => !agentId || row.agentId === agentId)
      .filter((row) => !workId || row.workId === workId)
      .filter((row) => !status || row.status === status)
      .filter((row) => !onlyExpired || row.expired)
      .sort(compareReservationRows)
      .slice(0, limit);
  });
  output.write(json ? formatRecord(rows, true) : table(rows.map(textReservationListRow)));
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
          throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat not found", { heartbeatId: existing.meta.id });
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
      throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat not found", { heartbeatId: value });
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
      containerId
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
        throw new BorealError("BOREAL_NOT_FOUND", "Heartbeat work cursor not found", { workId });
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
        throw new BorealError("BOREAL_NOT_FOUND", "Heartbeat event cursor not found", { eventId: explicitEventId });
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
        throw new BorealError("BOREAL_NOT_FOUND", "Heartbeat event cursor not found", { eventId: explicitEventId });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Reviewer heartbeat checkpoint not found", { checkpointId: value });
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

async function initCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  await ensureWorkspaceDirs(context);
  const result = await context.runtime.ensureWorkspaceInitialized();
  const projectSetup = await maybeConfigureProjectSetup(context, args);
  const skillInstalls = projectSetup ? await installProjectSetupSkills(context, projectSetup) : undefined;
  const initResult = {
    initialized: result.initialized,
    workspaceRoot: context.workspaceRoot,
    eventId: result.event.meta.id,
    projectSetup,
    skillInstalls
  };
  output.write(json ? formatRecord(initResult, true) : formatInitResult(initResult));
  return { exitCode: 0 };
}

async function installProjectSetupSkills(context: CliContext, projectSetup: ProjectSetupResult): Promise<readonly SkillInstallSummary[]> {
  const results: SkillInstallSummary[] = [];
  for (const target of projectSetup.config.skillTargets) {
    const installRoot =
      projectSetup.config.skillInstallRoots?.find((entry) => entry.target === target)?.installRoot ??
      configuredInstallRootForTarget(context.workspaceRoot, projectSetup.config.installRoot, target);
    const plan = await buildSkillInstallPlan({ target, dryRun: false, installRoot, workspaceRoot: context.workspaceRoot });
    const installed = await installSkillsFromPlan(plan);
    results.push({
      target: installed.target,
      installRoot: installed.installRoot,
      skillRoot: installed.skillRoot,
      fileCount: installed.files.length
    });
  }
  return results;
}

function formatInitResult(result: {
  readonly initialized: boolean;
  readonly workspaceRoot: string;
  readonly eventId: string;
  readonly projectSetup?: ProjectSetupResult;
  readonly skillInstalls?: readonly SkillInstallSummary[];
}): string {
  const lines = [
    "Boreal workspace initialized",
    `workspace: ${result.workspaceRoot}`,
    `event: ${result.eventId}`
  ];
  if (result.projectSetup) {
    lines.push(
      "",
      "Project setup",
      `config: ${result.projectSetup.configPath}`,
      `memory: ${result.projectSetup.config.memoryRoot}`,
      `layout: ${result.projectSetup.config.memoryLayout}`,
      `memory git: ${result.projectSetup.config.memoryGitMode}`,
      `memory repo initialized: ${result.projectSetup.gitSetup.memoryRepoInitialized ? "yes" : "no"}`,
      `project gitignore updated: ${result.projectSetup.gitSetup.projectGitignoreUpdated ? "yes" : "no"}`,
      `gitmodules updated: ${result.projectSetup.gitSetup.gitmodulesUpdated ? "yes" : "no"}`,
      `skills: ${result.projectSetup.config.installRoot}`,
      `targets: ${result.projectSetup.config.skillTargets.join(", ")}`,
      `folder scoped: ${result.projectSetup.config.folderScoped ? "yes" : "no"}`,
      `created: ${result.projectSetup.createdDirectories.length} directories, ${result.projectSetup.createdFiles.length} files`,
      `existing: ${result.projectSetup.existingDirectories.length} directories, ${result.projectSetup.existingFiles.length} files`
    );
  }
  if (result.skillInstalls && result.skillInstalls.length > 0) {
    lines.push(
      "",
      "Skill installs",
      ...result.skillInstalls.map((install) => `${install.target}: ${install.skillRoot} (${install.fileCount} files)`)
    );
  }
  return `${lines.join("\n")}\n`;
}

async function workCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const title = flagValue(args, "title") ?? rest.join(" ").trim();
      if (!title) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Work title is required");
      }
      const work = await context.runtime.createWork({
        title,
        description: flagValue(args, "description"),
        kind: parseWorkKind(flagValue(args, "kind")),
        priority: parsePriority(flagValue(args, "priority")),
        acceptanceCriteria: flagValues(args, "acceptance"),
        labels: labelsFromArgs(args),
        requiredCloseoutGates: requiredCloseoutGateInputsFromArgs(args),
        sourceRefs: sourceRefsFromArgs(args),
        ready: hasFlag(args, "ready")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "ready": {
      const work = await context.runtime.markReady(await resolveWorkId(context, requiredPositional(rest, 0, "work reference")));
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = listStatus(args);
      const labels = labelsFromArgs(args);
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const items = await context.store.read((reader) =>
        reader.listWorkItems({
          status,
          labels: labels.length > 0 ? labels : undefined
        })
      );
      const rows = items.slice(0, limit).map(workListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "recent-closed": {
      const result = await recentClosedWorkCommand(context, args);
      output.write(json ? formatRecord(result, true) : table(result.items.map(textRecentClosedWorkRow)));
      return { exitCode: 0 };
    }
    case "review-candidates": {
      const result = await reviewCandidatesCommand(context, args);
      output.write(json ? formatRecord(result, true) : table(result.items.map(textReviewCandidateRow)));
      return { exitCode: 0 };
    }
    case "next": {
      const labels = labelsFromArgs(args);
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_READY_WORK_LIMIT;
      const views = await context.runtime.listReadyWork();
      const rows = views
        .filter((view) => labels.every((label) => view.labels.includes(label)))
        .sort(compareWorkViews)
        .slice(0, limit)
        .map(workViewListRow);
      output.write(json ? formatRecord(rows, true) : dashboardView(args) ? formatReadyWorkDashboard(rows) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const view = await context.runtime.getWorkView(workId);
      const viewWithGaps = json ? { ...view, gaps: (await closeoutGateStatusForWork(context, workId)).gaps } : view;
      output.write(await formatRecordWithAgentDirectives(context, args, viewWithGaps, json, { subjectWorkId: workId }));
      return { exitCode: 0 };
    }
    case "block": {
      const blockedWorkId = await resolveWorkId(context, requiredPositional(rest, 0, "blocked work reference"));
      const blockingWorkId = await resolveWorkId(context, requiredPositional(rest, 1, "blocking work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "reserve": {
      const work = await context.runtime.reserveWork({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        agentId: agentIdFromArgs(args, context.actor.id),
        purpose: flagValue(args, "purpose"),
        expiresAt: parseReservationExpiresAt(args),
        force: hasFlag(args, "force"),
        forceReason: flagValue(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "claim": {
      const agentId = agentIdFromArgs(args, context.actor.id);
      const labels = labelsFromArgs(args);
      const handoffResultLimit = parseHandoffResultLimit(args);
      const claim = await context.runtime.claimNextWork({
        agentId,
        labels,
        purpose: flagValue(args, "purpose"),
        expiresAt: parseReservationExpiresAt(args)
      });
      if (!claim) {
        output.write(
          formatRecord(
            {
              claimed: false,
              reason: "no_ready_work",
              agentId,
              labels
            },
            json
          )
        );
        return { exitCode: 0 };
      }

      const handoff = await buildHandoffResult(context, claim.work.meta.id, args, handoffResultLimit, claim.work);
      const result = {
        claimed: true,
        work: handoff.work,
        reservation: claim.reservation,
        releasedReservations: claim.releasedReservations,
        ...handoff
      };
      output.write(await formatRecordWithAgentDirectives(context, args, result, json, { subjectWork: claim.work }));
      return { exitCode: 0 };
    }
    case "release": {
      const result = await context.runtime.releaseWorkReservation(
        await resolveWorkId(context, requiredPositional(rest, 0, "work reference"))
      );
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "renew": {
      const result = await context.runtime.renewWorkReservation({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        expiresAt: requiredReservationExpiresAt(args)
      });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "verify": {
      const evidenceIds = flagValues(args, "evidence").map(asEvidenceId);
      const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const verification = await context.runtime.verifyWork({
        workId,
        verdict: parseVerdict(flagValue(args, "verdict")),
        evidenceIds,
        notes: flagValue(args, "notes")
      });
      const result = { ...verification, closeoutGateStatus: await closeoutGateStatusForWork(context, workId) };
      output.write(await formatRecordWithAgentDirectives(context, args, result, json, { subjectWorkId: workId }));
      return { exitCode: 0 };
    }
    case "close": {
      const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const reason = requiredFlag(args, "reason");
      const work = await context.store.read((reader) => requireCliWork(reader, workId));
      const closeoutSummary = await ensureAgentSummaryForClose(context, args, work, reason);
      const closed = await context.runtime.closeWork({
        workId,
        reason,
        agentSummary: closeoutSummary.created?.summary,
        agentSummaryIds: closeoutSummary.summaries.map((summary) => summary.meta.id)
      });
      const createdArtifact = closeoutSummary.created
        ? await writeAgentSummaryArtifact(context, closeoutSummary.created.summary)
        : undefined;
      const result = {
        schemaVersion: "boreal.cli.work.close.v1",
        generatedAt: nowIso(),
        workspaceRoot: context.workspaceRoot,
        work: closed,
        agentSummaries: closeoutSummary.summaries,
        createdAgentSummary: closeoutSummary.created?.summary,
        createdAgentSummaryArtifact: createdArtifact
      };
      output.write(await formatRecordWithAgentDirectives(context, args, result, json, { subjectWork: closed }));
      return { exitCode: 0 };
    }
    case "edit": {
      const result = await editWorkCommand(context, await resolveWorkId(context, requiredPositional(rest, 0, "work reference")), args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "cancel": {
      const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const reason = requiredFlag(args, "reason");
      const work = await context.store.read((reader) => requireCliWork(reader, workId));
      if (work.status === "closed" || work.status === "cancelled") {
        throw new BorealError("BOREAL_INVALID_INPUT", "Only open work can be cancelled", {
          workId,
          status: work.status
        });
      }
      const activeReservations = await context.store.read((reader) => activeNonExpiredReservationsForWork(reader, workId, nowIso()));
      if (activeReservations.length > 0) {
        throw new BorealError("BOREAL_POLICY_VIOLATION", "Cannot cancel work with an active non-expired reservation", {
          workId,
          reservationIds: activeReservations.map((reservation) => reservation.meta.id)
        });
      }
      const closeoutSummary = await ensureAgentSummaryForClose(context, args, work, reason, {
        outcome: "cancelled"
      });
      const result = await cancelWorkCommand(
        context,
        workId,
        reason,
        closeoutSummary.created?.summary
      );
      const createdArtifact = closeoutSummary.created
        ? await writeAgentSummaryArtifact(context, closeoutSummary.created.summary)
        : undefined;
      const outputResult = {
        schemaVersion: "boreal.cli.work.cancel.v1",
        generatedAt: nowIso(),
        workspaceRoot: context.workspaceRoot,
        ...result,
        agentSummaries: closeoutSummary.summaries,
        createdAgentSummary: closeoutSummary.created?.summary,
        createdAgentSummaryArtifact: createdArtifact
      };
      output.write(await formatRecordWithAgentDirectives(context, args, outputResult, json, { subjectWorkId: workId }));
      return { exitCode: 0 };
    }
    case "reopen": {
      const result = await reopenWorkCommand(context, await resolveWorkId(context, requiredPositional(rest, 0, "work reference")), args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "split": {
      const parentId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const parent = await context.store.read(async (reader) => requireCliWork(reader, parentId));
      const child = await context.runtime.createWork({
        title: requiredFlag(args, "title"),
        description: flagValue(args, "description"),
        kind: "task",
        priority: parsePriority(flagValue(args, "priority")) ?? parent.priority,
        acceptanceCriteria: normalizedNonEmptyStrings(flagValues(args, "acceptance")),
        labels: uniqueStrings([...parent.labels, ...labelsFromArgs(args)]),
        parentId: parent.meta.id,
        sourceRefs: parent.meta.sourceRefs,
        ready: hasFlag(args, "ready")
      });
      const blockedParent = await context.runtime.addBlockingDependency({
        blockedWorkId: parent.meta.id,
        blockingWorkId: child.meta.id
      });
      output.write(formatRecord({ parent, child, blockedParent }, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown work command: ${action ?? ""}`);
  }
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
        reservationIds: activeReservations.map((reservation) => reservation.meta.id)
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
      availableGates: input.gates.map((gate) => `${gate.id}:${gate.kind}:${gate.scope}`)
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

async function depCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const type = dependencyTypeFromArgs(args);
      const blockedWorkId = await resolveWorkId(context, requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await resolveWorkId(context, requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "remove": {
      const type = dependencyTypeFromArgs(args);
      const blockedWorkId = await resolveWorkId(context, requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await resolveWorkId(context, requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.removeBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "tree": {
      const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const tree = await context.store.read(async (reader) =>
        dependencyTreeForWork(workId, await reader.listWorkItems(), await reader.listGraphEdges())
      );
      output.write(json ? await formatRecordWithAgentDirectives(context, args, tree, true, { subjectWorkId: workId }) : table(dependencyTreeRows(tree)));
      return { exitCode: 0 };
    }
    case "cycles": {
      const cycles = await context.store.read(async (reader) => dependencyCyclesFromGraph(await reader.listGraphEdges()));
      output.write(
        json
          ? formatRecord(cycles, true)
          : table(cycles.map((cycle, index) => ({ cycle: index + 1, path: cycle.cycle.join(" -> ") })))
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown dep command: ${action ?? ""}`);
  }
}

async function evidenceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "add") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown evidence command: ${action ?? ""}`);
  }

  const evidence = await context.runtime.recordEvidence({
    subjectId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
    subjectType: "work",
    kind: parseEvidenceKind(flagValue(args, "kind")),
    summary: requiredFlag(args, "summary"),
    outcome: parseOutcome(flagValue(args, "outcome")),
    command: flagValue(args, "command"),
    uri: flagValue(args, "uri")
  });
  const result = { ...evidence, closeoutGateStatus: await closeoutGateStatusForWork(context, evidence.subjectId as WorkId) };
  output.write(await formatRecordWithAgentDirectives(context, args, result, json, { subjectWorkId: evidence.subjectId as WorkId }));
  return { exitCode: 0 };
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
      const outputResult = { ...result, closeoutGateStatus: await closeoutGateStatusForSummary(context, result.summary) };
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
      const outputResult = { ...result, closeoutGateStatus: await closeoutGateStatusForSummary(context, result.summary) };
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
  return context.store.read(async (reader) => {
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
      satisfiedBy
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
      return verificationGateStatusSatisfaction(gate, target, evidence, verifications);
    case "checkpoint":
      return checkpointGateStatusSatisfaction(gate, target, summaries);
    case "review":
    case "audit":
      return evidenceGateStatusSatisfaction(gate, target, evidence);
  }
}

function verificationGateStatusSatisfaction(
  gate: RequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[]
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
        evidenceSatisfiesCloseoutGate(gate, record)
      );
    });
  });
  const evidenceIds = uniqueValues(matches.flatMap((verification) =>
    verification.evidenceIds.filter((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return (
        record?.subjectId === target.meta.id &&
        (record.outcome === "passed" || record.outcome === "observed") &&
        evidenceSatisfiesCloseoutGate(gate, record)
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
  evidence: readonly EvidenceRecord[]
): RequiredCloseoutGate["satisfiedBy"] | undefined {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  const matches = evidence.filter(
    (record) =>
      record.subjectId === target.meta.id &&
      record.outcome === gate.requiredOutcome &&
      allowedKinds.has(record.kind) &&
      evidenceSatisfiesCloseoutGate(gate, record)
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

function evidenceSatisfiesCloseoutGate(gate: RequiredCloseoutGate, record: EvidenceRecord): boolean {
  if (gate.declaredCommand && record.command !== gate.declaredCommand) {
    return false;
  }
  if (gate.expectedObservable && !record.summary.includes(gate.expectedObservable)) {
    return false;
  }
  return true;
}

function closeoutGateGapRow(
  gate: CloseoutGateStatusRow,
  owner: WorkItem,
  target: CloseoutGateTargetStatusRow
): CloseoutGateGapRow {
  const reason = declaredGateGapReason(gate) ?? "required gate has no satisfying evidence";
  const code = declaredGateGapCode(gate) ?? defaultCloseoutGateGapCode(gate.kind);
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
      ...(gate.declaredCommand ? { declaredCommand: gate.declaredCommand } : {}),
      ...(gate.expectedObservable ? { expectedObservable: gate.expectedObservable } : {}),
      reason
    }
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
      subjectType: subject.subjectType
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

function agentSummaryRow(summary: AgentSummaryRecord) {
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
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary not found", { summaryId });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing verification", { missingVerificationIds });
  }
  const summaryIds = [...input.childSummaryIds, ...(input.parentSummaryId ? [input.parentSummaryId] : [])];
  const missingSummaryIds: AgentSummaryId[] = [];
  for (const summaryId of summaryIds) {
    if (!(await reader.getAgentSummary(summaryId))) {
      missingSummaryIds.push(summaryId);
    }
  }
  if (missingSummaryIds.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Agent summary references missing summary", { missingSummaryIds });
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

async function agentFinishSummaryFactory(
  context: CliContext,
  args: ParsedArgs,
  workId: WorkId,
  reason: string
): Promise<FinishReservedWorkSummaryFactory> {
  const work = await context.store.read((reader) => requireCliWork(reader, workId));
  const childSummaryIds = await childAgentSummaryIdsForWork(context, work);
  const body = [
    "## Agent Finish Summary",
    "",
    requiredFlag(args, "summary"),
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
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Closeout requires at least one agent summary");
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
      }))
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

async function sourceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const source = await context.runtime.createKnowledgeSource({
        kind: parseSourceKind(flagValue(args, "kind")) ?? "document",
        title: requiredFlag(args, "title"),
        uri: requiredFlag(args, "uri"),
        summary: flagValue(args, "summary")
      });
      output.write(formatRecord(source, json));
      return { exitCode: 0 };
    }
    case "list": {
      const kind = parseSourceKind(flagValue(args, "kind"));
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const sources = await context.runtime.listKnowledgeSources();
      const rows = sources
        .filter((source) => !kind || source.kind === kind)
        .slice(0, limit)
        .map(sourceListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const source = await context.runtime.getKnowledgeSource(asSourceId(requiredPositional(rest, 0, "source id")));
      output.write(formatRecord(source, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown source command: ${action ?? ""}`);
  }
}

async function claimCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const wikiPageIds = await resolveWikiPageIds(context, flagValues(args, "wiki"));
      const claim = await context.runtime.createClaim({
        statement: requiredFlag(args, "statement"),
        status: parseClaimStatus(flagValue(args, "status")),
        sourceIds: flagValues(args, "source").map(asSourceId),
        evidenceIds: flagValues(args, "evidence").map(asEvidenceId),
        wikiPageIds
      });
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseClaimStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"));
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const claims = await context.runtime.listClaims();
      const rows = claims
        .filter((claim) => !status || claim.status === status)
        .filter((claim) => !sourceId || claim.sourceIds.includes(sourceId))
        .slice(0, limit)
        .map(claimListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textClaimListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const claim = await context.runtime.getClaim(asClaimId(requiredPositional(rest, 0, "claim id")));
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    case "review": {
      const result = await reviewClaimCommand(context, asClaimId(requiredPositional(rest, 0, "claim id")), args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown claim command: ${action ?? ""}`);
  }
}

async function reviewClaimCommand(context: CliContext, claimId: ClaimId, args: ParsedArgs) {
  const status = parseClaimStatus(requiredFlag(args, "status"));
  if (!status) {
    throw new BorealError("BOREAL_INVALID_INPUT", "claim review requires --status");
  }
  const sourceIds = flagValues(args, "source").map(asSourceId);
  const evidenceIds = flagValues(args, "evidence").map(asEvidenceId);
  const wikiPageIds = await resolveWikiPageIds(context, flagValues(args, "wiki"));
  const notes = flagValue(args, "notes");
  const current = nowIso();

  return context.store.write(async (writer) => {
    const claim = await requireCliClaim(writer, claimId);
    await requireCliKnowledgeSources(writer, sourceIds);
    await requireCliEvidenceRecords(writer, evidenceIds);
    const updated = touchRecord(
      {
        ...claim,
        status,
        sourceIds: uniqueValues([...claim.sourceIds, ...sourceIds]),
        evidenceIds: uniqueValues([...claim.evidenceIds, ...evidenceIds]),
        wikiPageIds: uniqueStrings([...(claim.wikiPageIds ?? []), ...wikiPageIds])
      },
      current,
      context.actor
    );
    await writer.putClaim(updated);
    const event = await appendCliEvent(writer, context, "knowledge.claim_reviewed", updated.meta.id, "claim", {
      status,
      addedSourceIds: sourceIds,
      addedEvidenceIds: evidenceIds,
      addedWikiPageIds: wikiPageIds,
      notes
    }, current);
    return { claim: updated, event };
  });
}

async function decisionCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const wikiPageIds = await resolveWikiPageIds(context, flagValues(args, "wiki"));
      const decision = await context.runtime.createDecision({
        title: requiredFlag(args, "title"),
        context: flagValue(args, "context") ?? "",
        decision: requiredFlag(args, "decision"),
        status: parseDecisionStatus(flagValue(args, "status")),
        consequences: flagValues(args, "consequence"),
        sourceIds: flagValues(args, "source").map(asSourceId),
        wikiPageIds
      });
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseDecisionStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"));
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const decisions = await context.runtime.listDecisions();
      const rows = decisions
        .filter((decision) => !status || decision.status === status)
        .filter((decision) => !sourceId || decision.sourceIds.includes(sourceId))
        .slice(0, limit)
        .map(decisionListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textDecisionListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const decision = await context.runtime.getDecision(asDecisionId(requiredPositional(rest, 0, "decision id")));
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    case "supersede": {
      const result = await supersedeDecisionCommand(context, asDecisionId(requiredPositional(rest, 0, "decision id")), args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown decision command: ${action ?? ""}`);
  }
}

async function supersedeDecisionCommand(context: CliContext, decisionId: DecisionId, args: ParsedArgs) {
  const previous = await context.runtime.getDecision(decisionId);
  if (previous.status === "superseded") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Decision is already superseded", { decisionId });
  }
  const title = flagValue(args, "title") ?? previous.title;
  const decisionText = requiredFlag(args, "decision");
  if (title === previous.title && decisionText.trim() === previous.decision) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Replacement decision must differ from the decision it supersedes", {
      decisionId
    });
  }
  const sourceIds = uniqueValues([...previous.sourceIds, ...flagValues(args, "source").map(asSourceId)]);
  const wikiPageIds = uniqueStrings([...(previous.wikiPageIds ?? []), ...(await resolveWikiPageIds(context, flagValues(args, "wiki")))]);
  const replacement = await context.runtime.createDecision({
    title,
    context: flagValue(args, "context") ?? previous.context,
    decision: decisionText,
    consequences: flagValues(args, "consequence").length > 0 ? normalizedNonEmptyStrings(flagValues(args, "consequence")) : previous.consequences,
    sourceIds,
    wikiPageIds,
    status: "accepted"
  });
  if (replacement.meta.id === previous.meta.id) {
    throw new BorealError("BOREAL_CONFLICT", "Replacement decision resolved to the same record id", {
      decisionId,
      replacementDecisionId: replacement.meta.id
    });
  }

  const current = nowIso();
  const superseded = await context.store.write(async (writer) => {
    const latest = await requireCliDecision(writer, decisionId);
    const updated = touchRecord({ ...latest, status: "superseded" as const }, current, context.actor) satisfies DecisionRecord;
    await writer.putDecision(updated);
    await appendCliEvent(writer, context, "knowledge.decision_superseded", updated.meta.id, "decision", {
      replacementDecisionId: replacement.meta.id,
      reason: flagValue(args, "reason")
    }, current);
    return updated;
  });
  return { superseded, decision: replacement };
}

async function contextCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "rebuild": {
      const views = await rebuildProjectionsRespectingTombstones(context);
      output.write(formatRecord({ rebuilt: views.length, views }, json));
      return { exitCode: 0 };
    }
    case "show": {
      const pack = await context.runtime.getContextPack(await resolveWorkId(context, requiredPositional(rest, 0, "work reference")));
      output.write(json ? formatRecord(pack, true) : formatContextPack(pack));
      return { exitCode: 0 };
    }
    case "search": {
      const results = await runSearch(context, rest.join(" "), {
        limit: parseLimit(flagValue(args, "limit"), { max: MAX_SEARCH_LIMIT }),
        types: ["context_pack", "context_chunk"],
        explain: hasFlag(args, "explain"),
        rebuildStaleIndex: !hasFlag(args, "no-rebuild")
      });
      output.write(json ? formatRecord(results, true) : table(results.map(searchResultRow)));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown context command: ${action ?? ""}`);
  }
}

async function searchCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "index": {
      output.write(formatRecord(await writeSearchIndex(context), json));
      return { exitCode: 0 };
    }
    case "query": {
      const results = await runSearch(context, rest.join(" "), {
        limit: parseLimit(flagValue(args, "limit"), { max: MAX_SEARCH_LIMIT }),
        explain: hasFlag(args, "explain"),
        rebuildStaleIndex: !hasFlag(args, "no-rebuild")
      });
      output.write(json ? formatRecord(results, true) : table(results.map(searchResultRow)));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown search command: ${action ?? ""}`);
  }
}

function formatContextPack(pack: ContextPack): string {
  const lines = [
    pack.title,
    `Subject: ${pack.subjectId}`,
    `Generated at: ${pack.generatedAt}`,
    "",
    pack.summary
  ];
  if (pack.facts.length > 0) {
    lines.push("", "Facts:", ...pack.facts.map((fact) => `- ${fact}`));
  }
  if (pack.evidence.length > 0) {
    lines.push("", "Evidence:", ...pack.evidence.map((entry) => `- ${entry}`));
  }
  return `${lines.join("\n")}\n`;
}

async function exportCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "json": {
      output.write(formatRecord(await exportJson(context, flagValue(args, "out")), json));
      return { exitCode: 0 };
    }
    case "markdown": {
      output.write(formatRecord(await exportMarkdown(context, flagValue(args, "out")), json));
      return { exitCode: 0 };
    }
    case "ledgers": {
      output.write(formatRecord(await exportLedgers(context, flagValue(args, "out")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown export command: ${action ?? ""}`);
  }
}

async function importCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "json": {
      output.write(
        formatRecord(
          await importJson(context, requiredFlag(args, "from"), {
            allowExternalRead: hasFlag(args, "allow-external-read")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "ledgers": {
      output.write(
        formatRecord(
          await importLedgers(context, requiredFlag(args, "from"), {
            allowExternalRead: hasFlag(args, "allow-external-read")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown import command: ${action ?? ""}`);
  }
}

async function syncCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "status": {
      const status = await buildSyncStatus(context);
      output.write(json ? await formatRecordWithAgentDirectives(context, args, status, true, {
        syncStatus: status,
        subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
      }) : dashboardView(args) ? formatSyncDashboard(status) : formatRecord(status, false));
      return { exitCode: status.ok ? 0 : 1 };
    }
    case "refresh": {
      const result = await buildSyncRefreshResult(context);
      output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
        syncStatus: result.status,
        syncRefreshed: true,
        subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
      }));
      return { exitCode: result.postRefreshStatusOk ? 0 : 1 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown sync command: ${action ?? ""}`);
  }
}

async function buildSyncRefreshResult(context: CliContext): Promise<SyncRefreshResult> {
  const views = await rebuildProjectionsRespectingTombstones(context);
  const searchIndex = await writeSearchIndex(context);
  const ledgers = await exportLedgers(context, undefined);
  const cacheDocument = await buildExportDocument(context);
  const sqliteCache = await rebuildSQLiteCache({
    rootDir: context.workspaceRoot,
    snapshot: cacheDocument.state,
    sourceContentHash: cacheDocument.contentHash
  });
  const status = await buildSyncStatus(context);
  return {
    refreshed: true,
    refreshOk: true,
    postRefreshStatusOk: status.ok,
    exitReason: status.ok ? "ok" : "post_refresh_status_unhealthy",
    contextViews: views.length,
    searchIndex,
    ledgers,
    sqliteCache,
    status
  };
}

async function vaultCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "init": {
      output.write(formatRecord(await initVault(context), json));
      return { exitCode: 0 };
    }
    case "status": {
      const status = await inspectVault(context);
      output.write(formatRecord(status, json));
      return { exitCode: status.ok ? 0 : 1 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown vault command: ${action ?? ""}`);
  }
}

async function rawCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const rows = await listRawSourceRows(context, { limit });
      output.write(json ? formatRecord(rows, true) : table(rows.map(textRawSourceRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const detail = await getRawSourceDetail(context, requiredPositional(rest, 0, "raw source id"), {
        previewBytes: parsePreviewBytes(flagValue(args, "preview-bytes"))
      });
      output.write(formatRecord(detail, json));
      return { exitCode: 0 };
    }
    case "add": {
      output.write(
        formatRecord(
          await addRawSource(context, {
            title: requiredFlag(args, "title"),
            kind: flagValue(args, "kind"),
            uri: flagValue(args, "uri"),
            summary: flagValue(args, "summary"),
            tags: flagValues(args, "tag")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown raw command: ${action ?? ""}`);
  }
}

async function wikiCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const limit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_LIST_LIMIT;
      const pages = await listVaultWikiPages(context);
      const rows = wikiPageRows(pages).slice(0, limit);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWikiPageRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const pages = await listVaultWikiPages(context);
      const page = resolveWikiPage(pages, requiredPositional(rest, 0, "wiki page reference"));
      const detail = wikiPageDetail(page, pages);
      output.write(formatRecord(detail, json));
      return { exitCode: 0 };
    }
    case "create": {
      output.write(
        formatRecord(
          await createWikiPage(context, {
            title: rest.join(" ").trim(),
            slug: flagValue(args, "slug"),
            summary: flagValue(args, "summary"),
            sourceRefs: flagValues(args, "source"),
            tags: flagValues(args, "tag")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown wiki command: ${action ?? ""}`);
  }
}

async function duplicateCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "scan": {
      const result = await scanDuplicates(context, { domain: parseDuplicateDomain(flagValue(args, "domain") ?? "all") });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown duplicate command: ${action ?? ""}`);
  }
}

async function mergeCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "plan": {
      const duplicateIds = flagValues(args, "duplicate");
      if (duplicateIds.length === 0) {
        throw new BorealError("BOREAL_INVALID_INPUT", "merge plan requires at least one --duplicate");
      }
      output.write(
        formatRecord(
          buildManualMergePlan(parseMergeDomain(requiredFlag(args, "domain")), requiredFlag(args, "survivor"), duplicateIds),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "apply": {
      const duplicateIds = flagValues(args, "duplicate");
      output.write(
        formatRecord(
          await applyManualMerge(context, {
            domain: parseMergeDomain(requiredFlag(args, "domain")),
            survivorId: requiredFlag(args, "survivor"),
            duplicateIds,
            planId: requiredFlag(args, "plan"),
            confirm: hasFlag(args, "confirm")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown merge command: ${action ?? ""}`);
  }
}

async function compactCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "analyze": {
      output.write(
        formatRecord(
          await analyzeCompaction(context, {
            domain: parseCompactDomain(flagValue(args, "domain") ?? "all"),
            olderThanDays: parseOlderThanDays(flagValue(args, "older-than-days"))
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "apply": {
      output.write(
        formatRecord(
          await applyCompaction(context, {
            domain: parseCompactApplyDomain(requiredFlag(args, "domain")),
            targetId: requiredFlag(args, "target"),
            planId: requiredFlag(args, "plan"),
            summary: requiredFlag(args, "summary"),
            confirm: hasFlag(args, "confirm"),
            olderThanDays: parseOlderThanDays(flagValue(args, "older-than-days"))
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown compact command: ${action ?? ""}`);
  }
}

async function buildSyncStatus(context: CliContext): Promise<SyncStatusResult> {
  const [vault, ledgers, searchIndex, git] = await Promise.all([
    inspectVaultForSyncStatus(context),
    safeLedgerStatus(context),
    inspectSearchIndex(context),
    inspectGitWorktree(context)
  ]);
  const searchIndexOk = searchIndex.exists && !searchIndex.stale && !searchIndex.error;
  const recommendedActions = syncRecommendedActions(vault, ledgers, searchIndexOk, git);
  return {
    ok: vault.ok && ledgers.ok && searchIndexOk && git.ok,
    workspaceRoot: context.workspaceRoot,
    checkedAt: nowIso(),
    vault,
    ledgers,
    searchIndex: {
      ...searchIndex,
      ok: searchIndexOk
    },
    git,
    recommendedActions
  };
}

async function inspectVaultForSyncStatus(context: CliContext): Promise<VaultStatusResult> {
  try {
    return await inspectVault(context);
  } catch (caught) {
    if (!isBorealError(caught)) {
      throw caught;
    }
    return unavailableVaultStatus(context);
  }
}

function unavailableVaultStatus(context: CliContext): VaultStatusResult {
  return {
    ok: false,
    initialized: false,
    rootDir: join(context.workspaceRoot, "memory"),
    schemaVersion: VAULT_SCHEMA_VERSION,
    health: {
      ok: false,
      hasWarnings: true,
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
  };
}

async function safeLedgerStatus(context: CliContext): Promise<LedgerStatusResult> {
  try {
    return await ledgerStatus(context, undefined);
  } catch (error) {
    return {
      ok: false,
      path: join(context.workspaceRoot, ".boreal/ledgers/manifest.json"),
      exists: false,
      stale: true,
      expectedContentHash: "unavailable",
      reconstructable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

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
  const agentDirectives = await compileCliAgentDirectiveBundles(context, args, options);
  return formatRecord(value, true, { agentDirectives });
}

async function compileCliAgentDirectiveBundles(
  context: CliContext,
  args: ParsedArgs,
  options: CliAgentDirectiveOptions
): Promise<readonly AgentDirectiveBundle[]> {
  const snapshot = await buildCliAgentDirectiveSnapshot(context, args, options);
  const dataByRegistryId = cliDirectiveDataByRegistryId(snapshot);
  const gaps = agentDirectiveGapsForSnapshot(snapshot, AGENT_DIRECTIVE_REGISTRY, dataByRegistryId);
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
  const syncStatus = options.syncStatus ?? await buildSyncStatus(context);
  const doctor = options.doctorResult;
  const actorId = optionalAgentIdFromArgs(args) ?? String(context.actor.id);
  const generatedAt = nowIso();
  return context.store.read(async (reader) => {
    const [workItems, graphEdges, evidence, verifications, summaries, reservations] = await Promise.all([
      reader.listWorkItems(),
      reader.listGraphEdges(),
      reader.listEvidence(),
      reader.listVerifications(),
      reader.listAgentSummaries(),
      reader.listReservations()
    ]);
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    const subjectWork = options.subjectWork ?? (options.subjectWorkId ? workById.get(options.subjectWorkId) : undefined);
    const subjectWorkId = subjectWork?.meta.id;
    const dependencyIds = subjectWork ? dependencyIdsForWork(subjectWork, graphEdges) : [];
    const dependencyWork = dependencyIds.map((id) => workById.get(id)).filter(isWorkItem);
    const activeBlockerIds = dependencyWork.filter((work) => isOpenWorkStatus(work.status)).map((work) => work.meta.id);
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
    diagnostics.push(syncDiagnostic("ledger.status", "warning", "Ledger status is not ok", false, syncStatus.recommendedActions));
  }
  if (!syncStatus.searchIndex.ok) {
    diagnostics.push(syncDiagnostic("search.index", "warning", "Search index is not fresh", false, syncStatus.recommendedActions));
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
  if (!syncStatus.ok) {
    return true;
  }
  if (doctor) {
    return !doctor.ok || doctor.diagnostics.some(doctorDiagnosticNeedsAttention);
  }
  if (command === "doctor" || command.startsWith("sync ") || command.startsWith("lock ")) {
    return syncStatusDiagnostics(syncStatus).length > 0;
  }
  return false;
}

function doctorDiagnosticNeedsAttention(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === "error" || strictBlockingWarning(diagnostic);
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

async function buildAgentProtocolBrief(
  kind: AgentProtocolKind,
  context: CliContext,
  agentId: string,
  labels: readonly string[]
): Promise<AgentProtocolBrief> {
  const [sync, agent, operations] = await Promise.all([
    buildSyncStatus(context),
    buildAgentStatus(context, agentId, labels),
    buildSessionOperationSummary(context, context.sessionId, 10)
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
    commands,
    recommendedActions: protocolRecommendedActions(kind, sync, agent, operations, commands)
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

function syncRecommendedActions(
  vault: VaultStatusResult,
  ledgers: LedgerStatusResult,
  searchIndexOk: boolean,
  git: GitWorktreeInspection
): readonly string[] {
  const actions: string[] = [];
  if (!vault.ok) {
    actions.push("bwrk vault init --json");
  }
  if (!ledgers.ok || !searchIndexOk) {
    actions.push("bwrk sync refresh --json");
  }
  return [...actions, ...git.recommendedActions];
}

async function ledgerCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "status": {
      const status = await ledgerStatus(context, flagValue(args, "dir"));
      output.write(formatRecord(status, json));
      return { exitCode: status.ok ? 0 : 1 };
    }
    case "delete": {
      const kind = requiredPositional(rest, 0, "ledger record kind");
      const id = requiredPositional(rest, 1, "record id");
      const reason = flagValue(args, "reason");
      if (kind === "work") {
        output.write(formatRecord(await deleteWorkItemWithTombstone(context, asWorkId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "evidence") {
        output.write(formatRecord(await deleteEvidenceWithTombstone(context, asEvidenceId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "verification") {
        output.write(formatRecord(await deleteVerificationWithTombstone(context, asVerificationId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "source") {
        output.write(formatRecord(await deleteKnowledgeSourceWithTombstone(context, asSourceId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "claim") {
        output.write(formatRecord(await deleteClaimWithTombstone(context, asClaimId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "decision") {
        output.write(formatRecord(await deleteDecisionWithTombstone(context, asDecisionId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "graph-edge") {
        output.write(formatRecord(await deleteGraphEdgeWithTombstone(context, asGraphEdgeId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "reservation") {
        output.write(formatRecord(await deleteReservationWithTombstone(context, asReservationId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "projection") {
        output.write(formatRecord(await deleteProjectionWithTombstone(context, asProjectionId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "context-pack") {
        output.write(formatRecord(await deleteContextPackWithTombstone(context, asProjectionId(id), reason), json));
        return { exitCode: 0 };
      }
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        "ledger delete currently supports work, evidence, verification, source, claim, decision, graph-edge, reservation, projection, and context-pack records",
        { kind }
      );
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown ledger command: ${action ?? ""}`);
  }
}

async function snapshotCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      output.write(formatRecord(await createSnapshot(context, flagValue(args, "name")), json));
      return { exitCode: 0 };
    }
    case "list": {
      output.write(formatRecord(await listSnapshots(context), json));
      return { exitCode: 0 };
    }
    case "show": {
      output.write(formatRecord(await showSnapshot(context, requiredPositional(rest, 0, "snapshot id")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown snapshot command: ${action ?? ""}`);
  }
}

async function doctorCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action === "skills") {
    const result = await inspectWorkflowAssets({
      workspaceRoot: context.workspaceRoot,
      installChecks: await installedSkillChecks(context, args)
    });
    output.write(json ? formatRecord(result, true) : formatSkillDoctor(result));
    return { exitCode: result.ok ? 0 : 1 };
  }
  if (action !== undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown doctor command: ${action}`);
  }
  const result = await runDoctor(context, hasFlag(args, "fix"), hasFlag(args, "strict"));
  if (json) {
    output.write(
      doctorResultCanAttachDirectives(result)
        ? await formatRecordWithAgentDirectives(context, args, result, true, {
            doctorResult: result,
            subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
          })
        : formatRecord(result, true)
    );
  } else if (dashboardView(args)) {
    output.write(formatDoctorDashboard(result));
  } else {
    output.write(result.diagnostics.map(formatDiagnostic).join("\n") + "\n");
  }
  return { exitCode: result.ok ? 0 : 1 };
}

function doctorResultCanAttachDirectives(result: DoctorResult): boolean {
  return !result.diagnostics.some((diagnostic) => diagnostic.code === "state.record_shape" && diagnostic.severity === "error");
}

async function schemaCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "validate") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown schema command: ${action ?? ""}`);
  }
  const result = await schemaValidateResult(context);
  output.write(formatRecord(result, json));
  return { exitCode: result.ok ? 0 : 1 };
}

async function docsCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "check") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown docs command: ${action ?? ""}`);
  }
  const result = await docsCheckResult(context);
  output.write(formatRecord(result, json));
  return { exitCode: result.ok ? 0 : 1 };
}

async function gateCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== undefined && action !== "closeout") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown gate command: ${action}`);
  }
  const result = await gateCloseoutResult(context, args);
  output.write(await formatRecordWithAgentDirectives(context, args, result, json, {
    subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
  }));
  return { exitCode: result.ok ? 0 : 1 };
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
  const commandMetadata = commandMetadataValidationResult();
  return {
    schemaVersion: "boreal.cli.docs.check.v1",
    generatedAt,
    ok: assets.ok && commandMetadata.ok,
    workflowCount: assets.workflowCount,
    templateCount: assets.templateCount,
    skillCount: assets.skillCount,
    assetIssueCount: assets.issues.length,
    assetIssues: assets.issues,
    commandMetadata
  };
}

async function gateCloseoutResult(context: CliContext, args: ParsedArgs) {
  const generatedAt = nowIso();
  const strict = hasFlag(args, "strict");
  const autoPruneOperations = hasFlag(args, "auto-prune-operations");
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
    sqliteCacheOk: !sync.sqliteCache.error,
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
  if (!explicitRoot && targets.length === 0) {
    return [];
  }
  const resolvedTargets = targets.length > 0 ? targets : (["skills"] as const);
  return Promise.all(
    resolvedTargets.map(async (target) => ({
      target,
      installRoot: explicitRoot ? resolve(context.workspaceRoot, explicitRoot) : await installRootFromArgs(context, args, target)
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

async function registryCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const options = { registryRoot: flagValue(args, "registry-root") };
  switch (action) {
    case "list": {
      const result = await listProjectRegistry(options);
      output.write(json ? formatRecord(result, true) : formatRegistryList(result));
      return { exitCode: 0 };
    }
    case "add": {
      const result = await addProjectRegistryEntry({
        ...options,
        workspaceRoot: requiredFlag(args, "workspace"),
        name: flagValue(args, "name"),
        labels: flagValues(args, "label")
      });
      output.write(json ? formatRecord(result, true) : formatRegistryAdd(result));
      return { exitCode: 0 };
    }
    case "import-setup": {
      const result = await importProjectSetupRegistryEntry({
        ...options,
        workspaceRoot: context.workspaceRoot,
        name: flagValue(args, "name"),
        labels: flagValues(args, "label")
      });
      output.write(json ? formatRecord(result, true) : formatRegistryImport(result));
      return { exitCode: 0 };
    }
    case "remove": {
      const result = await removeProjectRegistryEntry(requiredPositional(rest, 0, "project id"), options);
      output.write(json ? formatRecord(result, true) : formatRegistryRemove(result));
      return { exitCode: 0 };
    }
    case "doctor": {
      const result = await doctorProjectRegistry(options);
      output.write(json ? formatRecord(result, true) : formatRegistryDoctor(result));
      return { exitCode: result.ok ? 0 : 1 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown registry command: ${action ?? ""}`);
  }
}

function formatRegistryList(result: RegistryListResult): string {
  if (result.entries.length === 0) {
    return `No registered projects at ${result.storage.registryFile}\n`;
  }
  return table(
    result.entries.map((entry) => ({
      id: entry.id,
      name: entry.display.name,
      projectRoot: entry.projectRoot,
      memoryRoot: entry.memoryRoot,
      git: entry.memoryGitMode
    }))
  );
}

function formatRegistryAdd(result: RegistryAddResult): string {
  return `${result.added ? "Added" : result.replaced ? "Updated" : "Registered"} ${result.entry.display.name} (${result.entry.id})\n`;
}

function formatRegistryImport(result: RegistryImportSetupResult): string {
  const action = result.changed ? result.added ? "Imported" : "Updated" : "Already registered";
  return `${action} ${result.entry.display.name} (${result.entry.id})\n`;
}

function formatRegistryRemove(result: RegistryRemoveResult): string {
  return `Removed ${result.entry.display.name} (${result.entry.id})\n`;
}

function formatRegistryDoctor(result: RegistryDoctorResult): string {
  const header = `[${result.ok ? "ok" : "error"}] registry: ${result.entryCount} project(s) at ${result.storage.registryFile}`;
  if (result.findings.length === 0) {
    return `${header}\n`;
  }
  return `${header}\n${result.findings.map((finding) => {
    const project = finding.projectId ? ` ${finding.projectId}` : "";
    const path = finding.path ? ` ${finding.path}` : "";
    return `[${finding.severity}] ${finding.code}${project}:${path} ${finding.message}`.trimEnd();
  }).join("\n")}\n`;
}

async function dashboardCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const scope: "repo" | "global" = hasFlag(args, "global") ? "global" : "repo";
  switch (action) {
    case undefined:
      // --json emits the cross-repo data payload (same as `dashboard global`).
      if (json) {
        return emitGlobalDashboardData(context, args, output, true);
      }
      // Terminal dashboard is the default; --web opts into the browser console.
      if (hasFlag(args, "web")) {
        return serveDashboardCommand(context, args, output, scope);
      }
      return launchTuiCommand(context, args, scope);
    case "global":
      // Retained data command; equivalent to `dashboard --global --json`.
      return emitGlobalDashboardData(context, args, output, json);
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown dashboard command: ${action ?? ""}`);
  }
}

async function emitGlobalDashboardData(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const result = await buildGlobalDashboardResult(context, args);
  output.write(json ? formatRecord(result, true) : formatGlobalDashboardSummary(result));
  return { exitCode: 0 };
}

// `bwrk global` is an ergonomic alias for `bwrk dashboard --global`, and also
// hosts the `link` / `unlink` project-registry verbs.
async function globalCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action === "link") {
    return linkCommand(rest[0], context, args, output, json);
  }
  if (action === "unlink") {
    return unlinkCommand(rest[0], args, output, json);
  }
  if (action !== undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown global command: ${action}`);
  }
  if (json) {
    return emitGlobalDashboardData(context, args, output, true);
  }
  if (hasFlag(args, "web")) {
    return serveDashboardCommand(context, args, output, "global");
  }
  return launchTuiCommand(context, args, "global");
}

// Link a project into the global workspace (registry add, reframed). With no
// path, links the current repo; inside the global context a path is required.
async function linkCommand(
  pathArg: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const target = pathArg ? resolve(pathArg) : isGlobalContext(args) ? undefined : context.workspaceRoot;
  if (!target) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Provide a project path to link: bwrk global link <path>");
  }
  const result = await addProjectRegistryEntry({
    registryRoot: flagValue(args, "registry-root"),
    workspaceRoot: target,
    name: flagValue(args, "name"),
    labels: flagValues(args, "label")
  });
  output.write(json ? formatRecord(result, true) : formatRegistryAdd(result));
  return { exitCode: 0 };
}

async function unlinkCommand(
  idArg: string | undefined,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const id = idArg ?? "";
  if (!id) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Provide the project id to unlink: bwrk unlink <project-id>");
  }
  const result = await removeProjectRegistryEntry(id, { registryRoot: flagValue(args, "registry-root") });
  output.write(json ? formatRecord(result, true) : formatRegistryRemove(result));
  return { exitCode: 0 };
}

async function serveDashboardCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  scope: "repo" | "global"
): Promise<CommandResult> {
  const host = flagValue(args, "host") ?? "127.0.0.1";
  const port = parsePort(flagValue(args, "port")) ?? 4318;
  const mode = flagValue(args, "mode") === "fixture" ? "fixture" : "live";
  const liveCacheTtlMs = parseNonNegativeInteger(flagValue(args, "live-cache-ttl-ms"), "--live-cache-ttl-ms") ?? 60_000;
  const allowFixtureFallback = hasFlag(args, "allow-fixture-fallback");
  const url = `http://${host}:${port}`;
  const child = spawnDashboardServer({
    workspaceRoot: context.workspaceRoot,
    host,
    port,
    mode,
    scope,
    liveCacheTtlMs,
    allowFixtureFallback
  });
  output.write(`Boreal ${scope === "global" ? "global console" : "dashboard"} starting at ${url}\n`);
  output.write("Press Ctrl+C to stop.\n");
  if (!hasFlag(args, "no-open")) {
    setTimeout(() => openBrowser(url), 750);
  }
  return {
    exitCode: await waitForDashboardProcess(child)
  };
}

async function launchTuiCommand(context: CliContext, args: ParsedArgs, scope: "repo" | "global"): Promise<CommandResult> {
  const refreshMs = parseNonNegativeInteger(flagValue(args, "refresh-ms"), "--refresh-ms");
  const child = spawnAppProcess({
    appDir: "tui",
    distEntry: "index.js",
    srcEntry: "index.tsx",
    args: [
      "--workspace",
      context.workspaceRoot,
      ...(scope === "global" ? ["--global"] : []),
      ...(hasFlag(args, "mouse") ? ["--mouse"] : []),
      ...(refreshMs !== undefined ? ["--refresh-ms", String(refreshMs)] : [])
    ]
  });
  return { exitCode: await waitForDashboardProcess(child) };
}

function spawnDashboardServer(input: {
  readonly workspaceRoot: string;
  readonly host: string;
  readonly port: number;
  readonly mode: "live" | "fixture";
  readonly scope: "repo" | "global";
  readonly liveCacheTtlMs: number;
  readonly allowFixtureFallback: boolean;
}) {
  const fallbackArgs = input.allowFixtureFallback ? ["--allow-fixture-fallback"] : [];
  return spawnAppProcess({
    appDir: "console",
    distEntry: "server.js",
    srcEntry: "server.ts",
    args: [
      "--workspace",
      input.workspaceRoot,
      "--host",
      input.host,
      "--port",
      String(input.port),
      "--mode",
      input.mode,
      "--scope",
      input.scope,
      "--live-cache-ttl-ms",
      String(input.liveCacheTtlMs),
      ...fallbackArgs
    ]
  });
}

// Prefer the compiled app output (works in any layout, no tsx, faster start);
// fall back to running TypeScript source via tsx for in-repo dev checkouts.
function spawnAppProcess(input: {
  readonly appDir: string;
  readonly distEntry: string;
  readonly srcEntry: string;
  readonly args: readonly string[];
}) {
  const sourceRoot = resolve(dirname(import.meta.url.replace(/^file:\/\//u, "")), "..", "..", "..");
  const distEntrypoint = join(sourceRoot, "apps", input.appDir, "dist", input.distEntry);
  if (existsSync(distEntrypoint)) {
    return spawn(process.execPath, [distEntrypoint, ...input.args], { cwd: sourceRoot, stdio: "inherit" });
  }
  const tsxBin = join(sourceRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const srcEntrypoint = join(sourceRoot, "apps", input.appDir, "src", input.srcEntry);
  const tsconfig = join(sourceRoot, "apps", input.appDir, "tsconfig.json");
  return spawn(tsxBin, ["--tsconfig", tsconfig, srcEntrypoint, ...input.args], {
    cwd: sourceRoot,
    stdio: "inherit"
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Serving the dashboard is the primary contract; the URL is printed if browser launch fails.
  }
}

function waitForDashboardProcess(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolvePromise) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      child.kill("SIGTERM");
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolvePromise(signal ? 0 : code ?? 0);
    });
    child.once("error", () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolvePromise(1);
    });
  });
}

function parsePort(value: string | undefined): number | undefined {
  const parsed = parseNonNegativeInteger(value, "--port");
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed < 1 || parsed > 65_535) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--port must be between 1 and 65535", { value });
  }
  return parsed;
}

async function daemonCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "status":
      output.write(formatRecord(await inspectDaemonStatus({ workspaceRoot: context.workspaceRoot }), json));
      return { exitCode: 0 };
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown daemon command: ${action ?? ""}`);
  }
}

interface GlobalDashboardProjectOverview {
  readonly entry: DashboardProjectRegistryEntry;
  readonly settings: GlobalSettingsProjectInput;
  readonly work: readonly WorkItemView[];
  readonly searchResults: readonly GlobalSearchSourceRow[];
  readonly activityRows: readonly GlobalActivitySourceRow[];
  readonly sync: SyncDashboardView;
  readonly locks: LockDashboardView;
  readonly daemon: DaemonStatusResult;
}

async function buildGlobalDashboardResult(context: CliContext, args: ParsedArgs) {
  const generatedAt = nowIso();
  const projectLimit = parseLimit(flagValue(args, "limit"), { max: MAX_DASHBOARD_PROJECT_LIMIT }) ?? DEFAULT_DASHBOARD_PROJECT_LIMIT;
  const registryOptions = { registryRoot: flagValue(args, "registry-root") };
  const [registryList, registryDoctor] = await Promise.all([
    listProjectRegistry(registryOptions),
    doctorProjectRegistry(registryOptions)
  ]);
  const registryEntries = registryList.entries.length > 0
    ? registryList.entries
    : [await currentWorkspaceDashboardRegistryEntry(context, generatedAt)];
  const limitedRegistryEntries = registryEntries.slice(0, projectLimit);
  const registryFindings = dashboardRegistryFindingsByProject(registryDoctor);
  const searchQuery = "v1-remainder global dashboard registry";
  const overviews = await Promise.all(
    limitedRegistryEntries.map((entry) =>
      buildGlobalDashboardProjectOverview({
        parentContext: context,
        entry,
        registryFindings: registryFindings.get(entry.id) ?? [],
        generatedAt,
        searchQuery
      })
    )
  );

  return {
    schemaVersion: "boreal.cli.dashboard.global.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    searchQuery,
    limits: {
      projects: projectLimit,
      workPerProject: DEFAULT_DASHBOARD_WORK_LIMIT,
      queueRowsPerQueue: DEFAULT_DASHBOARD_QUEUE_LIMIT,
      searchPerProject: DEFAULT_DASHBOARD_SEARCH_LIMIT,
      activityPerProject: DEFAULT_DASHBOARD_ACTIVITY_LIMIT
    },
    truncated: {
      projects: registryEntries.length > limitedRegistryEntries.length
    },
    registry: buildProjectRegistryView({
      generatedAt,
      entries: overviews.map((project) => project.entry)
    }),
    globalQueues: buildGlobalWorkQueuesView({
      generatedAt,
      limit: DEFAULT_DASHBOARD_QUEUE_LIMIT,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        work: project.work
      }))
    }),
    globalSearch: buildGlobalSearchView({
      generatedAt,
      query: searchQuery,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        results: project.searchResults
      }))
    }),
    globalActivity: buildGlobalActivityView({
      generatedAt,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        operations: project.activityRows
      }))
    }),
    globalHealth: buildGlobalHealthView({
      generatedAt,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        memoryRoot: project.entry.memoryRoot,
        health: project.entry.health,
        stale: project.entry.stale,
        syncFreshness: project.entry.syncFreshness,
        syncOk: project.sync.ok,
        vaultOk: project.sync.vaultOk,
        ledgersOk: project.sync.ledgersOk,
        searchIndexOk: project.sync.searchIndexOk,
        gitOk: project.sync.gitOk,
        findings: project.entry.findings,
        locks: project.locks.locks
      }))
    }),
    daemonStatus: {
      generatedAt,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        state: project.daemon.state,
        pid: project.daemon.pid,
        processAlive: project.daemon.processAlive,
        statusPath: project.daemon.statusPath,
        findings: project.daemon.findings,
        recommendedActions: project.daemon.recommendedActions
      }))
    },
    globalSettings: buildGlobalSettingsView({
      generatedAt,
      projects: overviews.map((project) => project.settings)
    })
  };
}

async function buildGlobalDashboardProjectOverview(input: {
  readonly parentContext: CliContext;
  readonly entry: CoreProjectRegistryEntry;
  readonly registryFindings: readonly DashboardFinding[];
  readonly generatedAt: string;
  readonly searchQuery: string;
}): Promise<GlobalDashboardProjectOverview> {
  try {
    const projectContext = await dashboardProjectContext(input.parentContext, input.entry.projectRoot);
    assertInitialized(projectContext);
    const [work, reservations, sync, doctor, operations, searchResults, daemon] = await Promise.all([
      dashboardWork(projectContext),
      projectContext.store.read((reader) => reader.listReservations()),
      buildSyncStatus(projectContext),
      runDoctor(projectContext, false, false),
      dashboardOperations(projectContext),
      dashboardSearch(projectContext, input.searchQuery),
      inspectDaemonStatus({ workspaceRoot: projectContext.workspaceRoot })
    ]);
    const syncView = syncDashboardViewFromStatus(sync, input.generatedAt);
    const findings = [
      ...input.registryFindings,
      ...dashboardFindingsFromDiagnostics(doctor.diagnostics)
    ];
    const entry = dashboardEntryFromMetrics({
      entry: input.entry,
      generatedAt: input.generatedAt,
      work,
      sync: syncView,
      findings,
      activeReservationCount: reservations.filter((reservation) => reservation.status === "active").length
    });
    return {
      entry,
      settings: dashboardSettingsFromEntry(input.entry, entry),
      work,
      searchResults,
      activityRows: operations,
      sync: syncView,
      locks: lockDashboardViewFromDiagnostics(doctor.diagnostics, input.entry.projectRoot, input.generatedAt),
      daemon
    };
  } catch (error) {
    const sync = syncDashboardViewFromFailure(input.entry.projectRoot, input.generatedAt);
    const findings = [
      ...input.registryFindings,
      {
        code: "dashboard.project_unreadable",
        title: "dashboard.project_unreadable",
        severity: "error" as const,
        status: "failed" as const,
        message: error instanceof Error ? error.message : String(error),
        source: input.entry.projectRoot,
        actions: []
      }
    ];
    const entry = dashboardEntryFromMetrics({
      entry: input.entry,
      generatedAt: input.generatedAt,
      work: [],
      sync,
      findings,
      activeReservationCount: 0
    });
    return {
      entry,
      settings: dashboardSettingsFromEntry(input.entry, entry),
      work: [],
      searchResults: [],
      activityRows: [],
      sync,
      locks: { generatedAt: input.generatedAt, ok: true, workspaceRoot: input.entry.projectRoot, locks: [] },
      daemon: daemonStatusUnavailable(input.entry.projectRoot, input.generatedAt, error)
    };
  }
}

function daemonStatusUnavailable(workspaceRoot: string, generatedAt: string, error: unknown): DaemonStatusResult {
  return {
    schemaVersion: "boreal.daemon.status.v1",
    generatedAt,
    workspaceRoot,
    statusPath: join(resolve(workspaceRoot), ".boreal", "daemon", "status.json"),
    state: "missing",
    locks: {
      runtime: {
        path: join(resolve(workspaceRoot), ".boreal", "runtime", "state.lock"),
        exists: false,
        stale: false,
        status: "clear"
      },
      searchIndex: {
        path: join(resolve(workspaceRoot), ".boreal", "runtime", "search-index.lock"),
        exists: false,
        stale: false,
        status: "clear"
      }
    },
    watch: {
      paths: [],
      writesTruth: false,
      repairsAreCommandMediated: true
    },
    findings: [
      {
        code: "daemon.project_unreadable",
        severity: "error",
        message: error instanceof Error ? error.message : String(error)
      }
    ],
    recommendedActions: [],
    agentDirectives: [],
    directiveObligations: unavailableDaemonDirectiveObligations(generatedAt)
  };
}

function unavailableDaemonDirectiveObligations(generatedAt: string): DaemonStatusResult["directiveObligations"] {
  const obligationGeneratedAt = isIsoTimestamp(generatedAt) ? generatedAt : nowIso();
  return {
    schemaVersion: "boreal.agent-runtime.directive-obligations.v1",
    generatedAt: obligationGeneratedAt,
    context: "health",
    ok: true,
    agentDirectives: [],
    summary: {
      context: "health",
      bundleCount: 0,
      directiveCount: 0,
      selectedRegistryIds: [],
      emittedRegistryIds: [],
      requiredRegistryIds: [],
      blockingRegistryIds: [],
      closeoutBlockingRegistryIds: [],
      requiredCount: 0,
      blockingCount: 0,
      closeoutBlockingCount: 0,
      conflictCount: 0,
      deprecationCount: 0,
      missingRequiredCount: 0
    },
    selectedRegistryIds: [],
    dataByRegistryId: {},
    issues: [],
    missingRequired: []
  };
}

async function dashboardProjectContext(parentContext: CliContext, workspaceRoot: string): Promise<CliContext> {
  if (resolve(workspaceRoot) === parentContext.workspaceRoot) {
    return parentContext;
  }
  return createCliContext({
    command: [],
    flags: new Map<string, readonly string[]>([
      ["workspace", [workspaceRoot]],
      ["session", [parentContext.sessionId]],
      ["actor", [parentContext.actor.id]],
      ["actor-kind", [parentContext.actor.kind]]
    ])
  }, parentContext.cwd, { sessionId: parentContext.sessionId });
}

async function dashboardWork(context: CliContext): Promise<readonly WorkItemView[]> {
  const work = await context.store.read((reader) => reader.listWorkItems());
  return work.map((item) => toWorkItemView({ work: item })).sort(compareWorkViews).slice(0, DEFAULT_DASHBOARD_WORK_LIMIT);
}

async function dashboardOperations(context: CliContext): Promise<readonly GlobalActivitySourceRow[]> {
  return context.store.read(async (reader) => {
    const operations = await reader.listOperations();
    return [...operations]
      .sort(compareOperationsNewestFirst)
      .slice(0, DEFAULT_DASHBOARD_ACTIVITY_LIMIT)
      .map(operationListRow);
  });
}

async function dashboardSearch(context: CliContext, query: string): Promise<readonly GlobalSearchSourceRow[]> {
  try {
    return (await runSearch(context, query, { limit: DEFAULT_DASHBOARD_SEARCH_LIMIT })).map((result) => ({
      id: result.id,
      type: result.type,
      recordId: result.recordId,
      title: result.title,
      summary: result.summary,
      score: result.score
    }));
  } catch {
    return [];
  }
}

function dashboardEntryFromMetrics(input: {
  readonly entry: CoreProjectRegistryEntry;
  readonly generatedAt: string;
  readonly work: readonly WorkItemView[];
  readonly sync: SyncDashboardView;
  readonly findings: readonly DashboardFinding[];
  readonly activeReservationCount: number;
}): DashboardProjectRegistryEntry {
  const openWorkCount = input.work.filter((item) => isOpenWorkStatus(item.status)).length;
  const readyWorkCount = input.work.filter((item) => item.status === "ready").length;
  const blockedWorkCount = input.work.filter((item) => item.status === "blocked").length;
  const syncFreshness: ProjectSyncFreshness = input.sync.ok ? "fresh" : "stale";
  const stale = syncFreshness === "stale" || input.findings.some((finding) => finding.severity !== "info");
  return {
    id: input.entry.id,
    name: input.entry.display.name,
    projectRoot: input.entry.projectRoot,
    memoryRoot: input.entry.memoryRoot,
    memoryLayout: input.entry.memoryLayout,
    memoryGitMode: input.entry.memoryGitMode,
    installRoot: input.entry.installRoot,
    health: projectHealthState(input.sync.ok, input.findings),
    stale,
    syncFreshness,
    openWorkCount,
    readyWorkCount,
    blockedWorkCount,
    activeReservationCount: input.activeReservationCount,
    findings: input.findings,
    lastSeenAt: input.entry.lastSeenAt ?? input.generatedAt
  };
}

function dashboardSettingsFromEntry(
  entry: CoreProjectRegistryEntry,
  dashboardEntry: DashboardProjectRegistryEntry
): GlobalSettingsProjectInput {
  return {
    projectId: dashboardEntry.id,
    projectName: dashboardEntry.name,
    projectRoot: dashboardEntry.projectRoot,
    memoryRoot: dashboardEntry.memoryRoot,
    memoryLayout: dashboardEntry.memoryLayout,
    memoryGitMode: dashboardEntry.memoryGitMode,
    memoryRemote: entry.memoryRemote,
    installRoot: dashboardEntry.installRoot,
    source: entry.source,
    health: dashboardEntry.health,
    stale: dashboardEntry.stale
  };
}

function syncDashboardViewFromStatus(sync: SyncStatusResult, generatedAt: string): SyncDashboardView {
  return {
    generatedAt,
    ok: sync.ok,
    workspaceRoot: sync.workspaceRoot,
    vaultOk: sync.vault.ok,
    ledgersOk: sync.ledgers.ok,
    searchIndexOk: sync.searchIndex.ok,
    gitOk: sync.git.ok,
    recommendedActions: sync.recommendedActions.map((command) => ({ label: command, command })),
    findings: []
  };
}

function syncDashboardViewFromFailure(workspaceRoot: string, generatedAt: string): SyncDashboardView {
  return {
    generatedAt,
    ok: false,
    workspaceRoot,
    vaultOk: false,
    ledgersOk: false,
    searchIndexOk: false,
    gitOk: false,
    recommendedActions: [],
    findings: []
  };
}

function dashboardFindingsFromDiagnostics(diagnostics: readonly Diagnostic[]): readonly DashboardFinding[] {
  return diagnostics.flatMap((diagnostic): readonly DashboardFinding[] => {
    const severity = dashboardDiagnosticSeverity(diagnostic.severity);
    if (severity === "info") {
      return [];
    }
    return [{
      code: diagnostic.code,
      title: diagnostic.code,
      severity,
      status: severity === "error" ? "failed" : severity === "warning" ? "warning" : "ok",
      message: diagnostic.message,
      source: diagnosticSourcePath(diagnostic),
      actions: diagnosticRepairCommand(diagnostic) ? [{ label: "Repair", command: diagnosticRepairCommand(diagnostic) }] : []
    }];
  });
}

function dashboardRegistryFindingsByProject(result: RegistryDoctorResult): ReadonlyMap<string, readonly DashboardFinding[]> {
  const byProject = new Map<string, DashboardFinding[]>();
  for (const finding of result.findings) {
    if (finding.severity === "ok") {
      continue;
    }
    const projectId = finding.projectId ?? "registry";
    byProject.set(projectId, [
      ...(byProject.get(projectId) ?? []),
      {
        code: finding.code,
        title: finding.code,
        severity: dashboardDiagnosticSeverity(finding.severity),
        status: finding.severity === "error" ? "failed" : "warning",
        message: finding.message,
        source: finding.path,
        actions: diagnosticRepairCommand(finding) ? [{ label: "Repair", command: diagnosticRepairCommand(finding) }] : []
      }
    ]);
  }
  return byProject;
}

function lockDashboardViewFromDiagnostics(
  diagnostics: readonly Diagnostic[],
  workspaceRoot: string,
  generatedAt: string
): LockDashboardView {
  const locks = diagnostics.flatMap((diagnostic) => {
    if (!diagnostic.code.startsWith("lock.")) {
      return [];
    }
    return [{
      domain: diagnostic.code,
      path: ".boreal/locks",
      status: diagnostic.severity === "ok" ? "clear" as const : "stale" as const,
      repairCommand: diagnostic.severity === "ok" ? undefined : "bwrk doctor --fix --json"
    }];
  });
  return {
    generatedAt,
    ok: locks.every((lock) => lock.status === "clear"),
    workspaceRoot,
    locks
  };
}

function dashboardDiagnosticSeverity(value: string): DashboardFinding["severity"] {
  if (value === "error" || value === "warning") {
    return value;
  }
  return "info";
}

function diagnosticSourcePath(diagnostic: { readonly details?: unknown; readonly path?: string }): string | undefined {
  if (typeof diagnostic.path === "string") {
    return diagnostic.path;
  }
  const details = diagnostic.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    for (const key of ["path", "configPath", "projectRoot", "workspaceRoot", "memoryRoot", "gitRoot", "rootDir", "statePath", "indexPath", "file"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function diagnosticRepairCommand(diagnostic: { readonly details?: unknown; readonly repairCommand?: string }): string | undefined {
  if (typeof diagnostic.repairCommand === "string") {
    return diagnostic.repairCommand;
  }
  const details = diagnostic.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const repairCommand = (details as Record<string, unknown>).repairCommand;
    return typeof repairCommand === "string" ? repairCommand : undefined;
  }
  return undefined;
}

async function currentWorkspaceDashboardRegistryEntry(
  context: CliContext,
  generatedAt: string
): Promise<CoreProjectRegistryEntry> {
  let config: Awaited<ReturnType<typeof readProjectSetupConfig>>;
  try {
    config = await readProjectSetupConfig(context.workspaceRoot);
  } catch {
    config = undefined;
  }
  const projectRoot = context.workspaceRoot;
  const memoryRoot = resolve(config?.memoryRoot ?? join(projectRoot, "memory"));
  return {
    id: "project_current",
    display: {
      name: basename(projectRoot),
      labels: []
    },
    projectRoot,
    borealDir: join(projectRoot, ".boreal"),
    runtimeDir: join(projectRoot, ".boreal", "runtime"),
    runtimeStateFile: join(projectRoot, ".boreal", "runtime", "state.json"),
    projectConfigPath: join(projectRoot, ".boreal", "project.json"),
    memoryRoot,
    memoryBorealDir: join(memoryRoot, ".boreal"),
    memoryLayout: config?.memoryLayout ?? "in-repo",
    memoryGitMode: config?.memoryGitMode ?? "separate",
    memoryRemote: config?.memoryRemote,
    installRoot: resolve(config?.installRoot ?? join(projectRoot, ".agents", "skills")),
    skillTargets: config?.skillTargets ?? [],
    folderScoped: config?.folderScoped ?? false,
    source: config ? "project-setup" : "explicit",
    addedAt: generatedAt,
    updatedAt: generatedAt,
    lastSeenAt: generatedAt
  };
}

function isOpenWorkStatus(status: WorkItemView["status"]): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "verified";
}

function projectHealthState(syncOk: boolean, findings: readonly DashboardFinding[]): DashboardProjectRegistryEntry["health"] {
  if (findings.some((finding) => finding.severity === "error")) {
    return "error";
  }
  if (!syncOk || findings.some((finding) => finding.severity === "warning")) {
    return "warning";
  }
  return "ok";
}

function formatGlobalDashboardSummary(result: Awaited<ReturnType<typeof buildGlobalDashboardResult>>): string {
  return table(
    result.registry.entries.map((entry) => ({
      project: entry.name,
      health: entry.health,
      open: entry.openWorkCount,
      ready: entry.readyWorkCount,
      blocked: entry.blockedWorkCount,
      stale: entry.stale ? "yes" : "no"
    }))
  );
}

async function sprintCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const result = await sprintListResult(context, args);
      output.write(json ? formatRecord(result, true) : formatSprintList(result));
      return { exitCode: 0 };
    }
    case "show": {
      const sprint = await resolveSprintWork(context, requiredPositional(rest, 0, "sprint reference"));
      const result = await sprintShowResult(context, sprint, sprintScopeLimit(args));
      output.write(json ? formatRecord(result, true) : formatSprintShow(result));
      return { exitCode: 0 };
    }
    case "current": {
      const result = await sprintCurrentResult(context);
      output.write(json ? formatRecord(result, true) : formatSprintCurrent(result));
      return { exitCode: 0 };
    }
    case "activate": {
      const result = await activateSprint(context, requiredPositional(rest, 0, "sprint reference"));
      output.write(json ? formatRecord(result, true) : formatSprintActivated(result));
      return { exitCode: 0 };
    }
    case "board": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current");
      const result = await sprintBoardResult(context, sprint, sprintScopeLimit(args));
      output.write(json ? formatRecord(result, true) : formatSprintBoard(result));
      return { exitCode: 0 };
    }
    case "report": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current");
      const result = await sprintReportResult(context, sprint, args);
      output.write(json ? await formatRecordWithAgentDirectives(context, args, result, true, { subjectWork: sprint }) : formatSprintReport(result));
      return { exitCode: 0 };
    }
    case "metrics": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current");
      const result = await sprintMetricsResult(context, sprint, args, flagValue(args, "closeout-reason"));
      output.write(await formatRecordWithAgentDirectives(context, args, result, json, { subjectWork: sprint }));
      return { exitCode: 0 };
    }
    case "close": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current");
      const reason = requiredFlag(args, "reason");
	      const metrics = await sprintMetricsResult(context, sprint, args, reason);
	      const closeoutSummary = await ensureAgentSummaryForClose(context, args, sprint, reason);
	      const closed = await context.runtime.closeWork({
	        workId: sprint.meta.id,
	        reason,
	        agentSummary: closeoutSummary.created?.summary,
	        agentSummaryIds: closeoutSummary.summaries.map((summary) => summary.meta.id)
	      });
	      const createdArtifact = closeoutSummary.created
	        ? await writeAgentSummaryArtifact(context, closeoutSummary.created.summary)
	        : undefined;
	      const result = {
	        schemaVersion: "boreal.cli.sprint.close.v1",
	        generatedAt: nowIso(),
	        workspaceRoot: context.workspaceRoot,
	        closed,
	        metrics,
	        agentSummaries: closeoutSummary.summaries,
	        createdAgentSummary: closeoutSummary.created?.summary,
	        createdAgentSummaryArtifact: createdArtifact
	      };
	      output.write(await formatRecordWithAgentDirectives(context, args, result, json, { subjectWork: closed }));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown sprint command: ${action ?? ""}`);
  }
}

async function sprintListResult(context: CliContext, args: ParsedArgs) {
  const generatedAt = nowIso();
  const limit = parseLimit(flagValue(args, "limit"), { max: MAX_SPRINT_LIST_LIMIT }) ?? DEFAULT_SPRINT_LIST_LIMIT;
  return context.store.read(async (reader) => {
    const active = await activeSprintProjection(reader);
    const activeSprintId = activeSprintIdFromProjection(active);
    const allSprints = (await reader.listWorkItems())
      .filter((work) => work.kind === "sprint")
      .sort(compareSprintWork);
    const sprints = allSprints
      .slice(0, limit)
      .map((work): SprintListRow => ({
        ...workListRow(work),
        active: work.meta.id === activeSprintId
      }));
    return {
      schemaVersion: "boreal.cli.sprint.list.v1",
      generatedAt,
      workspaceRoot: context.workspaceRoot,
      activeSprintId,
      truncated: allSprints.length > sprints.length,
      count: sprints.length,
      sprints
    };
  });
}

async function sprintShowResult(context: CliContext, sprint: WorkItem, limit: number) {
  const generatedAt = nowIso();
  const active = await context.store.read((reader) => activeSprintProjection(reader));
  const scope = await buildSprintScope(context, sprint, limit);
  return {
    schemaVersion: "boreal.cli.sprint.show.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    active: sprint.meta.id === activeSprintIdFromProjection(active),
    sprint: await context.runtime.getWorkView(sprint.meta.id),
    scope
  };
}

async function sprintCurrentResult(context: CliContext) {
  const generatedAt = nowIso();
  const active = await context.store.read(async (reader) => {
    const projection = await activeSprintProjection(reader);
    const sprintId = activeSprintIdFromProjection(projection);
    const sprint = sprintId ? await reader.getWorkItem(sprintId) : undefined;
    return { projection, sprintId, sprint };
  });
  if (!active.projection || !active.sprintId) {
    return {
      schemaVersion: "boreal.cli.sprint.current.v1",
      generatedAt,
      workspaceRoot: context.workspaceRoot,
      active: false,
      stale: false
    };
  }
  if (!active.sprint || active.sprint.kind !== "sprint") {
    return {
      schemaVersion: "boreal.cli.sprint.current.v1",
      generatedAt,
      workspaceRoot: context.workspaceRoot,
      active: false,
      stale: true,
      activeSprintId: active.sprintId,
      projection: sprintProjectionSummary(active.projection)
    };
  }
  return {
    schemaVersion: "boreal.cli.sprint.current.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    active: true,
    stale: false,
    activeSprintId: active.sprintId,
    projection: sprintProjectionSummary(active.projection),
    sprint: await context.runtime.getWorkView(active.sprint.meta.id),
    scope: await buildSprintScope(context, active.sprint, DEFAULT_SPRINT_SCOPE_LIMIT)
  };
}

async function sprintBoardResult(context: CliContext, sprint: WorkItem, limit: number) {
  const generatedAt = nowIso();
  const [active, scope, reservations, sprintView] = await Promise.all([
    context.store.read((reader) => activeSprintProjection(reader)),
    buildSprintScope(context, sprint, limit),
    context.store.read((reader) => reader.listReservations()),
    context.runtime.getWorkView(sprint.meta.id)
  ]);
  const scopedWorkIds = new Set(scope.descendants.map((work) => work.id));
  const scopedReservations = reservations.filter((reservation) => scopedWorkIds.has(reservation.workId));
  return {
    schemaVersion: "boreal.cli.sprint.board.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    active: sprint.meta.id === activeSprintIdFromProjection(active),
    activeSprintId: activeSprintIdFromProjection(active),
    selectedSprintId: sprint.meta.id,
    scope: {
      directChildCount: scope.directChildren.length,
      totalDescendants: scope.totalDescendants,
      truncated: scope.truncated,
      limit
    },
    board: buildSprintBoardView({
      sprint: sprintView,
      work: scope.descendants,
      reservations: scopedReservations,
      generatedAt
    })
  };
}

async function sprintMetricsResult(context: CliContext, sprint: WorkItem, args: ParsedArgs, closeoutReason: string | undefined) {
  const generatedAt = nowIso();
  const limit = sprintScopeLimit(args);
  const capacity = parseNonNegativeInteger(flagValue(args, "capacity"), "--capacity");
  const scope = await buildSprintScope(context, sprint, limit);
  const descendantsById = new Map(scope.descendants.map((work) => [work.id, work]));
  const committedWork = await resolveSprintMetricWorkSet(context, flagValues(args, "commit"), scope.descendants);
  const carryoverWork = await resolveSprintMetricWorkSet(
    context,
    flagValues(args, "carryover"),
    committedWork.filter((work) => isOpenWorkStatus(work.status))
  );
  const completed = scope.descendants.filter((work) => !isOpenWorkStatus(work.status));
  const open = scope.descendants.filter((work) => isOpenWorkStatus(work.status));
  const blocked = open.filter((work) => work.status === "blocked" || work.activeBlockerIds.length > 0);
  const risks = sprintMetricRisks({
    explicitRisks: flagValues(args, "risk"),
    capacity,
    committedCount: committedWork.length,
    carryoverCount: carryoverWork.length,
    blockedCount: blocked.length
  });
  const committedOutOfScope = committedWork.filter((work) => !descendantsById.has(work.id));
  const carryoverOutOfScope = carryoverWork.filter((work) => !descendantsById.has(work.id));
  const readyForReport = open.length === 0 && Boolean(closeoutReason || sprint.closedReason || sprint.status === "closed");

  return {
    schemaVersion: "boreal.cli.sprint.metrics.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    sprint: workListRow(sprint),
    scope: {
      directChildCount: scope.directChildren.length,
      totalDescendants: scope.totalDescendants,
      truncated: scope.truncated,
      limit
    },
    capacity: {
      capacity,
      committed: committedWork.length,
      completed: completed.length,
      open: open.length,
      remaining: capacity === undefined ? undefined : Math.max(0, capacity - committedWork.length),
      overCapacity: capacity !== undefined && committedWork.length > capacity
    },
    summary: {
      total: scope.descendants.length,
      completed: completed.length,
      open: open.length,
      blocked: blocked.length,
      needsVerification: open.filter((work) => work.status === "needs_verification").length,
      carryover: carryoverWork.length,
      risks: risks.length,
      committedOutOfScope: committedOutOfScope.length,
      carryoverOutOfScope: carryoverOutOfScope.length
    },
    committed: committedWork.map(metricWorkRow),
    carryover: carryoverWork.map(metricWorkRow),
    risks,
    closeout: {
      reason: closeoutReason,
      readyForReport,
      unresolvedWork: open.map(metricWorkRow),
      committedOutOfScope: committedOutOfScope.map(metricWorkRow),
      carryoverOutOfScope: carryoverOutOfScope.map(metricWorkRow)
    }
  };
}

async function resolveSprintMetricWorkSet(
  context: CliContext,
  references: readonly string[],
  fallback: readonly WorkItemView[]
): Promise<readonly WorkItemView[]> {
  if (references.length === 0) {
    return fallback;
  }
  const rows: WorkItemView[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const workId = await resolveWorkId(context, reference);
    if (seen.has(workId)) {
      continue;
    }
    rows.push(await context.runtime.getWorkView(workId));
    seen.add(workId);
  }
  return rows;
}

function sprintMetricRisks(input: {
  readonly explicitRisks: readonly string[];
  readonly capacity: number | undefined;
  readonly committedCount: number;
  readonly carryoverCount: number;
  readonly blockedCount: number;
}): readonly string[] {
  const generated: string[] = [];
  if (input.capacity !== undefined && input.committedCount > input.capacity) {
    generated.push(`capacity_exceeded: committed ${input.committedCount} exceeds capacity ${input.capacity}`);
  }
  if (input.carryoverCount > 0) {
    generated.push(`carryover: ${input.carryoverCount} item(s) remain open`);
  }
  if (input.blockedCount > 0) {
    generated.push(`blocked_scope: ${input.blockedCount} item(s) remain blocked`);
  }
  return normalizedNonEmptyStrings([...input.explicitRisks, ...generated]);
}

function metricWorkRow(work: WorkItemView): WorkListRow {
  return {
    id: work.id,
    status: work.status,
    priority: work.priority,
    title: work.title,
    labels: work.labels
  };
}

async function sprintReportResult(context: CliContext, sprint: WorkItem, args: ParsedArgs): Promise<SprintReportResult> {
  const format = parseSprintReportFormat(flagValue(args, "format"));
  const limit = sprintScopeLimit(args);
  const doctorEvidenceId = asEvidenceId(requiredFlag(args, "doctor-evidence"));
  const syncEvidenceId = asEvidenceId(requiredFlag(args, "sync-evidence"));
  if (doctorEvidenceId === syncEvidenceId) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Sprint report requires distinct doctor and sync evidence records");
  }

  const document = await buildSprintReportDocument(context, sprint, {
    format,
    limit,
    doctorEvidenceId,
    syncEvidenceId
  });
  const content = renderSprintReportContent(document);
  const contentHash = String(hashContent({ format, content }));
  const out = flagValue(args, "out");
  const path = out ? await writeSprintReportArtifact(context, out, content) : undefined;
  return {
    schemaVersion: SPRINT_REPORT_SCHEMA_VERSION,
    generatedAt: document.generatedAt,
    workspaceRoot: context.workspaceRoot,
    format,
    path,
    contentHash,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    report: document,
    content: path ? undefined : content
  };
}

async function buildSprintReportDocument(
  context: CliContext,
  sprint: WorkItem,
  input: {
    readonly format: SprintReportFormat;
    readonly limit: number;
    readonly doctorEvidenceId: EvidenceRecord["meta"]["id"];
    readonly syncEvidenceId: EvidenceRecord["meta"]["id"];
  }
): Promise<SprintReportDocument> {
  const generatedAt = nowIso();
  const [active, scope, sprintView, snapshot] = await Promise.all([
    context.store.read((reader) => activeSprintProjection(reader)),
    buildSprintScope(context, sprint, input.limit),
    context.runtime.getWorkView(sprint.meta.id),
    context.store.read(async (reader) => ({
      workItems: await reader.listWorkItems(),
      agentSummaries: await reader.listAgentSummaries(),
      evidence: await reader.listEvidence(),
      verifications: await reader.listVerifications(),
      decisions: await reader.listDecisions(),
      graphEdges: await reader.listGraphEdges(),
      sources: await reader.listKnowledgeSources()
    }))
  ]);
  const workById = new Map(snapshot.workItems.map((work) => [work.meta.id, work]));
  const scopedWorkIds = new Set<string>([sprint.meta.id, ...scope.descendants.map((work) => work.id)]);
  const scopedWork = [reportWorkRow(sprintView, sprint), ...scope.descendants.map((work) => reportWorkRow(work, workById.get(work.id as WorkId)))]
    .sort(compareReportWorkRows);
  const descendantWork = scopedWork.filter((work) => work.id !== sprint.meta.id);
  const scopedEvidence = snapshot.evidence
    .filter((record) => record.subjectType === "work" && scopedWorkIds.has(record.subjectId))
    .map(evidenceRow)
    .sort(compareEvidenceRows);
  const closeoutEvidence = {
    doctor: resolveCloseoutEvidence(snapshot.evidence, scopedWorkIds, input.doctorEvidenceId, "doctor"),
    sync: resolveCloseoutEvidence(snapshot.evidence, scopedWorkIds, input.syncEvidenceId, "sync")
  };
  const scopedEvidenceIds = new Set(scopedEvidence.map((record) => record.id));
  const scopedSourceIds = sourceIdsForSprintScope({
    workItems: snapshot.workItems.filter((work) => scopedWorkIds.has(work.meta.id)),
    evidence: snapshot.evidence.filter((record) => scopedEvidenceIds.has(record.meta.id)),
    sources: snapshot.sources
  });
  const decisions = snapshot.decisions
    .filter((decision) =>
      decision.status !== "rejected" &&
      sprintDecisionIsRelevant(decision, snapshot.graphEdges, scopedWorkIds, scopedEvidenceIds, scopedSourceIds)
    )
    .map(decisionRow)
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const agentSummaries = snapshot.agentSummaries
    .filter((summary) => scopedWorkIds.has(summary.subjectId))
    .map(agentSummaryReportRow)
    .sort(compareAgentSummaryRows);
  const summaryCheckpointGaps = agentSummaries.filter(
    (summary) => (summary.status === "final" || summary.status === "forced") &&
      summary.commitShas.length === 0 &&
      summary.dirtyPathNotes.length === 0
  );
  const completedWork = descendantWork.filter((work) => isCompletedReportStatus(work.status));
  const openWork = descendantWork.filter((work) => isOpenReportStatus(work.status));
  const unresolvedBlockers = openWork
    .filter((work) => work.status === "blocked" || work.activeBlockerIds.length > 0)
    .map((work): SprintReportBlockerRow => ({
      work,
      blockers: work.activeBlockerIds
        .map((id) => {
          const view = scope.descendants.find((candidate) => candidate.id === id);
          const raw = workById.get(id as WorkId);
          return view ? reportWorkRow(view, raw) : raw ? reportWorkRow(toWorkItemView({ work: raw }), raw) : undefined;
        })
        .filter(isReportWorkRow)
    }));
  const nextSprintCandidates = openWork
    .filter((work) => work.status !== "cancelled")
    .sort(compareReportWorkRows);
  const scopedGateStatuses = snapshot.workItems
    .filter((work) => scopedWorkIds.has(work.meta.id))
    .map((work) => closeoutGateStatusFromSnapshot(
      work,
      snapshot.workItems,
      snapshot.graphEdges,
      snapshot.evidence,
      snapshot.verifications,
      snapshot.agentSummaries
    ));
  const reviewGates = reviewGateSummaryFromStatuses(scopedGateStatuses);
  const reviewGateDetails = reviewGateDetailRowsFromStatuses(scopedGateStatuses);

  return {
    schemaVersion: SPRINT_REPORT_SCHEMA_VERSION,
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    format: input.format,
    sprint: reportWorkRow(sprintView, sprint),
    active: sprint.meta.id === activeSprintIdFromProjection(active),
    activeSprintId: activeSprintIdFromProjection(active),
    scope: {
      directChildCount: scope.directChildren.length,
      totalDescendants: scope.totalDescendants,
      truncated: scope.truncated,
      limit: input.limit
    },
    summary: {
      total: descendantWork.length,
      completed: completedWork.length,
      open: openWork.length,
      blocked: openWork.filter((work) => work.status === "blocked").length,
      needsVerification: openWork.filter((work) => work.status === "needs_verification").length,
      evidence: scopedEvidence.length,
      decisions: decisions.length,
      agentSummaries: agentSummaries.length,
      summaryCheckpointGaps: summaryCheckpointGaps.length,
      nextSprintCandidates: nextSprintCandidates.length,
      reviewGates
    },
    completedWork,
    openWork,
    unresolvedBlockers,
    nextSprintCandidates,
    agentSummaries,
    evidence: scopedEvidence,
    decisions,
    reviewGateDetails,
    closeoutEvidence
  };
}

function resolveCloseoutEvidence(
  records: readonly EvidenceRecord[],
  scopedWorkIds: ReadonlySet<string>,
  evidenceId: EvidenceRecord["meta"]["id"],
  requiredKind: "doctor" | "sync"
): SprintReportEvidenceRow {
  const record = records.find((candidate) => candidate.meta.id === evidenceId);
  if (!record) {
    throw new BorealError("BOREAL_NOT_FOUND", `Sprint report ${requiredKind} evidence was not found`, { evidenceId });
  }
  if (record.subjectType !== "work" || !scopedWorkIds.has(record.subjectId)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Sprint report ${requiredKind} evidence must belong to the sprint scope`, {
      evidenceId,
      subjectType: record.subjectType,
      subjectId: record.subjectId
    });
  }
  if (record.outcome !== "passed") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Sprint report ${requiredKind} evidence must have passed outcome`, {
      evidenceId,
      outcome: record.outcome
    });
  }
  const text = `${record.summary} ${record.command ?? ""} ${record.uri ?? ""}`.toLowerCase();
  if (!text.includes(requiredKind)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Sprint report ${requiredKind} evidence must reference ${requiredKind}`, {
      evidenceId
    });
  }
  return evidenceRow(record);
}

function sourceIdsForSprintScope(input: {
  readonly workItems: readonly WorkItem[];
  readonly evidence: readonly EvidenceRecord[];
  readonly sources: readonly KnowledgeSource[];
}): ReadonlySet<string> {
  const sourceUris = new Set([
    ...input.workItems.flatMap((work) => work.meta.sourceRefs.map((sourceRef) => sourceRef.uri)),
    ...input.evidence.map((record) => record.uri).filter(isString)
  ]);
  return new Set(input.sources.filter((source) => sourceUris.has(source.uri)).map((source) => source.meta.id));
}

function sprintDecisionIsRelevant(
  decision: DecisionRecord,
  graphEdges: readonly GraphEdge[],
  scopedWorkIds: ReadonlySet<string>,
  scopedEvidenceIds: ReadonlySet<string>,
  scopedSourceIds: ReadonlySet<string>
): boolean {
  if (decision.sourceIds.some((sourceId) => scopedSourceIds.has(sourceId))) {
    return true;
  }
  return graphEdges.some((edge) => {
    if (edge.fromId === decision.meta.id && edge.fromType === "decision") {
      return scopedGraphTarget(edge.toType, edge.toId, scopedWorkIds, scopedEvidenceIds, scopedSourceIds);
    }
    if (edge.toId === decision.meta.id && edge.toType === "decision") {
      return scopedGraphTarget(edge.fromType, edge.fromId, scopedWorkIds, scopedEvidenceIds, scopedSourceIds);
    }
    return false;
  });
}

function scopedGraphTarget(
  type: string,
  id: string,
  scopedWorkIds: ReadonlySet<string>,
  scopedEvidenceIds: ReadonlySet<string>,
  scopedSourceIds: ReadonlySet<string>
): boolean {
  return (
    ((type === "work" || type === "works") && scopedWorkIds.has(id)) ||
    ((type === "evidence" || type === "evidences") && scopedEvidenceIds.has(id)) ||
    ((type === "source" || type === "sources" || type === "knowledgeSource" || type === "knowledgeSources") &&
      scopedSourceIds.has(id))
  );
}

function reportWorkRow(view: WorkItemView, raw: WorkItem | undefined): SprintReportWorkRow {
  return {
    ...view,
    description: raw?.description ?? "",
    acceptanceCriteria: raw?.acceptanceCriteria ?? []
  };
}

function evidenceRow(record: EvidenceRecord): SprintReportEvidenceRow {
  return {
    id: record.meta.id,
    subjectId: record.subjectId,
    kind: record.kind,
    outcome: record.outcome,
    summary: record.summary,
    command: record.command,
    uri: record.uri,
    observedAt: record.observedAt
  };
}

function decisionRow(record: DecisionRecord): SprintReportDecisionRow {
  return {
    id: record.meta.id,
    title: record.title,
    status: record.status,
    decision: record.decision,
    consequences: record.consequences,
    sourceIds: record.sourceIds
  };
}

function agentSummaryReportRow(record: AgentSummaryRecord): SprintReportAgentSummaryRow {
  return {
    id: record.meta.id,
    subjectId: record.subjectId,
    subjectType: record.subjectType,
    summaryKind: record.summaryKind,
    status: record.status,
    outcome: record.outcome,
    title: record.title,
    artifactUri: record.artifactUri,
    commitShas: record.commitShas,
    dirtyPathNotes: record.dirtyPathNotes,
    childSummaryIds: record.childSummaryIds,
    forceReasonCode: record.forceReasonCode,
    forceComment: record.forceComment,
    generatedAt: record.generatedAt
  };
}

function isReportWorkRow(value: SprintReportWorkRow | undefined): value is SprintReportWorkRow {
  return value !== undefined;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareEvidenceRows(left: SprintReportEvidenceRow, right: SprintReportEvidenceRow): number {
  return right.observedAt.localeCompare(left.observedAt) || left.summary.localeCompare(right.summary) || left.id.localeCompare(right.id);
}

function compareAgentSummaryRows(left: SprintReportAgentSummaryRow, right: SprintReportAgentSummaryRow): number {
  return right.generatedAt.localeCompare(left.generatedAt) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function compareReportWorkRows(left: SprintReportWorkRow, right: SprintReportWorkRow): number {
  const priority = priorityRank(right.priority) - priorityRank(left.priority);
  return priority || left.status.localeCompare(right.status) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function isCompletedReportStatus(status: WorkStatus): boolean {
  return status === "closed" || status === "verified";
}

function isOpenReportStatus(status: WorkStatus): boolean {
  return status !== "closed" && status !== "verified" && status !== "cancelled";
}

function renderSprintReportContent(document: SprintReportDocument): string {
  return document.format === "html" ? renderSprintReportHtml(document) : renderSprintReportMarkdown(document);
}

function renderSprintReportMarkdown(document: SprintReportDocument): string {
  return [
    `# Sprint Closeout: ${document.sprint.title}`,
    "",
    `- Schema: ${document.schemaVersion}`,
    `- Generated: ${document.generatedAt}`,
    `- Workspace: ${document.workspaceRoot}`,
    `- Sprint: ${document.sprint.id}`,
    `- Active: ${document.active ? "yes" : "no"}`,
    `- Scope: ${document.scope.totalDescendants}${document.scope.truncated ? ` (truncated to ${document.scope.limit})` : ""}`,
    `- Doctor evidence: ${document.closeoutEvidence.doctor.id}`,
    `- Sync evidence: ${document.closeoutEvidence.sync.id}`,
    "",
    "## Summary",
    "",
    `- Total scoped work: ${document.summary.total}`,
    `- Completed work: ${document.summary.completed}`,
    `- Open work: ${document.summary.open}`,
    `- Blocked work: ${document.summary.blocked}`,
    `- Needs verification: ${document.summary.needsVerification}`,
    `- Evidence records: ${document.summary.evidence}`,
    `- Decisions: ${document.summary.decisions}`,
    `- Agent summaries: ${document.summary.agentSummaries}`,
    `- Summary checkpoint gaps: ${document.summary.summaryCheckpointGaps}`,
    `- Next sprint candidates: ${document.summary.nextSprintCandidates}`,
    `- Review gates: pending ${document.summary.reviewGates.review.pending}, passed ${document.summary.reviewGates.review.passed}, forced bypass ${document.summary.reviewGates.review.forced}`,
    `- Audit gates: pending ${document.summary.reviewGates.audit.pending}, passed ${document.summary.reviewGates.audit.passed}, forced bypass ${document.summary.reviewGates.audit.forced}`,
    "",
    "## Completed Work",
    "",
    markdownWorkList(document.completedWork),
    "",
    "## Open Work",
    "",
    markdownWorkList(document.openWork),
    "",
    "## Unresolved Blockers",
    "",
    markdownBlockerList(document.unresolvedBlockers),
    "",
    "## Decisions",
    "",
    markdownDecisionList(document.decisions),
    "",
    "## Agent Summaries",
    "",
    markdownAgentSummaryList(document.agentSummaries),
    "",
    "## Review/Audit Gates",
    "",
    formatReviewGateDetailsMarkdown(document.reviewGateDetails),
    "",
    "## Evidence",
    "",
    markdownEvidenceList(document.evidence),
    "",
    "## Next Sprint Candidates",
    "",
    markdownWorkList(document.nextSprintCandidates)
  ].join("\n") + "\n";
}

function markdownWorkList(rows: readonly SprintReportWorkRow[]): string {
  if (rows.length === 0) {
    return "None.";
  }
  return rows
    .map((row) => {
      const blockers = row.activeBlockerIds.length > 0 ? ` blockers: ${row.activeBlockerIds.join(", ")}` : "";
      return `- ${row.title} (${row.id}) - ${row.status}, ${row.priority}, evidence ${row.evidenceCount}, verifications ${row.verificationCount}${blockers}`;
    })
    .join("\n");
}

function markdownBlockerList(rows: readonly SprintReportBlockerRow[]): string {
  if (rows.length === 0) {
    return "None.";
  }
  return rows
    .map((row) => {
      const blockers = row.blockers.length > 0
        ? row.blockers.map((blocker) => `${blocker.title} (${blocker.id})`).join(", ")
        : row.work.activeBlockerIds.join(", ");
      return `- ${row.work.title} (${row.work.id}) blocked by ${blockers}`;
    })
    .join("\n");
}

function markdownDecisionList(rows: readonly SprintReportDecisionRow[]): string {
  if (rows.length === 0) {
    return "None.";
  }
  return rows
    .map((row) => `- ${row.title} (${row.id}) - ${row.status}: ${row.decision}`)
    .join("\n");
}

function markdownAgentSummaryList(rows: readonly SprintReportAgentSummaryRow[]): string {
  if (rows.length === 0) {
    return "None.";
  }
  return rows
    .map((row) => {
      const commits = row.commitShas.length > 0 ? row.commitShas.join(", ") : "none";
      const dirtyPaths = row.dirtyPathNotes.length > 0 ? row.dirtyPathNotes.join("; ") : "none";
      const children = row.childSummaryIds.length > 0 ? row.childSummaryIds.join(", ") : "none";
      const artifact = row.artifactUri ?? "none";
      const forced = row.forceReasonCode ? ` force ${row.forceReasonCode}` : "";
      return `- ${row.title} (${row.id}) - ${row.subjectType} ${row.subjectId}, ${row.status}/${row.outcome}, commits ${commits}, dirty paths ${dirtyPaths}, child summaries ${children}, artifact ${artifact}${forced}`;
    })
    .join("\n");
}

function markdownEvidenceList(rows: readonly SprintReportEvidenceRow[]): string {
  if (rows.length === 0) {
    return "None.";
  }
  return rows
    .map((row) => `- ${row.summary} (${row.id}) - ${row.outcome}, ${row.kind}, subject ${row.subjectId}`)
    .join("\n");
}

function renderSprintReportHtml(document: SprintReportDocument): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(`Sprint Closeout: ${document.sprint.title}`)}</title>`,
    "<style>",
    "body{margin:0;font-family:Inter,Arial,sans-serif;background:#f6f3ee;color:#17201c;line-height:1.45}",
    "main{max-width:1120px;margin:0 auto;padding:32px 20px 48px}",
    "h1,h2{letter-spacing:0;margin:0 0 12px}h1{font-size:30px}h2{font-size:19px;margin-top:28px}",
    ".meta,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}",
    ".pill,.card{border:1px solid #d8d1c4;border-radius:8px;background:#fffdf8;padding:10px}",
    ".pill strong,.card strong{display:block;color:#4d3f2f;font-size:12px;text-transform:uppercase}",
    "table{width:100%;border-collapse:collapse;background:#fffdf8;border:1px solid #d8d1c4;border-radius:8px;overflow:hidden}",
    "th,td{text-align:left;border-bottom:1px solid #e4ded3;padding:8px;vertical-align:top;overflow-wrap:anywhere}",
    "th{font-size:12px;text-transform:uppercase;color:#4d3f2f;background:#eee7da}",
    "tr:last-child td{border-bottom:0}.empty{color:#6f6a62}.section{margin-top:18px}",
    "@media (max-width:720px){main{padding:22px 12px}h1{font-size:24px}th,td{font-size:13px}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(document.sprint.title)}</h1>`,
    '<div class="meta">',
    htmlPill("Generated", document.generatedAt),
    htmlPill("Sprint", document.sprint.id),
    htmlPill("Scope", `${document.scope.totalDescendants}${document.scope.truncated ? ` truncated to ${document.scope.limit}` : ""}`),
    htmlPill("Doctor evidence", document.closeoutEvidence.doctor.id),
    htmlPill("Sync evidence", document.closeoutEvidence.sync.id),
    "</div>",
    '<section class="section"><h2>Summary</h2><div class="grid">',
    htmlPill("Total work", String(document.summary.total)),
    htmlPill("Completed", String(document.summary.completed)),
    htmlPill("Open", String(document.summary.open)),
    htmlPill("Blocked", String(document.summary.blocked)),
    htmlPill("Needs verification", String(document.summary.needsVerification)),
    htmlPill("Decisions", String(document.summary.decisions)),
    htmlPill("Agent summaries", String(document.summary.agentSummaries)),
    htmlPill("Summary checkpoint gaps", String(document.summary.summaryCheckpointGaps)),
    htmlPill("Review gates", `pending ${document.summary.reviewGates.review.pending}, passed ${document.summary.reviewGates.review.passed}, forced ${document.summary.reviewGates.review.forced}`),
    htmlPill("Audit gates", `pending ${document.summary.reviewGates.audit.pending}, passed ${document.summary.reviewGates.audit.passed}, forced ${document.summary.reviewGates.audit.forced}`),
    "</div></section>",
    htmlWorkSection("Completed Work", document.completedWork),
    htmlWorkSection("Open Work", document.openWork),
    htmlBlockerSection(document.unresolvedBlockers),
    htmlDecisionSection(document.decisions),
    htmlAgentSummarySection(document.agentSummaries),
    htmlReviewGateSection(document.reviewGateDetails),
    htmlEvidenceSection(document.evidence),
    htmlWorkSection("Next Sprint Candidates", document.nextSprintCandidates),
    "</main>",
    "</body>",
    "</html>"
  ].join("\n") + "\n";
}

function htmlPill(label: string, value: string): string {
  return `<div class="pill"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`;
}

function htmlWorkSection(title: string, rows: readonly SprintReportWorkRow[]): string {
  return [
    `<section class="section"><h2>${escapeHtml(title)}</h2>`,
    rows.length === 0
      ? '<p class="empty">None.</p>'
      : htmlTable(
          ["Title", "Status", "Priority", "Evidence", "Verifications"],
          rows.map((row) => [
            `${row.title} (${row.id})`,
            row.status,
            row.priority,
            String(row.evidenceCount),
            String(row.verificationCount)
          ])
        ),
    "</section>"
  ].join("\n");
}

function htmlBlockerSection(rows: readonly SprintReportBlockerRow[]): string {
  return [
    '<section class="section"><h2>Unresolved Blockers</h2>',
    rows.length === 0
      ? '<p class="empty">None.</p>'
      : htmlTable(
          ["Work", "Blockers"],
          rows.map((row) => [
            `${row.work.title} (${row.work.id})`,
            row.blockers.length > 0
              ? row.blockers.map((blocker) => `${blocker.title} (${blocker.id})`).join(", ")
              : row.work.activeBlockerIds.join(", ")
          ])
        ),
    "</section>"
  ].join("\n");
}

function htmlDecisionSection(rows: readonly SprintReportDecisionRow[]): string {
  return [
    '<section class="section"><h2>Decisions</h2>',
    rows.length === 0
      ? '<p class="empty">None.</p>'
      : htmlTable(
          ["Title", "Status", "Decision"],
          rows.map((row) => [`${row.title} (${row.id})`, row.status, row.decision])
        ),
    "</section>"
  ].join("\n");
}

function htmlAgentSummarySection(rows: readonly SprintReportAgentSummaryRow[]): string {
  return [
    '<section class="section"><h2>Agent Summaries</h2>',
    rows.length === 0
      ? '<p class="empty">None.</p>'
      : htmlTable(
          ["Title", "Subject", "Status", "Checkpoint", "Children", "Artifact"],
          rows.map((row) => [
            `${row.title} (${row.id})`,
            `${row.subjectType} ${row.subjectId}`,
            `${row.status}/${row.outcome}${row.forceReasonCode ? ` force ${row.forceReasonCode}` : ""}`,
            row.commitShas.length > 0
              ? row.commitShas.join(", ")
              : row.dirtyPathNotes.length > 0
                ? row.dirtyPathNotes.join("; ")
                : "none",
            row.childSummaryIds.length > 0 ? row.childSummaryIds.join(", ") : "none",
            row.artifactUri ?? "none"
          ])
        ),
    "</section>"
  ].join("\n");
}

function htmlReviewGateSection(rows: readonly ReviewGateDetailRow[]): string {
  return [
    '<section class="section"><h2>Review/Audit Gates</h2>',
    rows.length === 0
      ? '<p class="empty">None.</p>'
      : htmlTable(
          ["Work", "Gate", "Status", "Evidence", "Forced Bypass"],
          rows.map((row) => [
            `${row.workTitle} (${row.workId})`,
            `${row.kind}:${row.scope} ${row.gateId}`,
            `${row.status}${row.pendingTargetIds.length > 0 ? ` pending ${row.pendingTargetIds.join(", ")}` : ""}`,
            [
              row.evidenceIds.length > 0 ? `evidence ${row.evidenceIds.join(", ")}` : "",
              row.verificationIds.length > 0 ? `verification ${row.verificationIds.join(", ")}` : "",
              row.agentSummaryIds.length > 0 ? `summaries ${row.agentSummaryIds.join(", ")}` : "",
              row.commitShas.length > 0 ? `commits ${row.commitShas.join(", ")}` : "",
              row.dirtyPathNotes.length > 0 ? `dirty ${row.dirtyPathNotes.join("; ")}` : ""
            ].filter((value) => value.length > 0).join("; ") || "none",
            row.forceReason
              ? `${row.forceReason}: ${row.forceComment ?? ""}${row.forceEvidenceIds.length > 0 ? ` (${row.forceEvidenceIds.join(", ")})` : ""}`
              : "none"
          ])
        ),
    "</section>"
  ].join("\n");
}

function htmlEvidenceSection(rows: readonly SprintReportEvidenceRow[]): string {
  return [
    '<section class="section"><h2>Evidence</h2>',
    rows.length === 0
      ? '<p class="empty">None.</p>'
      : htmlTable(
          ["Summary", "Outcome", "Kind", "Subject"],
          rows.map((row) => [`${row.summary} (${row.id})`, row.outcome, row.kind, row.subjectId])
        ),
    "</section>"
  ].join("\n");
}

function htmlTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    "<table>",
    "<thead><tr>",
    ...headers.map((header) => `<th>${escapeHtml(header)}</th>`),
    "</tr></thead>",
    "<tbody>",
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`),
    "</tbody>",
    "</table>"
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function parseSprintReportFormat(value: string | undefined): SprintReportFormat {
  if (!value) {
    return "markdown";
  }
  if (SPRINT_REPORT_FORMATS.has(value as SprintReportFormat)) {
    return value as SprintReportFormat;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Sprint report format must be markdown or html", { format: value });
}

async function writeSprintReportArtifact(context: CliContext, outPath: string, content: string): Promise<string> {
  const resolvedPath = resolve(context.workspaceRoot, outPath);
  assertPathInside(context.workspaceRoot, resolvedPath);
  await assertRealPathInside(context.workspaceRoot, resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeTextFileAtomic(resolvedPath, content);
  return resolvedPath;
}

async function activateSprint(context: CliContext, sprintReference: string) {
  const sprint = await resolveSprintWork(context, sprintReference);
  const generatedAt = nowIso();
  return context.store.write(async (writer) => {
    const previousProjection = await activeSprintProjection(writer);
    const previousSprintId = activeSprintIdFromProjection(previousProjection);
    const event = withContentHash({
      meta: createRecordMeta({
        id: randomId<EventId>("event"),
        now: generatedAt,
        actor: context.actor
      }),
      type: "sprint.activated",
      subjectId: sprint.meta.id,
      subjectType: "sprint",
      operationId: context.operationId,
      payload: {
        workspaceRoot: context.workspaceRoot,
        previousSprintId,
        sprintId: sprint.meta.id
      }
    } satisfies RuntimeEvent);
    await writer.putEvent(event);

    const projectionValue = {
      workspaceRoot: context.workspaceRoot,
      sprintId: sprint.meta.id,
      activatedAt: generatedAt,
      activatedBy: String(context.actor.id),
      previousSprintId,
      eventId: event.meta.id
    };
    const projection = activeSprintProjectionRecord(previousProjection, projectionValue, generatedAt, context.actor);
    await writer.putProjection(projection);
    return {
      schemaVersion: "boreal.cli.sprint.activate.v1",
      generatedAt,
      workspaceRoot: context.workspaceRoot,
      activated: true,
      previousSprintId,
      activeSprintId: sprint.meta.id,
      projectionId: projection.meta.id,
      eventId: event.meta.id,
      sprint: toWorkItemView({ work: sprint })
    };
  });
}

async function resolveSprintWork(context: CliContext, value: string): Promise<WorkItem> {
  const workId = value === "current"
    ? await context.store.read(async (reader) => {
        const projection = await activeSprintProjection(reader);
        const sprintId = activeSprintIdFromProjection(projection);
        if (!sprintId) {
          throw new BorealError("BOREAL_NOT_FOUND", "No active sprint is selected");
        }
        return sprintId;
      })
    : await resolveWorkId(context, value);
  const work = await context.store.read((reader) => reader.getWorkItem(workId));
  if (!work) {
    throw new BorealError("BOREAL_NOT_FOUND", "Sprint not found", { sprintId: workId });
  }
  if (work.kind !== "sprint") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Sprint reference must resolve to work with kind sprint", {
      workId: work.meta.id,
      kind: work.kind
    });
  }
  return work;
}

async function buildSprintScope(context: CliContext, sprint: WorkItem, limit: number): Promise<SprintScope> {
  return context.store.read(async (reader) => {
    const [workItems, graphEdges, evidence, verifications] = await Promise.all([
      reader.listWorkItems(),
      reader.listGraphEdges(),
      reader.listEvidence(),
      reader.listVerifications()
    ]);
    const workById = new Map(workItems.map((item) => [item.meta.id, item]));
    const evidenceByWork = recordsByWorkSubject(evidence);
    const verificationsByWork = recordsByWorkSubject(verifications);
    const directChildIds = dependencyIdsForWork(sprint, graphEdges);
    const descendants: WorkItem[] = [];
    const visited = new Set<string>();
    const visit = (workId: string): void => {
      if (visited.has(workId)) {
        return;
      }
      const work = workById.get(workId as WorkId);
      if (!work) {
        return;
      }
      visited.add(workId);
      descendants.push(work);
      for (const childId of dependencyIdsForWork(work, graphEdges)) {
        visit(childId);
      }
    };
    for (const childId of directChildIds) {
      visit(childId);
    }
    const limitedDescendants = descendants.slice(0, limit);
    const directChildren = directChildIds
      .map((id) => workById.get(id))
      .filter(isWorkItem)
      .map((work) => sprintWorkView(work, workById, graphEdges, evidenceByWork, verificationsByWork))
      .sort(compareWorkViews);
    return {
      directChildren,
      descendants: limitedDescendants
        .map((work) => sprintWorkView(work, workById, graphEdges, evidenceByWork, verificationsByWork))
        .sort(compareWorkViews),
      totalDescendants: descendants.length,
      truncated: descendants.length > limitedDescendants.length
    };
  });
}

function dependencyIdsForWork(work: WorkItem, graphEdges: readonly GraphEdge[]): readonly WorkId[] {
  const ids = new Set<string>(work.dependencyIds);
  for (const edge of graphEdges) {
    if (
      edge.kind === "blocks" &&
      edge.fromType === "work" &&
      edge.toType === "work" &&
      edge.toId === work.meta.id
    ) {
      ids.add(edge.fromId);
    }
  }
  return [...ids] as WorkId[];
}

function sprintWorkView(
  work: WorkItem,
  workById: ReadonlyMap<WorkId, WorkItem>,
  graphEdges: readonly GraphEdge[],
  evidenceByWork: ReadonlyMap<string, readonly EvidenceRecord[]>,
  verificationsByWork: ReadonlyMap<string, readonly VerificationRecord[]>
): WorkItemView {
  const dependencyIds = dependencyIdsForWork(work, graphEdges);
  return toWorkItemView({
    work: { ...work, dependencyIds },
    dependencies: dependencyIds.map((id) => workById.get(id)).filter(isWorkItem),
    evidence: evidenceByWork.get(work.meta.id) ?? [],
    verifications: verificationsByWork.get(work.meta.id) ?? []
  });
}

function recordsByWorkSubject<TRecord extends { readonly subjectId: string; readonly subjectType: string }>(
  records: readonly TRecord[]
): ReadonlyMap<string, readonly TRecord[]> {
  const byWork = new Map<string, TRecord[]>();
  for (const record of records) {
    if (record.subjectType !== "work") {
      continue;
    }
    byWork.set(record.subjectId, [...(byWork.get(record.subjectId) ?? []), record]);
  }
  return byWork;
}

async function activeSprintProjection(reader: BorealReader): Promise<ProjectionRecord | undefined> {
  const deterministic = await reader.getProjection(ACTIVE_SPRINT_PROJECTION_ID);
  if (deterministic?.kind === ACTIVE_SPRINT_PROJECTION_KIND) {
    return deterministic;
  }
  return (await reader.listProjections()).find(
    (projection) => projection.kind === ACTIVE_SPRINT_PROJECTION_KIND && projection.subjectId === "workspace"
  );
}

function activeSprintIdFromProjection(projection: ProjectionRecord | undefined): WorkId | undefined {
  const sprintId = projectionValueString(projection, "sprintId");
  return sprintId?.startsWith("bw_work_") ? sprintId as WorkId : undefined;
}

function activeSprintProjectionRecord(
  existing: ProjectionRecord | undefined,
  value: Record<string, unknown>,
  now: IsoTimestamp,
  actor: ActorRef
): ProjectionRecord {
  const record = existing?.meta.id === ACTIVE_SPRINT_PROJECTION_ID
    ? touchRecord({
        ...existing,
        kind: ACTIVE_SPRINT_PROJECTION_KIND,
        subjectId: "workspace",
        value
      }, now, actor)
    : {
        meta: createRecordMeta({
          id: ACTIVE_SPRINT_PROJECTION_ID,
          now,
          actor
        }),
        kind: ACTIVE_SPRINT_PROJECTION_KIND,
        subjectId: "workspace",
        value
      };
  return withContentHash(record satisfies ProjectionRecord);
}

function sprintProjectionSummary(projection: ProjectionRecord) {
  return {
    id: projection.meta.id,
    updatedAt: projection.meta.updatedAt,
    sprintId: projectionValueString(projection, "sprintId"),
    activatedAt: projectionValueString(projection, "activatedAt"),
    activatedBy: projectionValueString(projection, "activatedBy"),
    eventId: projectionValueString(projection, "eventId")
  };
}

function projectionValueString(projection: ProjectionRecord | undefined, key: string): string | undefined {
  const value = projection?.value[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compareSprintWork(left: WorkItem, right: WorkItem): number {
  return (
    left.status.localeCompare(right.status) ||
    left.title.localeCompare(right.title) ||
    left.meta.id.localeCompare(right.meta.id)
  );
}

function formatSprintList(result: Awaited<ReturnType<typeof sprintListResult>>): string {
  if (result.sprints.length === 0) {
    return "No sprints found\n";
  }
  return table(
    result.sprints.map((row) => ({
      id: row.id,
      status: row.status,
      priority: row.priority,
      active: row.active ? "yes" : "no",
      title: row.title
    }))
  );
}

function formatSprintShow(result: Awaited<ReturnType<typeof sprintShowResult>>): string {
  return [
    `Sprint: ${result.sprint.title} (${result.sprint.id})`,
    `Status: ${result.sprint.status}`,
    `Active: ${result.active ? "yes" : "no"}`,
    `Scope: ${result.scope.totalDescendants}${result.scope.truncated ? " (truncated)" : ""}`
  ].join("\n") + "\n";
}

function formatSprintCurrent(result: Awaited<ReturnType<typeof sprintCurrentResult>>): string {
  const sprint = "sprint" in result ? result.sprint : undefined;
  if (result.active !== true || !sprint) {
    const suffix = result.stale ? ` stale projection ${result.activeSprintId ?? ""}` : "none";
    return `Active sprint: ${suffix}\n`;
  }
  return `Active sprint: ${sprint.title} (${sprint.id})\n`;
}

function formatSprintActivated(result: Awaited<ReturnType<typeof activateSprint>>): string {
  const previous = result.previousSprintId ? ` previous ${result.previousSprintId}` : "";
  return `Activated sprint ${result.activeSprintId}${previous}\n`;
}

function formatSprintBoard(result: Awaited<ReturnType<typeof sprintBoardResult>>): string {
  const lines = [
    `Sprint board: ${result.board.sprint.title} (${result.board.sprint.id})`,
    `Scope: ${result.scope.totalDescendants}${result.scope.truncated ? ` (truncated to ${result.scope.limit})` : ""}`,
    table(result.board.lanes.map((lane) => ({ lane: lane.title, count: lane.count }))).trimEnd()
  ];
  return `${lines.join("\n")}\n`;
}

function formatSprintReport(result: SprintReportResult): string {
  if (!result.path) {
    return result.content ?? "";
  }
  return [
    `Sprint report written: ${result.path}`,
    `Format: ${result.format}`,
    `Hash: ${result.contentHash}`,
    `Bytes: ${result.sizeBytes}`
  ].join("\n") + "\n";
}

function sprintScopeLimit(args: ParsedArgs): number {
  return parseLimit(flagValue(args, "limit"), { max: MAX_SPRINT_SCOPE_LIMIT }) ?? DEFAULT_SPRINT_SCOPE_LIMIT;
}

async function lockCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "inspect": {
      const inspection = await inspectFileLock(context.paths.stateLockDir);
      output.write(json ? formatRecord(inspection, true) : dashboardView(args) ? formatLockDashboard(inspection) : formatRecord(inspection, false));
      return { exitCode: 0 };
    }
    case "break": {
      if (!hasFlag(args, "stale-only")) {
        throw new BorealError("BOREAL_INVALID_INPUT", "`bwrk lock break` requires --stale-only");
      }
      const result = await breakStaleFileLock(context.paths.stateLockDir);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown lock command: ${action ?? ""}`);
  }
}

async function requireCliWork(reader: BorealReader, workId: WorkId): Promise<WorkItem> {
  const work = await reader.getWorkItem(workId);
  if (!work) {
    throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId });
  }
  return work;
}

async function requireCliClaim(reader: BorealReader, claimId: ClaimId): Promise<ClaimRecord> {
  const claim = await reader.getClaim(claimId);
  if (!claim) {
    throw new BorealError("BOREAL_NOT_FOUND", "Claim not found", { claimId });
  }
  return claim;
}

async function requireCliDecision(reader: BorealReader, decisionId: DecisionId): Promise<DecisionRecord> {
  const decision = await reader.getDecision(decisionId);
  if (!decision) {
    throw new BorealError("BOREAL_NOT_FOUND", "Decision not found", { decisionId });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge record references missing source", { missingSourceIds });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Knowledge record references missing evidence", { missingEvidenceIds });
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

function parsePreviewBytes(value: string | undefined): number {
  if (!value) {
    return DEFAULT_RAW_PREVIEW_BYTES;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--preview-bytes must be a positive integer");
  }
  if (parsed > MAX_RAW_PREVIEW_BYTES) {
    throw new BorealError("BOREAL_INVALID_INPUT", `--preview-bytes must be at most ${MAX_RAW_PREVIEW_BYTES}`);
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

function parseSourceKind(value: string | undefined): KnowledgeSourceKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "raw" || value === "document" || value === "chat" || value === "code" || value === "artifact") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be raw, document, chat, code, or artifact");
}

function parseClaimStatus(value: string | undefined): ClaimStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "rejected" || value === "stale") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be proposed, accepted, rejected, or stale");
}

function parseDecisionStatus(value: string | undefined): DecisionStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "superseded" || value === "rejected") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be proposed, accepted, superseded, or rejected");
}

function parseDuplicateDomain(value: string): DuplicateDomain {
  if (value === "all" || value === "work" || value === "raw" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be all, work, raw, or wiki");
}

function parseMergeDomain(value: string): Exclude<DuplicateDomain, "all"> {
  if (value === "work" || value === "raw" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be work, raw, or wiki");
}

function parseCompactDomain(value: string): CompactDomain {
  if (value === "all" || value === "work" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be all, work, or wiki");
}

function parseCompactApplyDomain(value: string): Exclude<CompactDomain, "all"> {
  if (value === "work" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be work or wiki");
}

function parseOlderThanDays(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--older-than-days must be a non-negative integer");
  }
  return parsed;
}

function parseVerdict(value: string | undefined): VerificationVerdict {
  const verdict = value ?? "passed";
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
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement references missing evidence", { missingEvidenceIds });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement references missing agent summary", { missingSummaryIds });
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
    throw new BorealError("BOREAL_NOT_FOUND", "Directive acknowledgement references missing verification", { missingVerificationIds });
  }
}

function optionalSourceId(value: string | undefined): KnowledgeSourceId | undefined {
  return value ? asSourceId(value) : undefined;
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

function requiredCloseoutGateInputsFromArgs(args: ParsedArgs): readonly RequiredCloseoutGateInput[] {
  const gateValues = flagValues(args, "required-gate");
  const gateCommands = flagValues(args, "gate-command");
  const gateExpectedObservables = flagValues(args, "gate-expect");
  if (gateValues.length === 0 && (gateCommands.length > 0 || gateExpectedObservables.length > 0)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--gate-command and --gate-expect require --required-gate");
  }
  if (gateCommands.length > gateValues.length || gateExpectedObservables.length > gateValues.length) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      "--gate-command and --gate-expect must not be repeated more times than --required-gate"
    );
  }
  return gateValues.map((value, index) => {
    const [kindValue, scopeValue, extra] = value.split(":");
    if (!kindValue || extra !== undefined) {
      throw new BorealError("BOREAL_INVALID_INPUT", "--required-gate must use kind or kind:scope");
    }
    const declaredCommand = optionalRequiredGateText(gateCommands[index], "--gate-command");
    const expectedObservable = optionalRequiredGateText(gateExpectedObservables[index], "--gate-expect");
    return {
      kind: parseCloseoutGateKind(kindValue),
      scope: parseCloseoutGateScope(scopeValue),
      ...(declaredCommand ? { declaredCommand } : {}),
      ...(expectedObservable ? { expectedObservable } : {})
    };
  });
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

async function rebuildProjectionsRespectingTombstones(context: CliContext): Promise<readonly WorkItemView[]> {
  const tombstones = await readGeneratedLedgerTombstones(context);
  return context.runtime.rebuildProjections({
    skipContextPackIds: tombstones.contextPackIds,
    skipProjectionIds: tombstones.projectionIds
  });
}

async function buildHandoffBundle(
  context: CliContext,
  workId: WorkId,
  args: ParsedArgs,
  resultLimit: number
): Promise<HandoffBundle> {
  await rebuildProjectionsRespectingTombstones(context);
  const [work, contextPack] = await Promise.all([context.runtime.getWorkView(workId), context.runtime.getContextPack(workId)]);
  await writeSearchIndex(context);
  const queryFlag = flagValue(args, "query");
  const query = queryFlag ? normalizeSearchQuery(queryFlag) : handoffSearchQuery(work, contextPack);
  const candidates = await runSearch(context, query, {
    limit: Math.max(resultLimit * HANDOFF_CONTEXT_CHUNK_LIMIT_RATIO, HANDOFF_SEARCH_MIN_CANDIDATES)
  });
  return {
    work,
    contextPack,
    search: {
      query,
      results: diversifyHandoffSearchResults(candidates, resultLimit)
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
    return {
      handoffComplete: true,
      warnings: [],
      ...(await buildHandoffBundle(context, workId, args, resultLimit))
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
  const validationCommand = declaredGateHint?.declaredCommand ?? "pnpm test";
  const agentFlag = `--agent ${shellArg(normalizedAgentId)}`;
  const scopedFlags = `${agentFlag}${labelFlags(normalizedLabels)}`;
  const commands = {
    status: `bwrk agent status ${scopedFlags} --json`,
    start: `bwrk agent start ${scopedFlags} --purpose ${shellArg("start implementation")} --json`,
    finish:
      `bwrk agent finish <work-id> ${agentFlag} --summary ${shellArg("implemented and tested")} ` +
      `--command ${shellArg(validationCommand)} --close --reason ${shellArg("verified by evidence")} --json`,
    renew: "bwrk work renew <work-id> --ttl 2h --json",
    evidence:
      `bwrk evidence add <work-id> --summary ${shellArg("implemented and tested")} --kind command --outcome passed --command ${shellArg(validationCommand)} --json`,
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
    loop: [
      {
        step: "Check coordination state",
        command: commands.status,
        when: "Use before work and after repair to see stale reservations, capacity, and the next recommended action."
      },
      {
        step: "Start or resume work",
        command: commands.start,
        when: "Use as the normal entrypoint; it resumes active work before claiming another ready item."
      },
      {
        step: "Renew if work continues",
        command: commands.renew,
        when: "Use before the reservation TTL expires when the same agent is still actively working."
      },
      {
        step: "Finish with evidence",
        command: commands.finish,
        when: "Use after implementation or investigation to record evidence, verify, close, and release in one guarded exit."
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
): Promise<{ readonly declaredCommand: string; readonly expectedObservable?: string } | undefined> {
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

function workListRow(work: {
  readonly meta: { readonly id: string };
  readonly title: string;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly labels: readonly string[];
}): WorkListRow {
  return {
    id: work.meta.id,
    status: work.status,
    priority: work.priority,
    title: work.title,
    labels: [...work.labels]
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
    if (edge.kind !== "blocks" || edge.fromType !== "work" || edge.toType !== "work" || !workIds.has(edge.toId as WorkId)) {
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

function dependencyTreeRows(tree: DependencyTreeNode): Array<Record<string, string | number>> {
  const rows: Array<Record<string, string | number>> = [];
  const visit = (node: DependencyTreeNode, depth: number): void => {
    rows.push({
      depth,
      id: node.id,
      status: node.status ?? (node.missing ? "missing" : ""),
      title: node.title ?? "",
      flags: [node.cycle ? "cycle" : "", node.missing ? "missing" : "", node.shared ? "shared" : ""].filter(Boolean).join(",")
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
    if (edge.kind !== "blocks" || edge.fromType !== "work" || edge.toType !== "work") {
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

function workViewListRow(view: WorkItemView): WorkListRow {
  return {
    id: view.id,
    status: view.status,
    priority: view.priority,
    title: view.title,
    labels: [...view.labels]
  };
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
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    title: row.title,
    labels: row.labels.join(",")
  };
}

function textRawSourceRow(row: RawSourceRow): Record<string, string> {
  return {
    id: row.id,
    status: row.processingStatus,
    kind: row.kind,
    title: row.title,
    uri: row.uri ?? "",
    linked: String(row.linkedPageCount),
    addedAt: row.addedAt
  };
}

interface WikiPageRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly sourceRefs: readonly string[];
  readonly links: readonly string[];
  readonly claimStatus?: string;
  readonly truthStatus: string;
  readonly sourceRefCount: number;
  readonly outboundLinkCount: number;
  readonly backlinkCount: number;
  readonly showCommand: string;
}

interface WikiPageDetail extends WikiPageRow {
  readonly backlinks: readonly WikiLinkedPage[];
  readonly outboundPages: readonly WikiLinkedPage[];
  readonly missingOutboundLinks: readonly string[];
}

interface WikiLinkedPage {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly truthStatus: string;
}

function wikiPageRows(pages: readonly WikiPageRecord[]): readonly WikiPageRow[] {
  return pages.map((page) => wikiPageRow(page, pages)).sort(compareWikiPageRows);
}

function wikiPageDetail(page: WikiPageRecord, pages: readonly WikiPageRecord[]): WikiPageDetail {
  const row = wikiPageRow(page, pages);
  const outbound = page.links.map((link) => ({ link, page: findWikiPageByLink(pages, link) }));
  return {
    ...row,
    backlinks: wikiBacklinks(page, pages).map(wikiLinkedPage),
    outboundPages: outbound.map((entry) => entry.page).filter(isWikiPageRecord).map(wikiLinkedPage),
    missingOutboundLinks: outbound.filter((entry) => !entry.page).map((entry) => entry.link)
  };
}

function wikiPageRow(page: WikiPageRecord, pages: readonly WikiPageRecord[]): WikiPageRow {
  return {
    id: wikiPageRuntimeId(page),
    slug: page.slug,
    title: page.title,
    path: page.path,
    sourceRefs: page.sourceRefs,
    links: page.links,
    claimStatus: page.claimStatus,
    truthStatus: wikiTruthStatus(page),
    sourceRefCount: page.sourceRefs.length,
    outboundLinkCount: page.links.length,
    backlinkCount: wikiBacklinks(page, pages).length,
    showCommand: `bwrk wiki show ${wikiPageRuntimeId(page)} --json`
  };
}

function wikiBacklinks(page: WikiPageRecord, pages: readonly WikiPageRecord[]): readonly WikiPageRecord[] {
  return pages.filter((candidate) =>
    candidate.path !== page.path && candidate.links.some((link) => wikiLinkTargetsPage(link, page))
  );
}

async function resolveWikiPageIds(context: CliContext, references: readonly string[]): Promise<readonly string[]> {
  if (references.length === 0) {
    return [];
  }
  const vaultStatus = await inspectVault(context);
  if (!vaultStatus.initialized) {
    throw new BorealError("BOREAL_NOT_FOUND", "Wiki page references require an initialized Boreal memory vault", {
      references,
      missingDirectories: vaultStatus.missingDirectories,
      missingFiles: vaultStatus.missingFiles
    });
  }
  const pages = await listVaultWikiPages(context);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const pageId = wikiPageRuntimeId(resolveWikiPage(pages, reference));
    if (!seen.has(pageId)) {
      ids.push(pageId);
      seen.add(pageId);
    }
  }
  return ids;
}

function resolveWikiPage(pages: readonly WikiPageRecord[], reference: string): WikiPageRecord {
  const normalized = normalizeWikiReference(reference);
  const page = pages.find((candidate) =>
    candidate.id === reference ||
    candidate.slug === reference ||
    normalizeWikiReference(candidate.title) === normalized ||
    normalizeWikiReference(candidate.path) === normalized
  );
  if (!page) {
    throw new BorealError("BOREAL_NOT_FOUND", "Wiki page not found", { reference });
  }
  return page;
}

function findWikiPageByLink(pages: readonly WikiPageRecord[], link: string): WikiPageRecord | undefined {
  const normalized = normalizeWikiReference(link);
  return pages.find((page) =>
    normalizeWikiReference(page.slug) === normalized ||
    normalizeWikiReference(page.title) === normalized ||
    normalizeWikiReference(page.path) === normalized ||
    page.id === link
  );
}

function wikiLinkTargetsPage(link: string, page: WikiPageRecord): boolean {
  const normalized = normalizeWikiReference(link);
  return (
    normalized === normalizeWikiReference(page.slug) ||
    normalized === normalizeWikiReference(page.title) ||
    normalized === normalizeWikiReference(page.path) ||
    link === page.id
  );
}

function wikiTruthStatus(page: WikiPageRecord): string {
  if (page.claimStatus === "accepted") return "accepted";
  if (page.claimStatus === "proposed") return "proposed";
  if (page.claimStatus === "stale") return "stale";
  if (page.claimStatus === "rejected") return "rejected";
  return "draft";
}

function wikiLinkedPage(page: WikiPageRecord): WikiLinkedPage {
  return {
    id: wikiPageRuntimeId(page),
    slug: page.slug,
    title: page.title,
    path: page.path,
    truthStatus: wikiTruthStatus(page)
  };
}

function compareWikiPageRows(left: WikiPageRow, right: WikiPageRow): number {
  return (
    wikiTruthRank(left.truthStatus) - wikiTruthRank(right.truthStatus) ||
    right.backlinkCount - left.backlinkCount ||
    right.sourceRefCount - left.sourceRefCount ||
    left.title.localeCompare(right.title) ||
    left.slug.localeCompare(right.slug)
  );
}

function wikiTruthRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "proposed") return 1;
  if (status === "draft") return 2;
  if (status === "stale") return 3;
  return 4;
}

function normalizeWikiReference(value: string): string {
  const fileName = basename(value.trim().replace(/\\/gu, "/"), ".md");
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function wikiPageRuntimeId(page: WikiPageRecord): string {
  return page.id || page.slug;
}

function isWikiPageRecord(value: WikiPageRecord | undefined): value is WikiPageRecord {
  return Boolean(value);
}

function textWikiPageRow(row: WikiPageRow): Record<string, string> {
  return {
    id: row.id,
    status: row.truthStatus,
    title: row.title,
    path: row.path,
    sources: String(row.sourceRefCount),
    backlinks: String(row.backlinkCount),
    outbound: String(row.outboundLinkCount)
  };
}

function sourceListRow(source: KnowledgeSource): Record<string, string> {
  return {
    id: source.meta.id,
    kind: source.kind,
    title: source.title,
    uri: source.uri
  };
}

function claimListRow(claim: ClaimRecord): Record<string, string | number | readonly string[]> {
  const wikiPageIds = claim.wikiPageIds ?? [];
  return {
    id: claim.meta.id,
    status: claim.status,
    statement: claim.statement,
    sources: claim.sourceIds.join(","),
    sourceIds: claim.sourceIds,
    sourceCount: claim.sourceIds.length,
    evidence: claim.evidenceIds.join(","),
    evidenceIds: claim.evidenceIds,
    evidenceCount: claim.evidenceIds.length,
    wikiPages: wikiPageIds.join(","),
    wikiPageIds,
    wikiPageCount: wikiPageIds.length,
    reviewState: claimReviewState(claim.status),
    updatedAt: claim.meta.updatedAt
  };
}

function textClaimListRow(row: Record<string, string | number | readonly string[]>): Record<string, string | number> {
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? ""),
    statement: String(row.statement ?? ""),
    sources: String(row.sources ?? ""),
    evidence: String(row.evidence ?? ""),
    wiki: String(row.wikiPages ?? ""),
    review: String(row.reviewState ?? "")
  };
}

function decisionListRow(decision: DecisionRecord): Record<string, string | number | readonly string[]> {
  const wikiPageIds = decision.wikiPageIds ?? [];
  return {
    id: decision.meta.id,
    status: decision.status,
    title: decision.title,
    context: decision.context,
    decision: decision.decision,
    consequences: decision.consequences,
    consequenceCount: decision.consequences.length,
    sources: decision.sourceIds.join(","),
    sourceIds: decision.sourceIds,
    sourceCount: decision.sourceIds.length,
    wikiPages: wikiPageIds.join(","),
    wikiPageIds,
    wikiPageCount: wikiPageIds.length,
    reviewState: decisionReviewState(decision.status),
    supersessionStatus: decision.status === "superseded" ? "superseded" : "none",
    updatedAt: decision.meta.updatedAt
  };
}

function textDecisionListRow(row: Record<string, string | number | readonly string[]>): Record<string, string | number> {
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? ""),
    title: String(row.title ?? ""),
    decision: String(row.decision ?? ""),
    sources: String(row.sources ?? ""),
    wiki: String(row.wikiPages ?? ""),
    review: String(row.reviewState ?? "")
  };
}

function claimReviewState(status: ClaimRecord["status"]): string {
  if (status === "proposed") return "needs_review";
  if (status === "stale") return "needs_refresh";
  return status;
}

function decisionReviewState(status: DecisionRecord["status"]): string {
  if (status === "proposed") return "needs_review";
  if (status === "superseded") return "superseded";
  return status;
}

function searchResultRow(result: SearchResult): Record<string, string | number> {
  return {
    score: result.score,
    type: result.type,
    id: result.recordId,
    subject: result.subjectId ?? "",
    title: result.title,
    matches: result.matches.join(",")
  };
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

function diversifyHandoffSearchResults(results: readonly SearchResult[], limit: number): readonly SearchResult[] {
  const selected: SearchResult[] = [];
  const deferredContextChunks: SearchResult[] = [];
  const contextChunkLimit = Math.max(1, Math.floor(limit / HANDOFF_CONTEXT_CHUNK_LIMIT_RATIO));
  let contextChunkCount = 0;

  for (const result of results) {
    if (result.type === "context_chunk") {
      if (contextChunkCount >= contextChunkLimit) {
        deferredContextChunks.push(result);
        continue;
      }
      contextChunkCount += 1;
    }
    selected.push(result);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const result of deferredContextChunks) {
    selected.push(result);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
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
    return {
      kind: "claim_work",
      command: `bwrk work claim --agent ${shellArg(input.agentId)}${labelFlags(input.labels)}`,
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

const HELP_SECTIONS: readonly { readonly title: string; readonly categories: readonly string[] }[] = [
  { title: "Start", categories: ["workspace", "install", "docs"] },
  { title: "Work", categories: ["work", "dependency", "evidence", "gate"] },
  { title: "Plan", categories: ["sprint", "workflow"] },
  { title: "Knowledge", categories: ["source", "claim", "decision", "context", "search", "raw", "wiki", "vault"] },
  { title: "Agents", categories: ["agent", "session", "reservation", "operation", "directive"] },
  { title: "Dashboards", categories: ["dashboard", "registry"] },
  { title: "Maintain", categories: ["doctor", "sync", "lock", "ledger", "snapshot", "duplicate", "merge", "compact", "daemon"] },
  { title: "Data", categories: ["export", "import"] },
  { title: "Meta", categories: ["meta", "schema"] }
];

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
