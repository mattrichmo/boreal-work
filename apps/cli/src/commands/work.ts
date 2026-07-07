import {
  BorealError,
  nowIso,
  type AgentReservation,
  type AgentSummaryOutcome,
  type AgentSummaryRecord,
  type EvidenceRecord,
  type IsoTimestamp,
  type ReservationId,
  type SourceRef,
  type VerificationVerdict,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import type { BorealReader } from "@boreal/storage";
import {
  buildRepoRollupView,
  type RepoRollupSummary,
  type RollupNodeKind,
  type RollupNodeView,
  type WorkItemView,
  type WorkReservationView
} from "@boreal/ui-model";
import type { RequiredCloseoutGateInput } from "@boreal/work-engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import { boundedTable, type BoundedTableColumn } from "../cli-ui.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

type WorkCommandGroup = "work" | "dep" | "reservation";

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
  readonly lineage?: readonly unknown[];
  readonly agentId?: string;
  readonly showCommand?: string;
  readonly agentStartCommand?: string;
  readonly workClaimCommand?: string;
}

interface CloseoutAgentSummaryResult {
  readonly summaries: readonly AgentSummaryRecord[];
  readonly created?: {
    readonly summary: AgentSummaryRecord;
  };
}

interface CliMutationResultInput {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly subjectId: string;
  readonly schemaVersion?: string;
}

type RuntimeClaimResult = Awaited<ReturnType<CliContext["runtime"]["claimNextWork"]>>;
type ClaimedWorkResult = NonNullable<RuntimeClaimResult>;
type RuntimeVerification = Awaited<ReturnType<CliContext["runtime"]["verifyWork"]>>;
type WorkMutationResult = { readonly work: WorkItem } & Record<string, unknown>;

