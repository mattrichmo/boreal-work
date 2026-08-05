import type {
  AgentSummaryRecord,
  AgentReservation,
  EvidenceId,
  EvidenceKind,
  EvidenceOutcome,
  EvidenceRecord,
  IsoTimestamp,
  VerificationVerdict,
  WorkId,
  WorkItem
} from "@boreal/core";
import { BorealError } from "@boreal/core";
import type {
  ClaimNextWorkResult,
  FinishReservedWorkInput,
  FinishReservedWorkResult,
  FinishReservedWorkSummaryFactory
} from "@boreal/engine";
import type { WorkItemView } from "@boreal/ui-model";

import { flagValue, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

interface ReservationRow {
  readonly id: string;
  readonly workId: string;
}

interface AgentStatusLike {
  readonly reservations: {
    readonly expiredActiveCount: number;
    readonly capacityRemaining: number;
    readonly active: readonly ReservationRow[];
  };
}

interface HandoffResultLike {
  readonly work?: WorkItemView;
}

interface BranchResultLike {
  readonly reservation: AgentReservation;
  readonly gitBranch?: unknown;
}

interface FinishGitResult {
  readonly branch: string;
  readonly headSha: string;
  readonly worktreePath?: string;
}

interface FinishEvidencePayloadLike {
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

interface AgentRenewRow {
  readonly workId: WorkId;
  readonly reservationId: string;
  readonly expiresAt: string;
  readonly previousExpiresAt?: string;
}

interface AgentRenewSkippedRow {
  readonly workId: WorkId;
  readonly reservationId: string;
  readonly reason: string;
}

interface AgentRenewResult {
  readonly schemaVersion: "boreal.cli.agent.renew.v1";
  readonly generatedAt: IsoTimestamp;
  readonly agentId: string;
  readonly extend: string;
  readonly expiresAt: IsoTimestamp;
  readonly renewed: readonly AgentRenewRow[];
  readonly skipped: readonly AgentRenewSkippedRow[];
}

export interface AgentCommandDependencies {
  readonly agentIdFromArgs: (args: ParsedArgs, fallback: string) => string;
  readonly nowIso: () => IsoTimestamp;
  readonly labelsFromArgs: (args: ParsedArgs) => readonly string[];
  readonly buildAgentGuide: (context: CliContext, agentId: string, labels: readonly string[]) => Promise<unknown>;
  readonly formatAgentGuide: (guide: unknown) => string;
  readonly buildAgentStatus: (context: CliContext, agentId: string, labels: readonly string[]) => Promise<AgentStatusLike>;
  readonly dashboardView: (args: ParsedArgs) => boolean;
  readonly formatAgentStatusDashboard: (status: AgentStatusLike) => string;
  readonly optionalContainerIdFromArgs: (context: CliContext, args: ParsedArgs) => Promise<WorkId | undefined>;
  readonly parseHandoffResultLimit: (args: ParsedArgs) => number;
  readonly resolveWorkId: (context: CliContext, value: string, options?: { readonly agentId?: string }) => Promise<WorkId>;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly agentStartBlocked: (
    agentId: string,
    labels: readonly string[],
    status: AgentStatusLike,
    reason: string
  ) => unknown;
  readonly assertExactClaimMatchesFilters: (
    context: CliContext,
    workId: WorkId,
    labels: readonly string[],
    containerId: WorkId | undefined
  ) => Promise<void>;
  readonly requireReservation: (context: CliContext, reservationId: string) => Promise<AgentReservation>;
  readonly buildHandoffResult: (
    context: CliContext,
    workId: WorkId,
    args: ParsedArgs,
    limit: number,
    work?: WorkItem
  ) => Promise<HandoffResultLike>;
  readonly formatRecordWithAgentDirectives: (
    context: CliContext,
    args: ParsedArgs,
    value: unknown,
    json: boolean,
    options?: { readonly subjectWorkId?: WorkId; readonly subjectWork?: WorkItem }
  ) => Promise<string>;
  readonly asWorkId: (value: string) => WorkId;
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
  ) => Promise<ClaimNextWorkResult | undefined>;
  readonly parseReservationExpiresAt: (args: ParsedArgs) => IsoTimestamp | undefined;
  readonly attachGitBranchForClaim: (
    context: CliContext,
    args: ParsedArgs,
    claim: ClaimNextWorkResult
  ) => Promise<BranchResultLike>;
  readonly parseVerdict: (value: string | undefined) => VerificationVerdict;
  readonly idempotentAgentFinishResult: (
    context: CliContext,
    workId: WorkId,
    agentId: string,
    args: ParsedArgs
  ) => Promise<Record<string, unknown> | undefined>;
  readonly assertWorkNotAlreadyClosedForAgentFinish: (context: CliContext, workId: WorkId) => Promise<void>;
  readonly agentFinishGitPreflight: (
    context: CliContext,
    workId: WorkId,
    agentId: string
  ) => Promise<FinishGitResult | undefined>;
  readonly agentFinishSummaryFactory: (
    context: CliContext,
    args: ParsedArgs,
    workId: WorkId,
    closeReason: string
  ) => Promise<FinishReservedWorkSummaryFactory>;
  readonly finishEvidenceInput: (
    context: CliContext,
    args: ParsedArgs,
    workId: WorkId,
    verdict: VerificationVerdict
  ) => Promise<FinishEvidencePayloadLike>;
  readonly finishReservedWorkWithCompositeState: (
    context: CliContext,
    workId: WorkId,
    input: FinishReservedWorkInput
  ) => Promise<FinishReservedWorkResult>;
  readonly writeAgentSummaryArtifact: (context: CliContext, summary: AgentSummaryRecord) => Promise<unknown>;
  readonly captureGitFinishEvidence: (
    context: CliContext,
    workId: WorkId,
    gitRoot?: string
  ) => Promise<{ readonly evidence?: EvidenceRecord; readonly note?: string }>;
  readonly removeGitWorktreeAfterFinish: (
    context: CliContext,
    worktreePath: string | undefined
  ) => Promise<unknown | undefined>;
  readonly agentSummaryRow: (summary: AgentSummaryRecord) => unknown;
  readonly resultForWork: <T extends object>(value: T, work: WorkItem | WorkItemView) => T & { readonly result: unknown };
}

export async function agentCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: AgentCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "guide": {
      const guide = await dependencies.buildAgentGuide(
        context,
        dependencies.agentIdFromArgs(args, context.actor.id),
        dependencies.labelsFromArgs(args)
      );
      output.write(json ? formatRecord(guide, true) : dependencies.formatAgentGuide(guide));
      return { exitCode: 0 };
    }
    case "finish":
      return agentFinishCommand(rest, context, args, output, json, dependencies);
    case "renew":
      return agentRenewCommand(rest, context, args, output, json, dependencies);
    case "start":
      return agentStartCommand(rest, context, args, output, json, dependencies);
    case "status": {
      const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
      const labels = dependencies.labelsFromArgs(args);
      const status = await dependencies.buildAgentStatus(context, agentId, labels);
      output.write(json ? formatRecord(status, true) : dependencies.dashboardView(args) ? dependencies.formatAgentStatusDashboard(status) : formatRecord(status, false));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown agent command: ${action ?? ""}`);
  }
}

export async function agentStartCommand(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: AgentCommandDependencies
): Promise<CommandResult> {
  if (rest.length > 1) {
    throw new BorealError("BOREAL_INVALID_INPUT", "agent start accepts at most one work reference");
  }
  if (hasFlag(args, "worktree") && hasFlag(args, "no-branch")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--worktree cannot be combined with --no-branch");
  }
  const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
  const labels = dependencies.labelsFromArgs(args);
  const containerId = await dependencies.optionalContainerIdFromArgs(context, args);
  const handoffResultLimit = dependencies.parseHandoffResultLimit(args);
  const workId = rest[0] ? await dependencies.resolveWorkId(context, rest[0], { agentId }) : undefined;
  const status = await dependencies.buildAgentStatus(context, agentId, labels);

  if (status.reservations.expiredActiveCount > 0) {
    output.write(formatRecord(dependencies.agentStartBlocked(agentId, labels, status, "expired_active_reservations"), json));
    return { exitCode: 1 };
  }

  if (workId) {
    await dependencies.assertExactClaimMatchesFilters(context, workId, labels, containerId);
  }

  const activeReservation = workId
    ? status.reservations.active.find((reservation) => reservation.workId === workId)
    : status.reservations.active[0];
  if (activeReservation) {
    const reservation = await dependencies.requireReservation(context, activeReservation.id);
    const handoff = await dependencies.buildHandoffResult(context, dependencies.asWorkId(activeReservation.workId), args, handoffResultLimit);
    const result = {
      started: true,
      action: "continue_reserved_work",
      agentId,
      labels,
      status: await dependencies.buildAgentStatus(context, agentId, labels),
      reservation,
      releasedReservations: [],
      ...handoff
    };
    output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, {
      subjectWorkId: dependencies.asWorkId(activeReservation.workId)
    }));
    return { exitCode: 0 };
  }

  if (status.reservations.capacityRemaining <= 0) {
    output.write(formatRecord(dependencies.agentStartBlocked(agentId, labels, status, "reservation_capacity_reached"), json));
    return { exitCode: 1 };
  }

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
    const currentStatus = await dependencies.buildAgentStatus(context, agentId, labels);
    output.write(formatRecord(dependencies.agentStartBlocked(agentId, labels, currentStatus, "no_ready_work"), json));
    return { exitCode: 0 };
  }

  const branchResult = await dependencies.attachGitBranchForClaim(context, args, claim);
  const handoff = await dependencies.buildHandoffResult(context, claim.work.meta.id, args, handoffResultLimit, claim.work);
  const result = {
    started: true,
    action: "claimed_work",
    agentId,
    labels,
    status: await dependencies.buildAgentStatus(context, agentId, labels),
    reservation: branchResult.reservation,
    releasedReservations: claim.releasedReservations,
    ...(branchResult.gitBranch ? { gitBranch: branchResult.gitBranch } : {}),
    postMutationWork: handoff.work,
    ...handoff
  };
  output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, {
    subjectWork: claim.work
  }));
  return { exitCode: 0 };
}

async function agentRenewCommand(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: AgentCommandDependencies
): Promise<CommandResult> {
  if (rest.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "agent renew does not accept positional arguments");
  }
  if (!hasFlag(args, "all")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "agent renew currently requires --all");
  }
  const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
  const extend = parseAgentRenewExtend(flagValue(args, "extend") ?? "30m");
  const generatedAt = dependencies.nowIso();
  const expiresAt = new Date(Date.parse(generatedAt) + extend.ms).toISOString() as IsoTimestamp;
  const reservations = await context.store.read(async (reader) =>
    (await reader.listActiveReservationsForAgent(agentId))
      .slice()
      .sort((left, right) => left.workId.localeCompare(right.workId) || left.meta.id.localeCompare(right.meta.id))
  );
  const renewed: AgentRenewRow[] = [];
  const skipped: AgentRenewSkippedRow[] = [];
  for (const reservation of reservations) {
    const work = await context.store.read((reader) => reader.getWorkItem(reservation.workId));
    if (!work || work.reservationId !== reservation.meta.id) {
      skipped.push({
        workId: reservation.workId,
        reservationId: reservation.meta.id,
        reason: work ? "work_reservation_mismatch" : "work_missing"
      });
      continue;
    }
    const result = await context.runtime.renewWorkReservation({
      workId: reservation.workId,
      expiresAt
    });
    renewed.push({
      workId: result.work.meta.id,
      reservationId: result.reservation.meta.id,
      expiresAt: result.reservation.expiresAt ?? expiresAt,
      previousExpiresAt: reservation.expiresAt
    });
  }
  const result: AgentRenewResult = {
    schemaVersion: "boreal.cli.agent.renew.v1",
    generatedAt,
    agentId,
    extend: extend.value,
    expiresAt,
    renewed,
    skipped
  };
  output.write(json ? formatRecord(result, true) : formatRecord(result, false));
  return { exitCode: 0 };
}

function parseAgentRenewExtend(value: string): { readonly value: string; readonly ms: number } {
  const trimmed = value.trim();
  const match = /^([1-9][0-9]*)(m|h)$/.exec(trimmed);
  if (!match) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--extend must be a positive duration like 30m or 2h");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return {
    value: trimmed,
    ms: amount * (unit === "m" ? 60_000 : 3_600_000)
  };
}

async function agentFinishCommand(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: AgentCommandDependencies
): Promise<CommandResult> {
  const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
  const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"), { agentId });
  const close = hasFlag(args, "close");
  const release = hasFlag(args, "release");

  if (close && release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--close and --release cannot be used together");
  }
  if (!close && !release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish requires --close or --release");
  }
  const verdict = dependencies.parseVerdict(flagValue(args, "verdict"));
  if (close && verdict !== "passed") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--close requires a passed verification verdict");
  }

  const noop = await dependencies.idempotentAgentFinishResult(context, workId, agentId, args);
  if (noop) {
    output.write(await dependencies.formatRecordWithAgentDirectives(context, args, noop, json, { subjectWorkId: workId }));
    return { exitCode: 0 };
  }
  await dependencies.assertWorkNotAlreadyClosedForAgentFinish(context, workId);
  const finishGit = await dependencies.agentFinishGitPreflight(context, workId, agentId);
  const closeGit = finishGit ? { branch: finishGit.branch, headSha: finishGit.headSha } : undefined;

  const closeReason = close ? requiredFlag(args, "reason") : undefined;
  const closeoutSummaryFactory = closeReason
    ? await dependencies.agentFinishSummaryFactory(context, args, workId, closeReason)
    : undefined;
  const finishEvidence = await dependencies.finishEvidenceInput(context, args, workId, verdict);
  const finished = await dependencies.finishReservedWorkWithCompositeState(context, workId, {
    workId,
    agentId,
    ...(finishEvidence.evidenceId
      ? { evidenceId: finishEvidence.evidenceId }
      : { evidence: finishEvidence.evidence as NonNullable<typeof finishEvidence.evidence> }),
    verification: {
      verdict,
      notes: flagValue(args, "notes")
    },
    close: closeReason ? { reason: closeReason, agentSummary: closeoutSummaryFactory, ...(closeGit ? { git: closeGit } : {}) } : undefined,
    release
  });
  const closeoutSummaryArtifact = finished.agentSummary
    ? await dependencies.writeAgentSummaryArtifact(context, finished.agentSummary)
    : undefined;
  const gitEvidence = await dependencies.captureGitFinishEvidence(context, workId, finishGit?.worktreePath);
  const worktreeRemoval = close && hasFlag(args, "remove-worktree")
    ? await dependencies.removeGitWorktreeAfterFinish(context, finishGit?.worktreePath)
    : undefined;

  const result = {
    finished: true,
    action: close ? "verified_and_closed" : "verified_and_released",
    agentId,
    work: await context.runtime.getWorkView(workId),
    evidence: finished.evidence,
    evidenceRefs: finishEvidence.evidenceRefs,
    inlineEvidence: finishEvidence.inlineEvidence,
    gitEvidence: gitEvidence.evidence,
    gitEvidenceNote: gitEvidence.note,
    worktreeRemoval,
    verification: finished.verification,
    reservation: finished.reservation,
    closedWork: finished.closedWork,
    agentSummary: finished.agentSummary ? dependencies.agentSummaryRow(finished.agentSummary) : undefined,
    agentSummaryArtifact: closeoutSummaryArtifact,
    release: finished.release,
    status: await dependencies.buildAgentStatus(context, agentId, [])
  };
  output.write(await dependencies.formatRecordWithAgentDirectives(context, args, dependencies.resultForWork(result, result.work), json, {
    subjectWork: finished.closedWork ?? finished.work
  }));
  return { exitCode: 0 };
}
