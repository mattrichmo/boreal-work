import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  createRecordMeta,
  deterministicId,
  hashContent,
  nowIso,
  randomId,
  touchRecord,
  withContentHash,
  type ActorRef,
  type AgentSummaryForceReasonCode,
  type AgentSummaryKind,
  type AgentSummaryOutcome,
  type AgentSummaryRecord,
  type AgentSummaryStatus,
  type AgentSummarySubjectType,
  type CloseoutGateKind,
  type CloseoutGateScope,
  type DecisionRecord,
  type DecisionStatus,
  type EventId,
  type EvidenceId,
  type EvidenceKind,
  type EvidenceOutcome,
  type EvidenceRecord,
  type GraphEdge,
  type IsoTimestamp,
  type KnowledgeSource,
  type ProjectionId,
  type ProjectionRecord,
  type RuntimeEvent,
  type VerificationRecord,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import { writeTextFileAtomic, type BorealReader } from "@boreal/storage";
import { buildSprintBoardView, toWorkItemView, type WorkItemView } from "@boreal/ui-model";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import { boundedTable, type BoundedTableColumn } from "../cli-ui.js";
import type { CliContext } from "../context.js";
import { asEvidenceId, runDoctor } from "../doctor.js";
import { workBranchName } from "../git-branch.js";
import { isMissingGit, runGit } from "../git-exec.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import { buildSyncRefreshResult } from "./sync.js";
import { dependencyIdsForWork, type CommandResult } from "./shared.js";

const DEFAULT_SPRINT_LIST_LIMIT = 200;
const DEFAULT_SPRINT_SCOPE_LIMIT = 500;
const MAX_SPRINT_LIST_LIMIT = 200;
const MAX_SPRINT_SCOPE_LIMIT = 500;
const ACTIVE_SPRINT_PROJECTION_KIND = "active-sprint";
const ACTIVE_SPRINT_PROJECTION_ID = deterministicId<ProjectionId>("projection", {
  kind: ACTIVE_SPRINT_PROJECTION_KIND,
  subjectId: "workspace"
});
type SprintReportFormat = "markdown" | "html";
const SPRINT_REPORT_SCHEMA_VERSION = "boreal.cli.sprint.report.v1";
const SPRINT_REPORT_FORMATS = new Set<SprintReportFormat>(["markdown", "html"]);