export interface WorkCommandDependencies {
  readonly defaultListLimit: number;
  readonly defaultReadyWorkLimit: number;
  readonly dependencyTypeFromArgs: (args: ParsedArgs) => string;
  readonly optionalAgentIdFromArgs: (args: ParsedArgs) => string | undefined;
  readonly agentIdFromArgs: (args: ParsedArgs, fallback: string) => string;
  readonly resolveWorkId: (context: CliContext, value: string, options?: { readonly agentId?: string }) => Promise<WorkId>;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly parseReservationStatus: (value: string | undefined) => string | undefined;
  readonly parseLimit: (value: string | undefined, options?: { readonly max?: number }) => number | undefined;
  readonly parseNonNegativeInteger: (value: string | undefined, label: string) => number | undefined;
  readonly parseWorkKind: (value: string | undefined) => WorkKind | undefined;
  readonly parsePriority: (value: string | undefined) => WorkPriority | undefined;
  readonly listStatus: (args: ParsedArgs) => WorkStatus | undefined;
  readonly labelsFromArgs: (args: ParsedArgs) => readonly string[];
  readonly requiredCloseoutGateInputsFromArgs: (args: ParsedArgs) => readonly RequiredCloseoutGateInput[];
  readonly sourceRefsFromArgs: (args: ParsedArgs) => readonly SourceRef[];
  readonly optionalContainerIdFromArgs: (context: CliContext, args: ParsedArgs) => Promise<WorkId | undefined>;
  readonly containerScopeIds: (context: CliContext, containerId: WorkId) => Promise<ReadonlySet<WorkId>>;
  readonly heartbeatScopeIds: (containerId: WorkId, workItems: readonly WorkItem[], graphEdges: readonly unknown[]) => ReadonlySet<WorkId>;
  readonly workLineageById: (workItems: readonly WorkItem[], graphEdges: readonly unknown[]) => ReadonlyMap<WorkId, readonly unknown[]>;
  readonly workLineageByIdFromStore: (context: CliContext) => Promise<ReadonlyMap<WorkId, readonly unknown[]>>;
  readonly claimableWorkItems: (
    workItems: readonly WorkItem[],
    labels: readonly string[],
    graphEdges: readonly unknown[]
  ) => readonly WorkItem[];
  readonly workListRow: (work: WorkItem, containerId?: WorkId, lineage?: readonly unknown[]) => WorkListRow;
  readonly textWorkListRow: (row: WorkListRow) => Record<string, string>;
  readonly recentClosedWorkCommand: (context: CliContext, args: ParsedArgs) => Promise<{ readonly items: readonly unknown[] }>;
  readonly reviewCandidatesCommand: (context: CliContext, args: ParsedArgs) => Promise<{ readonly items: readonly unknown[] }>;
  readonly textRecentClosedWorkRow: (row: unknown) => Record<string, string | number | undefined>;
  readonly textReviewCandidateRow: (row: unknown) => Record<string, string | number | undefined>;
  readonly asWorkId: (value: string) => WorkId;
  readonly compareWorkViews: (left: WorkItemView, right: WorkItemView) => number;
  readonly readyWorkCommandRow: (
    view: WorkItemView,
    input: {
      readonly containerId?: WorkId;
      readonly lineage: readonly unknown[];
      readonly labels: readonly string[];
      readonly agentId: string;
      readonly purpose?: string;
      readonly sessionId?: string;
    }
  ) => WorkListRow;
  readonly dashboardView: (args: ParsedArgs) => boolean;
  readonly formatReadyWorkDashboard: (rows: readonly WorkListRow[], containerId?: WorkId) => string;
  readonly buildWorkParallelResult: (input: {
    readonly context: CliContext;
    readonly args: ParsedArgs;
    readonly labels: readonly string[];
    readonly containerId?: WorkId;
    readonly limit: number;
    readonly views: readonly WorkItemView[];
    readonly lineageById: ReadonlyMap<WorkId, readonly unknown[]>;
  }) => unknown;
  readonly formatWorkParallelResult: (result: unknown) => string;
  readonly workFreshnessSince: (
    context: CliContext,
    workId: WorkId,
    since: number
  ) => Promise<{ readonly unchanged: boolean; readonly ledgerSeq: number; readonly latestTouchSeq: number }>;
  readonly closeoutGateStatusForWork: (context: CliContext, workId: WorkId) => Promise<{ readonly gaps: readonly unknown[] }>;
  readonly resolveBorealSourceRefs: (context: CliContext, args: ParsedArgs, view: WorkItemView) => Promise<WorkItemView>;
  readonly requireWork: (reader: BorealReader, workId: WorkId) => Promise<WorkItem>;
  readonly parseReservationExpiresAt: (args: ParsedArgs) => IsoTimestamp | undefined;
  readonly requiredReservationExpiresAt: (args: ParsedArgs) => IsoTimestamp;
  readonly requireReservation: (context: CliContext, reservationId: ReservationId) => Promise<unknown>;
  readonly agentStartCommand: (
    rest: readonly string[],
    context: CliContext,
    args: ParsedArgs,
    output: CliOutput,
    json: boolean
  ) => Promise<CommandResult>;
  readonly parseHandoffResultLimit: (args: ParsedArgs) => number;
  readonly claimExactWork: (
    context: CliContext,
    input: {
      readonly workId: WorkId;
      readonly agentId: string;
      readonly labels: readonly string[];
      readonly containerId?: WorkId;
      readonly purpose?: string;
      readonly expiresAt?: IsoTimestamp;
    }
  ) => Promise<RuntimeClaimResult>;
  readonly attachGitBranchForClaim: (
    context: CliContext,
    args: ParsedArgs,
    claim: ClaimedWorkResult
  ) => Promise<{ readonly reservation: unknown; readonly gitBranch?: unknown }>;
  readonly buildHandoffResult: (
    context: CliContext,
    workId: WorkId,
    args: ParsedArgs,
    limit: number,
    work: WorkItem
  ) => Promise<object & { readonly work?: unknown }>;
  readonly idempotentWorkReleaseResult: (context: CliContext, workId: WorkId) => Promise<unknown | undefined>;
  readonly asEvidenceId: (value: string) => EvidenceRecord["meta"]["id"];
  readonly parseVerdict: (value: string | undefined) => VerificationVerdict;
  readonly withCliResult: <T extends object>(value: T, result: CliMutationResultInput) => T & { readonly result: unknown };
  readonly verificationCliResult: (verification: RuntimeVerification) => CliMutationResultInput;
  readonly workCliResult: (work: WorkItem | WorkItemView) => CliMutationResultInput;
  readonly activeNonExpiredReservationsForWork: (
    reader: BorealReader,
    workId: WorkId,
    current: IsoTimestamp
  ) => Promise<readonly AgentReservation[]>;
  readonly shellArg: (value: string) => string;
  readonly assertLeafEvidenceGateForClose: (work: WorkItem, args: ParsedArgs) => void;
  readonly ensureAgentSummaryForClose: (
    context: CliContext,
    args: ParsedArgs,
    work: WorkItem,
    closeReason: string,
    options?: { readonly outcome?: AgentSummaryOutcome }
  ) => Promise<CloseoutAgentSummaryResult>;
  readonly writeAgentSummaryArtifact: (context: CliContext, summary: AgentSummaryRecord) => Promise<unknown>;
  readonly agentSummaryRow: (summary: AgentSummaryRecord) => unknown;
  readonly editWorkCommand: (context: CliContext, workId: WorkId, args: ParsedArgs) => Promise<Record<string, unknown>>;
  readonly cancelWorkCommand: (
    context: CliContext,
    workId: WorkId,
    reason: string,
    agentSummary?: AgentSummaryRecord
  ) => Promise<Record<string, unknown>>;
  readonly reopenWorkCommand: (context: CliContext, workId: WorkId, args: ParsedArgs) => Promise<WorkMutationResult>;
  readonly normalizedNonEmptyStrings: (values: readonly string[]) => readonly string[];
  readonly uniqueStrings: (values: readonly string[]) => readonly string[];
  readonly reservationListRow: (reservation: unknown, work: unknown, now: number) => Record<string, unknown>;
  readonly compareReservationRows: (left: Record<string, unknown>, right: Record<string, unknown>) => number;
  readonly textReservationListRow: (row: Record<string, unknown>) => Record<string, string | number>;
  readonly dependencyTreeForWork: (workId: WorkId, workItems: readonly unknown[], graphEdges: readonly unknown[]) => unknown;
  readonly formatRecordWithAgentDirectives: (
    context: CliContext,
    args: ParsedArgs,
    value: unknown,
    json: boolean,
    options?: { readonly subjectWorkId?: WorkId }
      | { readonly subjectWork?: WorkItem }
  ) => Promise<string>;
  readonly dependencyTreeRows: (tree: unknown) => readonly Record<string, string | number | undefined>[];
  readonly dependencyCyclesFromGraph: (graphEdges: readonly unknown[]) => readonly { readonly cycle: readonly string[] }[];
}

