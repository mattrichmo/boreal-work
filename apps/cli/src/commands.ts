import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  createRecordMeta,
  deterministicId,
  hashContent,
  isBorealError,
  isIsoTimestamp,
  normalizeActorId,
  normalizeLabels,
  normalizeMachineString,
  normalizeSearchQuery,
  nowIso,
  randomId,
  runtimeSnapshotSchemaIssues,
  touchRecord,
  withContentHash,
  type ActorRef,
  type ActorKind,
  type AgentReservation,
  type ClaimId,
  type ClaimRecord,
  type ClaimStatus,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type DecisionStatus,
  type EventId,
  type EvidenceRecord,
  type EvidenceKind,
  type EvidenceOutcome,
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
import { deriveReadinessStatus } from "@boreal/work-engine";

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
import { asEvidenceId, asWorkId, runDoctor, type Diagnostic } from "./doctor.js";
import { assertInitialized, createCliContext, ensureWorkspaceDirs, type CliContext } from "./context.js";
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
import { maybeConfigureProjectSetup, readProjectSetupConfig, type ProjectSetupResult } from "./project-setup.js";
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
import {
  addRawSource,
  createWikiPage,
  getRawSourceDetail,
  initVault,
  inspectVault,
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
    readonly nextSprintCandidates: number;
  };
  readonly completedWork: readonly SprintReportWorkRow[];
  readonly openWork: readonly SprintReportWorkRow[];
  readonly unresolvedBlockers: readonly SprintReportBlockerRow[];
  readonly nextSprintCandidates: readonly SprintReportWorkRow[];
  readonly evidence: readonly SprintReportEvidenceRow[];
  readonly decisions: readonly SprintReportDecisionRow[];
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
      case "dep":
        result = await depCommand(action, rest, context, args, commandOutput, json);
        break;
      case "evidence":
        result = await evidenceCommand(action, rest, context, args, commandOutput, json);
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
        result = await workflowsCommand(action, rest, args, commandOutput, json);
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
        result = await globalCommand(action, context, args, commandOutput, json);
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
        result = await docsCommand(action, commandOutput, json);
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
  output.write(formatRecord(await buildAgentProtocolBrief("prime", context, agentId, labels), json));
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
      output.write(formatRecord(await buildAgentProtocolBrief("session_start", context, agentId, labels), json));
      return { exitCode: 0 };
    case "end":
      output.write(formatRecord(await buildAgentProtocolBrief("session_end", context, agentId, labels), json));
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

  return context.store.write(async (writer) => {
    const operations = [...(await writer.listOperations())].sort(compareOperationsNewestFirst);
    const beforeMs = before ? Date.parse(before) : undefined;
    const eligibleByAge = operations.filter(
      (operation) => beforeMs === undefined || Date.parse(operation.finishedAt) >= beforeMs
    );
    const keepBeforeOperationLog = keep === undefined ? eligibleByAge.length : Math.max(0, keep - 1);
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
      keep,
      before,
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
    output.write(
      table(
        COMMAND_DEFINITIONS.map((definition) => ({
          command: commandPath(definition),
          category: definition.category,
          workspace: definition.requiresWorkspace ? "yes" : "no",
          summary: definition.summary
        }))
      )
    );
  }
  return { exitCode: 0 };
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
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const workflows = await listWorkflowAssets();
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
      const workflow = await getWorkflowAsset(requiredPositional(rest, 0, "workflow reference"));
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
    installRoot: await installRootFromArgs(context, args, target)
  });
  if (interactive && !dryRun) {
    await confirmSkillInstallPlan(plan);
  }
  const result = dryRun ? plan : await installSkillsFromPlan(plan);
  output.write(json ? formatRecord(result, true) : formatSkillInstallPlan(result));
  return { exitCode: result.issues.length === 0 ? 0 : 1 };
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
  if (config?.installRoot && configuredInstallRootMatchesTarget(config.installRoot, target)) {
    return config.installRoot;
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

function configuredInstallRootMatchesTarget(root: string, target: "codex" | "claude" | "skills"): boolean {
  if (target === "skills") {
    return true;
  }
  const container = basename(root) === "skills" ? basename(dirname(root)) : basename(root);
  return target === "codex" ? container === ".agents" : container === ".claude";
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
      const guide = buildAgentGuide(agentIdFromArgs(args, context.actor.id), labelsFromArgs(args));
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
    output.write(
      formatRecord(
        {
          started: true,
          action: "continue_reserved_work",
          agentId,
          labels,
          status: await buildAgentStatus(context, agentId, labels),
          reservation,
          releasedReservations: [],
          ...handoff
        } satisfies AgentStartResult,
        json
      )
    );
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
  output.write(
    formatRecord(
      {
        started: true,
        action: "claimed_work",
        agentId,
        labels,
        status: await buildAgentStatus(context, agentId, labels),
        reservation: claim.reservation,
        releasedReservations: claim.releasedReservations,
        ...handoff
      } satisfies AgentStartResult,
      json
    )
  );
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
    close: close ? { reason: requiredFlag(args, "reason") } : undefined,
    release
  });

  output.write(
    formatRecord(
      {
        finished: true,
        action: close ? "verified_and_closed" : "verified_and_released",
        agentId,
        work: await context.runtime.getWorkView(workId),
        evidence: finished.evidence,
        verification: finished.verification,
        reservation: finished.reservation,
        closedWork: finished.closedWork,
        release: finished.release,
        status: await buildAgentStatus(context, agentId, [])
      } satisfies AgentFinishResult,
      json
    )
  );
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
    close: input.close ? { reason: requiredFlag(input.args, "reason") } : undefined,
    release: input.release
  });

  input.output.write(
    formatRecord(
      {
        finished: true,
        action: input.close ? "verified_and_closed" : "verified_and_released",
        agentId,
        work: await input.context.runtime.getWorkView(workId),
        evidence: finished.evidence,
        verification: finished.verification,
        reservation: finished.reservation,
        closedWork: finished.closedWork,
        release: finished.release,
        status: await buildAgentStatus(input.context, agentId, [])
      } satisfies AgentFinishResult,
      input.json
    )
  );
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
    const installRoot = configuredInstallRootMatchesTarget(projectSetup.config.installRoot, target)
      ? projectSetup.config.installRoot
      : defaultInstallRoot(context.workspaceRoot, target);
    const plan = await buildSkillInstallPlan({ target, dryRun: false, installRoot });
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
      const view = await context.runtime.getWorkView(await resolveWorkId(context, requiredPositional(rest, 0, "work reference")));
      output.write(formatRecord(view, json));
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
      output.write(
        formatRecord(
          {
            claimed: true,
            work: handoff.work,
            reservation: claim.reservation,
            releasedReservations: claim.releasedReservations,
            ...handoff
          },
          json
        )
      );
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
      const verification = await context.runtime.verifyWork({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        verdict: parseVerdict(flagValue(args, "verdict")),
        evidenceIds,
        notes: flagValue(args, "notes")
      });
      output.write(formatRecord(verification, json));
      return { exitCode: 0 };
    }
    case "close": {
      const work = await context.runtime.closeWork({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        reason: requiredFlag(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "edit": {
      const result = await editWorkCommand(context, await resolveWorkId(context, requiredPositional(rest, 0, "work reference")), args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "cancel": {
      const result = await cancelWorkCommand(
        context,
        await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        requiredFlag(args, "reason")
      );
      output.write(formatRecord(result, json));
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
  if (
    title === undefined &&
    description === undefined &&
    kind === undefined &&
    priority === undefined &&
    labels.length === 0 &&
    acceptanceCriteria.length === 0
  ) {
    throw new BorealError("BOREAL_INVALID_INPUT", "work edit requires at least one mutable field flag");
  }

  const current = nowIso();
  return context.store.write(async (writer) => {
    const work = await requireCliWork(writer, workId);
    const nextLabels = labels.length > 0 ? labelsFromArgs(args) : work.labels;
    const updated = touchRecord(
      {
        ...work,
        kind: kind ?? work.kind,
        title: title ?? work.title,
        description: description ?? work.description,
        priority: priority ?? work.priority,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? normalizedNonEmptyStrings(acceptanceCriteria) : work.acceptanceCriteria,
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
}

async function cancelWorkCommand(context: CliContext, workId: WorkId, reason: string) {
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
  return changed;
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
      output.write(json ? formatRecord(tree, true) : table(dependencyTreeRows(tree)));
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
  output.write(formatRecord(evidence, json));
  return { exitCode: 0 };
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
      output.write(formatRecord(pack, json));
      return { exitCode: 0 };
    }
    case "search": {
      const results = await runSearch(context, rest.join(" "), {
        limit: parseLimit(flagValue(args, "limit"), { max: MAX_SEARCH_LIMIT }),
        types: ["context_pack", "context_chunk"],
        explain: hasFlag(args, "explain")
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
        explain: hasFlag(args, "explain")
      });
      output.write(json ? formatRecord(results, true) : table(results.map(searchResultRow)));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown search command: ${action ?? ""}`);
  }
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
      output.write(json ? formatRecord(status, true) : dashboardView(args) ? formatSyncDashboard(status) : formatRecord(status, false));
      return { exitCode: status.ok ? 0 : 1 };
    }
    case "refresh": {
      const result = await buildSyncRefreshResult(context);
      output.write(formatRecord(result, json));
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
    inspectVault(context),
    ledgerStatus(context, undefined),
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
    output.write(formatRecord(result, true));
  } else if (dashboardView(args)) {
    output.write(formatDoctorDashboard(result));
  } else {
    output.write(result.diagnostics.map(formatDiagnostic).join("\n") + "\n");
  }
  return { exitCode: result.ok ? 0 : 1 };
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
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "check") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown docs command: ${action ?? ""}`);
  }
  const result = await docsCheckResult();
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
  output.write(formatRecord(result, json));
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

async function docsCheckResult() {
  const generatedAt = nowIso();
  const assets = await inspectWorkflowAssets();
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
  const sync = await buildSyncRefreshResult(context);
  const doctor = await runDoctor(context, false, hasFlag(args, "strict"));
  const schema = await schemaValidateResult(context);
  const docs = await docsCheckResult();
  const ok = sync.postRefreshStatusOk && doctor.ok && schema.ok && docs.ok;
  return {
    schemaVersion: "boreal.cli.gate.closeout.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    strict: hasFlag(args, "strict"),
    ok,
    sync: {
      refreshOk: sync.refreshOk,
      postRefreshStatusOk: sync.postRefreshStatusOk,
      exitReason: sync.exitReason,
      contextViews: sync.contextViews,
      ledgersOk: sync.status.ledgers.ok,
      searchIndexOk: sync.status.searchIndex.ok,
      sqliteCacheOk: !sync.sqliteCache.error,
      statusOk: sync.status.ok,
      recommendedActions: sync.status.recommendedActions
    },
    doctor: {
      ok: doctor.ok,
      fixed: doctor.fixed,
      diagnosticCount: doctor.diagnostics.length,
      errors: doctor.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      warnings: doctor.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
      fixedCount: doctor.diagnostics.filter((diagnostic) => diagnostic.severity === "fixed").length,
      diagnostics: doctor.diagnostics
    },
    schema,
    docs
  };
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
  switch (action) {
    case undefined:
      if (json) {
        throw new BorealError("BOREAL_INVALID_INPUT", "bwrk dashboard serves the interactive console and does not support --json. Use bwrk dashboard global --json for dashboard data.");
      }
      if (hasFlag(args, "tui")) {
        return launchTuiCommand(context, args, "repo");
      }
      return serveDashboardCommand(context, args, output, "repo");
    case "global": {
      const result = await buildGlobalDashboardResult(context, args);
      output.write(json ? formatRecord(result, true) : formatGlobalDashboardSummary(result));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown dashboard command: ${action ?? ""}`);
  }
}

async function globalCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown global command: ${action}`);
  }
  if (json) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk global serves the cross-repo console. Use bwrk dashboard global --json for the data payload.");
  }
  if (hasFlag(args, "tui")) {
    return launchTuiCommand(context, args, "global");
  }
  return serveDashboardCommand(context, args, output, "global");
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
  const url = `http://${host}:${port}`;
  const child = spawnDashboardServer({
    workspaceRoot: context.workspaceRoot,
    host,
    port,
    mode,
    scope,
    liveCacheTtlMs
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
}) {
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
      String(input.liveCacheTtlMs)
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
    recommendedActions: []
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
      output.write(json ? formatRecord(result, true) : formatSprintReport(result));
      return { exitCode: 0 };
    }
    case "metrics": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current");
      const result = await sprintMetricsResult(context, sprint, args, flagValue(args, "closeout-reason"));
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "close": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current");
      const reason = requiredFlag(args, "reason");
      const metrics = await sprintMetricsResult(context, sprint, args, reason);
      const closed = await context.runtime.closeWork({ workId: sprint.meta.id, reason });
      output.write(
        formatRecord(
          {
            schemaVersion: "boreal.cli.sprint.close.v1",
            generatedAt: nowIso(),
            workspaceRoot: context.workspaceRoot,
            closed,
            metrics
          },
          json
        )
      );
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
      evidence: await reader.listEvidence(),
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
      nextSprintCandidates: nextSprintCandidates.length
    },
    completedWork,
    openWork,
    unresolvedBlockers,
    nextSprintCandidates,
    evidence: scopedEvidence,
    decisions,
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

function isReportWorkRow(value: SprintReportWorkRow | undefined): value is SprintReportWorkRow {
  return value !== undefined;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareEvidenceRows(left: SprintReportEvidenceRow, right: SprintReportEvidenceRow): number {
  return right.observedAt.localeCompare(left.observedAt) || left.summary.localeCompare(right.summary) || left.id.localeCompare(right.id);
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
    `- Next sprint candidates: ${document.summary.nextSprintCandidates}`,
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
    "</div></section>",
    htmlWorkSection("Completed Work", document.completedWork),
    htmlWorkSection("Open Work", document.openWork),
    htmlBlockerSection(document.unresolvedBlockers),
    htmlDecisionSection(document.decisions),
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
      details: error.details
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

function buildAgentGuide(agentId: string, labels: readonly string[]): AgentGuide {
  const normalizedAgentId = normalizeActorId(agentId);
  const normalizedLabels = normalizeLabels(labels);
  const agentFlag = `--agent ${shellArg(normalizedAgentId)}`;
  const scopedFlags = `${agentFlag}${labelFlags(normalizedLabels)}`;
  const commands = {
    status: `bwrk agent status ${scopedFlags} --json`,
    start: `bwrk agent start ${scopedFlags} --purpose ${shellArg("start implementation")} --json`,
    finish:
      `bwrk agent finish <work-id> ${agentFlag} --summary ${shellArg("implemented and tested")} ` +
      `--command ${shellArg("pnpm test")} --close --reason ${shellArg("verified by evidence")} --json`,
    renew: "bwrk work renew <work-id> --ttl 2h --json",
    evidence:
      "bwrk evidence add <work-id> --summary 'implemented and tested' --kind command --outcome passed --command 'pnpm test' --json",
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

function rootHelpText(): string {
  return `bwrk - Boreal Work CLI

Usage:
${COMMAND_DEFINITIONS.map((definition) => `  ${definition.usage}`).join("\n")}

Help:
  bwrk help [init|work|dep|evidence|source|claim|decision|context|search|reservation|agent|session|operation|workflows|install|registry|dashboard|daemon|sprint|export|import|vault|raw|wiki|duplicate|merge|compact|sync|ledger|snapshot|doctor|lock|commands|completion|prime]
`;
}