interface WorkListRow {
  readonly id: string;
  readonly kind: WorkKind;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly title: string;
  readonly labels: readonly string[];
  readonly containerId?: WorkId;
  readonly parentIds?: readonly WorkId[];
  readonly lineage?: readonly unknown[];
  readonly agentId?: string;
  readonly showCommand?: string;
  readonly agentStartCommand?: string;
  readonly workClaimCommand?: string;
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
  readonly status: "open" | "satisfied" | "forced";
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

interface SprintCloseAutoReportResult {
  readonly sync: {
    readonly ok: boolean;
    readonly postRefreshStatusOk: boolean;
    readonly evidence: SprintReportEvidenceRow;
  };
  readonly doctor: {
    readonly ok: boolean;
    readonly strict: boolean;
    readonly blockingDiagnosticCodes: readonly string[];
    readonly evidence: SprintReportEvidenceRow;
  };
  readonly verification: {
    readonly id: string;
    readonly verdict: string;
  };
  readonly report: {
    readonly schemaVersion: typeof SPRINT_REPORT_SCHEMA_VERSION;
    readonly format: SprintReportFormat;
    readonly path?: string;
    readonly contentHash: string;
    readonly sizeBytes: number;
    readonly summary: SprintReportDocument["summary"];
    readonly closeoutEvidence: SprintReportDocument["closeoutEvidence"];
  };
}

type SprintLaunchGitBranch =
  | {
      readonly status: "recorded";
      readonly branch: string;
      readonly headSha: string;
      readonly baseBranch: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: "git_unavailable" | "not_git_repository" | "base_branch_missing" | "head_unavailable";
      readonly baseBranch?: string;
    };

interface CloseoutAgentSummaryResult {
  readonly summaries: readonly AgentSummaryRecord[];
  readonly created?: {
    readonly summary: AgentSummaryRecord;
  };
}

interface SprintCliMutationResult {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly subjectId: string;
  readonly schemaVersion?: string;
}

export interface SprintCommandDependencies {
  readonly resolveWorkId: (context: CliContext, value: string) => Promise<WorkId>;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly requireWork: (reader: BorealReader, workId: WorkId) => Promise<WorkItem>;
  readonly formatRecordWithAgentDirectives: (
    context: CliContext,
    args: ParsedArgs,
    value: unknown,
    json: boolean,
    options?: { readonly subjectWork?: WorkItem; readonly subjectWorkId?: WorkId }
  ) => Promise<string>;
  readonly withCliResult: <T extends object>(value: T, result: SprintCliMutationResult) => T & { readonly result: unknown };
  readonly workCliResult: (work: WorkItem | WorkItemView) => SprintCliMutationResult;
  readonly labelsFromArgs: (args: ParsedArgs) => readonly string[];
  readonly uniqueStrings: (values: readonly string[]) => readonly string[];
  readonly workListRow: (work: WorkItem) => WorkListRow;
  readonly parseLimit: (value: string | undefined, options?: { readonly max?: number }) => number | undefined;
  readonly parseNonNegativeInteger: (value: string | undefined, label: string) => number | undefined;
  readonly normalizedNonEmptyStrings: (values: readonly string[]) => readonly string[];
  readonly ensureAgentSummaryForClose: (
    context: CliContext,
    args: ParsedArgs,
    work: WorkItem,
    closeReason: string
  ) => Promise<CloseoutAgentSummaryResult>;
  readonly writeAgentSummaryArtifact: (context: CliContext, summary: AgentSummaryRecord) => Promise<unknown>;
  readonly agentSummaryRow: (summary: AgentSummaryRecord) => unknown;
  readonly closeoutGateStatusFromSnapshot: (
    work: WorkItem,
    workItems: readonly WorkItem[],
    graphEdges: readonly GraphEdge[],
    evidence: readonly EvidenceRecord[],
    verifications: readonly VerificationRecord[],
    summaries: readonly AgentSummaryRecord[]
  ) => unknown;
  readonly reviewGateSummaryFromStatuses: (statuses: readonly unknown[]) => ReviewGateSummary;
  readonly reviewGateDetailRowsFromStatuses: (statuses: readonly unknown[]) => readonly ReviewGateDetailRow[];
  readonly formatReviewGateDetailsMarkdown: (rows: readonly ReviewGateDetailRow[]) => string;
  readonly compareWorkViews: (left: WorkItemView, right: WorkItemView) => number;
  readonly priorityRank: (priority: WorkPriority) => number;
}

export async function sprintCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: SprintCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const result = await sprintListResult(context, args, dependencies);
      output.write(json ? formatRecord(result, true) : formatSprintList(result));
      return { exitCode: 0 };
    }
    case "launch": {
      const containerId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "container reference"));
      const container = await context.store.read((reader) => dependencies.requireWork(reader, containerId));
      const result = await sprintLaunchResult(context, args, container, dependencies);
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, dependencies.withCliResult(result, dependencies.workCliResult(result.sprint)), json, {
        subjectWork: result.sprint
      }));
      return { exitCode: 0 };
    }
    case "show": {
      const sprint = await resolveSprintWork(context, dependencies.requiredPositional(rest, 0, "sprint reference"), dependencies);
      const result = await sprintShowResult(context, sprint, sprintScopeLimit(args, dependencies), dependencies);
      output.write(json ? formatRecord(result, true) : formatSprintShow(result, hasFlag(args, "wide")));
      return { exitCode: 0 };
    }
    case "current": {
      const result = await sprintCurrentResult(context, dependencies);
      output.write(json ? formatRecord(result, true) : formatSprintCurrent(result));
      return { exitCode: 0 };
    }
    case "activate": {
      const result = await activateSprint(context, dependencies.requiredPositional(rest, 0, "sprint reference"), dependencies);
      output.write(json ? formatRecord(result, true) : formatSprintActivated(result));
      return { exitCode: 0 };
    }
    case "board": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current", dependencies);
      const result = await sprintBoardResult(context, sprint, sprintScopeLimit(args, dependencies), dependencies);
      output.write(json ? formatRecord(result, true) : formatSprintBoard(result, hasFlag(args, "wide")));
      return { exitCode: 0 };
    }
    case "report": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current", dependencies);
      const result = await sprintReportResult(context, sprint, args, dependencies);
      output.write(json ? await dependencies.formatRecordWithAgentDirectives(context, args, result, true, { subjectWork: sprint }) : formatSprintReport(result));
      return { exitCode: 0 };
    }
    case "metrics": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current", dependencies);
      const result = await sprintMetricsResult(context, sprint, args, flagValue(args, "closeout-reason"), dependencies);
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, { subjectWork: sprint }));
      return { exitCode: 0 };
    }
    case "close": {
      const sprint = await resolveSprintWork(context, rest[0] ?? "current", dependencies);
      const reason = requiredFlag(args, "reason");
      const autoReport = hasFlag(args, "auto-report")
        ? await sprintCloseAutoReportResult(context, sprint, args, dependencies)
        : undefined;
      const sprintForClose = autoReport
        ? await context.store.read((reader) => dependencies.requireWork(reader, sprint.meta.id))
        : sprint;
      const metrics = await sprintMetricsResult(context, sprintForClose, args, reason, dependencies);
      const closeoutSummary = await dependencies.ensureAgentSummaryForClose(context, args, sprintForClose, reason);
      const closed = await context.runtime.closeWork({
        workId: sprint.meta.id,
        reason,
        agentSummary: closeoutSummary.created?.summary,
        agentSummaryIds: closeoutSummary.summaries.map((summary) => summary.meta.id)
      });
      const createdArtifact = closeoutSummary.created
        ? await dependencies.writeAgentSummaryArtifact(context, closeoutSummary.created.summary)
        : undefined;
      const result = {
        schemaVersion: "boreal.cli.sprint.close.v1",
        generatedAt: nowIso(),
        workspaceRoot: context.workspaceRoot,
        closed,
        metrics,
        autoReport,
        agentSummaries: closeoutSummary.summaries.map(dependencies.agentSummaryRow),
        createdAgentSummary: closeoutSummary.created ? dependencies.agentSummaryRow(closeoutSummary.created.summary) : undefined,
        createdAgentSummaryArtifact: createdArtifact
      };
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, dependencies.withCliResult(result, dependencies.workCliResult(closed)), json, { subjectWork: closed }));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown sprint command: ${action ?? ""}`);
  }
}

async function sprintLaunchResult(
  context: CliContext,
  args: ParsedArgs,
  container: WorkItem,
  dependencies: SprintCommandDependencies
) {
  const created = await context.runtime.createWork({
    title: requiredFlag(args, "title"),
    kind: "sprint",
    labels: dependencies.uniqueStrings(["sprint", ...dependencies.labelsFromArgs(args)]),
    acceptanceCriteria: flagValues(args, "acceptance"),
    parentId: container.meta.id,
    ready: hasFlag(args, "ready")
  });
  await context.runtime.addBlockingDependency({
    blockedWorkId: container.meta.id,
    blockingWorkId: created.meta.id
  });
  const branch = await attachSprintLaunchBranch(context, args, created, container);
  return {
    schemaVersion: "boreal.cli.sprint.launch.v1",
    generatedAt: nowIso(),
    workspaceRoot: context.workspaceRoot,
    container: dependencies.workListRow(container),
    sprint: branch.sprint,
    ...(branch.gitBranch ? { gitBranch: branch.gitBranch } : {})
  };
}

async function attachSprintLaunchBranch(
  context: CliContext,
  args: ParsedArgs,
  sprint: WorkItem,
  container: WorkItem
): Promise<{ readonly sprint: WorkItem; readonly gitBranch?: SprintLaunchGitBranch }> {
  if (hasFlag(args, "no-branch")) {
    return { sprint };
  }
  const root = await runGit(context.workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) {
    return {
      sprint,
      gitBranch: {
        status: "skipped",
        reason: isMissingGit(root) ? "git_unavailable" : "not_git_repository"
      }
    };
  }

  const baseBranch = await launchBaseBranchForWork(context, container);
  const baseExists = await runGit(context.workspaceRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${baseBranch}`]);
  if (!baseExists.ok) {
    return {
      sprint,
      gitBranch: {
        status: "skipped",
        reason: "base_branch_missing",
        baseBranch
      }
    };
  }

  const targetBranch = workBranchName(sprint);
  const targetExists = await runGit(context.workspaceRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${targetBranch}`]);
  const switched = targetExists.ok
    ? await runGit(context.workspaceRoot, ["switch", targetBranch])
    : await runGit(context.workspaceRoot, ["switch", "-c", targetBranch, baseBranch]);
  if (!switched.ok) {
    throw new BorealError("BOREAL_CONFLICT", "Unable to switch to sprint branch", {
      branch: targetBranch,
      baseBranch,
      stderr: switched.stderr.trim(),
      error: switched.error
    });
  }

  const head = await runGit(context.workspaceRoot, ["rev-parse", "HEAD"]);
  if (!head.ok || head.stdout.trim().length === 0) {
    return {
      sprint,
      gitBranch: {
        status: "skipped",
        reason: "head_unavailable",
        baseBranch
      }
    };
  }

  const updated = withContentHash({
    ...sprint,
    git: {
      branch: targetBranch,
      headSha: head.stdout.trim()
    }
  });
  await context.store.write((writer) => writer.putWorkItem(updated));
  return {
    sprint: updated,
    gitBranch: {
      status: "recorded",
      branch: targetBranch,
      headSha: head.stdout.trim(),
      baseBranch
    }
  };
}

async function launchBaseBranchForWork(context: CliContext, work: WorkItem): Promise<string> {
  if (work.git?.branch) {
    return work.git.branch;
  }
  const reservationBranch = await context.store.read(async (reader) => {
    const activeReservations = (await reader.listReservationsForWork(work.meta.id)).filter((reservation) => reservation.status === "active");
    return activeReservations.find((reservation) => reservation.git?.branch)?.git?.branch;
  });
  return reservationBranch ?? workBranchName(work);
}

async function sprintListResult(context: CliContext, args: ParsedArgs, dependencies: SprintCommandDependencies) {
  const generatedAt = nowIso();
  const limit = dependencies.parseLimit(flagValue(args, "limit"), { max: MAX_SPRINT_LIST_LIMIT }) ?? DEFAULT_SPRINT_LIST_LIMIT;
  return context.store.read(async (reader) => {
    const active = await activeSprintProjection(reader);
    const activeSprintId = activeSprintIdFromProjection(active);
    const allSprints = (await reader.listWorkItems())
      .filter((work) => work.kind === "sprint")
      .sort(compareSprintWork);
    const sprints = allSprints
      .slice(0, limit)
      .map((work): SprintListRow => ({
        ...dependencies.workListRow(work),
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

async function sprintShowResult(
  context: CliContext,
  sprint: WorkItem,
  limit: number,
  dependencies: SprintCommandDependencies
) {
  const generatedAt = nowIso();
  const active = await context.store.read((reader) => activeSprintProjection(reader));
  const scope = await buildSprintScope(context, sprint, limit, dependencies);
  return {
    schemaVersion: "boreal.cli.sprint.show.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    active: sprint.meta.id === activeSprintIdFromProjection(active),
    sprint: await context.runtime.getWorkView(sprint.meta.id),
    scope
  };
}

async function sprintCurrentResult(context: CliContext, dependencies: SprintCommandDependencies) {
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
    scope: await buildSprintScope(context, active.sprint, DEFAULT_SPRINT_SCOPE_LIMIT, dependencies)
  };
}

async function sprintBoardResult(
  context: CliContext,
  sprint: WorkItem,
  limit: number,
  dependencies: SprintCommandDependencies
) {
  const generatedAt = nowIso();
  const [active, scope, reservations, sprintView] = await Promise.all([
    context.store.read((reader) => activeSprintProjection(reader)),
    buildSprintScope(context, sprint, limit, dependencies),
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

async function sprintMetricsResult(
  context: CliContext,
  sprint: WorkItem,
  args: ParsedArgs,
  closeoutReason: string | undefined,
  dependencies: SprintCommandDependencies
) {
  const generatedAt = nowIso();
  const limit = sprintScopeLimit(args, dependencies);
  const capacity = dependencies.parseNonNegativeInteger(flagValue(args, "capacity"), "--capacity");
  const scope = await buildSprintScope(context, sprint, limit, dependencies);
  const descendantsById = new Map(scope.descendants.map((work) => [work.id, work]));
  const committedWork = await resolveSprintMetricWorkSet(context, flagValues(args, "commit"), scope.descendants, dependencies);
  const carryoverWork = await resolveSprintMetricWorkSet(
    context,
    flagValues(args, "carryover"),
    committedWork.filter((work) => isOpenWorkStatus(work.status)),
    dependencies
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
  }, dependencies);
  const committedOutOfScope = committedWork.filter((work) => !descendantsById.has(work.id));
  const carryoverOutOfScope = carryoverWork.filter((work) => !descendantsById.has(work.id));
  const readyForReport = open.length === 0 && Boolean(closeoutReason || sprint.closedReason || sprint.status === "closed");

  return {
    schemaVersion: "boreal.cli.sprint.metrics.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    sprint: dependencies.workListRow(sprint),
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
  fallback: readonly WorkItemView[],
  dependencies: SprintCommandDependencies
): Promise<readonly WorkItemView[]> {
  if (references.length === 0) {
    return fallback;
  }
  const rows: WorkItemView[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const workId = await dependencies.resolveWorkId(context, reference);
    if (seen.has(workId)) {
      continue;
    }
    rows.push(await context.runtime.getWorkView(workId));
    seen.add(workId);
  }
  return rows;
}

function sprintMetricRisks(
  input: {
    readonly explicitRisks: readonly string[];
    readonly capacity: number | undefined;
    readonly committedCount: number;
    readonly carryoverCount: number;
    readonly blockedCount: number;
  },
  dependencies: SprintCommandDependencies
): readonly string[] {
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
  return dependencies.normalizedNonEmptyStrings([...input.explicitRisks, ...generated]);
}

function metricWorkRow(work: WorkItemView): WorkListRow {
  return {
    id: work.id,
    kind: work.kind,
    status: work.status,
    priority: work.priority,
    title: work.title,
    labels: work.labels
  };
}

async function sprintCloseAutoReportResult(
  context: CliContext,
  sprint: WorkItem,
  args: ParsedArgs,
  dependencies: SprintCommandDependencies
): Promise<SprintCloseAutoReportResult> {
  const strict = hasFlag(args, "strict");
  const sync = await buildSyncRefreshResult(context);
  if (!sync.postRefreshStatusOk) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Sprint auto-report sync refresh did not finish healthy", {
      sprintId: sprint.meta.id,
      exitReason: sync.exitReason,
      recommendedActions: sync.status.recommendedActions,
      domain: "work"
    });
  }
  const syncEvidence = await context.runtime.recordEvidence({
    subjectId: sprint.meta.id,
    subjectType: "work",
    kind: "command",
    outcome: "passed",
    summary: "Sprint close auto-report sync refresh passed.",
    command: "bwrk sync refresh --json"
  });

  const doctor = await runDoctor(context, false, strict);
  if (!doctor.ok) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Sprint auto-report doctor gate did not pass", {
      sprintId: sprint.meta.id,
      strict,
      blockingDiagnosticCodes: doctor.blockingDiagnosticCodes,
      diagnostics: doctor.diagnostics
        .filter((diagnostic) => diagnostic.severity !== "ok")
        .map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
      domain: "work"
    });
  }
  const doctorEvidence = await context.runtime.recordEvidence({
    subjectId: sprint.meta.id,
    subjectType: "work",
    kind: "command",
    outcome: "passed",
    summary: `Sprint close auto-report doctor${strict ? " strict" : ""} passed.`,
    command: strict ? "bwrk doctor --strict --json" : "bwrk doctor --json"
  });
  const verification = await context.runtime.verifyWork({
    workId: sprint.meta.id,
    verdict: "passed",
    evidenceIds: [syncEvidence.meta.id, doctorEvidence.meta.id],
    notes: "Sprint auto-report verified sync and doctor closeout evidence."
  });
  const reportFormat = parseSprintReportFormat(flagValue(args, "report-format"));
  const report = await sprintReportResultFromEvidence(context, sprint, args, {
    doctorEvidenceId: doctorEvidence.meta.id,
    syncEvidenceId: syncEvidence.meta.id,
    out: flagValue(args, "report-out") ?? defaultSprintCloseoutReportPath(sprint.meta.id, reportFormat),
    format: reportFormat
  }, dependencies);

  return {
    sync: {
      ok: sync.refreshOk,
      postRefreshStatusOk: sync.postRefreshStatusOk,
      evidence: evidenceRow(syncEvidence)
    },
    doctor: {
      ok: doctor.ok,
      strict,
      blockingDiagnosticCodes: doctor.blockingDiagnosticCodes,
      evidence: evidenceRow(doctorEvidence)
    },
    verification: {
      id: verification.meta.id,
      verdict: verification.verdict
    },
    report: {
      schemaVersion: report.schemaVersion,
      format: report.format,
      path: report.path,
      contentHash: report.contentHash,
      sizeBytes: report.sizeBytes,
      summary: report.report.summary,
      closeoutEvidence: report.report.closeoutEvidence
    }
  };
}

function defaultSprintCloseoutReportPath(sprintId: WorkId, format: SprintReportFormat): string {
  return `.boreal/results/sprint-closeout-${sprintId}.${format === "html" ? "html" : "md"}`;
}

async function sprintReportResult(
  context: CliContext,
  sprint: WorkItem,
  args: ParsedArgs,
  dependencies: SprintCommandDependencies
): Promise<SprintReportResult> {
  const doctorEvidenceId = asEvidenceId(requiredFlag(args, "doctor-evidence"));
  const syncEvidenceId = asEvidenceId(requiredFlag(args, "sync-evidence"));
  return sprintReportResultFromEvidence(context, sprint, args, {
    doctorEvidenceId,
    syncEvidenceId,
    format: parseSprintReportFormat(flagValue(args, "format")),
    out: flagValue(args, "out")
  }, dependencies);
}

async function sprintReportResultFromEvidence(
  context: CliContext,
  sprint: WorkItem,
  args: ParsedArgs,
  input: {
    readonly doctorEvidenceId: EvidenceId;
    readonly syncEvidenceId: EvidenceId;
    readonly format: SprintReportFormat;
    readonly out?: string;
  },
  dependencies: SprintCommandDependencies
): Promise<SprintReportResult> {
  const limit = sprintScopeLimit(args, dependencies);
  const { doctorEvidenceId, syncEvidenceId, format } = input;
  if (doctorEvidenceId === syncEvidenceId) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Sprint report requires distinct doctor and sync evidence records");
  }

  const document = await buildSprintReportDocument(context, sprint, {
    format,
    limit,
    doctorEvidenceId,
    syncEvidenceId
  }, dependencies);
  const content = renderSprintReportContent(document, dependencies);
  const contentHash = String(hashContent({ format, content }));
  const out = input.out;
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
  },
  dependencies: SprintCommandDependencies
): Promise<SprintReportDocument> {
  const generatedAt = nowIso();
  const [active, scope, sprintView, snapshot] = await Promise.all([
    context.store.read((reader) => activeSprintProjection(reader)),
    buildSprintScope(context, sprint, input.limit, dependencies),
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
    .sort(compareReportWorkRows(dependencies));
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
    .sort(compareReportWorkRows(dependencies));
  const scopedGateStatuses = snapshot.workItems
    .filter((work) => scopedWorkIds.has(work.meta.id))
    .map((work) => dependencies.closeoutGateStatusFromSnapshot(
      work,
      snapshot.workItems,
      snapshot.graphEdges,
      snapshot.evidence,
      snapshot.verifications,
      snapshot.agentSummaries
    ));
  const reviewGates = dependencies.reviewGateSummaryFromStatuses(scopedGateStatuses);
  const reviewGateDetails = dependencies.reviewGateDetailRowsFromStatuses(scopedGateStatuses);

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
    throw new BorealError("BOREAL_NOT_FOUND", `Sprint report ${requiredKind} evidence was not found`, {
      evidenceId,
      domain: "evidence"
    });
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

function isOpenWorkStatus(status: WorkItemView["status"]): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "verified";
}

function compareEvidenceRows(left: SprintReportEvidenceRow, right: SprintReportEvidenceRow): number {
  return right.observedAt.localeCompare(left.observedAt) || left.summary.localeCompare(right.summary) || left.id.localeCompare(right.id);
}

function compareAgentSummaryRows(left: SprintReportAgentSummaryRow, right: SprintReportAgentSummaryRow): number {
  return right.generatedAt.localeCompare(left.generatedAt) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function compareReportWorkRows(dependencies: SprintCommandDependencies) {
  return (left: SprintReportWorkRow, right: SprintReportWorkRow): number => {
    const priority = dependencies.priorityRank(right.priority) - dependencies.priorityRank(left.priority);
    return priority || left.status.localeCompare(right.status) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  };
}

function isCompletedReportStatus(status: WorkStatus): boolean {
  return status === "closed" || status === "verified";
}

function isOpenReportStatus(status: WorkStatus): boolean {
  return status !== "closed" && status !== "verified" && status !== "cancelled";
}

function renderSprintReportContent(document: SprintReportDocument, dependencies: SprintCommandDependencies): string {
  return document.format === "html" ? renderSprintReportHtml(document) : renderSprintReportMarkdown(document, dependencies);
}

function renderSprintReportMarkdown(document: SprintReportDocument, dependencies: SprintCommandDependencies): string {
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
    dependencies.formatReviewGateDetailsMarkdown(document.reviewGateDetails),
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

async function activateSprint(
  context: CliContext,
  sprintReference: string,
  dependencies: SprintCommandDependencies
) {
  const sprint = await resolveSprintWork(context, sprintReference, dependencies);
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
      } satisfies RuntimeEvent["payload"]
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

async function resolveSprintWork(
  context: CliContext,
  value: string,
  dependencies: SprintCommandDependencies
): Promise<WorkItem> {
  const workId = value === "current"
    ? await context.store.read(async (reader) => {
        const projection = await activeSprintProjection(reader);
        const sprintId = activeSprintIdFromProjection(projection);
        if (!sprintId) {
          throw new BorealError("BOREAL_NOT_FOUND", "No active sprint is selected", { domain: "work" });
        }
        return sprintId;
      })
    : await dependencies.resolveWorkId(context, value);
  const work = await context.store.read((reader) => reader.getWorkItem(workId));
  if (!work) {
    throw new BorealError("BOREAL_NOT_FOUND", "Sprint not found", { sprintId: workId, domain: "work" });
  }
  if (work.kind !== "sprint") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Sprint reference must resolve to work with kind sprint", {
      workId: work.meta.id,
      kind: work.kind
    });
  }
  return work;
}

async function buildSprintScope(
  context: CliContext,
  sprint: WorkItem,
  limit: number,
  dependencies: SprintCommandDependencies
): Promise<SprintScope> {
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
      .sort(dependencies.compareWorkViews);
    return {
      directChildren,
      descendants: limitedDescendants
        .map((work) => sprintWorkView(work, workById, graphEdges, evidenceByWork, verificationsByWork))
        .sort(dependencies.compareWorkViews),
      totalDescendants: descendants.length,
      truncated: descendants.length > limitedDescendants.length
    };
  });
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
  const legacyProjection = (await reader.listProjections()).find(
    (projection) => projection.kind === ACTIVE_SPRINT_PROJECTION_KIND && projection.subjectId === "workspace"
  );
  if (legacyProjection) {
    return legacyProjection;
  }
  return activeSprintProjectionFromEvents(await reader.listEvents());
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

function activeSprintProjectionFromEvents(events: readonly RuntimeEvent[]): ProjectionRecord | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "sprint.activated" || event.subjectType !== "sprint") {
      continue;
    }
    const payload = event.payload;
    if (!isRecord(payload)) {
      continue;
    }
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : event.subjectId;
    if (!sprintId.startsWith("bw_work_")) {
      continue;
    }
    return withContentHash({
      meta: {
        id: ACTIVE_SPRINT_PROJECTION_ID,
        schemaVersion: event.meta.schemaVersion,
        createdAt: event.meta.createdAt,
        updatedAt: event.meta.updatedAt,
        createdBy: event.meta.createdBy,
        updatedBy: event.meta.updatedBy,
        sourceRefs: event.meta.sourceRefs,
        tags: event.meta.tags
      },
      kind: ACTIVE_SPRINT_PROJECTION_KIND,
      subjectId: "workspace",
      value: {
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : undefined,
        sprintId,
        activatedAt: event.meta.createdAt,
        activatedBy: String(event.meta.createdBy.id),
        previousSprintId: typeof payload.previousSprintId === "string" ? payload.previousSprintId : undefined,
        eventId: event.meta.id
      }
    } satisfies ProjectionRecord);
  }
  return undefined;
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

const SPRINT_SCOPE_TABLE_COLUMNS: readonly BoundedTableColumn[] = [
  { key: "status", header: "status" },
  { key: "kind", header: "kind" },
  { key: "title", header: "title", flex: true },
  { key: "owner", header: "owner" }
];

function sprintScopeTableRows(descendants: readonly WorkItemView[]): readonly Record<string, string>[] {
  return descendants.map((work) => ({
    status: work.status,
    kind: work.kind,
    title: work.title,
    owner: work.activeReservation?.agentId ?? "-"
  }));
}

function formatSprintShow(result: Awaited<ReturnType<typeof sprintShowResult>>, wide: boolean): string {
  const header = [
    `Sprint: ${result.sprint.title} (${result.sprint.id})`,
    `Status: ${result.sprint.status}`,
    `Active: ${result.active ? "yes" : "no"}`,
    `Scope: ${result.scope.totalDescendants}${result.scope.truncated ? " (truncated)" : ""}`
  ].join("\n");
  if (result.scope.descendants.length === 0) {
    return `${header}\nNo work in scope.\n`;
  }
  return `${header}\n\n${boundedTable(sprintScopeTableRows(result.scope.descendants), SPRINT_SCOPE_TABLE_COLUMNS, { wide })}`;
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

const SPRINT_BOARD_ITEM_COLUMNS: readonly BoundedTableColumn[] = [
  { key: "status", header: "status" },
  { key: "title", header: "title", flex: true },
  { key: "priority", header: "priority" },
  { key: "owner", header: "owner" }
];

function formatSprintBoard(result: Awaited<ReturnType<typeof sprintBoardResult>>, wide: boolean): string {
  const lines = [
    `Sprint board: ${result.board.sprint.title} (${result.board.sprint.id})`,
    `Scope: ${result.scope.totalDescendants}${result.scope.truncated ? ` (truncated to ${result.scope.limit})` : ""}`,
    ""
  ];
  const nonEmptyLanes = result.board.lanes.filter((lane) => lane.count > 0);
  if (nonEmptyLanes.length === 0) {
    lines.push("No work in scope.", "");
  } else {
    for (const lane of nonEmptyLanes) {
      lines.push(`${lane.title} (${lane.count})`);
      lines.push(
        boundedTable(
          lane.items.map((item) => ({
            status: item.status,
            title: item.title,
            priority: item.priority,
            owner: item.activeReservation?.agentId ?? "-"
          })),
          SPRINT_BOARD_ITEM_COLUMNS,
          { wide }
        ).trimEnd()
      );
      lines.push("");
    }
  }
  const summary = result.board.summary;
  lines.push(
    `Total ${summary.total} · ready ${summary.ready} · in_progress ${summary.inProgress} · blocked ${summary.blocked} · needs_verification ${summary.needsVerification} · verified ${summary.verified} · closed ${summary.closed}`
  );
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

function sprintScopeLimit(args: ParsedArgs, dependencies: SprintCommandDependencies): number {
  return dependencies.parseLimit(flagValue(args, "limit"), { max: MAX_SPRINT_SCOPE_LIMIT }) ?? DEFAULT_SPRINT_SCOPE_LIMIT;
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