export async function workCommand(
  group: WorkCommandGroup,
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "work":
      return mainWorkCommand(action, rest, context, args, output, json, dependencies);
    case "dep":
      return depCommand(action, rest, context, args, output, json, dependencies);
    case "reservation":
      return reservationCommand(action, context, args, output, json, dependencies);
  }
}

async function mainWorkCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkCommandDependencies
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
        kind: dependencies.parseWorkKind(flagValue(args, "kind")),
        priority: dependencies.parsePriority(flagValue(args, "priority")),
        acceptanceCriteria: flagValues(args, "acceptance"),
        labels: dependencies.labelsFromArgs(args),
        requiredCloseoutGates: dependencies.requiredCloseoutGateInputsFromArgs(args),
        sourceRefs: dependencies.sourceRefsFromArgs(args),
        ready: hasFlag(args, "ready")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "ready": {
      const work = await context.runtime.markReady(await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference")));
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "list": {
      const readyOnly = hasFlag(args, "ready");
      const status = readyOnly ? undefined : dependencies.listStatus(args);
      if (readyOnly) {
        dependencies.listStatus(args);
      }
      const labels = dependencies.labelsFromArgs(args);
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const containerId = await dependencies.optionalContainerIdFromArgs(context, args);
      // Human rendering defaults to open-only work, sorted for readability; JSON keeps the
      // legacy filter/order/limit contract (closed included by default, storage order) so
      // agent scripts relying on `work list --json` don't see a behavior change.
      const includeClosedInHuman = hasFlag(args, "all") || hasFlag(args, "closed");
      const { rows, humanRows } = await context.store.read(async (reader) => {
        const [workItems, graphEdges] = await Promise.all([reader.listWorkItems(), reader.listGraphEdges()]);
        const scopedIds = containerId ? dependencies.heartbeatScopeIds(containerId, workItems, graphEdges) : undefined;
        const lineageById = dependencies.workLineageById(workItems, graphEdges);
        const claimableIds = readyOnly
          ? new Set(dependencies.claimableWorkItems(workItems, labels, graphEdges).map((work) => work.meta.id))
          : undefined;
        const filtered = workItems
          .filter((work) => (claimableIds ? claimableIds.has(work.meta.id) : !status || work.status === status))
          .filter((work) => claimableIds || labels.every((label) => work.labels.includes(label)))
          .filter((work) => !scopedIds || scopedIds.has(work.meta.id));
        const toRow = (work: WorkItem) => dependencies.workListRow(work, containerId, lineageById.get(work.meta.id) ?? []);
        const jsonRows = filtered.slice(0, limit).map(toRow);
        const humanRows = (includeClosedInHuman ? filtered : filtered.filter((work) => isOpenWorkStatusForHumanList(work.status)))
          .slice()
          .sort(compareWorkListHumanOrder)
          .slice(0, limit)
          .map(toRow);
        return { rows: jsonRows, humanRows };
      });
      output.write(json ? formatRecord(rows, true) : formatWorkListHuman(humanRows, hasFlag(args, "wide"), includeClosedInHuman));
      return { exitCode: 0 };
    }
    case "rollup": {
      const result = await workRollupResult(context, rest[0], args, dependencies);
      output.write(json ? formatRecord(result, true) : formatWorkRollup(result, hasFlag(args, "wide")));
      return { exitCode: 0 };
    }
    case "recent-closed": {
      const result = await dependencies.recentClosedWorkCommand(context, args);
      output.write(json ? formatRecord(result, true) : table(result.items.map(dependencies.textRecentClosedWorkRow)));
      return { exitCode: 0 };
    }
    case "review-candidates": {
      const result = await dependencies.reviewCandidatesCommand(context, args);
      output.write(json ? formatRecord(result, true) : table(result.items.map(dependencies.textReviewCandidateRow)));
      return { exitCode: 0 };
    }
    case "next": {
      const labels = dependencies.labelsFromArgs(args);
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultReadyWorkLimit;
      const containerId = await dependencies.optionalContainerIdFromArgs(context, args);
      const scopedIds = containerId ? await dependencies.containerScopeIds(context, containerId) : undefined;
      const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
      const purpose = flagValue(args, "purpose");
      const explicitSessionId = flagValue(args, "session");
      const views = await context.runtime.listReadyWork();
      const lineageById = await dependencies.workLineageByIdFromStore(context);
      const rows = views
        .filter((view) => labels.every((label) => view.labels.includes(label)))
        .filter((view) => !scopedIds || scopedIds.has(view.id as WorkId))
        .sort(dependencies.compareWorkViews)
        .slice(0, limit)
        .map((view) =>
          dependencies.readyWorkCommandRow(view, {
            containerId,
            lineage: lineageById.get(dependencies.asWorkId(view.id)) ?? [],
            labels,
            agentId,
            purpose,
            sessionId: explicitSessionId
          })
        );
      output.write(json ? formatRecord(rows, true) : dependencies.dashboardView(args) ? dependencies.formatReadyWorkDashboard(rows, containerId) : table(rows.map(dependencies.textWorkListRow)));
      return { exitCode: 0 };
    }
    case "parallel": {
      const labels = dependencies.labelsFromArgs(args);
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultReadyWorkLimit;
      const containerId = await dependencies.optionalContainerIdFromArgs(context, args);
      const scopedIds = containerId ? await dependencies.containerScopeIds(context, containerId) : undefined;
      const views = (await context.runtime.listReadyWork())
        .filter((view) => labels.every((label) => view.labels.includes(label)))
        .filter((view) => !scopedIds || scopedIds.has(view.id as WorkId))
        .sort(dependencies.compareWorkViews)
        .slice(0, limit);
      const result = dependencies.buildWorkParallelResult({ context, args, labels, containerId, limit, views, lineageById: await dependencies.workLineageByIdFromStore(context) });
      output.write(json ? formatRecord(result, true) : dependencies.formatWorkParallelResult(result));
      return { exitCode: 0 };
    }
    case "show": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const since = dependencies.parseNonNegativeInteger(flagValue(args, "since"), "--since");
      if (since !== undefined) {
        const freshness = await dependencies.workFreshnessSince(context, workId, since);
        if (freshness.unchanged) {
          output.write(formatRecord({ id: workId, unchanged: true, seq: freshness.ledgerSeq, ledgerSeq: freshness.ledgerSeq }, json));
          return { exitCode: 0 };
        }
      }
      const view = await dependencies.resolveBorealSourceRefs(context, args, await context.runtime.getWorkView(workId));
      const reservation = view.activeReservationId ? await context.store.read((reader) => reader.getReservation(view.activeReservationId as ReservationId)) : undefined;
      const viewWithGaps = json
        ? { ...view, ...(reservation ? { reservation } : {}), gaps: (await dependencies.closeoutGateStatusForWork(context, workId)).gaps }
        : view;
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, viewWithGaps, json, { subjectWorkId: workId }));
      return { exitCode: 0 };
    }
    case "block": {
      const blockedWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "blocked work reference"));
      const blockingWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "blocking work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "reserve": {
      const work = await context.runtime.reserveWork({
        workId: await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference")),
        agentId: dependencies.agentIdFromArgs(args, context.actor.id),
        purpose: flagValue(args, "purpose"),
        expiresAt: dependencies.parseReservationExpiresAt(args),
        force: hasFlag(args, "force"),
        forceReason: flagValue(args, "reason")
      });
      const reservation = work.reservationId ? await dependencies.requireReservation(context, work.reservationId) : undefined;
      const postMutationWork = await context.runtime.getWorkView(work.meta.id);
      output.write(formatRecord(json && reservation ? { ...work, reservation, releasedReservations: [], postMutationWork } : work, json));
      return { exitCode: 0 };
    }
    case "claim": {
      if (rest.length > 1) {
        throw new BorealError("BOREAL_INVALID_INPUT", "work claim accepts at most one work reference");
      }
      if (hasFlag(args, "worktree") && hasFlag(args, "no-branch")) {
        throw new BorealError("BOREAL_INVALID_INPUT", "--worktree cannot be combined with --no-branch");
      }
      if (hasFlag(args, "start")) {
        return dependencies.agentStartCommand(rest, context, args, output, json);
      }
      const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
      const labels = dependencies.labelsFromArgs(args);
      const containerId = await dependencies.optionalContainerIdFromArgs(context, args);
      const workId = rest[0] ? await dependencies.resolveWorkId(context, rest[0], { agentId }) : undefined;
      const handoffResultLimit = dependencies.parseHandoffResultLimit(args);
      const claim = workId
        ? await dependencies.claimExactWork(context, {
            workId,
            agentId,
            labels,
            containerId,
            purpose: flagValue(args, "purpose"),
            expiresAt: dependencies.parseReservationExpiresAt(args)
          })
        : await context.runtime.claimNextWork({
            agentId,
            labels,
            containerId,
            purpose: flagValue(args, "purpose"),
            expiresAt: dependencies.parseReservationExpiresAt(args)
          });
      if (!claim) {
        output.write(
          formatRecord(
            {
              claimed: false,
              reason: "no_ready_work",
              agentId,
              labels,
              containerId
            },
            json
          )
        );
        return { exitCode: 0 };
      }

      const branchResult = await dependencies.attachGitBranchForClaim(context, args, claim);
      const handoff = await dependencies.buildHandoffResult(context, claim.work.meta.id, args, handoffResultLimit, claim.work);
      const { work: handoffWork, ...handoffRest } = handoff;
      const result = {
        claimed: true,
        work: handoffWork,
        reservation: branchResult.reservation,
        releasedReservations: claim.releasedReservations,
        ...(branchResult.gitBranch ? { gitBranch: branchResult.gitBranch } : {}),
        postMutationWork: handoffWork,
        ...handoffRest
      };
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, { subjectWork: claim.work }));
      return { exitCode: 0 };
    }
    case "release": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const noop = await dependencies.idempotentWorkReleaseResult(context, workId);
      if (noop) {
        output.write(formatRecord(noop, json));
        return { exitCode: 0 };
      }
      const result = await context.runtime.releaseWorkReservation(
        workId
      );
      const postMutationWork = await context.runtime.getWorkView(result.work.meta.id);
      output.write(formatRecord({ ...result, postMutationWork }, json));
      return { exitCode: 0 };
    }
    case "renew": {
      const result = await context.runtime.renewWorkReservation({
        workId: await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference")),
        expiresAt: dependencies.requiredReservationExpiresAt(args)
      });
      const postMutationWork = await context.runtime.getWorkView(result.work.meta.id);
      output.write(formatRecord({ ...result, postMutationWork }, json));
      return { exitCode: 0 };
    }
    case "verify": {
      const evidenceIds = flagValues(args, "evidence").map(dependencies.asEvidenceId);
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const verification = await context.runtime.verifyWork({
        workId,
        verdict: dependencies.parseVerdict(flagValue(args, "verdict")),
        evidenceIds,
        notes: flagValue(args, "notes")
      });
      const result = dependencies.withCliResult(
        { ...verification, closeoutGateStatus: await dependencies.closeoutGateStatusForWork(context, workId) },
        dependencies.verificationCliResult(verification)
      );
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, { subjectWorkId: workId }));
      return { exitCode: 0 };
    }
    case "close": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const reason = requiredFlag(args, "reason");
      const work = await context.store.read((reader) => dependencies.requireWork(reader, workId));
      const activeReservations = await context.store.read((reader) => dependencies.activeNonExpiredReservationsForWork(reader, workId, nowIso()));
      if (activeReservations.length > 0) {
        throw new BorealError("BOREAL_POLICY_VIOLATION", "Reserved work cannot be closed directly; use `bwrk agent finish`", {
          workId,
          reservationIds: activeReservations.map((reservation) => reservation.meta.id),
          remedialCommand: `bwrk agent finish ${workId} --agent ${activeReservations[0]?.agentId ?? context.actor.id} --summary '<evidence summary>' --close --reason ${dependencies.shellArg(reason)} --json`,
          domain: "work"
        });
      }
      dependencies.assertLeafEvidenceGateForClose(work, args);
      const closeoutSummary = await dependencies.ensureAgentSummaryForClose(context, args, work, reason);
      const closed = await context.runtime.closeWork({
        workId,
        reason,
        agentSummary: closeoutSummary.created?.summary,
        agentSummaryIds: closeoutSummary.summaries.map((summary) => summary.meta.id)
      });
      const createdArtifact = closeoutSummary.created
        ? await dependencies.writeAgentSummaryArtifact(context, closeoutSummary.created.summary)
        : undefined;
      const result = {
        schemaVersion: "boreal.cli.work.close.v1",
        generatedAt: nowIso(),
        workspaceRoot: context.workspaceRoot,
        work: closed,
        agentSummaries: closeoutSummary.summaries.map(dependencies.agentSummaryRow),
        createdAgentSummary: closeoutSummary.created ? dependencies.agentSummaryRow(closeoutSummary.created.summary) : undefined,
        createdAgentSummaryArtifact: createdArtifact
      };
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, dependencies.withCliResult(result, dependencies.workCliResult(closed)), json, { subjectWork: closed }));
      return { exitCode: 0 };
    }
    case "edit": {
      const result = await dependencies.editWorkCommand(context, await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference")), args);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "cancel": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const reason = requiredFlag(args, "reason");
      const work = await context.store.read((reader) => dependencies.requireWork(reader, workId));
      if (work.status === "closed" || work.status === "cancelled") {
        throw new BorealError("BOREAL_INVALID_INPUT", "Only open work can be cancelled", {
          workId,
          status: work.status
        });
      }
      const activeReservations = await context.store.read((reader) => dependencies.activeNonExpiredReservationsForWork(reader, workId, nowIso()));
      if (activeReservations.length > 0) {
        throw new BorealError("BOREAL_POLICY_VIOLATION", "Cannot cancel work with an active non-expired reservation", {
          workId,
          reservationIds: activeReservations.map((reservation) => reservation.meta.id),
          domain: "work"
        });
      }
      const closeoutSummary = await dependencies.ensureAgentSummaryForClose(context, args, work, reason, {
        outcome: "cancelled"
      });
      const result = await dependencies.cancelWorkCommand(
        context,
        workId,
        reason,
        closeoutSummary.created?.summary
      );
      const createdArtifact = closeoutSummary.created
        ? await dependencies.writeAgentSummaryArtifact(context, closeoutSummary.created.summary)
        : undefined;
      const outputResult = {
        schemaVersion: "boreal.cli.work.cancel.v1",
        generatedAt: nowIso(),
        workspaceRoot: context.workspaceRoot,
        ...result,
        agentSummaries: closeoutSummary.summaries.map(dependencies.agentSummaryRow),
        createdAgentSummary: closeoutSummary.created ? dependencies.agentSummaryRow(closeoutSummary.created.summary) : undefined,
        createdAgentSummaryArtifact: createdArtifact
      };
      output.write(await dependencies.formatRecordWithAgentDirectives(context, args, outputResult, json, { subjectWorkId: workId }));
      return { exitCode: 0 };
    }
    case "reopen": {
      const result = await dependencies.reopenWorkCommand(context, await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference")), args);
      output.write(formatRecord({ ...result, postMutationWork: await context.runtime.getWorkView(result.work.meta.id) }, json));
      return { exitCode: 0 };
    }
    case "split": {
      const parentId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const parent = await context.store.read(async (reader) => dependencies.requireWork(reader, parentId));
      const child = await context.runtime.createWork({
        title: requiredFlag(args, "title"),
        description: flagValue(args, "description"),
        kind: "task",
        priority: dependencies.parsePriority(flagValue(args, "priority")) ?? parent.priority,
        acceptanceCriteria: dependencies.normalizedNonEmptyStrings(flagValues(args, "acceptance")),
        labels: dependencies.uniqueStrings([...parent.labels, ...dependencies.labelsFromArgs(args)]),
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

async function reservationCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkCommandDependencies
): Promise<CommandResult> {
  if (action !== "list") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown reservation command: ${action ?? ""}`);
  }

  const agentId = dependencies.optionalAgentIdFromArgs(args);
  const workRef = flagValue(args, "work");
  const workId = workRef ? await dependencies.resolveWorkId(context, workRef, agentId ? { agentId } : undefined) : undefined;
  const status = dependencies.parseReservationStatus(flagValue(args, "status"));
  const onlyExpired = hasFlag(args, "expired");
  const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
  const now = Date.now();
  const rows = await context.store.read(async (reader) => {
    const reservations = await reader.listReservations();
    const workItems = await reader.listWorkItems();
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    return reservations
      .map((reservation) => dependencies.reservationListRow(reservation, workById.get(reservation.workId), now))
      .filter((row) => !agentId || row.agentId === agentId)
      .filter((row) => !workId || row.workId === workId)
      .filter((row) => !status || row.status === status)
      .filter((row) => !onlyExpired || row.expired)
      .sort(dependencies.compareReservationRows)
      .slice(0, limit);
  });
  output.write(json ? formatRecord(rows, true) : table(rows.map(dependencies.textReservationListRow)));
  return { exitCode: 0 };
}

async function depCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const type = dependencies.dependencyTypeFromArgs(args);
      const blockedWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "remove": {
      const type = dependencies.dependencyTypeFromArgs(args);
      const blockedWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.removeBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "tree": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const tree = await context.store.read(async (reader) =>
        dependencies.dependencyTreeForWork(workId, await reader.listWorkItems(), await reader.listGraphEdges())
      );
      output.write(json ? await dependencies.formatRecordWithAgentDirectives(context, args, tree, true, { subjectWorkId: workId }) : table(dependencies.dependencyTreeRows(tree)));
      return { exitCode: 0 };
    }
    case "cycles": {
      const cycles = await context.store.read(async (reader) => dependencies.dependencyCyclesFromGraph(await reader.listGraphEdges()));
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

// ---------------------------------------------------------------------------
// `work list` human rendering: open-only by default, sorted for readability,
// with a single truncated `container` (immediate parent title) column instead
// of the full ancestor id chain. JSON output is computed separately in the
// `list` case above and is untouched by any of this.
// ---------------------------------------------------------------------------

const WORK_LIST_STATUS_GROUP_RANK: Readonly<Record<string, number>> = {
  in_progress: 0,
  ready: 1,
  blocked: 2,
  draft: 3
};

function workListHumanStatusRank(status: WorkStatus): number {
  return WORK_LIST_STATUS_GROUP_RANK[status] ?? 4;
}

function workListHumanPriorityRank(priority: WorkPriority): number {
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

function isOpenWorkStatusForHumanList(status: WorkStatus): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "verified";
}

function compareWorkListHumanOrder(left: WorkItem, right: WorkItem): number {
  return (
    workListHumanStatusRank(left.status) - workListHumanStatusRank(right.status) ||
    workListHumanPriorityRank(right.priority) - workListHumanPriorityRank(left.priority) ||
    left.title.localeCompare(right.title)
  );
}

interface WorkListLineageEntryLike {
  readonly title: string;
}

function immediateContainerTitle(row: WorkListRow): string | undefined {
  const lineage = row.lineage as readonly WorkListLineageEntryLike[] | undefined;
  if (!lineage || lineage.length === 0) {
    return undefined;
  }
  // Lineage is ordered furthest ancestor first; the closest parent is last.
  return lineage[lineage.length - 1]?.title;
}

const WORK_LIST_COLUMNS: readonly BoundedTableColumn[] = [
  { key: "id", header: "id" },
  { key: "kind", header: "kind" },
  { key: "status", header: "status" },
  { key: "priority", header: "priority" },
  { key: "title", header: "title", flex: true },
  { key: "container", header: "container", flex: true, minWidth: 12 },
  { key: "labels", header: "labels", flex: true, minWidth: 10 }
];

function formatWorkListHuman(rows: readonly WorkListRow[], wide: boolean, includeClosed: boolean): string {
  if (rows.length === 0) {
    return includeClosed ? "No work found\n" : "No open work found (pass --all or --closed to include closed work)\n";
  }
  return boundedTable(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      priority: row.priority,
      title: row.title,
      container: immediateContainerTitle(row) ?? "-",
      labels: row.labels.join(",")
    })),
    WORK_LIST_COLUMNS,
    { wide }
  );
}

// ---------------------------------------------------------------------------
// `work rollup`: renders the work hierarchy (milestone -> sprint -> task) as a
// bounded table. Built entirely over `@boreal/ui-model`'s `buildRepoRollupView`
// so the hierarchy/progress derivation matches the TUI Roll-Up route and
// `sprint show`/`sprint board` scope membership exactly -- no second
// derivation lives here.
// ---------------------------------------------------------------------------

interface WorkRollupFilters {
  readonly all: boolean;
  readonly kind?: WorkKind;
  readonly labels: readonly string[];
  readonly depth?: number;
  readonly limit?: number;
  readonly containerId?: string;
}

interface WorkRollupRow {
  readonly id: string;
  readonly kind: RollupNodeKind;
  readonly status?: WorkStatus;
  readonly title: string;
  readonly depth: number;
  readonly isContainer: boolean;
  readonly done?: number;
  readonly total?: number;
  readonly blocked?: number;
  readonly owner?: string;
  readonly labels: readonly string[];
}

interface WorkRollupResult {
  readonly schemaVersion: "boreal.cli.work.rollup.v1";
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly filters: WorkRollupFilters;
  readonly summary: RepoRollupSummary;
  readonly rows: readonly WorkRollupRow[];
}

async function workRollupResult(
  context: CliContext,
  containerRef: string | undefined,
  args: ParsedArgs,
  dependencies: WorkCommandDependencies
): Promise<WorkRollupResult> {
  const generatedAt = nowIso();
  const includeAll = hasFlag(args, "all");
  const kindFilter = dependencies.parseWorkKind(flagValue(args, "kind"));
  const labelFilters = dependencies.labelsFromArgs(args);
  const depthLimit = dependencies.parseNonNegativeInteger(flagValue(args, "depth"), "--depth");
  const rowLimit = dependencies.parseLimit(flagValue(args, "limit"));
  const containerId = containerRef ? await dependencies.resolveWorkId(context, containerRef) : undefined;

  const { workItems, graphEdges, reservations } = await context.store.read(async (reader) => ({
    workItems: await reader.listWorkItems(),
    graphEdges: await reader.listGraphEdges(),
    reservations: await reader.listReservations()
  }));

  const generatedAtMs = Date.parse(generatedAt);
  const reservationsByWorkId = new Map<string, WorkReservationView>();
  for (const reservation of reservations) {
    if (reservation.status !== "active") {
      continue;
    }
    reservationsByWorkId.set(reservation.workId, {
      id: reservation.meta.id,
      agentId: String(reservation.agentId),
      reservedAt: reservation.reservedAt,
      expiresAt: reservation.expiresAt,
      expired: reservation.expiresAt !== undefined && Date.parse(reservation.expiresAt) <= generatedAtMs
    });
  }

  const projectName = context.workspaceRoot.split("/").filter(Boolean).at(-1) ?? context.workspaceRoot;
  const view = buildRepoRollupView({
    workspaceRoot: context.workspaceRoot,
    generatedAt,
    projectName,
    work: workItems,
    graphEdges,
    reservationsByWorkId
  });

  const nodesById = new Map(view.flatRows.map((node) => [node.id, node] as const));
  const rows: WorkRollupRow[] = [];

  const passesNodeFilters = (node: RollupNodeView, forceOpen: boolean): boolean => {
    const openOk = forceOpen || includeAll || node.workStatus === undefined || isOpenWorkStatusForHumanList(node.workStatus);
    const kindOk = !kindFilter || node.kind === kindFilter;
    const labelOk = labelFilters.every((label) => node.labels.includes(label));
    return openOk && kindOk && labelOk;
  };

  const visit = (node: RollupNodeView, depth: number, forceOpen: boolean): void => {
    if (depthLimit !== undefined && depth > depthLimit) {
      return;
    }
    if (!passesNodeFilters(node, forceOpen)) {
      return;
    }
    rows.push(toWorkRollupRow(node, depth));
    for (const childId of node.childIds) {
      const child = nodesById.get(childId);
      if (child) {
        visit(child, depth + 1, false);
      }
    }
  };

  if (containerId) {
    const root = nodesById.get(containerId);
    if (!root) {
      throw new BorealError("BOREAL_NOT_FOUND", "Work item not found for rollup", { containerId });
    }
    visit(root, 0, true);
  } else {
    const rootContainers = view.root.childIds
      .map((id) => nodesById.get(id))
      .filter((node): node is RollupNodeView => node !== undefined)
      .filter((node) => node.kind === "milestone" || node.childIds.length > 0)
      .sort((left, right) => left.title.localeCompare(right.title));
    for (const rootContainer of rootContainers) {
      visit(rootContainer, 0, false);
    }
  }

  const limitedRows = rowLimit !== undefined ? rows.slice(0, rowLimit) : rows;

  return {
    schemaVersion: "boreal.cli.work.rollup.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    filters: {
      all: includeAll,
      kind: kindFilter,
      labels: labelFilters,
      depth: depthLimit,
      limit: rowLimit,
      containerId
    },
    summary: view.summary,
    rows: limitedRows
  };
}

function toWorkRollupRow(node: RollupNodeView, depth: number): WorkRollupRow {
  const isContainer = node.childIds.length > 0;
  return {
    id: node.id,
    kind: node.kind,
    status: node.workStatus,
    title: node.title,
    depth,
    isContainer,
    done: isContainer ? node.progress.done : undefined,
    total: isContainer ? node.progress.total : undefined,
    blocked: isContainer ? node.blockerSummary.blockedDescendantCount : undefined,
    owner: node.reservation?.agentId,
    labels: node.labels
  };
}

const WORK_ROLLUP_COLUMNS: readonly BoundedTableColumn[] = [
  { key: "kind", header: "kind" },
  { key: "status", header: "status" },
  { key: "title", header: "title", flex: true },
  { key: "done", header: "done" },
  { key: "blk", header: "blk" },
  { key: "owner", header: "owner" }
];

function formatWorkRollup(result: WorkRollupResult, wide: boolean): string {
  if (result.rows.length === 0) {
    return "No work found for rollup\n";
  }
  return boundedTable(
    result.rows.map((row) => ({
      kind: `${"  ".repeat(row.depth)}${row.kind}`,
      status: row.status ?? "",
      title: row.title,
      done: row.total !== undefined ? `${row.done}/${row.total}` : "-",
      blk: row.isContainer ? String(row.blocked ?? 0) : "-",
      owner: row.owner ?? "-"
    })),
    WORK_ROLLUP_COLUMNS,
    { wide }
  );
}
