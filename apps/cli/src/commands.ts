import {
  BorealError,
  isIsoTimestamp,
  type AgentReservation,
  type ClaimId,
  type ClaimRecord,
  type ClaimStatus,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type DecisionStatus,
  type EvidenceRecord,
  type EvidenceKind,
  type EvidenceOutcome,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type KnowledgeSourceKind,
  type ReservationId,
  type ReservationStatus,
  type VerificationRecord,
  type VerificationVerdict,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import type { SearchResult } from "@boreal/search";
import { breakStaleFileLock, inspectFileLock } from "@boreal/storage";
import type { WorkItemView } from "@boreal/ui-model";
import { deriveReadinessStatus } from "@boreal/work-engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "./args.js";
import {
  COMMAND_DEFINITIONS,
  commandPath,
  findCommandDefinition,
  serializeCommandDefinition,
  validateCommandFlags
} from "./command-registry.js";
import { asEvidenceId, asWorkId, runDoctor, type Diagnostic } from "./doctor.js";
import { assertInitialized, createCliContext, ensureWorkspaceDirs, type CliContext } from "./context.js";
import {
  createSnapshot,
  exportJson,
  exportMarkdown,
  importJson,
  listSnapshots,
  showSnapshot
} from "./import-export.js";
import { formatRecord, table, type CliOutput } from "./output.js";
import { runSearch, writeSearchIndex } from "./search-cli.js";

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

type AgentStartReason = "expired_active_reservations" | "reservation_capacity_reached" | "no_ready_work";

interface HandoffBundle {
  readonly work: WorkItemView;
  readonly contextPack: ContextPack;
  readonly search: {
    readonly query: string;
    readonly results: readonly SearchResult[];
  };
}

interface AgentStartBlocked {
  readonly started: false;
  readonly reason: AgentStartReason;
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly status: AgentStatus;
  readonly recommendedAction: AgentStatus["recommendedAction"];
}

interface AgentStartReady extends HandoffBundle {
  readonly started: true;
  readonly action: "claimed_work" | "continue_reserved_work";
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly status: AgentStatus;
  readonly reservation: AgentReservation;
  readonly releasedReservations: readonly AgentReservation[];
}

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
    return commandsCommand(output, json);
  }

  const context = await createCliContext(args, cwd);
  const [group, action, ...rest] = args.command;
  if (definition.requiresWorkspace) {
    assertInitialized(context);
  }

  switch (group) {
    case "init":
      return initCommand(context, args, output, json);
    case "work":
      return workCommand(action, rest, context, args, output, json);
    case "evidence":
      return evidenceCommand(action, rest, context, args, output, json);
    case "source":
      return sourceCommand(action, rest, context, args, output, json);
    case "claim":
      return claimCommand(action, rest, context, args, output, json);
    case "decision":
      return decisionCommand(action, rest, context, args, output, json);
    case "context":
      return contextCommand(action, rest, context, args, output, json);
    case "search":
      return searchCommand(action, rest, context, args, output, json);
    case "reservation":
      return reservationCommand(action, context, args, output, json);
    case "agent":
      return agentCommand(action, rest, context, args, output, json);
    case "export":
      return exportCommand(action, context, args, output, json);
    case "import":
      return importCommand(action, context, args, output, json);
    case "snapshot":
      return snapshotCommand(action, rest, context, args, output, json);
    case "doctor":
      return doctorCommand(context, args, output, json);
    case "lock":
      return lockCommand(action, context, args, output, json);
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${group ?? ""}`);
  }
}

function commandsCommand(output: CliOutput, json: boolean): CommandResult {
  const registry = {
    commands: COMMAND_DEFINITIONS.map(serializeCommandDefinition)
  };
  if (json) {
    output.write(formatRecord(registry, true));
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
      const guide = buildAgentGuide(flagValue(args, "agent") ?? context.actor.id, flagValues(args, "label"));
      output.write(json ? formatRecord(guide, true) : formatAgentGuide(guide));
      return { exitCode: 0 };
    }
    case "finish":
      return agentFinishCommand(rest, context, args, output, json);
    case "start":
      return agentStartCommand(context, args, output, json);
    case "status": {
      const agentId = flagValue(args, "agent") ?? context.actor.id;
      const labels = flagValues(args, "label");
      output.write(formatRecord(await buildAgentStatus(context, agentId, labels), json));
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
  const agentId = flagValue(args, "agent") ?? context.actor.id;
  const labels = flagValues(args, "label");
  const status = await buildAgentStatus(context, agentId, labels);

  if (status.reservations.expiredActiveCount > 0) {
    output.write(formatRecord(agentStartBlocked(agentId, labels, status, "expired_active_reservations"), json));
    return { exitCode: 1 };
  }

  const activeReservation = status.reservations.active[0];
  if (activeReservation) {
    const reservation = await requireReservation(context, activeReservation.id);
    const handoff = await buildHandoffBundle(context, asWorkId(activeReservation.workId), args);
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

  const handoff = await buildHandoffBundle(context, claim.work.meta.id, args);
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
  const workId = asWorkId(requiredPositional(rest, 0, "work id"));
  const agentId = flagValue(args, "agent") ?? context.actor.id;
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

  const reservation = await requireAgentWorkReservation(context, workId, agentId);
  const evidence = await context.runtime.recordEvidence({
    subjectId: workId,
    subjectType: "work",
    kind: parseEvidenceKind(flagValue(args, "kind")),
    summary: requiredFlag(args, "summary"),
    outcome: parseFinishOutcome(flagValue(args, "outcome"), verdict),
    command: flagValue(args, "command"),
    uri: flagValue(args, "uri")
  });
  await requireAgentWorkReservation(context, workId, agentId);
  const verification = await context.runtime.verifyWork({
    workId,
    verdict,
    evidenceIds: [evidence.meta.id],
    notes: flagValue(args, "notes")
  });
  await requireAgentWorkReservation(context, workId, agentId);

  let closedWork: WorkItem | undefined;
  let releaseResult: ReservationLifecycleResult | undefined;
  if (close) {
    closedWork = await context.runtime.closeWork({
      workId,
      reason: requiredFlag(args, "reason")
    });
    await requireAgentWorkReservation(context, workId, agentId);
    releaseResult = await context.runtime.releaseWorkReservation(workId);
  } else if (release) {
    releaseResult = await context.runtime.releaseWorkReservation(workId);
  }

  output.write(
    formatRecord(
      {
        finished: true,
        action: close ? "verified_and_closed" : "verified_and_released",
        agentId,
        work: await context.runtime.getWorkView(workId),
        evidence,
        verification,
        reservation: releaseResult?.reservation ?? reservation,
        closedWork,
        release: releaseResult,
        status: await buildAgentStatus(context, agentId, [])
      } satisfies AgentFinishResult,
      json
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

  const agentId = flagValue(args, "agent");
  const workId = optionalWorkId(flagValue(args, "work"));
  const status = parseReservationStatus(flagValue(args, "status"));
  const onlyExpired = hasFlag(args, "expired");
  const limit = parseLimit(flagValue(args, "limit"));
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
      .slice(0, limit ?? reservations.length);
  });
  output.write(json ? formatRecord(rows, true) : table(rows.map(textReservationListRow)));
  return { exitCode: 0 };
}

async function buildAgentStatus(
  context: CliContext,
  agentId: string,
  labels: readonly string[]
): Promise<AgentStatus> {
  const now = Date.now();
  const maxActiveReservations = context.runtime.policy.maxActiveReservationsPerAgent;
  return context.store.read(async (reader) => {
    const [reservations, workItems] = await Promise.all([reader.listReservations(), reader.listWorkItems()]);
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    const reservationRows = reservations.map((reservation) => reservationListRow(reservation, workById.get(reservation.workId), now));
    const active = reservationRows
      .filter((row) => row.agentId === agentId && row.status === "active")
      .sort(compareReservationRows);
    const expiredActive = active.filter((row) => row.expired);
    const claimableWork = [...claimableWorkItems(workItems, labels)].sort(compareWorkItems);
    const capacityRemaining = Math.max(0, maxActiveReservations - active.length);

    return {
      agentId,
      labels,
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
        agentId,
        labels,
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
  _args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  await ensureWorkspaceDirs(context);
  const result = await context.runtime.ensureWorkspaceInitialized();
  output.write(
    formatRecord(
      { initialized: result.initialized, workspaceRoot: context.workspaceRoot, eventId: result.event.meta.id },
      json
    )
  );
  return { exitCode: 0 };
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
        labels: flagValues(args, "label"),
        ready: hasFlag(args, "ready")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "ready": {
      const work = await context.runtime.markReady(asWorkId(requiredPositional(rest, 0, "work id")));
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = listStatus(args);
      const labels = flagValues(args, "label");
      const limit = parseLimit(flagValue(args, "limit"));
      const items = await context.store.read((reader) =>
        reader.listWorkItems({
          status,
          labels: labels.length > 0 ? labels : undefined
        })
      );
      const rows = items.slice(0, limit ?? items.length).map(workListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "next": {
      const labels = flagValues(args, "label");
      const limit = parseLimit(flagValue(args, "limit")) ?? 10;
      const views = await context.runtime.listReadyWork();
      const rows = views
        .filter((view) => labels.every((label) => view.labels.includes(label)))
        .sort(compareWorkViews)
        .slice(0, limit)
        .map(workViewListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const view = await context.runtime.getWorkView(asWorkId(requiredPositional(rest, 0, "work id")));
      output.write(formatRecord(view, json));
      return { exitCode: 0 };
    }
    case "block": {
      const blockedWorkId = asWorkId(requiredPositional(rest, 0, "blocked work id"));
      const blockingWorkId = asWorkId(requiredPositional(rest, 1, "blocking work id"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "reserve": {
      const work = await context.runtime.reserveWork({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        agentId: flagValue(args, "agent") ?? context.actor.id,
        purpose: flagValue(args, "purpose"),
        expiresAt: parseReservationExpiresAt(args),
        force: hasFlag(args, "force"),
        forceReason: flagValue(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "claim": {
      const agentId = flagValue(args, "agent") ?? context.actor.id;
      const labels = flagValues(args, "label");
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

      const handoff = await buildHandoffBundle(context, claim.work.meta.id, args);
      output.write(
        formatRecord(
          {
            claimed: true,
            work: handoff.work,
            reservation: claim.reservation,
            releasedReservations: claim.releasedReservations,
            contextPack: handoff.contextPack,
            search: handoff.search
          },
          json
        )
      );
      return { exitCode: 0 };
    }
    case "release": {
      const result = await context.runtime.releaseWorkReservation(asWorkId(requiredPositional(rest, 0, "work id")));
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "renew": {
      const result = await context.runtime.renewWorkReservation({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        expiresAt: requiredReservationExpiresAt(args)
      });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "verify": {
      const evidenceIds = flagValues(args, "evidence").map(asEvidenceId);
      const verification = await context.runtime.verifyWork({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        verdict: parseVerdict(flagValue(args, "verdict")),
        evidenceIds,
        notes: flagValue(args, "notes")
      });
      output.write(formatRecord(verification, json));
      return { exitCode: 0 };
    }
    case "close": {
      const work = await context.runtime.closeWork({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        reason: requiredFlag(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown work command: ${action ?? ""}`);
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
    subjectId: asWorkId(requiredPositional(rest, 0, "work id")),
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
      const limit = parseLimit(flagValue(args, "limit"));
      const sources = await context.runtime.listKnowledgeSources();
      const rows = sources
        .filter((source) => !kind || source.kind === kind)
        .slice(0, limit ?? sources.length)
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
      const claim = await context.runtime.createClaim({
        statement: requiredFlag(args, "statement"),
        status: parseClaimStatus(flagValue(args, "status")),
        sourceIds: flagValues(args, "source").map(asSourceId),
        evidenceIds: flagValues(args, "evidence").map(asEvidenceId)
      });
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseClaimStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"));
      const limit = parseLimit(flagValue(args, "limit"));
      const claims = await context.runtime.listClaims();
      const rows = claims
        .filter((claim) => !status || claim.status === status)
        .filter((claim) => !sourceId || claim.sourceIds.includes(sourceId))
        .slice(0, limit ?? claims.length)
        .map(claimListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const claim = await context.runtime.getClaim(asClaimId(requiredPositional(rest, 0, "claim id")));
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown claim command: ${action ?? ""}`);
  }
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
      const decision = await context.runtime.createDecision({
        title: requiredFlag(args, "title"),
        context: flagValue(args, "context") ?? "",
        decision: requiredFlag(args, "decision"),
        status: parseDecisionStatus(flagValue(args, "status")),
        consequences: flagValues(args, "consequence"),
        sourceIds: flagValues(args, "source").map(asSourceId)
      });
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseDecisionStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"));
      const limit = parseLimit(flagValue(args, "limit"));
      const decisions = await context.runtime.listDecisions();
      const rows = decisions
        .filter((decision) => !status || decision.status === status)
        .filter((decision) => !sourceId || decision.sourceIds.includes(sourceId))
        .slice(0, limit ?? decisions.length)
        .map(decisionListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const decision = await context.runtime.getDecision(asDecisionId(requiredPositional(rest, 0, "decision id")));
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown decision command: ${action ?? ""}`);
  }
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
      const views = await context.runtime.rebuildProjections();
      output.write(formatRecord({ rebuilt: views.length, views }, json));
      return { exitCode: 0 };
    }
    case "show": {
      const pack = await context.runtime.getContextPack(asWorkId(requiredPositional(rest, 0, "work id")));
      output.write(formatRecord(pack, json));
      return { exitCode: 0 };
    }
    case "search": {
      const results = await runSearch(context, rest.join(" "), {
        limit: parseLimit(flagValue(args, "limit")),
        type: "context_pack"
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
        limit: parseLimit(flagValue(args, "limit"))
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
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown import command: ${action ?? ""}`);
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
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const result = await runDoctor(context, hasFlag(args, "fix"));
  if (json) {
    output.write(formatRecord(result, true));
  } else {
    output.write(result.diagnostics.map(formatDiagnostic).join("\n") + "\n");
  }
  return { exitCode: result.ok ? 0 : 1 };
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
      output.write(formatRecord(inspection, json));
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

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--limit must be a positive integer");
  }
  return parsed;
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

function optionalWorkId(value: string | undefined): WorkId | undefined {
  return value ? asWorkId(value) : undefined;
}

async function requireReservation(context: CliContext, reservationId: string): Promise<AgentReservation> {
  const reservation = await context.store.read((reader) => reader.getReservation(reservationId as ReservationId));
  if (!reservation || reservation.status !== "active") {
    throw new BorealError("BOREAL_CONFLICT", "Active reservation changed while starting agent", { reservationId });
  }
  return reservation;
}

async function requireAgentWorkReservation(
  context: CliContext,
  workId: WorkId,
  agentId: string
): Promise<AgentReservation> {
  return context.store.read(async (reader) => {
    const work = await reader.getWorkItem(workId);
    if (!work) {
      throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId });
    }
    const activeReservations = (await reader.listReservationsForWork(workId)).filter((reservation) => reservation.status === "active");
    const reservation = work.reservationId
      ? activeReservations.find((entry) => entry.meta.id === work.reservationId)
      : activeReservations[0];
    if (!reservation) {
      throw new BorealError("BOREAL_CONFLICT", "Agent finish requires an active reservation", { workId, agentId });
    }
    if (String(reservation.agentId) !== agentId) {
      throw new BorealError("BOREAL_POLICY_VIOLATION", "Agent does not own the active reservation", {
        workId,
        agentId,
        reservationAgentId: reservation.agentId,
        reservationId: reservation.meta.id
      });
    }
    if (reservation.expiresAt && Date.parse(reservation.expiresAt) <= Date.now()) {
      throw new BorealError("BOREAL_POLICY_VIOLATION", "Agent reservation is expired; run `bwrk doctor --fix`", {
        workId,
        agentId,
        reservationId: reservation.meta.id,
        expiresAt: reservation.expiresAt
      });
    }
    return reservation;
  });
}

async function buildHandoffBundle(context: CliContext, workId: WorkId, args: ParsedArgs): Promise<HandoffBundle> {
  await context.runtime.rebuildProjections();
  const [work, contextPack] = await Promise.all([context.runtime.getWorkView(workId), context.runtime.getContextPack(workId)]);
  await writeSearchIndex(context);
  const query = flagValue(args, "query") ?? handoffSearchQuery(work, contextPack);
  const results = await runSearch(context, query, {
    limit: parseLimit(flagValue(args, "limit")) ?? 8
  });
  return {
    work,
    contextPack,
    search: {
      query,
      results
    }
  };
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
  const agentFlag = `--agent ${shellArg(agentId)}`;
  const scopedFlags = `${agentFlag}${labelFlags(labels)}`;
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
    agentId,
    labels,
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

function claimableWorkItems(workItems: readonly WorkItem[], labels: readonly string[]): readonly WorkItem[] {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  return workItems.filter((work) => {
    if (work.status !== "ready" || work.reservationId) {
      return false;
    }
    if (!labels.every((label) => work.labels.includes(label))) {
      return false;
    }
    const dependencies = work.dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
    if (dependencies.length !== work.dependencyIds.length) {
      return false;
    }
    return deriveReadinessStatus(work, dependencies) === "ready";
  });
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

function textWorkListRow(row: WorkListRow): Record<string, string> {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    title: row.title,
    labels: row.labels.join(",")
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

function claimListRow(claim: ClaimRecord): Record<string, string> {
  return {
    id: claim.meta.id,
    status: claim.status,
    statement: claim.statement,
    sources: claim.sourceIds.join(","),
    evidence: claim.evidenceIds.join(",")
  };
}

function decisionListRow(decision: DecisionRecord): Record<string, string> {
  return {
    id: decision.meta.id,
    status: decision.status,
    title: decision.title,
    decision: decision.decision,
    sources: decision.sourceIds.join(",")
  };
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
  bwrk help [init|work|evidence|source|claim|decision|context|search|reservation|agent|export|import|snapshot|doctor|lock|commands]
`;
}
